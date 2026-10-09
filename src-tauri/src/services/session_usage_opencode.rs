//! 从 OpenCode 的本地数据库采集用量（思路对齐 cc-switch `session_usage_opencode.rs`）
//!
//! OpenCode 不走本项目代理，用量只能从它自己的 SQLite 里读：
//! `~/.local/share/opencode/opencode.db`（`OPENCODE_DB` / `XDG_DATA_HOME` 可覆盖）。
//!
//! - V1 布局：`session` / `message` 表，按 `data.role == "assistant"` 过滤
//! - V2 布局（OpenCode 2.x）：`session_v2` / `session_message`，按 `type` 列取
//!   `assistant` 与 `compaction`（上下文压缩也计费）；迁移后 V1 表冻结，检测到 V2 优先读 V2
//! - 只收已完成的消息：进行中的消息 token 只有半截，`INSERT OR IGNORE` 之后无法回填
//! - 增量：数据库文件（含 WAL）大小与修改时间没变就不打开；变了全量读一遍，靠主键去重
//!
//! 只读打开，绝不写 OpenCode 的数据库。

use crate::database::dao::usage_logs::RequestLogRow;
use crate::database::Database;
use crate::proxy::usage::calculator::ModelPricing;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use super::session_usage_scanner::{apply_cost, lookup_pricing, ScanResult};

pub const SOURCE_OPENCODE_SESSION: &str = "opencode_session";
const OPENCODE_SESSION_PROVIDER_ID: &str = "_opencode_session";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Schema {
    V1,
    V2,
}

/// OpenCode 数据库路径：`OPENCODE_DB` > `$XDG_DATA_HOME/opencode` > `~/.local/share/opencode`
pub fn opencode_db_path() -> Option<PathBuf> {
    if let Some(custom) = std::env::var_os("OPENCODE_DB").map(PathBuf::from) {
        if custom.is_absolute() {
            return Some(custom);
        }
    }
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| dirs::home_dir().map(|h| h.join(".local").join("share")))?;
    Some(data_home.join("opencode").join("opencode.db"))
}

/// 数据库 + WAL 的 (总大小, 最新修改时间 ms)。WAL 模式下新提交先落在 -wal 里
fn db_fingerprint(path: &Path) -> Option<(i64, i64)> {
    let stat = |p: &Path| {
        fs::metadata(p).ok().map(|m| {
            let mtime = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            (m.len() as i64, mtime)
        })
    };
    let (size, mtime) = stat(path)?;
    let wal = path.with_extension("db-wal");
    let (wal_size, wal_mtime) = stat(&wal).unwrap_or((0, 0));
    Some((size + wal_size, mtime.max(wal_mtime)))
}

fn table_exists(conn: &rusqlite::Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get::<_, bool>(0),
    )
    .unwrap_or(false)
}

fn detect_schema(conn: &rusqlite::Connection) -> Schema {
    if table_exists(conn, "session_v2") && table_exists(conn, "session_message") {
        Schema::V2
    } else {
        Schema::V1
    }
}

fn u32_at(v: Option<&Value>) -> u32 {
    v.and_then(Value::as_u64).unwrap_or(0).min(u32::MAX as u64) as u32
}

/// 一条 assistant / compaction 消息 → 日志行；未完成或全零 token 返回 None
fn build_row(session_id: &str, message_id: &str, kind: Option<&str>, data: &Value) -> Option<RequestLogRow> {
    let tokens = data.get("tokens")?;
    let completed = if kind == Some("compaction") {
        matches!(data.get("status").and_then(Value::as_str), Some("completed" | "failed"))
    } else {
        data.get("time").and_then(|t| t.get("completed")).is_some()
    };
    if !completed {
        return None;
    }

    let input = u32_at(tokens.get("input"));
    // 推理 token 按输出计费
    let output = u32_at(tokens.get("output")).saturating_add(u32_at(tokens.get("reasoning")));
    let cache = tokens.get("cache");
    let cache_read = u32_at(cache.and_then(|c| c.get("read")));
    let cache_write = u32_at(cache.and_then(|c| c.get("write")));
    if input == 0 && output == 0 && cache_read == 0 && cache_write == 0 {
        return None;
    }

    // V1：modelID 字符串；V2：model 为 { id, providerID } 对象（也兼容字符串）
    let model = data
        .get("modelID")
        .and_then(Value::as_str)
        .or_else(|| match data.get("model") {
            Some(Value::String(m)) => Some(m.as_str()),
            Some(m) => m.get("id").and_then(Value::as_str),
            None => None,
        })
        .unwrap_or("unknown")
        .to_string();

    let time = data.get("time");
    let created_ms = time.and_then(|t| t.get("created")).and_then(Value::as_i64).unwrap_or(0);
    let completed_ms = time.and_then(|t| t.get("completed")).and_then(Value::as_i64);
    let latency_ms = match completed_ms {
        Some(done) if created_ms > 0 && done > created_ms => (done - created_ms) as u64,
        _ => 0,
    };

    // OpenCode 自己算过的费用直接用（聚合值，无法拆分到各项）
    let cost = data.get("cost").and_then(Value::as_f64).unwrap_or(0.0);
    let total_cost = if cost > 0.0 { cost.to_string() } else { "0".to_string() };

    Some(RequestLogRow {
        request_id: format!("opencode-{session_id}:{message_id}"),
        provider_id: OPENCODE_SESSION_PROVIDER_ID.to_string(),
        app_type: "opencode".to_string(),
        model: model.clone(),
        request_model: Some(model),
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cache_read,
        cache_creation_tokens: cache_write,
        input_cost_usd: "0".into(),
        output_cost_usd: "0".into(),
        cache_read_cost_usd: "0".into(),
        cache_creation_cost_usd: "0".into(),
        total_cost_usd: total_cost,
        latency_ms,
        first_token_ms: None,
        duration_ms: None,
        status_code: 200,
        error_message: None,
        session_id: Some(session_id.to_string()),
        provider_type: None,
        is_streaming: true,
        cost_multiplier: "1".into(),
        created_at: if created_ms > 0 { created_ms / 1000 } else { 0 },
        data_source: Some(SOURCE_OPENCODE_SESSION.to_string()),
        reasoning_effort: None,
    })
}

/// 读出全部已完成的计费消息
fn read_rows(conn: &rusqlite::Connection) -> Result<(Vec<RequestLogRow>, u32), String> {
    let schema = detect_schema(conn);
    let sql = match schema {
        Schema::V1 => "SELECT session_id, id, data, NULL FROM message ORDER BY time_created",
        Schema::V2 => {
            "SELECT session_id, id, data, type FROM session_message \
             WHERE type IN ('assistant', 'compaction') ORDER BY time_created"
        }
    };
    let mut stmt = conn.prepare(sql).map_err(|e| format!("准备 OpenCode 查询失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| format!("查询 OpenCode 消息失败: {e}"))?;

    let mut out = Vec::new();
    let mut ignored = 0u32;
    for row in rows.flatten() {
        let (session_id, message_id, data, kind) = row;
        let Ok(value) = serde_json::from_str::<Value>(&data) else {
            ignored += 1;
            continue;
        };
        if schema == Schema::V1 && value.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        match build_row(&session_id, &message_id, kind.as_deref(), &value) {
            Some(r) => out.push(r),
            None => ignored += 1,
        }
    }
    Ok((out, ignored))
}

fn scan_db_at(db: &Database, path: &Path) -> ScanResult {
    let mut result = ScanResult::default();
    let Some((size, mtime)) = db_fingerprint(path) else {
        return result;
    };
    result.files = 1;
    let key = path.to_string_lossy().into_owned();
    if let Ok(Some((seen_size, seen_mtime, ..))) = db.get_session_scan_state(&key) {
        if seen_size == size && seen_mtime == mtime {
            return result;
        }
    }

    let conn = match rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("[SessionScan] 打开 opencode.db 失败: {e}");
            return result;
        }
    };
    let (mut rows, ignored) = match read_rows(&conn) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("[SessionScan] {e}");
            return result;
        }
    };
    result.ignored = ignored;

    // OpenCode 没给费用（如自定义 / 免费模型）时按本项目定价表算
    let mut pricing: HashMap<String, Option<ModelPricing>> = HashMap::new();
    for row in rows.iter_mut().filter(|r| r.total_cost_usd == "0") {
        let model = row.model.clone();
        apply_cost(row, lookup_pricing(db, &mut pricing, &model));
    }

    match db.commit_session_file(&rows, &key, size, mtime, 0, None, None) {
        Ok(inserted) => {
            result.inserted = inserted;
            result.skipped = rows.len() as u32 - inserted;
        }
        Err(e) => tracing::warn!("[SessionScan] OpenCode 用量写入失败: {e}"),
    }
    result
}

/// 扫描 OpenCode 数据库；不存在时什么也不做
pub fn scan_opencode(db: &Database) -> ScanResult {
    match opencode_db_path() {
        Some(path) if path.exists() => scan_db_at(db, &path),
        _ => ScanResult::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_db(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccg-ocusage-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("opencode.db")
    }

    fn assistant(completed: bool, input: u64, cost: f64) -> String {
        let mut time = json!({"created": 1_760_000_000_000i64});
        if completed {
            time["completed"] = json!(1_760_000_003_000i64);
        }
        json!({
            "role": "assistant", "modelID": "claude-sonnet-4-5", "cost": cost, "time": time,
            "tokens": {"input": input, "output": 20, "reasoning": 5, "cache": {"read": 100, "write": 7}}
        })
        .to_string()
    }

    #[test]
    fn v1_reads_completed_assistant_messages_only() {
        let path = temp_db("v1");
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch(
            "CREATE TABLE session (id TEXT, time_updated INTEGER);
             CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);",
        )
        .unwrap();
        let ins = |id: &str, data: &str| {
            c.execute("INSERT INTO message VALUES (?1, 's1', 1, ?2)", [id, data]).unwrap();
        };
        ins("m1", &assistant(true, 50, 0.012));
        ins("m2", &assistant(false, 60, 0.0)); // 进行中
        ins("m3", &json!({"role": "user", "tokens": {"input": 9}}).to_string());
        drop(c);

        let conn = rusqlite::Connection::open(&path).unwrap();
        let (rows, _) = read_rows(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(r.request_id, "opencode-s1:m1");
        assert_eq!(r.app_type, "opencode");
        assert_eq!(r.input_tokens, 50);
        assert_eq!(r.output_tokens, 25, "推理 token 计入输出");
        assert_eq!(r.cache_read_tokens, 100);
        assert_eq!(r.cache_creation_tokens, 7);
        assert_eq!(r.total_cost_usd, "0.012");
        assert_eq!(r.latency_ms, 3000);
        assert_eq!(r.created_at, 1_760_000_000);
    }

    #[test]
    fn v2_reads_assistant_and_compaction() {
        let path = temp_db("v2");
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch(
            "CREATE TABLE session_v2 (id TEXT, time_updated INTEGER);
             CREATE TABLE session_message (id TEXT, session_id TEXT, time_created INTEGER, type TEXT, data TEXT);
             CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);",
        )
        .unwrap();
        let v2_assistant = json!({
            "model": {"id": "gpt-5", "providerID": "openai"},
            "time": {"created": 1_760_000_000_000i64, "completed": 1_760_000_001_000i64},
            "tokens": {"input": 10, "output": 2}
        });
        let compaction = json!({"status": "completed", "model": "gpt-5", "tokens": {"input": 30, "output": 4}});
        let running = json!({"status": "running", "tokens": {"input": 30}});
        for (id, kind, data) in [("a", "assistant", &v2_assistant), ("b", "compaction", &compaction), ("c", "compaction", &running)] {
            c.execute(
                "INSERT INTO session_message VALUES (?1, 's2', 1, ?2, ?3)",
                [id, kind, &data.to_string()],
            )
            .unwrap();
        }
        // 冻结的 V1 表里的旧数据不能被读到
        c.execute("INSERT INTO message VALUES ('old', 's0', 1, ?1)", [assistant(true, 1, 0.0)]).unwrap();
        drop(c);

        let conn = rusqlite::Connection::open(&path).unwrap();
        let (rows, _) = read_rows(&conn).unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.request_id.as_str()).collect();
        assert_eq!(ids, vec!["opencode-s2:a", "opencode-s2:b"]);
        assert_eq!(rows[0].model, "gpt-5");
    }

    #[test]
    fn scan_is_idempotent_and_skips_unchanged_db() {
        let path = temp_db("scan");
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch("CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);")
            .unwrap();
        c.execute("INSERT INTO message VALUES ('m1', 's1', 1, ?1)", [assistant(true, 50, 0.5)]).unwrap();
        drop(c);

        let db = Database::in_memory().unwrap();
        let first = scan_db_at(&db, &path);
        assert_eq!(first.inserted, 1);
        let second = scan_db_at(&db, &path);
        assert_eq!(second.inserted, 0, "数据库没变化直接跳过");
        assert_eq!(second.skipped, 0);
    }
}
