//! Claude 会话按消息分叉（fork）：把 `{session}.jsonl` 截断复制成新 uuid 会话文件。
//!
//! 语义对标 desktop-cc-gui `fork_claude_session_from_message`：
//! - 逐行复制源会话文件到同目录的 `{new-uuid}.jsonl`；
//! - 在目标 user 消息处停止（不含该消息），保留其之前的完整对话；
//! - 递归改写每行 JSON 里等于源会话 id 的 `sessionId` / `session_id` 字段；
//! - 之后以新会话 id resume 即可从该时点继续对话（配合 SDK 文件 checkpoint
//!   恢复可实现「回退到此消息重来」）。

use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

/// fork 结果：新会话 id 与新会话文件路径。
#[derive(Debug)]
pub struct ForkOutcome {
    pub forked_session_id: String,
    pub forked_source_path: PathBuf,
}

/// 在 `~/.claude/projects/**` 下按会话 id 查找会话文件（source_path 缺失时的回退）。
pub fn locate_claude_session_file(session_id: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let projects_dir = home.join(".claude").join("projects");
    let file_name = format!("{session_id}.jsonl");
    let entries = fs::read_dir(&projects_dir).ok()?;
    for entry in entries.flatten() {
        let candidate = entry.path().join(&file_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn rewrite_session_id_fields(value: &mut Value, source_session_id: &str, forked_session_id: &str) {
    match value {
        Value::Object(map) => {
            for (key, nested) in map.iter_mut() {
                if (key == "session_id" || key == "sessionId")
                    && nested
                        .as_str()
                        .map(|sid| sid == source_session_id)
                        .unwrap_or(false)
                {
                    *nested = Value::String(forked_session_id.to_string());
                    continue;
                }
                rewrite_session_id_fields(nested, source_session_id, forked_session_id);
            }
        }
        Value::Array(items) => {
            for item in items {
                rewrite_session_id_fields(item, source_session_id, forked_session_id);
            }
        }
        _ => {}
    }
}

fn is_target_user_message_entry(entry: &Value, target_message_id: &str) -> bool {
    let role = entry
        .get("message")
        .and_then(|message| message.get("role"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let entry_type = entry
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if role != "user" && entry_type != "user" {
        return false;
    }
    entry
        .get("uuid")
        .and_then(|value| value.as_str())
        .or_else(|| {
            entry
                .get("message")
                .and_then(|message| message.get("id"))
                .and_then(|value| value.as_str())
        })
        .map(|value| value == target_message_id)
        .unwrap_or(false)
}

/// 把 `source_path` 会话在目标 user 消息处（不含）截断复制为新会话文件。
///
/// 目标消息找不到时报错并清理半成品文件。
pub fn fork_claude_session_file(
    source_path: &Path,
    session_id: &str,
    target_user_uuid: &str,
) -> Result<ForkOutcome, String> {
    let target_message_id = target_user_uuid.trim();
    if target_message_id.is_empty() {
        return Err("message uuid is required".to_string());
    }
    if !source_path.is_file() {
        return Err(format!(
            "session file not found: {}",
            source_path.display()
        ));
    }
    let target_dir = source_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "invalid session file path".to_string())?;

    let forked_session_id = uuid::Uuid::new_v4().to_string();
    let target_file = target_dir.join(format!("{forked_session_id}.jsonl"));

    let src = fs::File::open(source_path)
        .map_err(|e| format!("failed to open source session file: {e}"))?;
    let reader = BufReader::new(src);
    let mut dst = fs::File::create(&target_file)
        .map_err(|e| format!("failed to create forked session file: {e}"))?;

    let mut found_target = false;
    for line in reader.lines() {
        let line = match line {
            Ok(value) => value,
            Err(e) => {
                let _ = fs::remove_file(&target_file);
                return Err(format!("failed to read source session file: {e}"));
            }
        };
        let mut output = line;
        if let Ok(mut json_value) = serde_json::from_str::<Value>(&output) {
            if is_target_user_message_entry(&json_value, target_message_id) {
                found_target = true;
                break;
            }
            rewrite_session_id_fields(&mut json_value, session_id, &forked_session_id);
            output = serde_json::to_string(&json_value)
                .map_err(|e| format!("failed to serialize forked session entry: {e}"))?;
        }
        if let Err(e) = dst
            .write_all(output.as_bytes())
            .and_then(|_| dst.write_all(b"\n"))
        {
            let _ = fs::remove_file(&target_file);
            return Err(format!("failed to write forked session entry: {e}"));
        }
    }

    if !found_target {
        let _ = fs::remove_file(&target_file);
        return Err(format!(
            "target user message not found in session {session_id}: {target_message_id}"
        ));
    }

    dst.flush()
        .map_err(|e| format!("failed to flush forked session file: {e}"))?;

    Ok(ForkOutcome {
        forked_session_id,
        forked_source_path: target_file,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn write_temp_session(lines: &[String]) -> (tempdir::TempDirGuard, PathBuf) {
        let dir = tempdir::create("ccg-fork-test");
        let path = dir.path.join("11111111-2222-3333-4444-555555555555.jsonl");
        fs::write(&path, lines.join("\n") + "\n").unwrap();
        (dir, path)
    }

    // 轻量临时目录（避免引入 tempfile 依赖）：进程内唯一目录 + Drop 清理。
    mod tempdir {
        use std::path::PathBuf;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);

        pub struct TempDirGuard {
            pub path: PathBuf,
        }

        impl Drop for TempDirGuard {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.path);
            }
        }

        pub fn create(prefix: &str) -> TempDirGuard {
            let seq = SEQ.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir().join(format!(
                "{prefix}-{}-{}",
                std::process::id(),
                seq
            ));
            std::fs::create_dir_all(&path).unwrap();
            TempDirGuard { path }
        }
    }

    const SESSION_ID: &str = "11111111-2222-3333-4444-555555555555";

    fn user_line(uuid: &str, text: &str) -> String {
        format!(
            r#"{{"type":"user","uuid":"{uuid}","sessionId":"{SESSION_ID}","message":{{"role":"user","content":[{{"type":"text","text":"{text}"}}]}}}}"#
        )
    }

    fn assistant_line(uuid: &str, text: &str) -> String {
        format!(
            r#"{{"type":"assistant","uuid":"{uuid}","sessionId":"{SESSION_ID}","message":{{"role":"assistant","content":[{{"type":"text","text":"{text}"}}]}}}}"#
        )
    }

    #[test]
    fn fork_truncates_at_target_user_message_and_rewrites_session_ids() {
        let lines = vec![
            user_line("u-1", "first question"),
            assistant_line("a-1", "first answer"),
            user_line("u-2", "second question"),
            assistant_line("a-2", "second answer"),
        ];
        let (_guard, path) = write_temp_session(&lines);

        let outcome = fork_claude_session_file(&path, SESSION_ID, "u-2").unwrap();
        assert_ne!(outcome.forked_session_id, SESSION_ID);
        assert!(outcome.forked_source_path.is_file());

        let mut content = String::new();
        fs::File::open(&outcome.forked_source_path)
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        let kept: Vec<&str> = content.lines().collect();
        // 目标 user 消息（含之后）被截断，只保留第一轮。
        assert_eq!(kept.len(), 2);
        assert!(kept[0].contains("first question"));
        assert!(kept[1].contains("first answer"));
        // 会话 id 已改写为新 id。
        assert!(!content.contains(SESSION_ID));
        assert!(content.contains(&outcome.forked_session_id));
    }

    #[test]
    fn fork_fails_and_cleans_up_when_target_missing() {
        let lines = vec![user_line("u-1", "only question")];
        let (guard, path) = write_temp_session(&lines);

        let err = fork_claude_session_file(&path, SESSION_ID, "missing-uuid").unwrap_err();
        assert!(err.contains("not found"));
        // 半成品文件已清理：目录中只剩源文件。
        let files: Vec<_> = fs::read_dir(&guard.path).unwrap().flatten().collect();
        assert_eq!(files.len(), 1);
    }

    #[test]
    fn fork_rejects_empty_uuid() {
        let lines = vec![user_line("u-1", "q")];
        let (_guard, path) = write_temp_session(&lines);
        assert!(fork_claude_session_file(&path, SESSION_ID, "  ").is_err());
    }
}
