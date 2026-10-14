use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub session_count: usize,
    pub last_active: Option<String>,
    /// 用户是否置顶该项目（来自 workspace 元数据）。
    #[serde(default)]
    pub pinned: bool,
    /// 用户是否归档该项目（来自 workspace 元数据）。
    #[serde(default)]
    pub archived: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DashboardStats {
    pub num_startups: u64,
    pub total_projects: usize,
    pub total_sessions: usize,
    pub total_history: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub date: String,
    pub count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectTokenStat {
    pub name: String,
    pub path: String,
    pub session_count: usize,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

fn get_claude_home() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".claude"))
}

/// 扫描目录下所有 .jsonl 文件，返回文件列表和最新修改时间
fn scan_jsonl_files(dir: &Path) -> (Vec<PathBuf>, Option<std::time::SystemTime>) {
    let mut files = Vec::new();
    let mut latest: Option<std::time::SystemTime> = None;
    scan_jsonl_inner(dir, &mut files, &mut latest);
    (files, latest)
}

fn scan_jsonl_inner(
    dir: &Path,
    files: &mut Vec<PathBuf>,
    latest: &mut Option<std::time::SystemTime>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_jsonl_inner(&path, files, latest);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            // 更新最新修改时间
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if latest.is_none_or(|l| modified > l) {
                        *latest = Some(modified);
                    }
                }
            }
            files.push(path);
        }
    }
}

/// 从项目目录中的 .jsonl 文件提取 cwd 字段（即真实项目路径）
fn extract_cwd_from_project_dir(dir: &Path) -> Option<String> {
    // 优先读取一级 .jsonl 文件（主会话），避免读取 subagent 文件
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if let Some(cwd) = extract_cwd_from_jsonl(&path) {
            return Some(cwd);
        }
    }
    None
}

/// 从单个 .jsonl 文件的前几行提取 cwd 字段
fn extract_cwd_from_jsonl(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    // 只扫描前 20 行，cwd 通常在首行
    for line in reader.lines().take(20).flatten() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
            if let Some(cwd) = json.get("cwd").and_then(|v| v.as_str()) {
                if !cwd.is_empty() {
                    return Some(cwd.to_string());
                }
            }
        }
    }
    None
}

/// 获取项目列表
pub fn list_projects() -> Result<Vec<ProjectInfo>, io::Error> {
    let projects_dir = get_claude_home()?.join("projects");
    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let mut projects = Vec::new();

    for entry in fs::read_dir(&projects_dir)?.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        let dir_name = entry.file_name().to_string_lossy().to_string();
        // 优先从 .jsonl 内容读取 cwd（准确），fallback 到目录名解码
        let project_path = extract_cwd_from_project_dir(&entry.path())
            .unwrap_or_else(|| decode_project_path(&dir_name));
        let display_name = project_path
            .split(['/', '\\'])
            .next_back()
            .unwrap_or(&dir_name)
            .to_string();

        // 递归统计 session 文件数量（含 subagents 子目录）
        let (jsonl_files, latest_modified) = scan_jsonl_files(&entry.path());
        let session_count = jsonl_files.len();

        let last_active = latest_modified.map(|t| {
            let duration = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
            let secs = duration.as_secs() as i64;
            // 简单格式化为 ISO 字符串
            format_timestamp(secs)
        });

        projects.push(ProjectInfo {
            name: display_name,
            path: project_path,
            session_count,
            last_active,
            pinned: false,
            archived: false,
        });
    }

    // 应用 workspace 元数据：移除项过滤、归档项过滤、重命名、置顶。
    let metadata = crate::session_manager::workspace_metadata::load_project_metadata_map();
    if !metadata.is_empty() {
        projects.retain(|project| {
            let key = crate::session_manager::workspace_metadata::normalize_project_key(&project.path);
            !metadata.get(&key).map(|meta| meta.removed).unwrap_or(false)
        });
        for project in &mut projects {
            let key = crate::session_manager::workspace_metadata::normalize_project_key(&project.path);
            if let Some(meta) = metadata.get(&key) {
                project.pinned = meta.pinned;
                project.archived = meta.archived;
                if let Some(name) = &meta.custom_name {
                    project.name = name.clone();
                }
            }
        }
        // 归档项目从默认列表过滤。
        projects.retain(|project| !project.archived);
    }

    // 先按置顶分组，再按最后活跃时间倒序排列。
    projects.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| b.last_active.cmp(&a.last_active))
    });

    Ok(projects)
}

/// 获取仪表盘统计数据
#[allow(dead_code)]
pub fn get_stats() -> Result<DashboardStats, io::Error> {
    let claude_home = get_claude_home()?;

    // 读取 .claude.json 获取启动次数
    let num_startups = {
        let home = dirs::home_dir()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
        let claude_json = home.join(".claude.json");
        if claude_json.exists() {
            let content = fs::read_to_string(&claude_json)?;
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                json.get("numStartups")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
            } else {
                0
            }
        } else {
            0
        }
    };

    // 统计项目数
    let projects_dir = claude_home.join("projects");
    let total_projects = if projects_dir.exists() {
        fs::read_dir(&projects_dir)?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .count()
    } else {
        0
    };

    // 统计总 session 数
    let mut total_sessions = 0;
    if projects_dir.exists() {
        for entry in fs::read_dir(&projects_dir)?.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let (count, _) = scan_jsonl_files(&entry.path());
                total_sessions += count.len();
            }
        }
    }

    // 统计历史记录数
    let history_file = claude_home.join("history.jsonl");
    let total_history = if history_file.exists() {
        let content = fs::read_to_string(&history_file)?;
        content.lines().count()
    } else {
        0
    };

    Ok(DashboardStats {
        num_startups,
        total_projects,
        total_sessions,
        total_history,
    })
}

/// 获取历史活跃度数据（按天统计）
pub fn get_activity_history() -> Result<Vec<HistoryEntry>, io::Error> {
    let history_file = get_claude_home()?.join("history.jsonl");
    if !history_file.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&history_file)?;
    let mut date_counts: std::collections::BTreeMap<String, usize> =
        std::collections::BTreeMap::new();

    for line in content.lines() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(ts) = json.get("timestamp").and_then(|v| v.as_i64()) {
                let date = format_date(ts / 1000); // timestamp 是毫秒
                *date_counts.entry(date).or_insert(0) += 1;
            }
        }
    }

    let entries: Vec<HistoryEntry> = date_counts
        .into_iter()
        .map(|(date, count)| HistoryEntry { date, count })
        .collect();

    Ok(entries)
}

/// 将编码的目录名转换回路径
fn decode_project_path(encoded: &str) -> String {
    // C--guodevelop-claude-switch-v1 -> C:\guodevelop\claude-switch-v1
    // 规则：开头的 X-- 表示 X:\。后续 '-' 可能是路径分隔符，也可能是目录名中的连字符。
    // 为了更准确地还原，优先在真实文件系统中按"最长可匹配目录名"进行逐段匹配。
    if encoded.len() >= 3 && &encoded[1..3] == "--" {
        let drive = &encoded[0..1];
        let rest = &encoded[3..];
        let root = PathBuf::from(format!("{}:\\", drive));
        let parts: Vec<&str> = rest.split('-').filter(|p| !p.is_empty()).collect();

        if let Some(resolved) = resolve_encoded_parts(&root, &parts) {
            return resolved.to_string_lossy().to_string();
        }

        // 回退：按旧逻辑替换，保证对未知路径编码仍可工作。
        format!("{}:\\{}", drive, rest.replace('-', "\\"))
    } else {
        encoded.replace('-', "\\")
    }
}

/// 获取每个项目的 Token 使用统计（按项目内全部 session 聚合）
#[allow(dead_code)]
pub fn get_project_token_stats() -> Result<Vec<ProjectTokenStat>, io::Error> {
    let projects_dir = get_claude_home()?.join("projects");
    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let mut stats: Vec<ProjectTokenStat> = Vec::new();

    for entry in fs::read_dir(&projects_dir)?.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        let encoded = entry.file_name().to_string_lossy().to_string();
        let project_path = extract_cwd_from_project_dir(&entry.path())
            .unwrap_or_else(|| decode_project_path(&encoded));
        let project_name = project_path
            .split(['/', '\\'])
            .next_back()
            .unwrap_or(&encoded)
            .to_string();

        let mut session_count = 0usize;
        let mut input_tokens = 0u64;
        let mut output_tokens = 0u64;

        let (jsonl_files, _) = scan_jsonl_files(&entry.path());
        for file_path in &jsonl_files {
            session_count += 1;
            if let Some((input, output)) = cached_session_tokens(file_path) {
                input_tokens = input_tokens.saturating_add(input);
                output_tokens = output_tokens.saturating_add(output);
            }
        }

        stats.push(ProjectTokenStat {
            name: project_name,
            path: project_path,
            session_count,
            input_tokens,
            output_tokens,
            total_tokens: input_tokens.saturating_add(output_tokens),
        });
    }

    stats.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));
    Ok(stats)
}

/// 构建跨工具（Claude、Codex、Gemini）会话 ID 到项目工程路径的映射（内存缓存 60 秒）
pub fn get_session_project_map(db: &crate::database::Database) -> HashMap<String, String> {
    static CACHE: OnceLock<Mutex<(i64, HashMap<String, String>)>> = OnceLock::new();
    let cache_mutex = CACHE.get_or_init(|| Mutex::new((0, HashMap::new())));
    let now = chrono::Local::now().timestamp();
    if let Ok(guard) = cache_mutex.lock() {
        if now - guard.0 < 60 && !guard.1.is_empty() {
            return guard.1.clone();
        }
    }

    let mut map = HashMap::new();

    // 1. 读取 Gemini projects.json 获取 hash 对应的实际路径
    let mut gemini_map = HashMap::new();
    if let Some(home) = dirs::home_dir() {
        let p_file = home.join(".gemini").join("projects.json");
        if let Ok(content) = fs::read_to_string(&p_file) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(projects) = v.get("projects").and_then(|p| p.as_object()) {
                    for (path_str, _) in projects {
                        use sha2::{Digest, Sha256};
                        let mut hasher = Sha256::new();
                        hasher.update(path_str.as_bytes());
                        let h = format!("{:x}", hasher.finalize());
                        gemini_map.insert(h, path_str.clone());
                    }
                }
            }
        }
    }

    // 2. 从 session_scan_files 读取所有扫描过的会话路径并解析项目
    if let Ok(conn) = db.conn_for_read() {
        if let Ok(mut stmt) = conn.prepare("SELECT path FROM session_scan_files") {
            if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                for path_str in rows.flatten() {
                    let p = Path::new(&path_str);
                    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                    let norm = path_str.replace('/', "\\");

                    if norm.contains("\\.claude\\projects\\") {
                        if let Some(rest) = norm.split("\\.claude\\projects\\").nth(1) {
                            let parts: Vec<&str> = rest.split('\\').collect();
                            let encoded = parts[0];
                            let project_path = if encoded.starts_with("C--") {
                                format!("C:\\{}", &encoded[3..].replace('-', "\\"))
                            } else {
                                decode_project_path(encoded)
                            };
                            map.insert(stem.clone(), project_path.clone());
                        }
                    } else if norm.contains("\\.codex\\sessions\\") {
                        // 读取 Codex 会话第一行的 session_meta.payload.cwd
                        if let Ok(f) = fs::File::open(p) {
                            let mut reader = BufReader::new(f);
                            let mut first_line = String::new();
                            if reader.read_line(&mut first_line).is_ok() && !first_line.is_empty() {
                                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&first_line) {
                                    let meta = v.get("payload");
                                    let sid = meta.and_then(|m| m.get("session_id").or_else(|| m.get("id"))).and_then(|s| s.as_str());
                                    let cwd = meta.and_then(|m| m.get("cwd")).and_then(|s| s.as_str());
                                    if let Some(cwd) = cwd {
                                        if let Some(sid) = sid {
                                            map.insert(sid.to_string(), cwd.to_string());
                                        }
                                        map.insert(stem.clone(), cwd.to_string());
                                        if stem.starts_with("rollout-") {
                                            if let Some(uuid_part) = stem.split('-').last() {
                                                map.insert(uuid_part.to_string(), cwd.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else if norm.contains("\\.gemini\\tmp\\") {
                        if let Some(rest) = norm.split("\\.gemini\\tmp\\").nth(1) {
                            let parts: Vec<&str> = rest.split('\\').collect();
                            let hash = parts[0];
                            let proj_path = gemini_map.get(hash).cloned().unwrap_or_else(|| hash.to_string());
                            map.insert(stem.clone(), proj_path.clone());
                            if stem.starts_with("session-") {
                                map.insert(stem[8..].to_string(), proj_path);
                            }
                        }
                    }
                }
            }
        }
    }

    if let Ok(mut guard) = cache_mutex.lock() {
        *guard = (now, map.clone());
    }

    map
}

/// 从 SQLite (proxy_request_logs) 获取统一项目 Token 排行（支持 Claude+Codex+Gemini，包含缓存 Token）
pub fn get_project_token_stats_from_db(
    db: &crate::database::Database,
    app_filter: Option<&str>,
) -> Result<Vec<ProjectTokenStat>, String> {
    let session_map = get_session_project_map(db);

    let where_clause = match app_filter {
        Some("claude") => "WHERE (data_source = 'session_log' OR (data_source IS NOT NULL AND app_type = 'claude'))",
        Some("codex") => "WHERE (data_source = 'codex_session' OR (data_source IS NOT NULL AND app_type = 'codex'))",
        Some("gemini") => "WHERE (data_source = 'gemini_session' OR (data_source IS NOT NULL AND app_type = 'gemini'))",
        Some(other) if other != "all" && !other.is_empty() => "WHERE (data_source IS NOT NULL AND app_type = ?1)",
        _ => "WHERE data_source IN ('session_log', 'codex_session', 'gemini_session', 'opencode_session')",
    };

    let sql = format!(
        "SELECT session_id,
                sum(input_tokens),
                sum(output_tokens),
                sum(cache_read_tokens)
         FROM proxy_request_logs
         {}
         GROUP BY session_id",
        where_clause
    );

    let conn = db.conn_for_read()?;
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    struct ProjectAccum {
        name: String,
        path: String,
        sessions: std::collections::HashSet<String>,
        input_tokens: u64,
        output_tokens: u64,
        total_tokens: u64,
    }

    let mut project_map: HashMap<String, ProjectAccum> = HashMap::new();

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<(Option<String>, i64, i64, i64)> {
        let sid: Option<String> = row.get(0)?;
        let in_t: i64 = row.get(1)?;
        let out_t: i64 = row.get(2)?;
        let cache_t: i64 = row.get(3)?;
        Ok((sid, in_t, out_t, cache_t))
    };

    let rows: Vec<(Option<String>, i64, i64, i64)> = if let Some(app) = app_filter.filter(|a| *a != "all" && !a.is_empty() && *a != "claude" && *a != "codex" && *a != "gemini") {
        stmt.query_map([app], map_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
    } else {
        stmt.query_map([], map_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
    };

    for (sid_opt, in_t, out_t, cache_t) in rows {
        let sid = sid_opt.unwrap_or_default();
        let project_path = session_map.get(&sid).cloned().unwrap_or_else(|| "Other".to_string());
        
        let display_name = project_path
            .trim_end_matches(['/', '\\'])
            .split(['/', '\\'])
            .next_back()
            .unwrap_or(&project_path)
            .to_string();

        let entry = project_map.entry(project_path.clone()).or_insert_with(|| ProjectAccum {
            name: display_name,
            path: project_path,
            sessions: std::collections::HashSet::new(),
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
        });

        if !sid.is_empty() {
            entry.sessions.insert(sid);
        }
        let in_val = in_t.max(0) as u64;
        let out_val = out_t.max(0) as u64;
        let cache_val = cache_t.max(0) as u64;
        entry.input_tokens = entry.input_tokens.saturating_add(in_val);
        entry.output_tokens = entry.output_tokens.saturating_add(out_val);
        // 总 token 包含 input + output + cache_read
        let req_total = in_val.saturating_add(out_val).saturating_add(cache_val);
        entry.total_tokens = entry.total_tokens.saturating_add(req_total);
    }

    let mut stats: Vec<ProjectTokenStat> = project_map
        .into_values()
        .map(|acc| ProjectTokenStat {
            name: acc.name,
            path: acc.path,
            session_count: acc.sessions.len(),
            input_tokens: acc.input_tokens,
            output_tokens: acc.output_tokens,
            total_tokens: acc.total_tokens,
        })
        .collect();

    // 应用 workspace 元数据（自定义名称、置顶、归档）
    let metadata = crate::session_manager::workspace_metadata::load_project_metadata_map();
    if !metadata.is_empty() {
        stats.retain(|project| {
            let key = crate::session_manager::workspace_metadata::normalize_project_key(&project.path);
            !metadata.get(&key).map(|meta| meta.removed).unwrap_or(false)
        });
        for project in &mut stats {
            let key = crate::session_manager::workspace_metadata::normalize_project_key(&project.path);
            if let Some(meta) = metadata.get(&key) {
                if let Some(custom) = &meta.custom_name {
                    project.name = custom.clone();
                }
            }
        }
    }

    stats.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));
    Ok(stats)
}

/// 获取跨工具汇总的仪表盘 KPI 统计
pub fn get_unified_dashboard_stats(db: &crate::database::Database) -> Result<DashboardStats, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位主目录".to_string())?;

    // 读取 .claude.json 获取启动次数
    let num_startups = {
        let claude_json = home.join(".claude.json");
        if claude_json.exists() {
            if let Ok(content) = fs::read_to_string(&claude_json) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    json.get("numStartups").and_then(|v| v.as_u64()).unwrap_or(0)
                } else {
                    0
                }
            } else {
                0
            }
        } else {
            0
        }
    };

    // 统计总历史记录数 (history.jsonl)
    let total_history = {
        let history_file = home.join(".claude").join("history.jsonl");
        if history_file.exists() {
            fs::read_to_string(&history_file).map(|c| c.lines().count()).unwrap_or(0)
        } else {
            0
        }
    };

    // 从数据库统计多端项目数与会话数
    let (total_sessions, total_projects) = if let Ok(conn) = db.conn_for_read() {
        let session_count: i64 = conn
            .query_row(
                "SELECT count(DISTINCT session_id) FROM proxy_request_logs WHERE data_source IN ('session_log', 'codex_session', 'gemini_session', 'opencode_session')",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        let session_map = get_session_project_map(db);
        let mut projects: std::collections::HashSet<String> = std::collections::HashSet::new();
        for proj in session_map.values() {
            projects.insert(proj.clone());
        }
        (session_count.max(0) as usize, projects.len().max(1))
    } else {
        (0, 0)
    };

    Ok(DashboardStats {
        num_startups,
        total_projects,
        total_sessions,
        total_history,
    })
}

/// 单个会话文件的 token 合计缓存项
#[allow(dead_code)]
struct TokenSumEntry {
    size: u64,
    mtime_ms: i64,
    input: u64,
    output: u64,
}

/// 按文件 (size, mtime) 记忆化的 token 合计
#[allow(dead_code)]
static TOKEN_SUM_CACHE: OnceLock<Mutex<HashMap<PathBuf, TokenSumEntry>>> = OnceLock::new();

#[allow(dead_code)]
fn cached_session_tokens(path: &Path) -> Option<(u64, u64)> {
    let meta = fs::metadata(path).ok()?;
    let size = meta.len();
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let cache = TOKEN_SUM_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(map) = cache.lock() {
        if let Some(e) = map.get(path) {
            if e.size == size && e.mtime_ms == mtime_ms {
                return Some((e.input, e.output));
            }
        }
    }

    let (input, output) = sum_session_tokens(path).ok()?;
    if let Ok(mut map) = cache.lock() {
        map.insert(
            path.to_path_buf(),
            TokenSumEntry {
                size,
                mtime_ms,
                input,
                output,
            },
        );
    }
    Some((input, output))
}

#[allow(dead_code)]
fn sum_session_tokens(path: &std::path::Path) -> Result<(u64, u64), io::Error> {
    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);

    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;

    // map_while：读错误（如磁盘错误）时停止，flatten 遇到持续报错的迭代器会死循环
    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // 只有 assistant 消息带 usage；两个字面量缺一个就不可能计入，连 JSON 都不用解。
        // 绝大多数行是用户消息 / 工具结果（往往很长），这一步省掉了大部分解析开销。
        if !trimmed.contains("\"usage\"") || !trimmed.contains("\"assistant\"") {
            continue;
        }

        let json: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // usage 主要记录在 assistant 消息上；过滤后可显著减少误计。
        let msg_type = json
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        if msg_type != "assistant" {
            continue;
        }

        let usage = match json.get("message").and_then(|m| m.get("usage")) {
            Some(usage) => usage,
            None => continue,
        };

        input_tokens = input_tokens.saturating_add(
            extract_usage_u64(usage, "input_tokens")
                .or_else(|| extract_usage_u64(usage, "inputTokens"))
                .unwrap_or(0),
        );
        output_tokens = output_tokens.saturating_add(
            extract_usage_u64(usage, "output_tokens")
                .or_else(|| extract_usage_u64(usage, "outputTokens"))
                .unwrap_or(0),
        );
    }

    Ok((input_tokens, output_tokens))
}

#[allow(dead_code)]
fn extract_usage_u64(usage: &serde_json::Value, key: &str) -> Option<u64> {
    let value = usage.get(key)?;
    if let Some(v) = value.as_u64() {
        return Some(v);
    }
    value.as_f64().map(|v| if v < 0.0 { 0 } else { v as u64 })
}

/// 对 parts 尝试所有 `-` / `.` 分隔符组合，返回第一个匹配的目录。
/// Claude Code 编码路径时将 `.` 也替换为 `-`，因此解码时需要尝试两种分隔符。
fn try_join_with_separators(root: &Path, parts: &[&str]) -> Option<PathBuf> {
    let n = parts.len();
    if n == 1 {
        let p = root.join(parts[0]);
        return if p.is_dir() { Some(p) } else { None };
    }
    let seps = n - 1;
    // 位掩码：bit=0 用 '-'，bit=1 用 '.'；mask=0 即全 '-'（优先）
    for mask in 0..(1u32 << seps) {
        let mut name = String::from(parts[0]);
        for i in 0..seps {
            name.push(if mask & (1 << i) != 0 { '.' } else { '-' });
            name.push_str(parts[i + 1]);
        }
        let candidate = root.join(&name);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    None
}

fn resolve_encoded_parts(root: &Path, parts: &[&str]) -> Option<PathBuf> {
    if parts.is_empty() {
        return Some(root.to_path_buf());
    }

    let mut current = root.to_path_buf();
    let mut index = 0;

    while index < parts.len() {
        let mut matched_next: Option<(usize, PathBuf)> = None;

        // 贪心：优先尝试最长组合（例如 claude-switch-v1）。
        for end in (index + 1..=parts.len()).rev() {
            let segment = &parts[index..end];
            if let Some(matched_path) = try_join_with_separators(&current, segment) {
                matched_next = Some((end, matched_path));
                break;
            }
        }

        if let Some((next_index, next_path)) = matched_next {
            current = next_path;
            index = next_index;
        } else {
            // 失败时放弃真实匹配，返回 None 交由上层回退处理。
            return None;
        }
    }

    Some(current)
}

/// 格式化时间戳为 ISO 日期时间字符串
fn format_timestamp(secs: i64) -> String {
    // 简单的时间格式化，不依赖 chrono
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;

    // 从 1970-01-01 计算日期
    let (year, month, day) = days_to_date(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:00Z",
        year, month, day, hours, minutes
    )
}

/// 格式化毫秒时间戳为日期字符串 YYYY-MM-DD
fn format_date(secs: i64) -> String {
    let days = secs / 86400;
    let (year, month, day) = days_to_date(days);
    format!("{:04}-{:02}-{:02}", year, month, day)
}

/// 将天数转换为日期
fn days_to_date(mut days: i64) -> (i64, i64, i64) {
    // 简化的日期计算
    let mut year = 1970;
    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }

    let month_days = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1;
    for &md in &month_days {
        if days < md {
            break;
        }
        days -= md;
        month += 1;
    }

    (year, month, days + 1)
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}
