//! 从 Gemini CLI 的会话文件采集用量（思路对齐 cc-switch `session_usage_gemini.rs`）
//!
//! `~/.gemini/tmp/<project_hash>/chats/session-*.json(l)`：
//! - 旧版 `.json`：整个文件是 `{sessionId, messages: [...]}`
//! - 新版 `.jsonl`：按记录回放还原成同样的 messages（同 id 覆盖、`$set` 合并、`$rewindTo` 截断）
//! - `type == "gemini"` 的消息带独立的 `tokens`（不是累计值），每条消息有唯一 id，天然去重
//!
//! 文件没变化（大小 + 修改时间）就不打开；变化了全量重读，靠主键去重。

use crate::database::dao::usage_logs::RequestLogRow;
use crate::database::Database;
use crate::proxy::usage::calculator::ModelPricing;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use super::session_usage_scanner::{apply_cost, lookup_pricing, ScanResult};

pub const SOURCE_GEMINI_SESSION: &str = "gemini_session";
const GEMINI_SESSION_PROVIDER_ID: &str = "_gemini_session";

/// `GEMINI_CLI_HOME`（官方支持的覆盖）> `~/.gemini`
fn gemini_dir() -> Option<PathBuf> {
    std::env::var_os("GEMINI_CLI_HOME")
        .map(|p| PathBuf::from(p).join(".gemini"))
        .or_else(|| dirs::home_dir().map(|h| h.join(".gemini")))
}

/// 旧文件被 resume 迁移成 `.jsonl` 后会留下同名 `.json`，此时只认 `.jsonl`
fn is_session_file(path: &Path) -> bool {
    let named = path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with("session-"));
    named
        && match path.extension().and_then(|e| e.to_str()) {
            Some("jsonl") => true,
            Some("json") => !path.with_extension("jsonl").exists(),
            _ => false,
        }
}

fn collect_session_files(gemini_dir: &Path) -> Vec<PathBuf> {
    let Ok(projects) = fs::read_dir(gemini_dir.join("tmp")) else {
        return Vec::new();
    };
    let mut files = Vec::new();
    for project in projects.flatten() {
        let Ok(chats) = fs::read_dir(project.path().join("chats")) else {
            continue;
        };
        files.extend(chats.flatten().map(|e| e.path()).filter(|p| is_session_file(p)));
    }
    files.sort();
    files
}

/// JSONL 回放中的消息表：同 id 原位覆盖、保持首次出现顺序
#[derive(Default)]
struct MessageLog {
    messages: Vec<Value>,
    index: HashMap<String, usize>,
}

impl MessageLog {
    fn upsert(&mut self, msg: Value) {
        let Some(id) = msg.get("id").and_then(Value::as_str).map(str::to_string) else {
            return;
        };
        match self.index.get(&id) {
            Some(&i) => self.messages[i] = msg,
            None => {
                self.index.insert(id, self.messages.len());
                self.messages.push(msg);
            }
        }
    }

    fn rewind_to(&mut self, id: &str) {
        let len = self.index.get(id).copied().unwrap_or(0);
        self.messages.truncate(len);
        self.index.retain(|_, i| *i < len);
    }

    fn reset(&mut self, list: Vec<Value>) {
        self.messages.clear();
        self.index.clear();
        for msg in list {
            self.upsert(msg);
        }
    }
}

/// 把会话文件还原成 `{sessionId, ..., messages: [...]}`（同上游 `parse_session_document`）
fn parse_session_document(data: &str) -> Option<Value> {
    if let Ok(Value::Object(mut map)) = serde_json::from_str::<Value>(data) {
        map.entry("messages").or_insert_with(|| Value::Array(Vec::new()));
        return Some(Value::Object(map));
    }

    let mut metadata = Map::new();
    let mut log = MessageLog::default();
    let mut seen = false;
    for line in data.lines() {
        let Ok(Value::Object(mut record)) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        seen = true;
        if let Some(id) = record.get("$rewindTo").and_then(Value::as_str) {
            log.rewind_to(id);
        } else if record.get("id").is_some_and(Value::is_string) {
            log.upsert(Value::Object(record));
        } else if let Some(Value::Object(mut set)) = record.remove("$set") {
            if let Some(Value::Array(list)) = set.remove("messages") {
                log.reset(list);
            }
            metadata.extend(set);
        } else if record.get("sessionId").is_some_and(Value::is_string) {
            if let Some(Value::Array(list)) = record.remove("messages") {
                for msg in list {
                    log.upsert(msg);
                }
            }
            metadata.extend(record);
        }
    }
    if !seen {
        return None;
    }
    metadata.insert("messages".into(), Value::Array(log.messages));
    Some(Value::Object(metadata))
}

fn u32_at(v: Option<&Value>) -> u32 {
    v.and_then(Value::as_u64).unwrap_or(0).min(u32::MAX as u64) as u32
}

/// 一个会话文档 → 日志行（只取带 tokens 的 gemini 消息）
fn rows_from_document(doc: &Value, fallback_session: &str) -> (Vec<RequestLogRow>, u32) {
    let session_id = doc
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or(fallback_session)
        .to_string();
    let mut rows = Vec::new();
    let mut ignored = 0u32;
    for msg in doc.get("messages").and_then(Value::as_array).into_iter().flatten() {
        if msg.get("type").and_then(Value::as_str) != Some("gemini") {
            continue;
        }
        let Some(tokens) = msg.get("tokens").filter(|t| t.is_object()) else {
            ignored += 1;
            continue;
        };
        let input = u32_at(tokens.get("input"));
        // 思考 token 按输出计费
        let output = u32_at(tokens.get("output")).saturating_add(u32_at(tokens.get("thoughts")));
        let cached = u32_at(tokens.get("cached"));
        if input == 0 && output == 0 && cached == 0 {
            ignored += 1;
            continue;
        }
        let Some(message_id) = msg.get("id").and_then(Value::as_str) else {
            ignored += 1;
            continue;
        };
        let model = msg.get("model").and_then(Value::as_str).unwrap_or("unknown").to_string();
        let created_at = msg
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|ts| chrono::DateTime::parse_from_rfc3339(ts).ok())
            .map(|dt| dt.timestamp())
            .unwrap_or(0);

        rows.push(RequestLogRow {
            request_id: format!("gemini-{session_id}:{message_id}"),
            provider_id: GEMINI_SESSION_PROVIDER_ID.to_string(),
            app_type: "gemini".to_string(),
            model: model.clone(),
            request_model: Some(model),
            // 与 Codex 会话行一致：input 为原始值（含缓存），cache_read 单列，计费时按含缓存语义扣除
            input_tokens: input,
            output_tokens: output,
            cache_read_tokens: cached,
            cache_creation_tokens: 0,
            input_cost_usd: "0".into(),
            output_cost_usd: "0".into(),
            cache_read_cost_usd: "0".into(),
            cache_creation_cost_usd: "0".into(),
            total_cost_usd: "0".into(),
            latency_ms: 0,
            first_token_ms: None,
            duration_ms: None,
            status_code: 200,
            error_message: None,
            session_id: Some(session_id.clone()),
            provider_type: None,
            is_streaming: true,
            cost_multiplier: "1".into(),
            created_at,
            data_source: Some(SOURCE_GEMINI_SESSION.to_string()),
            reasoning_effort: None,
        });
    }
    (rows, ignored)
}

fn scan_file(
    db: &Database,
    path: &Path,
    pricing: &mut HashMap<String, Option<ModelPricing>>,
    result: &mut ScanResult,
) {
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    let size = meta.len() as i64;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    result.files += 1;

    let key = path.to_string_lossy().into_owned();
    if let Ok(Some((seen_size, seen_mtime, ..))) = db.get_session_scan_state(&key) {
        if seen_size == size && seen_mtime == mtime {
            return;
        }
    }

    let Some(doc) = fs::read_to_string(path).ok().and_then(|s| parse_session_document(&s)) else {
        result.ignored += 1;
        return;
    };
    let fallback = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let (mut rows, ignored) = rows_from_document(&doc, &fallback);
    result.ignored += ignored;
    for row in rows.iter_mut() {
        let model = row.model.clone();
        apply_cost(row, lookup_pricing(db, pricing, &model));
    }

    match db.commit_session_file(&rows, &key, size, mtime, 0, None, None) {
        Ok(inserted) => {
            result.inserted += inserted;
            result.skipped += rows.len() as u32 - inserted;
        }
        Err(e) => tracing::warn!("[SessionScan] Gemini 用量写入失败 ({}): {e}", path.display()),
    }
}

fn scan_dir(db: &Database, gemini_dir: &Path) -> ScanResult {
    let mut result = ScanResult::default();
    let mut pricing = HashMap::new();
    for file in collect_session_files(gemini_dir) {
        scan_file(db, &file, &mut pricing, &mut result);
    }
    result
}

/// 扫描 Gemini CLI 会话文件；目录不存在时什么也不做
pub fn scan_gemini(db: &Database) -> ScanResult {
    match gemini_dir() {
        Some(dir) if dir.join("tmp").is_dir() => scan_dir(db, &dir),
        _ => ScanResult::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sandbox(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccg-gemusage-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("tmp").join("hash1").join("chats")).unwrap();
        dir
    }

    fn gemini_msg(id: &str, input: u64) -> Value {
        json!({
            "id": id, "type": "gemini", "model": "gemini-2.5-pro",
            "timestamp": "2026-02-09T06:04:47.934Z",
            "tokens": {"input": input, "output": 79, "cached": 10, "thoughts": 504, "tool": 0, "total": 0}
        })
    }

    #[test]
    fn legacy_json_session_is_parsed() {
        let doc = json!({
            "sessionId": "s1",
            "messages": [
                {"id": "u1", "type": "user", "content": "hi"},
                gemini_msg("g1", 22141),
                {"id": "g2", "type": "gemini", "tokens": {"input": 0, "output": 0}}
            ]
        });
        let (rows, ignored) = rows_from_document(&doc, "fallback");
        assert_eq!(rows.len(), 1);
        assert_eq!(ignored, 1);
        let r = &rows[0];
        assert_eq!(r.request_id, "gemini-s1:g1");
        assert_eq!(r.app_type, "gemini");
        assert_eq!(r.input_tokens, 22141);
        assert_eq!(r.output_tokens, 583, "thoughts 计入输出");
        assert_eq!(r.cache_read_tokens, 10);
        assert_eq!(r.created_at, 1_770_617_087);
    }

    #[test]
    fn jsonl_replay_overrides_and_rewinds() {
        let lines = [
            json!({"sessionId": "s2", "projectHash": "h"}).to_string(),
            gemini_msg("a", 1).to_string(),
            gemini_msg("b", 2).to_string(),
            gemini_msg("a", 100).to_string(), // 同 id 覆盖
            json!({"$rewindTo": "b"}).to_string(), // 删掉 b 及之后
        ]
        .join("\n");
        let doc = parse_session_document(&lines).unwrap();
        let (rows, _) = rows_from_document(&doc, "x");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].input_tokens, 100);
    }

    #[test]
    fn scan_is_incremental_and_prefers_jsonl() {
        let dir = sandbox("scan");
        let chats = dir.join("tmp").join("hash1").join("chats");
        let doc = json!({"sessionId": "s3", "messages": [gemini_msg("g1", 5)]});
        fs::write(chats.join("session-a.json"), doc.to_string()).unwrap();
        // 已迁移到 jsonl 的旧 json 不再读
        fs::write(chats.join("session-b.json"), doc.to_string()).unwrap();
        fs::write(chats.join("session-b.jsonl"), json!({"sessionId": "s4"}).to_string()).unwrap();

        let db = Database::in_memory().unwrap();
        let first = scan_dir(&db, &dir);
        assert_eq!(first.inserted, 1);
        assert_eq!(first.files, 2);
        let second = scan_dir(&db, &dir);
        assert_eq!(second.inserted, 0);
        assert_eq!(second.skipped, 0, "未变化的文件不打开");
    }
}
