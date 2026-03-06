use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub session_count: usize,
    pub last_active: Option<String>,
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
        // 将目录名转换回路径: C--guodevelop-xxx -> C:\guodevelop\xxx
        let project_path = decode_project_path(&dir_name);
        let display_name = project_path
            .split(['/', '\\'])
            .last()
            .unwrap_or(&dir_name)
            .to_string();

        // 统计 session 文件数量
        let mut session_count = 0;
        let mut latest_modified: Option<std::time::SystemTime> = None;

        if let Ok(files) = fs::read_dir(entry.path()) {
            for file in files.flatten() {
                let fname = file.file_name().to_string_lossy().to_string();
                if fname.ends_with(".jsonl") {
                    session_count += 1;
                    if let Ok(meta) = file.metadata() {
                        if let Ok(modified) = meta.modified() {
                            if latest_modified.is_none() || modified > latest_modified.unwrap() {
                                latest_modified = Some(modified);
                            }
                        }
                    }
                }
            }
        }

        let last_active = latest_modified.map(|t| {
            let duration = t
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default();
            let secs = duration.as_secs() as i64;
            // 简单格式化为 ISO 字符串
            format_timestamp(secs)
        });

        projects.push(ProjectInfo {
            name: display_name,
            path: project_path,
            session_count,
            last_active,
        });
    }

    // 按最后活跃时间倒序排列
    projects.sort_by(|a, b| b.last_active.cmp(&a.last_active));

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
                if let Ok(files) = fs::read_dir(entry.path()) {
                    total_sessions += files
                        .flatten()
                        .filter(|f| {
                            f.file_name()
                                .to_string_lossy()
                                .ends_with(".jsonl")
                        })
                        .count();
                }
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
    let mut date_counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();

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
    // 为了更准确地还原，优先在真实文件系统中按“最长可匹配目录名”进行逐段匹配。
    if encoded.len() >= 3 && &encoded[1..3] == "--" {
        let drive = &encoded[0..1];
        let rest = &encoded[3..];
        let root = PathBuf::from(format!("{}:\\", drive));
        let parts: Vec<&str> = rest
            .split('-')
            .filter(|p| !p.is_empty())
            .collect();

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
        let project_path = decode_project_path(&encoded);
        let project_name = project_path
            .split(['/', '\\'])
            .last()
            .unwrap_or(&encoded)
            .to_string();

        let mut session_count = 0usize;
        let mut input_tokens = 0u64;
        let mut output_tokens = 0u64;

        if let Ok(files) = fs::read_dir(entry.path()) {
            for file in files.flatten() {
                let fname = file.file_name().to_string_lossy().to_string();
                if !fname.ends_with(".jsonl") {
                    continue;
                }

                session_count += 1;
                if let Ok((input, output)) = sum_session_tokens(&file.path()) {
                    input_tokens = input_tokens.saturating_add(input);
                    output_tokens = output_tokens.saturating_add(output);
                }
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

fn sum_session_tokens(path: &std::path::Path) -> Result<(u64, u64), io::Error> {
    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);

    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;

    for line in reader.lines().flatten() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let json: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // usage 主要记录在 assistant 消息上；过滤后可显著减少误计。
        let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or_default();
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
            let candidate_name = parts[index..end].join("-");
            let candidate_path = current.join(&candidate_name);
            if candidate_path.is_dir() {
                matched_next = Some((end, candidate_path));
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

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub file_path: String,
    pub last_modified: Option<String>,
    pub file_size: u64,
    pub session_title: Option<String>,
    pub session_preview: Option<String>,
    pub session_slug: Option<String>,
    pub last_message: Option<String>,
    pub last_message_role: Option<String>,
    pub last_message_at: Option<String>,
}

/// 将项目路径编码为目录名（decode_project_path 的反向操作）
fn encode_project_path(path: &str) -> String {
    // C:\guodevelop\claude-switch-v1 -> C--guodevelop-claude-switch-v1
    let path = path.replace('/', "\\"); // normalize
    if path.len() >= 3 && &path[1..3] == ":\\" {
        let drive = &path[0..1];
        let rest = &path[3..];
        format!("{}--{}", drive, rest.replace('\\', "-"))
    } else {
        path.replace('\\', "-")
    }
}

/// 获取指定项目的会话列表
pub fn get_project_sessions(project_path: &str) -> Result<Vec<SessionInfo>, io::Error> {
    let projects_dir = get_claude_home()?.join("projects");
    let encoded = encode_project_path(project_path);
    let project_dir = projects_dir.join(&encoded);

    if !project_dir.exists() {
        return Ok(vec![]);
    }

    let mut sessions = Vec::new();

    for entry in fs::read_dir(&project_dir)?.flatten() {
        let fname = entry.file_name().to_string_lossy().to_string();
        if !fname.ends_with(".jsonl") {
            continue;
        }

        let session_id = fname.trim_end_matches(".jsonl").to_string();
        let file_path = entry.path().to_string_lossy().to_string();
        let (session_title, session_preview, session_slug) = extract_session_hints(&entry.path());
        let (last_message, last_message_role, last_message_at) = extract_last_message(&entry.path());

        let (last_modified, file_size) = if let Ok(meta) = entry.metadata() {
            let size = meta.len();
            let modified = meta.modified().ok().map(|t| {
                let duration = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
                format_timestamp(duration.as_secs() as i64)
            });
            (modified, size)
        } else {
            (None, 0)
        };

        sessions.push(SessionInfo {
            session_id,
            file_path,
            last_modified,
            file_size,
            session_title,
            session_preview,
            session_slug,
            last_message,
            last_message_role,
            last_message_at,
        });
    }

    // 按最后修改时间倒序
    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    Ok(sessions)
}

fn extract_session_hints(path: &std::path::Path) -> (Option<String>, Option<String>, Option<String>) {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return (None, None, None),
    };

    let reader = BufReader::new(file);
    let mut slug: Option<String> = None;
    let mut title: Option<String> = None;
    let mut preview: Option<String> = None;

    // 只扫描前 240 行，避免大文件导致页面加载变慢。
    for line in reader.lines().take(240).flatten() {
        if line.trim().is_empty() {
            continue;
        }

        let json: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if slug.is_none() {
            slug = json.get("slug").and_then(|v| v.as_str()).map(|s| s.to_string());
        }

        if title.is_some() && preview.is_some() && slug.is_some() {
            break;
        }

        let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or_default();
        if msg_type != "user" {
            continue;
        }

        let message_content = match json.get("message").and_then(|v| v.get("content")) {
            Some(content) => content,
            None => continue,
        };

        let raw_text = match extract_message_text(message_content) {
            Some(text) => text,
            None => continue,
        };

        if let Some(summary) = extract_teammate_summary(&raw_text) {
            let short = truncate_text(&summary, 80);
            if !short.is_empty() {
                title = Some(short);
            }
        }

        let clean_text = sanitize_session_text(&raw_text);
        if clean_text.is_empty() {
            continue;
        }

        if title.is_none() {
            title = Some(truncate_text(&clean_text, 80));
        }

        if preview.is_none() {
            preview = Some(truncate_text(&clean_text, 140));
        }
    }

    (title, preview, slug)
}

fn extract_last_message(path: &std::path::Path) -> (Option<String>, Option<String>, Option<String>) {
    let tail_text = match read_tail_text(path, 64 * 1024) {
        Some(text) => text,
        None => return (None, None, None),
    };

    let mut lines: Vec<&str> = tail_text.lines().collect();
    if !tail_text.ends_with('\n') && !lines.is_empty() {
        // 起始行可能是不完整 JSON，逆序解析时跳过它。
        lines.remove(0);
    }

    for line in lines.into_iter().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let json: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or_default();
        if msg_type != "user" && msg_type != "assistant" {
            continue;
        }

        let message_content = match json.get("message").and_then(|v| v.get("content")) {
            Some(content) => content,
            None => continue,
        };

        let raw_text = match extract_message_text(message_content) {
            Some(text) => text,
            None => continue,
        };
        let clean_text = sanitize_session_text(&raw_text);
        if clean_text.is_empty() {
            continue;
        }

        let message = truncate_text(&clean_text, 180);
        let role = Some(msg_type.to_string());
        let timestamp = json
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        return (Some(message), role, timestamp);
    }

    (None, None, None)
}

fn read_tail_text(path: &std::path::Path, max_bytes: u64) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    let start = size.saturating_sub(max_bytes);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return None;
    }

    let mut buf = Vec::new();
    if file.read_to_end(&mut buf).is_err() {
        return None;
    }
    Some(String::from_utf8_lossy(&buf).to_string())
}

fn extract_message_text(content: &serde_json::Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    if let Some(items) = content.as_array() {
        for item in items {
            if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                if !text.trim().is_empty() {
                    return Some(text.to_string());
                }
            }
        }
    }

    None
}

fn extract_teammate_summary(text: &str) -> Option<String> {
    let marker = "summary=\"";
    let start = text.find(marker)?;
    let summary_start = start + marker.len();
    let remaining = &text[summary_start..];
    let end = remaining.find('"')?;
    let summary = remaining[..end].trim();
    if summary.is_empty() {
        None
    } else {
        Some(summary.to_string())
    }
}

fn sanitize_session_text(text: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    for raw_line in text.replace('\r', "").lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("<teammate-message") || line.starts_with("</teammate-message") {
            continue;
        }
        if line.contains("\"type\":\"idle_notification\"") {
            continue;
        }
        if line == "[Request interrupted by user]" || line == "No response requested." {
            continue;
        }
        lines.push(line.to_string());
    }

    lines.join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut count = 0;
    for ch in text.chars() {
        if count >= max_chars {
            break;
        }
        out.push(ch);
        count += 1;
    }

    if text.chars().count() > max_chars {
        out.push_str("...");
    }

    out
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionMessage {
    pub role: String,
    pub content: String,
    pub ts: Option<String>,
}

/// 读取会话 JSONL 文件中的所有消息
pub fn get_session_messages(file_path: &str) -> Result<Vec<SessionMessage>, io::Error> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(io::Error::new(io::ErrorKind::NotFound, "Session file not found"));
    }

    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);
    let mut messages = Vec::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let json: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // 跳过 meta 行
        if json.get("isMeta").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }

        let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or_default();
        if msg_type != "user" && msg_type != "assistant" {
            continue;
        }

        let message_content = match json.get("message").and_then(|v| v.get("content")) {
            Some(content) => content,
            None => continue,
        };

        let raw_text = match extract_message_text(message_content) {
            Some(text) => text,
            None => continue,
        };
        let clean_text = sanitize_session_text(&raw_text);
        if clean_text.is_empty() {
            continue;
        }

        let ts = json
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        messages.push(SessionMessage {
            role: msg_type.to_string(),
            content: clean_text,
            ts,
        });
    }

    Ok(messages)
}
