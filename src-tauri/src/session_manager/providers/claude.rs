use super::utils::{
    extract_message_text, extract_teammate_summary, home_dir, is_system_message,
    sanitize_session_markdown_text, sanitize_session_text, truncate_text,
};
use crate::session_manager::{
    normalize_message_window_limit, MessageWindowBuilder, SessionMeta, UnifiedSessionMessage,
    UnifiedSessionMessageWindow,
};
use serde::Deserialize;
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const TOOL_RESULT_CONTENT: &str = "[tool_result]";
const CLAUDE_TAIL_WINDOW_FAST_PATH_MIN_BYTES: u64 = 1_048_576;
const CLAUDE_TAIL_WINDOW_CHUNK_BYTES: u64 = 64 * 1024;
const CLAUDE_TAIL_WINDOW_LINE_MULTIPLIER: usize = 4;

struct ClaudeTailWindowLines {
    lines: Vec<String>,
    start_line_index: usize,
    total_line_count: usize,
}

/// 按项目路径扫描 Claude 会话（只扫描匹配的项目目录）
pub fn scan_claude_sessions_for_project(project_path: &str) -> Vec<SessionMeta> {
    let home = match home_dir() {
        Some(h) => h,
        None => return vec![],
    };

    let projects_dir = home.join(".claude").join("projects");
    if !projects_dir.exists() {
        return vec![];
    }

    // 找到匹配 project_path 的项目目录
    let target_dir = find_project_dir(&projects_dir, project_path);
    let target_dir = match target_dir {
        Some(d) => d,
        None => return vec![],
    };

    scan_sessions_in_dir(&target_dir, project_path)
}

/// 在 ~/.claude/projects/ 中找到匹配给定路径的项目目录
fn find_project_dir(projects_dir: &Path, project_path: &str) -> Option<PathBuf> {
    let normalized = normalize_path(project_path);
    let entries = fs::read_dir(projects_dir).ok()?;

    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let dir = entry.path();

        // 快速检查：读取第一个 .jsonl 的 cwd 字段
        if let Some(cwd) = extract_cwd_from_first_file(&dir) {
            if normalize_path(&cwd) == normalized {
                return Some(dir);
            }
        }
    }
    None
}

/// 从目录中第一个 .jsonl 文件提取 cwd
fn extract_cwd_from_first_file(dir: &Path) -> Option<String> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            if let Some(cwd) = extract_cwd(&path) {
                return Some(cwd);
            }
        }
    }
    None
}

/// 规范化路径用于比较（统一斜杠方向和大小写）
fn normalize_path(p: &str) -> String {
    p.replace('\\', "/").to_lowercase()
}

/// 扫描指定目录下的所有会话文件
fn scan_sessions_in_dir(dir: &Path, project_path: &str) -> Vec<SessionMeta> {
    let mut sessions = Vec::new();
    let jsonl_files = collect_jsonl_files(dir);

    for path in jsonl_files {
        let fname = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if fname.starts_with("agent-") {
            continue;
        }

        let session_id = fname.trim_end_matches(".jsonl").to_string();
        let source_path = path.to_string_lossy().to_string();
        let (title, summary) = extract_title_and_summary(&path);

        let (created_at, last_active_at) = match fs::metadata(&path) {
            Ok(meta) => {
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                let created = meta
                    .created()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(modified);
                (created, modified)
            }
            Err(_) => (0, 0),
        };

        sessions.push(SessionMeta {
            provider_id: "claude".to_string(),
            session_id: session_id.clone(),
            title,
            summary,
            project_dir: Some(project_path.to_string()),
            created_at,
            last_active_at,
            source_path,
            resume_command: Some(format!("claude --resume {}", session_id)),
            pinned: false,
            archived: false,
            unread: false,
        });
    }

    sessions
}

/// 加载 Claude 会话的所有消息
pub fn load_claude_messages(source_path: &str) -> Result<Vec<UnifiedSessionMessage>, String> {
    let path = Path::new(source_path);
    if !path.exists() {
        return Err("Session file not found".to_string());
    }

    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut messages = Vec::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if let Some(message) = parse_claude_history_line(&line) {
            messages.push(message);
        }
    }

    Ok(messages)
}

pub fn load_claude_message_window(
    source_path: &str,
    tail_limit: usize,
) -> Result<UnifiedSessionMessageWindow, String> {
    let path = Path::new(source_path);
    if !path.exists() {
        return Err("Session file not found".to_string());
    }

    let file_len = fs::metadata(path).map_err(|e| e.to_string())?.len();
    if file_len < CLAUDE_TAIL_WINDOW_FAST_PATH_MIN_BYTES {
        return load_claude_message_window_exact(path, tail_limit);
    }

    let limit = normalize_message_window_limit(tail_limit);
    let total_line_count = count_jsonl_lines(path)?;
    let mut tail_line_limit = limit
        .saturating_mul(CLAUDE_TAIL_WINDOW_LINE_MULTIPLIER)
        .max(limit + 16)
        .min(total_line_count.max(1));
    let mut messages: VecDeque<(usize, UnifiedSessionMessage)> = VecDeque::new();
    let mut window_start_index;

    loop {
        let tail = read_claude_tail_window_lines(path, tail_line_limit, total_line_count)?;
        debug_assert_eq!(tail.total_line_count, total_line_count);
        messages.clear();

        for (offset, line) in tail.lines.iter().enumerate() {
            if let Some(message) = parse_claude_history_line(line) {
                messages.push_back((tail.start_line_index + offset, message));
                while messages.len() > limit {
                    messages.pop_front();
                }
            }
        }

        window_start_index = tail.start_line_index;
        if messages.len() >= limit || tail.start_line_index == 0 {
            break;
        }

        let next_tail_line_limit = tail_line_limit.saturating_mul(2).min(total_line_count);
        if next_tail_line_limit <= tail_line_limit {
            break;
        }
        tail_line_limit = next_tail_line_limit;
    }

    let start_index = messages
        .front()
        .map(|(line_index, _)| *line_index)
        .unwrap_or(window_start_index);
    Ok(UnifiedSessionMessageWindow {
        complete: window_start_index == 0,
        messages: messages.into_iter().map(|(_, message)| message).collect(),
        start_index,
        total_count: total_line_count,
    })
}

fn load_claude_message_window_exact(
    path: &Path,
    tail_limit: usize,
) -> Result<UnifiedSessionMessageWindow, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut window = MessageWindowBuilder::new(tail_limit);

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if let Some(message) = parse_claude_history_line(&line) {
            window.push(message);
        }
    }

    Ok(window.finish())
}

fn count_jsonl_lines(path: &Path) -> Result<usize, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut newline_count = 0_usize;
    let mut saw_any_byte = false;
    let mut last_byte = b'\n';

    loop {
        let bytes_read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if bytes_read == 0 {
            break;
        }
        saw_any_byte = true;
        newline_count += buffer[..bytes_read]
            .iter()
            .filter(|byte| **byte == b'\n')
            .count();
        last_byte = buffer[bytes_read - 1];
    }

    if !saw_any_byte {
        return Ok(0);
    }
    Ok(newline_count + usize::from(last_byte != b'\n'))
}

fn read_claude_tail_window_lines(
    path: &Path,
    tail_line_limit: usize,
    total_line_count: usize,
) -> Result<ClaudeTailWindowLines, String> {
    let limit = tail_line_limit.max(1);
    if total_line_count == 0 {
        return Ok(ClaudeTailWindowLines {
            lines: Vec::new(),
            start_line_index: 0,
            total_line_count: 0,
        });
    }

    if total_line_count <= limit {
        let file = fs::File::open(path).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);
        let lines = reader
            .lines()
            .filter_map(Result::ok)
            .collect::<Vec<String>>();
        return Ok(ClaudeTailWindowLines {
            lines,
            start_line_index: 0,
            total_line_count,
        });
    }

    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut position = file.metadata().map_err(|e| e.to_string())?.len();
    let mut suffix = Vec::new();

    while position > 0 {
        let read_size = CLAUDE_TAIL_WINDOW_CHUNK_BYTES.min(position) as usize;
        position -= read_size as u64;
        file.seek(SeekFrom::Start(position))
            .map_err(|e| e.to_string())?;
        let mut chunk = vec![0_u8; read_size];
        file.read_exact(&mut chunk).map_err(|e| e.to_string())?;
        chunk.extend_from_slice(&suffix);
        suffix = chunk;

        let text = String::from_utf8_lossy(&suffix);
        let line_count = text.lines().count();
        let usable_line_count = if position > 0 {
            line_count.saturating_sub(1)
        } else {
            line_count
        };
        if usable_line_count >= limit {
            break;
        }
    }

    let text = String::from_utf8_lossy(&suffix);
    let mut lines = text.lines().map(str::to_string).collect::<Vec<String>>();
    if position > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    if lines.len() > limit {
        lines = lines.split_off(lines.len() - limit);
    }
    let start_line_index = total_line_count.saturating_sub(lines.len());

    Ok(ClaudeTailWindowLines {
        lines,
        start_line_index,
        total_line_count,
    })
}

pub fn load_claude_subagent_messages(
    session_id: &str,
    source_path: &str,
    agent_id: Option<&str>,
    description: Option<&str>,
) -> Result<Vec<UnifiedSessionMessage>, String> {
    let subagents_dir = resolve_subagents_dir(source_path, session_id)
        .ok_or_else(|| "Subagent history directory not found".to_string())?;
    let history_file = find_subagent_history_file(&subagents_dir, agent_id, description)
        .ok_or_else(|| "Subagent history file not found".to_string())?;
    load_claude_messages(&history_file.to_string_lossy())
}

fn parse_claude_history_line(line: &str) -> Option<UnifiedSessionMessage> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let json: serde_json::Value = serde_json::from_str(trimmed).ok()?;

    // 跳过 meta 行
    if json.get("isMeta").and_then(|v| v.as_bool()) == Some(true) {
        return None;
    }

    let msg_type = json
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    // 上下文压缩边界：透传给前端渲染为压缩分隔条（raw 携带 compactMetadata）。
    if msg_type == "system" {
        let subtype = json
            .get("subtype")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        if subtype != "compact_boundary" {
            return None;
        }
        let ts = json
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        return Some(UnifiedSessionMessage {
            role: "system".to_string(),
            content: json
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("Conversation compacted")
                .to_string(),
            ts,
            raw: Some(json),
        });
    }

    if msg_type != "user" && msg_type != "assistant" {
        return None;
    }

    let message_content = json.get("message").and_then(|v| v.get("content"))?;
    let has_structured_content = has_structured_history_content(message_content);
    let raw_text = extract_message_text(message_content).unwrap_or_default();
    let clean_text = sanitize_session_markdown_text(&raw_text);
    if clean_text.is_empty() && !has_structured_content {
        return None;
    }
    let content = if clean_text.is_empty() && has_tool_result_content(message_content) {
        TOOL_RESULT_CONTENT.to_string()
    } else {
        clean_text
    };

    let ts = json
        .get("timestamp")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 压缩摘要消息（isCompactSummary）内容是纯字符串，无结构化块；
    // 仍需携带 raw 让前端识别标志并折叠展示。
    let is_compact_summary =
        json.get("isCompactSummary").and_then(|v| v.as_bool()) == Some(true);

    Some(UnifiedSessionMessage {
        role: msg_type.to_string(),
        content,
        ts,
        raw: if has_structured_content || is_compact_summary {
            Some(json)
        } else {
            None
        },
    })
}

fn has_content_block_type(content: &serde_json::Value, target_type: &str) -> bool {
    content
        .as_array()
        .map(|items| {
            items
                .iter()
                .any(|item| item.get("type").and_then(|v| v.as_str()) == Some(target_type))
        })
        .unwrap_or(false)
}

fn has_structured_history_content(content: &serde_json::Value) -> bool {
    has_content_block_type(content, "thinking")
        || has_content_block_type(content, "tool_use")
        || has_content_block_type(content, "tool_result")
        || has_content_block_type(content, "image")
        || has_content_block_type(content, "input_image")
}

fn has_tool_result_content(content: &serde_json::Value) -> bool {
    has_content_block_type(content, "tool_result")
}

/// 递归收集目录下所有 .jsonl 文件
fn collect_jsonl_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_jsonl_inner(dir, &mut files);
    files
}

fn collect_jsonl_inner(dir: &Path, files: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_inner(&path, files);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

#[derive(Debug, Deserialize)]
struct SubagentMeta {
    #[serde(default)]
    description: Option<String>,
}

fn resolve_subagents_dir(source_path: &str, session_id: &str) -> Option<PathBuf> {
    let source = Path::new(source_path);
    if source.is_file() {
        let parent = source.parent()?;
        let sibling = parent.join(session_id).join("subagents");
        if sibling.is_dir() {
            return Some(sibling);
        }
        let direct = parent.join("subagents");
        if direct.is_dir() {
            return Some(direct);
        }
    }

    let home = home_dir()?;
    let projects_dir = home.join(".claude").join("projects");
    let project_dir = if source.is_file() {
        source.parent()?.to_path_buf()
    } else {
        find_project_dir(&projects_dir, source_path)?
    };
    let candidate = project_dir.join(session_id).join("subagents");
    if candidate.is_dir() {
        Some(candidate)
    } else {
        None
    }
}

fn read_optional_string(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(|entry| entry.as_str())
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn extract_agent_id_from_subagent_file(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    for line in reader.lines().take(40).flatten() {
        let json: serde_json::Value = serde_json::from_str(&line).ok()?;
        if let Some(agent_id) = read_optional_string(&json, &["agentId", "agent_id"]) {
            return Some(agent_id);
        }
    }
    None
}

fn load_subagent_meta(meta_path: &Path) -> Option<SubagentMeta> {
    let file = fs::File::open(meta_path).ok()?;
    serde_json::from_reader(file).ok()
}

fn find_subagent_history_file(
    subagents_dir: &Path,
    agent_id: Option<&str>,
    description: Option<&str>,
) -> Option<PathBuf> {
    let mut candidates = fs::read_dir(subagents_dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("jsonl"))
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("agent-"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    candidates.sort();

    if let Some(agent_id) = agent_id.map(str::trim).filter(|value| !value.is_empty()) {
        if let Some(path) = candidates.iter().find(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.contains(agent_id))
                .unwrap_or(false)
                || extract_agent_id_from_subagent_file(path).as_deref() == Some(agent_id)
        }) {
            return Some(path.clone());
        }
    }

    if let Some(description) = description.map(str::trim).filter(|value| !value.is_empty()) {
        let normalized = description.to_lowercase();
        if let Some(path) = candidates.iter().find(|path| {
            load_subagent_meta(&path.with_extension("meta.json"))
                .and_then(|meta| meta.description)
                .map(|value| value.trim().to_lowercase() == normalized)
                .unwrap_or(false)
        }) {
            return Some(path.clone());
        }
    }

    None
}

/// 从 .jsonl 前 20 行提取 cwd 字段
fn extract_cwd(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
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

/// 从 .jsonl 前 240 行提取 title 和 summary
fn extract_title_and_summary(path: &Path) -> (Option<String>, Option<String>) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (None, None),
    };

    let reader = BufReader::new(file);
    let mut title: Option<String> = None;
    let mut summary: Option<String> = None;

    for line in reader.lines().take(240).flatten() {
        if line.trim().is_empty() {
            continue;
        }

        let json: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if title.is_some() && summary.is_some() {
            break;
        }

        let msg_type = json
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
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

        // 优先从 teammate 标签提取 summary 作为 title
        if let Some(teammate_summary) = extract_teammate_summary(&raw_text) {
            let short = truncate_text(&teammate_summary, 80);
            if !short.is_empty() {
                title = Some(short);
            }
        }

        // 跳过纯系统/命令消息（如 <local-command-caveat>、/clear 等）
        if is_system_message(&raw_text) {
            continue;
        }

        let clean_text = sanitize_session_text(&raw_text);
        if clean_text.is_empty() {
            continue;
        }

        if title.is_none() {
            title = Some(truncate_text(&clean_text, 80));
        }

        if summary.is_none() {
            summary = Some(truncate_text(&clean_text, 140));
        }
    }

    (title, summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_temp_session(content: impl AsRef<[u8]>) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("ccg-switch-claude-{suffix}.jsonl"));
        fs::write(&path, content).expect("write temp claude session");
        path
    }

    fn write_temp_dir() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("ccg-switch-claude-dir-{suffix}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn load_claude_messages_passes_compact_boundary_and_skips_other_system_lines() {
        let path = write_temp_session(
            r#"{"type":"user","timestamp":"2026-06-17T08:00:00.000Z","message":{"content":[{"type":"text","text":"question"}]}}"#
                .to_owned()
                + "\n"
                + r#"{"type":"system","subtype":"compact_boundary","content":"Conversation compacted","isMeta":false,"timestamp":"2026-06-17T08:01:00.000Z","compactMetadata":{"trigger":"auto","preTokens":275007,"postTokens":8320}}"#
                + "\n"
                + r#"{"type":"system","subtype":"init","timestamp":"2026-06-17T08:01:01.000Z","session_id":"s-1"}"#
                + "\n"
                + r#"{"type":"assistant","timestamp":"2026-06-17T08:02:00.000Z","message":{"content":[{"type":"text","text":"answer"}]}}"#,
        );

        let messages = load_claude_messages(&path.to_string_lossy()).expect("load messages");
        fs::remove_file(path).ok();

        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1].role, "system");
        assert_eq!(messages[1].content, "Conversation compacted");
        let raw = messages[1].raw.as_ref().unwrap();
        assert_eq!(raw["subtype"], "compact_boundary");
        assert_eq!(raw["compactMetadata"]["preTokens"], 275007);
        // init 等其它 system 子类型不透传
        assert_eq!(messages[2].role, "assistant");
    }

    #[test]
    fn load_claude_messages_preserves_structured_blocks() {
        let path = write_temp_session(
            r#"{"type":"assistant","timestamp":"2026-06-17T08:00:00.000Z","message":{"content":[{"type":"thinking","thinking":"inspect first"}]}}"#
                .to_owned()
                + "\n"
                + r#"{"type":"assistant","timestamp":"2026-06-17T08:00:01.000Z","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"src/App.tsx"}}]}}"#
                + "\n"
                + r#"{"type":"user","timestamp":"2026-06-17T08:00:02.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":"file contents","is_error":false}]}}"#,
        );

        let messages = load_claude_messages(&path.to_string_lossy()).expect("load messages");
        fs::remove_file(path).ok();

        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].content, "");
        assert_eq!(
            messages[0].raw.as_ref().unwrap()["message"]["content"][0]["type"],
            "thinking"
        );
        assert_eq!(
            messages[1].raw.as_ref().unwrap()["message"]["content"][0]["name"],
            "Read"
        );
        assert_eq!(messages[2].content, TOOL_RESULT_CONTENT);
        assert_eq!(
            messages[2].raw.as_ref().unwrap()["message"]["content"][0]["tool_use_id"],
            "tool-1"
        );
    }

    #[test]
    fn load_claude_messages_preserves_markdown_line_breaks() {
        let path = write_temp_session(
            r#"{"type":"assistant","timestamp":"2026-06-17T08:00:00.000Z","message":{"content":[{"type":"text","text":"**上轮进展与阻塞**\n记录里声称完成。\n\n- **本轮规划**：先定位根因。\n- **验证结果**：保留列表。"}]}}"#,
        );

        let messages = load_claude_messages(&path.to_string_lossy()).expect("load messages");
        fs::remove_file(path).ok();

        assert_eq!(messages.len(), 1);
        assert_eq!(
            messages[0].content,
            "**上轮进展与阻塞**\n记录里声称完成。\n\n- **本轮规划**：先定位根因。\n- **验证结果**：保留列表。"
        );
    }

    #[test]
    fn load_claude_messages_preserves_image_only_blocks() {
        let path = write_temp_session(
            r#"{"type":"user","timestamp":"2026-06-17T08:00:00.000Z","message":{"content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBORw0KGgo="},"fileName":"screen.png"}]}}"#,
        );

        let messages = load_claude_messages(&path.to_string_lossy()).expect("load messages");
        fs::remove_file(path).ok();

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "");
        assert_eq!(
            messages[0].raw.as_ref().unwrap()["message"]["content"][0]["type"],
            "image"
        );
        assert_eq!(
            messages[0].raw.as_ref().unwrap()["message"]["content"][0]["source"]["media_type"],
            "image/png"
        );
    }

    #[test]
    fn load_claude_message_window_keeps_tail_with_original_start_index() {
        let path = write_temp_session(
            r#"{"type":"user","timestamp":"2026-06-17T08:00:00.000Z","message":{"content":[{"type":"text","text":"first"}]}}"#
                .to_owned()
                + "\n"
                + r#"{"type":"assistant","timestamp":"2026-06-17T08:00:01.000Z","message":{"content":[{"type":"text","text":"second"}]}}"#
                + "\n"
                + r#"{"type":"user","timestamp":"2026-06-17T08:00:02.000Z","message":{"content":[{"type":"text","text":"third"}]}}"#,
        );

        let window = load_claude_message_window(&path.to_string_lossy(), 2).expect("load window");
        fs::remove_file(path).ok();

        assert_eq!(window.total_count, 3);
        assert_eq!(window.start_index, 1);
        assert!(!window.complete);
        assert_eq!(window.messages.len(), 2);
        assert_eq!(window.messages[0].content, "second");
        assert_eq!(window.messages[1].content, "third");
    }

    #[test]
    fn read_claude_tail_window_lines_avoids_front_matter_for_large_history() {
        let path = write_temp_session(
            r#"{"type":"user","timestamp":"2026-06-17T08:00:00.000Z","message":{"content":[{"type":"text","text":"first"}]}}"#
                .to_owned()
                + "\n"
                + r#"{"type":"assistant","timestamp":"2026-06-17T08:00:01.000Z","message":{"content":[{"type":"text","text":"second"}]}}"#
                + "\n"
                + r#"{"type":"user","timestamp":"2026-06-17T08:00:02.000Z","message":{"content":[{"type":"text","text":"third"}]}}"#,
        );

        let tail = read_claude_tail_window_lines(&path, 2, 3).expect("read tail lines");
        fs::remove_file(path).ok();

        assert_eq!(tail.total_line_count, 3);
        assert_eq!(tail.start_line_index, 1);
        assert_eq!(tail.lines.len(), 2);
        assert!(tail.lines[0].contains("\"second\""));
        assert!(tail.lines[1].contains("\"third\""));
    }

    #[test]
    fn load_claude_message_window_expands_tail_when_meta_lines_fill_suffix() {
        let meta_padding = "x".repeat(40 * 1024);
        let mut content = r#"{"type":"user","timestamp":"2026-06-17T08:00:00.000Z","message":{"content":[{"type":"text","text":"first"}]}}"#
            .to_owned()
            + "\n"
            + r#"{"type":"assistant","timestamp":"2026-06-17T08:00:01.000Z","message":{"content":[{"type":"text","text":"second"}]}}"#;
        for index in 0..32 {
            content.push('\n');
            content.push_str(&format!(
                r#"{{"isMeta":true,"index":{},"padding":"{}"}}"#,
                index, meta_padding
            ));
        }
        let path = write_temp_session(content);

        let window = load_claude_message_window(&path.to_string_lossy(), 2).expect("load window");
        fs::remove_file(path).ok();

        assert_eq!(window.messages.len(), 2);
        assert_eq!(window.messages[0].content, "first");
        assert_eq!(window.messages[1].content, "second");
        assert!(window.total_count > window.messages.len());
    }

    #[test]
    fn load_claude_subagent_messages_finds_file_by_agent_id() {
        let root = write_temp_dir();
        let parent = root.join("parent-session.jsonl");
        fs::write(&parent, "").expect("write parent session");
        let subagents = root.join("session-1").join("subagents");
        fs::create_dir_all(&subagents).expect("create subagents dir");
        let history = subagents.join("agent-a12c75a82930fb687.jsonl");
        fs::write(
            &history,
            r#"{"type":"assistant","timestamp":"2026-06-17T08:00:00.000Z","agentId":"agent-a12c75a82930fb687","message":{"content":[{"type":"text","text":"subagent trace"}]}}"#,
        )
        .expect("write subagent history");

        let messages = load_claude_subagent_messages(
            "session-1",
            &parent.to_string_lossy(),
            Some("agent-a12c75a82930fb687"),
            None,
        )
        .expect("load subagent messages");

        fs::remove_dir_all(root).ok();

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "subagent trace");
    }

    #[test]
    fn load_claude_subagent_messages_finds_file_by_meta_description() {
        let root = write_temp_dir();
        let parent = root.join("parent-session.jsonl");
        fs::write(&parent, "").expect("write parent session");
        let subagents = root.join("session-1").join("subagents");
        fs::create_dir_all(&subagents).expect("create subagents dir");
        let history = subagents.join("agent-lookup.jsonl");
        fs::write(
            &history,
            r#"{"type":"assistant","timestamp":"2026-06-17T08:00:00.000Z","message":{"content":[{"type":"thinking","thinking":"inspect backend"}]}}"#,
        )
        .expect("write subagent history");
        fs::write(
            history.with_extension("meta.json"),
            r#"{"description":"逆向JetBrains插件后端Java"}"#,
        )
        .expect("write subagent meta");

        let messages = load_claude_subagent_messages(
            "session-1",
            &parent.to_string_lossy(),
            None,
            Some("逆向JetBrains插件后端Java"),
        )
        .expect("load subagent messages by meta");

        fs::remove_dir_all(root).ok();

        assert_eq!(messages.len(), 1);
        assert_eq!(
            messages[0].raw.as_ref().unwrap()["message"]["content"][0]["type"],
            "thinking"
        );
    }
}
