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

/// 单个会话文件的 token 合计缓存项
struct TokenSumEntry {
    size: u64,
    mtime_ms: i64,
    input: u64,
    output: u64,
}

/// 按文件 (size, mtime) 记忆化的 token 合计
///
/// 首页每次加载都要把所有会话文件过一遍；会话文件只增不改，
/// size + mtime 没变就直接复用上次结果，刷新时只重解析有变化的文件。
static TOKEN_SUM_CACHE: OnceLock<Mutex<HashMap<PathBuf, TokenSumEntry>>> = OnceLock::new();

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
