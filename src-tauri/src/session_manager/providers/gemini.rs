use super::utils::{home_dir, sanitize_session_text, truncate_text};
use crate::session_manager::{SessionMeta, UnifiedSessionMessage};
use chrono::DateTime;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// 将 RFC3339 时间戳字符串解析为毫秒级 Unix 时间戳
fn parse_timestamp_millis(ts: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

/// 从文件元数据获取修改时间（毫秒级），作为时间戳的 fallback
fn file_modified_millis(path: &Path) -> i64 {
    path.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 从 Gemini messages 数组中提取第一条用户消息的文本作为标题
fn extract_title(messages: &serde_json::Value) -> Option<String> {
    let arr = messages.as_array()?;
    for msg in arr {
        let msg_type = msg.get("type").and_then(|r| r.as_str()).unwrap_or("");
        if msg_type == "user" {
            if let Some(text) = msg.get("content").and_then(|c| c.as_str()) {
                let cleaned = sanitize_session_text(text);
                if !cleaned.is_empty() {
                    return Some(truncate_text(&cleaned, 80));
                }
            }
        }
    }
    None
}

/// 构建项目目录映射：从 ~/.gemini/projects.json 读取
/// 返回 (slug_to_path, hash_to_path) 两个映射
fn build_project_maps(home: &Path) -> (HashMap<String, String>, HashMap<String, String>) {
    let mut slug_to_path: HashMap<String, String> = HashMap::new();
    let mut hash_to_path: HashMap<String, String> = HashMap::new();

    let projects_file = home.join(".gemini").join("projects.json");
    let content = match fs::read_to_string(&projects_file) {
        Ok(c) => c,
        Err(_) => return (slug_to_path, hash_to_path),
    };

    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return (slug_to_path, hash_to_path),
    };

    let projects = match json.get("projects").and_then(|p| p.as_object()) {
        Some(p) => p,
        None => return (slug_to_path, hash_to_path),
    };

    for (path_key, slug_val) in projects {
        if let Some(slug) = slug_val.as_str() {
            // 规范化路径：首字母大写驱动器号 + 反斜杠
            let normalized = normalize_win_path(path_key);

            // slug → path（用于 slug 目录名查找）
            slug_to_path.insert(slug.to_string(), normalized.clone());

            // SHA256(normalized_path) → path（用于 hash 目录名查找）
            let hash = sha256_hex(&normalized);
            hash_to_path.insert(hash, normalized);
        }
    }

    (slug_to_path, hash_to_path)
}

/// 规范化 Windows 路径：大写驱动器号 + 反斜杠
fn normalize_win_path(path: &str) -> String {
    // projects.json 中路径是小写的，如 "c:\\guodevelop\\..."
    // Gemini 计算 SHA256 时使用大写驱动器号 "C:\\..."
    let mut chars: Vec<char> = path.chars().collect();
    if chars.len() >= 2 && chars[1] == ':' {
        chars[0] = chars[0].to_uppercase().next().unwrap_or(chars[0]);
    }
    chars.into_iter().collect()
}

/// 计算字符串的 SHA-256 十六进制摘要
fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// 轻量扫描：从 ~/.gemini/projects.json 读取所有已知项目路径
pub fn scan_gemini_project_dirs() -> Vec<String> {
    let home = match home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };
    let (slug_to_path, hash_to_path) = build_project_maps(&home);
    let mut dirs = std::collections::HashSet::new();
    for (_, path) in slug_to_path {
        dirs.insert(path);
    }
    for (_, path) in hash_to_path {
        dirs.insert(path);
    }
    dirs.into_iter().collect()
}

/// 按项目路径扫描 Gemini 会话（只扫描匹配的项目目录）
pub fn scan_gemini_sessions_for_project(project_path: &str) -> Vec<SessionMeta> {
    let home = match home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };

    let tmp_dir = home.join(".gemini").join("tmp");
    if !tmp_dir.exists() {
        return Vec::new();
    }

    let (slug_to_path, hash_to_path) = build_project_maps(&home);

    // 找到匹配 project_path 的目录名
    let normalized_target = project_path.replace('\\', "/").to_lowercase();
    let mut target_dirs: Vec<(String, String)> = Vec::new(); // (dir_name, resolved_path)

    for (slug, path) in &slug_to_path {
        if path.replace('\\', "/").to_lowercase() == normalized_target {
            target_dirs.push((slug.clone(), path.clone()));
        }
    }
    for (hash, path) in &hash_to_path {
        if path.replace('\\', "/").to_lowercase() == normalized_target {
            // 避免重复（如果 slug 和 hash 指向同一路径）
            if !target_dirs.iter().any(|(_, p)| p == path) {
                target_dirs.push((hash.clone(), path.clone()));
            }
        }
    }

    let mut sessions = Vec::new();
    for (dir_name, resolved_path) in &target_dirs {
        let chats_dir = tmp_dir.join(dir_name).join("chats");
        if !chats_dir.exists() || !chats_dir.is_dir() {
            continue;
        }
        let chat_entries = match fs::read_dir(&chats_dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for entry in chat_entries.flatten() {
            let file_path = entry.path();
            let file_name = match file_path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            if !file_name.starts_with("session-") || !file_name.ends_with(".json") {
                continue;
            }
            if let Some(meta) =
                parse_session_file(&file_path, &file_name, Some(resolved_path.clone()))
            {
                sessions.push(meta);
            }
        }
    }

    sessions
}

/// 扫描 ~/.gemini/tmp/*/chats/session-*.json 获取所有 Gemini 会话元数据
#[allow(dead_code)]
fn scan_gemini_sessions() -> Vec<SessionMeta> {
    let home = match home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };

    let tmp_dir = home.join(".gemini").join("tmp");
    if !tmp_dir.exists() {
        return Vec::new();
    }

    // 构建项目目录映射
    let (slug_to_path, hash_to_path) = build_project_maps(&home);

    let mut sessions = Vec::new();

    let sub_dirs = match fs::read_dir(&tmp_dir) {
        Ok(rd) => rd,
        Err(_) => return Vec::new(),
    };

    for dir_entry in sub_dirs.flatten() {
        let dir_path = dir_entry.path();
        if !dir_path.is_dir() {
            continue;
        }

        let chats_dir = dir_path.join("chats");
        if !chats_dir.exists() || !chats_dir.is_dir() {
            continue;
        }

        // 获取目录名，查找对应的项目路径
        let dir_name = match dir_path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        let project_dir = slug_to_path
            .get(&dir_name)
            .or_else(|| hash_to_path.get(&dir_name))
            .cloned();

        let chat_entries = match fs::read_dir(&chats_dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };

        for entry in chat_entries.flatten() {
            let file_path = entry.path();
            let file_name = match file_path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };

            // 匹配 session-*.json 文件
            if !file_name.starts_with("session-") || !file_name.ends_with(".json") {
                continue;
            }

            if let Some(meta) = parse_session_file(&file_path, &file_name, project_dir.clone()) {
                sessions.push(meta);
            }
        }
    }

    sessions
}

/// 解析单个 Gemini 会话 JSON 文件为 SessionMeta
fn parse_session_file(
    file_path: &Path,
    file_name: &str,
    project_dir: Option<String>,
) -> Option<SessionMeta> {
    let content = fs::read_to_string(file_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;

    // session_id: 优先从 JSON 字段取，fallback 从文件名提取
    let session_id = json
        .get("sessionId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            file_name
                .strip_prefix("session-")
                .and_then(|s| s.strip_suffix(".json"))
                .unwrap_or(file_name)
                .to_string()
        });

    // 时间戳解析，fallback 到文件修改时间
    let fallback_ts = file_modified_millis(file_path);

    let created_at = json
        .get("startTime")
        .and_then(|v| v.as_str())
        .and_then(parse_timestamp_millis)
        .unwrap_or(fallback_ts);

    let last_active_at = json
        .get("lastUpdated")
        .and_then(|v| v.as_str())
        .and_then(parse_timestamp_millis)
        .unwrap_or(fallback_ts);

    // 标题：第一条用户消息
    let title = json.get("messages").and_then(extract_title);

    let source_path = file_path.to_string_lossy().to_string();
    let resume_command = format!("gemini --resume {}", session_id);

    Some(SessionMeta {
        provider_id: "gemini".to_string(),
        session_id,
        title,
        summary: None,
        project_dir,
        created_at,
        last_active_at,
        source_path,
        resume_command: Some(resume_command),
        pinned: false,
        archived: false,
        unread: false,
    })
}

/// 加载指定 Gemini 会话文件的所有消息
pub fn load_gemini_messages(source_path: &str) -> Result<Vec<UnifiedSessionMessage>, String> {
    let content = fs::read_to_string(source_path).map_err(|e| format!("读取文件失败: {}", e))?;

    let json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let messages = json
        .get("messages")
        .and_then(|m| m.as_array())
        .ok_or_else(|| "messages 字段不存在或非数组".to_string())?;

    let mut result = Vec::new();

    for msg in messages {
        let msg_type = msg.get("type").and_then(|r| r.as_str()).unwrap_or("");

        // 跳过 info 类型消息（系统通知）
        if msg_type == "info" {
            continue;
        }

        // 映射角色: "user" -> "user", "model" -> "assistant"
        let role = match msg_type {
            "user" => "user".to_string(),
            "model" => "assistant".to_string(),
            other => other.to_string(),
        };

        // Gemini CLI 使用 content 纯字符串
        let content = msg
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();

        if content.is_empty() {
            continue;
        }

        let ts = msg
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        result.push(UnifiedSessionMessage {
            role,
            content,
            ts,
            raw: None,
        });
    }

    Ok(result)
}
