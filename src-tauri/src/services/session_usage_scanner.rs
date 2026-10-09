//! 从 Claude Code / Codex 的本地会话文件（JSONL）采集用量
//!
//! # 为什么需要这条通道
//!
//! 用量统计有两个数据来源：
//!
//! 1. **代理记账** —— 本项目代理转发上游API 响应时顺带记账（见 `proxy/usage/logger.rs`）。
//!    只有请求真的走了本项目代理才有数据。
//! 2. **会话文件** —— Claude Code / Codex 把每次 API 调用的 usage 写进
//!    `~/.claude/projects/<project>/<session>.jsonl`，与是否走代理无关。
//!
//! 实际使用中大多数请求**不经过**本项目代理（用户可能直连、可能用别的代理），
//! 因此只靠代理记账会漏掉绝大部分用量。参考项目 cc-switch 早期正是
//! 用这条通道记账（`proxy_request_logs.data_source = 'session_log'`），
//! 后来才改成代理优先。
//!
//! # 采集策略
//!
//! - 扫描 `~/.claude/projects/**/*.jsonl` 与 `~/.codex/sessions/**/*.jsonl`
//! - **文件级增量**：`session_scan_files` 记录每个文件上次扫到的字节偏移与当时的
//!   size / mtime。没变化的文件连打开都不打开；变过的只从偏移处续读新追加的完整行。
//!   会话 JSONL 是追加写的，这个假设成立；文件被截断时从头重扫。
//! - **行级预筛选**：不含 `"usage"` 等字面量的行不可能解析出用量，直接跳过、不解 JSON。
//!   绝大多数行是用户消息 / 工具结果（往往很长），这是扫描提速的主要来源。
//! - **幂等**：`request_id` 是主键，`INSERT OR IGNORE` 去重；中断、重扫、截断重读都不会重复记账。
//! - **批量落库**：一个文件一个事务（日志行 + 扫描进度原子提交），而不是一行一次自动提交。
//!
//! 本机实测规模：Codex 会话 755 个文件 887 MB。改造前每次扫描整体读入并逐行解 JSON，
//! 改造后稳态只是 stat 一遍文件。

use crate::database::dao::usage_logs::RequestLogRow;
use crate::database::Database;
use crate::proxy::usage::calculator::{CostCalculator, ModelPricing};
use crate::proxy::usage::parser::TokenUsage;
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// 数据来源标记（对应 `proxy_request_logs.data_source`）
pub const SOURCE_SESSION_LOG: &str = "session_log";
pub const SOURCE_CODEX_SESSION: &str = "codex_session";

/// 会话文件来源的 provider_id
///
/// 会话文件里没有 provider 概念（用户可能直连），统一归到 `_session`，
/// 这样能在 provider 统计里与代理记账的条目区分开。
const SESSION_PROVIDER_ID: &str = "_session";
const CODEX_SESSION_PROVIDER_ID: &str = "_codex_session";

/// 读文件用的缓冲区大小
const READ_BUF_BYTES: usize = 256 * 1024;

/// 文件多久没写过就视为「已结束」
///
/// 已结束的文件，末尾没有换行的最后一行也按完整行处理；否则一个不以换行结尾的
/// 已完成会话，最后一条记录会永远收不进来。仍在写入中的文件则把它留给下次。
const SETTLED_AFTER_MS: i64 = 2 * 60 * 1000;

/// 一次扫描的结果
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ScanResult {
    /// 新增入库的行数
    pub inserted: u32,
    /// 因已存在而跳过的行数
    pub skipped: u32,
    /// 解析失败 / 无 token 的行数
    pub ignored: u32,
    /// 扫描过的文件数
    pub files: u32,
}

impl ScanResult {
    pub fn merge(&mut self, other: &ScanResult) {
        self.inserted += other.inserted;
        self.skipped += other.skipped;
        self.ignored += other.ignored;
        self.files += other.files;
    }
}

/// 扫描全部会话文件并写入统计库
pub fn scan_all(db: &Database) -> Result<ScanResult, String> {
    let mut total = ScanResult::default();

    let (claude_dir, codex_dir) = session_dirs()?;
    tracing::debug!(
        "[SessionScan] claude_dir={:?} codex_dir={:?}",
        claude_dir,
        codex_dir
    );

    total.merge(&scan_claude(db, claude_dir.as_deref()));
    total.merge(&scan_codex(db, codex_dir.as_deref()));

    if total.inserted > 0 {
        tracing::info!(
            "[SessionScan] 会话文件采集完成：新增 {} 条（跳过 {}，忽略 {}，扫描 {} 个文件）",
            total.inserted,
            total.skipped,
            total.ignored,
            total.files
        );
    }
    Ok(total)
}

/// 会话文件所在目录
///
/// `CLAUDE_CONFIG_DIR` / `CODEX_HOME` 是这两个工具官方支持的环境变量，
/// 用户自定义过目录时必须认，否则会扫错地方。
fn session_dirs() -> Result<(Option<PathBuf>, Option<PathBuf>), String> {
    let home = dirs_home()?;

    let claude = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .map(|p| p.join("projects"))
        .unwrap_or_else(|| home.join(".claude").join("projects"));

    let codex = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .map(|p| p.join("sessions"))
        .unwrap_or_else(|| home.join(".codex").join("sessions"));

    Ok((Some(claude), Some(codex)))
}

fn dirs_home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法确定用户主目录".to_string())
}

/// 递归收集目录下所有 `.jsonl` 文件
fn collect_jsonl(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(cur) = stack.pop() {
        let Ok(entries) = fs::read_dir(&cur) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Claude Code 的子代理也各有一个会话目录，必须一起扫
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "jsonl") {
                out.push(path);
            }
        }
    }
    out
}

/// 会话文件来源：决定行预筛选的字面量与解析器
#[derive(Clone, Copy)]
enum Source {
    Claude,
    Codex,
}

impl Source {
    /// 一行里必须同时出现的字面量；缺任何一个都不可能解析出用量
    ///
    /// JSON 键名在文本里一定以带引号的字面量出现，所以子串检查是解析结果的安全超集。
    fn markers(self) -> &'static [&'static str] {
        match self {
            // type == "assistant" 且 message.usage 存在
            Source::Claude => &["\"assistant\"", "\"usage\""],
            // payload.info.last_token_usage / total_token_usage
            Source::Codex => &["token_usage"],
        }
    }

    fn build_row(self, entry: &Value, fallback_session: &str) -> Option<RequestLogRow> {
        match self {
            Source::Claude => build_row_from_claude(entry, fallback_session),
            Source::Codex => build_row_from_codex(entry, fallback_session),
        }
    }
}

/// 扫描 Claude Code 会话
fn scan_claude(db: &Database, dir: Option<&Path>) -> ScanResult {
    scan_dir(db, Source::Claude, dir)
}

/// 扫描 Codex 会话
fn scan_codex(db: &Database, dir: Option<&Path>) -> ScanResult {
    scan_dir(db, Source::Codex, dir)
}

/// 扫描一个来源目录下的全部会话文件
fn scan_dir(db: &Database, source: Source, dir: Option<&Path>) -> ScanResult {
    let Some(dir) = dir else {
        return ScanResult::default();
    };
    let files = collect_jsonl(dir);
    let mut result = ScanResult {
        files: files.len() as u32,
        ..Default::default()
    };

    // 一次扫描里模型名高度重复，定价按名缓存，避免每行查库
    let mut pricing: HashMap<String, Option<ModelPricing>> = HashMap::new();
    for path in &files {
        scan_file(db, source, path, &mut pricing, &mut result);
    }
    result
}

/// 增量处理单个会话文件
///
/// 没变化的文件直接跳过（不打开）；变过的只从上次的偏移续读。
fn scan_file(
    db: &Database,
    source: Source,
    path: &Path,
    pricing: &mut HashMap<String, Option<ModelPricing>>,
    result: &mut ScanResult,
) {
    let path_key = path.to_string_lossy().into_owned();
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    let size = meta.len() as i64;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let mut offset: i64 = 0;
    // Codex 的思考强度写在本轮开头的 turn_context 里；从中途续读时沿用上次读到的值
    let mut effort: Option<String> = None;
    if let Some((seen_size, seen_mtime, seen_offset, seen_effort)) =
        db.get_session_scan_state(&path_key).unwrap_or(None)
    {
        if seen_size == size && seen_mtime == mtime_ms {
            // 没动过：不打开文件。稳态下绝大多数文件走这条路径。
            return;
        }
        // 比上次记录的偏移还短 → 被截断或重写，从头重扫（重复行由主键兜底）
        if seen_offset <= size {
            offset = seen_offset;
            effort = seen_effort;
        }
    }

    let Ok(file) = File::open(path) else {
        return;
    };
    let mut reader = BufReader::with_capacity(READ_BUF_BYTES, file);
    if offset > 0 && reader.seek(SeekFrom::Start(offset as u64)).is_err() {
        offset = 0;
        effort = None;
        if reader.seek(SeekFrom::Start(0)).is_err() {
            return;
        }
    }

    let session_id = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let settled = now_ms().saturating_sub(mtime_ms) > SETTLED_AFTER_MS;

    let (rows, consumed) = read_new_rows(
        &mut reader,
        source,
        &session_id,
        settled,
        &mut effort,
        db,
        pricing,
        result,
    );

    match db.commit_session_file(
        &rows,
        &path_key,
        size,
        mtime_ms,
        offset + consumed,
        effort.as_deref(),
    ) {
        Ok(inserted) => {
            result.inserted += inserted;
            result.skipped += rows.len() as u32 - inserted;
        }
        Err(e) => tracing::warn!("[SessionScan] 写入失败 ({}): {e}", path.display()),
    }
}

/// 从 reader 当前位置读出所有完整行并解析，返回（日志行，消费的字节数）
///
/// 末尾没有换行的那一行视为写入方尚未写完：不消费、留给下次；
/// 文件已「结束」（久未修改）时例外，按完整行处理。
fn read_new_rows(
    reader: &mut BufReader<File>,
    source: Source,
    session_id: &str,
    settled: bool,
    effort: &mut Option<String>,
    db: &Database,
    pricing: &mut HashMap<String, Option<ModelPricing>>,
    result: &mut ScanResult,
) -> (Vec<RequestLogRow>, i64) {
    let markers = source.markers();
    let mut rows = Vec::new();
    let mut consumed: i64 = 0;
    let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);

    loop {
        buf.clear();
        let n = match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        let complete = buf.last() == Some(&b'\n');
        if !complete && !settled {
            break;
        }
        consumed += n as i64;

        // 按字节做预筛选；绝大多数行在这里就被跳过，不付 JSON 解析的代价
        let text = String::from_utf8_lossy(&buf);
        let line = text.trim();

        // Codex：每轮开头的 turn_context 声明思考强度，本轮后续的用量行沿用它
        if matches!(source, Source::Codex) && line.contains("\"turn_context\"") {
            if let Ok(entry) = serde_json::from_str::<Value>(line) {
                if let Some(e) = codex_turn_effort(&entry) {
                    *effort = Some(e);
                }
            }
            continue;
        }

        if line.len() < 2 || !markers.iter().all(|m| line.contains(m)) {
            continue;
        }

        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            result.ignored += 1;
            continue;
        };
        let Some(mut row) = source.build_row(&entry, session_id) else {
            result.ignored += 1;
            continue;
        };
        if row.reasoning_effort.is_none() {
            row.reasoning_effort = effort.clone();
        }
        let price = lookup_pricing(db, pricing, &row.model).cloned();
        apply_cost(&mut row, price.as_ref());
        rows.push(row);
    }

    (rows, consumed)
}

/// 查模型定价（带缓存）；缺价每个模型只告警一次
fn lookup_pricing<'a>(
    db: &Database,
    cache: &'a mut HashMap<String, Option<ModelPricing>>,
    model: &str,
) -> Option<&'a ModelPricing> {
    cache
        .entry(model.to_string())
        .or_insert_with(|| {
            // 会话文件里没有 provider 概念，所以倍率恒为 1；
            // 价格从定价表按模型名查（与代理记账共用同一套逻辑和同一个价格）
            let found = db.find_model_pricing(model).unwrap_or(None).and_then(|p| {
                ModelPricing::from_strings(
                    &p.input_cost_per_million,
                    &p.output_cost_per_million,
                    &p.cache_read_cost_per_million,
                    &p.cache_creation_cost_per_million,
                )
                .ok()
            });
            if found.is_none() && !model.is_empty() {
                tracing::warn!("[SessionScan] 模型无定价，成本记 0: {model}");
            }
            found
        })
        .as_ref()
}

/// 按定价算成本写回行；无定价时各项保持 "0"
fn apply_cost(row: &mut RequestLogRow, pricing: Option<&ModelPricing>) {
    let Some(pricing) = pricing else {
        return;
    };
    let usage = TokenUsage {
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_tokens: row.cache_read_tokens,
        cache_creation_tokens: row.cache_creation_tokens,
        model: None,
    };
    let cost = CostCalculator::calculate_for_app(&row.app_type, &usage, pricing, Decimal::ONE);
    row.input_cost_usd = cost.input_cost.to_string();
    row.output_cost_usd = cost.output_cost.to_string();
    row.cache_read_cost_usd = cost.cache_read_cost.to_string();
    row.cache_creation_cost_usd = cost.cache_creation_cost.to_string();
    row.total_cost_usd = cost.total_cost.to_string();
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 从一条 Claude Code JSONL 记录构造日志行
fn build_row_from_claude(entry: &Value, fallback_session: &str) -> Option<RequestLogRow> {
    // 只要 assistant 回复才有 usage；user 消息的 message.usage 是空的
    if entry.get("type").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let message = entry.get("message")?;
    let usage = message.get("usage")?;

    let input = usage.get("input_tokens").and_then(Value::as_u64).unwrap_or(0) as u32;
    let output = usage.get("output_tokens").and_then(Value::as_u64).unwrap_or(0) as u32;
    let cache_read = usage
        .get("cache_read_input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0) as u32;
    let cache_creation = usage
        .get("cache_creation_input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0) as u32;

    // 全0 是 <synthetic> 占位记录，记进去只会污染统计
    if input == 0 && output == 0 && cache_read == 0 && cache_creation == 0 {
        return None;
    }

    let model = message
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let session_id = entry
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| fallback_session.to_string());

    // 优先用 requestId（一次 API 调用一个 id），否则用行 uuid
    let request_id = entry
        .get("requestId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| entry.get("uuid").and_then(Value::as_str).map(str::to_string))
        // 两者都没有就放弃这一行 —— 无法幂等去重
        .map(|id| format!("claude-{id}"))?;

    let created_at = parse_timestamp(entry.get("timestamp"));

    // 思考强度：顶层 effort 是本次生效的值，perTurnEffort 是本轮的临时覆盖
    let reasoning_effort = ["effort", "perTurnEffort"]
        .iter()
        .find_map(|k| entry.get(*k).and_then(Value::as_str))
        .and_then(normalize_effort);

    Some(RequestLogRow {
        request_id,
        provider_id: SESSION_PROVIDER_ID.to_string(),
        app_type: "claude".to_string(),
        model: model.to_string(),
        request_model: Some(model.to_string()),
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cache_read,
        cache_creation_tokens: cache_creation,
        input_cost_usd: "0".into(),
        output_cost_usd: "0".into(),
        cache_read_cost_usd: "0".into(),
        cache_creation_cost_usd: "0".into(),
        total_cost_usd: "0".into(),
        latency_ms: 0,
        first_token_ms: None,
        // 会话文件里没有延迟信息，与参考项目保持一致记 0
        duration_ms: Some(0),
        status_code: 200,
        error_message: None,
        session_id: Some(session_id),
        provider_type: None,
        is_streaming: false,
        cost_multiplier: "1".into(),
        created_at,
        data_source: Some(SOURCE_SESSION_LOG.to_string()),
        reasoning_effort,
    })
}

/// 从一条 Codex JSONL 记录构造日志行
fn build_row_from_codex(entry: &Value, fallback_session: &str) -> Option<RequestLogRow> {
    // Codex 的结构：payload.type == 'token_count' 且带 info
    let payload = entry.get("payload")?;
    let info = payload.get("info")?;
    let usage = info
        .get("last_token_usage")
        .or_else(|| info.get("total_token_usage"))?;

    let input = usage
        .get("input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0) as u32;
    let output = usage
        .get("output_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0) as u32;
    let cache_read = usage
        .get("cached_input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0) as u32;

    if input == 0 && output == 0 && cache_read == 0 {
        return None;
    }

    let model = info
        .get("model")
        .or_else(|| usage.get("model"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    let session_id = entry
        .get("session_id")
        .or_else(|| entry.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| fallback_session.to_string());

    let ident = entry
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}:{}", session_id, created_at_of(entry)));

    let created_at = created_at_of(entry);

    Some(RequestLogRow {
        request_id: format!("codex-{ident}"),
        provider_id: CODEX_SESSION_PROVIDER_ID.to_string(),
        app_type: "codex".to_string(),
        model: model.to_string(),
        request_model: Some(model.to_string()),
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cache_read,
        cache_creation_tokens: 0,
        input_cost_usd: "0".into(),
        output_cost_usd: "0".into(),
        cache_read_cost_usd: "0".into(),
        cache_creation_cost_usd: "0".into(),
        total_cost_usd: "0".into(),
        latency_ms: 0,
        first_token_ms: None,
        duration_ms: Some(0),
        status_code: 200,
        error_message: None,
        session_id: Some(session_id),
        provider_type: None,
        is_streaming: false,
        cost_multiplier: "1".into(),
        created_at,
        data_source: Some(SOURCE_CODEX_SESSION.to_string()),
        // 由 read_new_rows 用本轮 turn_context 的值补上
        reasoning_effort: None,
    })
}

/// 思考强度原值清洗：去空白、转小写；空串视为没有
fn normalize_effort(raw: &str) -> Option<String> {
    let s = raw.trim();
    (!s.is_empty()).then(|| s.to_ascii_lowercase())
}

/// Codex turn_context 里的思考强度：`payload.effort`，旧版本在 collaboration_mode 里
fn codex_turn_effort(entry: &Value) -> Option<String> {
    let payload = entry.get("payload")?;
    payload
        .get("effort")
        .or_else(|| payload.pointer("/collaboration_mode/settings/reasoning_effort"))
        .and_then(Value::as_str)
        .and_then(normalize_effort)
}

/// 解析 RFC3339 时间戳为 Unix 秒；失败回退 0
fn parse_timestamp(raw: Option<&Value>) -> i64 {
    raw.and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp())
        .unwrap_or(0)
}

/// Codex 记录的时间戳字段名与 Claude 不同
fn created_at_of(entry: &Value) -> i64 {
    if let Some(ts) = parse_timestamp_opt(entry.get("timestamp")) {
        return ts;
    }
    entry
        .get("created_at")
        .and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp())
        .unwrap_or(0)
}

fn parse_timestamp_opt(v: Option<&Value>) -> Option<i64> {
    Some(parse_timestamp(v))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;
    use std::time::Duration;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccg-scan-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn claude_line(request_id: &str) -> String {
        json!({
            "type": "assistant",
            "timestamp": "2026-10-06T07:42:00Z",
            "sessionId": "s1",
            "requestId": request_id,
            "message": {"model": "claude-opus-4-5-20250929",
                        "usage": {"input_tokens": 10, "output_tokens": 2}}
        })
        .to_string()
    }

    fn append(path: &Path, text: &str) {
        let mut f = fs::OpenOptions::new().append(true).open(path).unwrap();
        f.write_all(text.as_bytes()).unwrap();
    }

    #[test]
    fn claude_assistant_with_usage_is_collected() {
        let entry = json!({
            "type": "assistant",
            "timestamp": "2026-10-06T07:42:00.626Z",
            "sessionId": "sess-1",
            "requestId": "req-1",
            "message": {
                "model": "claude-opus-4-5-20250929",
                "usage": {
                    "input_tokens": 1000,
                    "output_tokens": 200,
                    "cache_read_input_tokens": 300,
                    "cache_creation_input_tokens": 50
                }
            }
        });
        let row = build_row_from_claude(&entry, "fallback").unwrap();
        assert_eq!(row.request_id, "claude-req-1");
        assert_eq!(row.provider_id, SESSION_PROVIDER_ID);
        assert_eq!(row.input_tokens, 1000);
        assert_eq!(row.output_tokens, 200);
        assert_eq!(row.cache_read_tokens, 300);
        assert_eq!(row.cache_creation_tokens, 50);
        assert_eq!(row.session_id.as_deref(), Some("sess-1"));
        assert_eq!(row.data_source.as_deref(), Some(SOURCE_SESSION_LOG));
    }

    #[test]
    fn user_message_and_synthetic_are_skipped() {
        // user 消息没有可用 usage
        let user = json!({"type": "user", "message": {"usage": {"input_tokens": 100}}});
        assert!(build_row_from_claude(&user, "s").is_none());

        // <synthetic> 全 0 记录不应污染统计
        let synthetic = json!({
            "type": "assistant",
            "timestamp": "2026-10-06T07:32:31.856Z",
            "sessionId": "s",
            "message": {"model": "<synthetic>", "usage": {
                "input_tokens": 0, "output_tokens": 0,
                "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0
            }}
        });
        assert!(build_row_from_claude(&synthetic, "s").is_none());
    }

    #[test]
    fn claude_without_ident_is_dropped() {
        // 既没 requestId 也没 uuid → 无法幂等去重，必须丢弃
        let entry = json!({
            "type": "assistant",
            "timestamp": "2026-10-06T07:42:00Z",
            "sessionId": "s",
            "message": {"model": "m", "usage": {"input_tokens": 10, "output_tokens": 1}}
        });
        assert!(build_row_from_claude(&entry, "s").is_none());
    }

    #[test]
    fn codex_token_count_is_collected() {
        let entry = json!({
            "type": "event_msg",
            "timestamp": "2026-10-06T07:35:07.080Z",
            "session_id": "codex-sess",
            "payload": {"type": "token_count", "info": {
                "model": "gpt-5.1-codex",
                "last_token_usage": {
                    "input_tokens": 6165, "output_tokens": 13, "cached_input_tokens": 6855
                }
            }}
        });
        let row = build_row_from_codex(&entry, "fallback").unwrap();
        assert_eq!(row.app_type, "codex");
        assert_eq!(row.input_tokens, 6165);
        assert_eq!(row.output_tokens, 13);
        assert_eq!(row.cache_read_tokens, 6855);
        assert_eq!(row.data_source.as_deref(), Some(SOURCE_CODEX_SESSION));
    }

    #[test]
    fn timestamp_falls_back_to_zero_on_garbage() {
        let entry = json!({
            "type": "assistant",
            "timestamp": "not-a-time",
            "requestId": "r",
            "message": {"model": "m", "usage": {"input_tokens": 5, "output_tokens": 1}}
        });
        let row = build_row_from_claude(&entry, "s").unwrap();
        assert_eq!(row.created_at, 0);
    }

    #[test]
    fn line_markers_are_a_superset_of_parseable_rows() {
        // 预筛选不能把能解析出用量的行筛掉：两种来源的真实样例都必须命中全部字面量
        let claude = claude_line("x");
        assert!(Source::Claude.markers().iter().all(|m| claude.contains(m)));

        let codex = json!({"payload": {"info": {"model": "m",
            "last_token_usage": {"input_tokens": 1, "output_tokens": 1}}}})
        .to_string();
        assert!(Source::Codex.markers().iter().all(|m| codex.contains(m)));

        // 用户消息 / 工具结果这类行不含 "usage"，在预筛选阶段就该被跳过
        let user = json!({"type": "user", "message": {"role": "user", "content": "hi"}}).to_string();
        assert!(!Source::Claude.markers().iter().all(|m| user.contains(m)));
    }

    #[test]
    fn scan_is_idempotent_and_deduplicates() {
        let dir = temp_dir();
        let line = claude_line("dup-1");
        fs::write(dir.join("s1.jsonl"), format!("{line}\n{line}\n")).unwrap();

        let db = Database::in_memory().unwrap();
        let first = scan_claude(&db, Some(&dir));
        assert_eq!(first.inserted, 1, "同一 requestId 只应入库一次");
        assert_eq!(first.skipped, 1);
        assert_eq!(first.files, 1);

        // 文件没变化：第二次扫描整文件跳过，既不新增也不重读
        let second = scan_claude(&db, Some(&dir));
        assert_eq!(second.inserted, 0, "重复扫描不应新增任何行");
        assert_eq!(second.skipped, 0, "未变化的文件不应被重读");
        assert_eq!(second.files, 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn appended_lines_are_read_from_the_recorded_offset() {
        let dir = temp_dir();
        let path = dir.join("s.jsonl");
        fs::write(&path, format!("{}\n", claude_line("a"))).unwrap();
        let db = Database::in_memory().unwrap();
        assert_eq!(scan_claude(&db, Some(&dir)).inserted, 1);

        // 追加一行：只读新行，旧行连跳过计数都不该出现（说明没有被重读）
        append(&path, &format!("{}\n", claude_line("b")));
        let r = scan_claude(&db, Some(&dir));
        assert_eq!(r.inserted, 1);
        assert_eq!(r.skipped, 0, "偏移之前的旧行不应被重读");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn truncated_file_is_rescanned_from_start() {
        let dir = temp_dir();
        let path = dir.join("s.jsonl");
        fs::write(&path, format!("{}\n{}\n", claude_line("a"), claude_line("b"))).unwrap();
        let db = Database::in_memory().unwrap();
        assert_eq!(scan_claude(&db, Some(&dir)).inserted, 2);

        // 文件被重写得比记录的偏移还短 → 从头重扫，新内容入库、旧偏移作废
        fs::write(&path, format!("{}\n", claude_line("c"))).unwrap();
        let r = scan_claude(&db, Some(&dir));
        assert_eq!(r.inserted, 1);
        assert_eq!(r.skipped, 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn incomplete_trailing_line_waits_for_newline() {
        let dir = temp_dir();
        let path = dir.join("s.jsonl");
        let b = claude_line("b");
        let (head, tail) = b.split_at(b.len() / 2);
        // 第二行只写了一半，没有换行：写入方还没写完
        fs::write(&path, format!("{}\n{head}", claude_line("a"))).unwrap();
        let db = Database::in_memory().unwrap();
        let first = scan_claude(&db, Some(&dir));
        assert_eq!(first.inserted, 1, "半行不应被当成坏行消费掉");
        assert_eq!(first.ignored, 0);

        // 写完后再扫：半行补全、入库
        append(&path, &format!("{tail}\n"));
        let second = scan_claude(&db, Some(&dir));
        assert_eq!(second.inserted, 1);
        assert_eq!(second.skipped, 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn settled_file_consumes_unterminated_last_line() {
        let dir = temp_dir();
        let path = dir.join("s.jsonl");
        // 已完成的会话，最后一行没有换行
        fs::write(&path, format!("{}\n{}", claude_line("a"), claude_line("b"))).unwrap();
        let f = fs::OpenOptions::new().write(true).open(&path).unwrap();
        f.set_modified(SystemTime::now() - Duration::from_secs(10 * 60))
            .unwrap();

        let db = Database::in_memory().unwrap();
        let r = scan_claude(&db, Some(&dir));
        assert_eq!(r.inserted, 2, "久未修改的文件，无换行末行也应入库");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn claude_effort_is_read_from_each_record() {
        let mut entry: Value = serde_json::from_str(&claude_line("r")).unwrap();
        entry["effort"] = json!("XHigh");
        let row = build_row_from_claude(&entry, "s").unwrap();
        assert_eq!(row.reasoning_effort.as_deref(), Some("xhigh"));

        // 没有 effort 时退到 perTurnEffort；都没有则为 None
        entry.as_object_mut().unwrap().remove("effort");
        entry["perTurnEffort"] = json!("medium");
        assert_eq!(
            build_row_from_claude(&entry, "s").unwrap().reasoning_effort.as_deref(),
            Some("medium")
        );
        entry.as_object_mut().unwrap().remove("perTurnEffort");
        assert_eq!(build_row_from_claude(&entry, "s").unwrap().reasoning_effort, None);
    }

    fn codex_turn(effort: &str) -> String {
        json!({"type": "turn_context", "timestamp": "2026-10-06T07:35:00Z",
               "payload": {"effort": effort}})
        .to_string()
    }

    fn codex_usage(id: &str) -> String {
        json!({"type": "event_msg", "id": id, "timestamp": "2026-10-06T07:35:07Z",
               "payload": {"type": "token_count", "info": {"model": "gpt-5.1-codex",
                 "last_token_usage": {"input_tokens": 100, "output_tokens": 10}}}})
        .to_string()
    }

    fn effort_of(db: &Database, request_id: &str) -> Option<String> {
        db.get_request_detail(request_id).unwrap().unwrap().reasoning_effort
    }

    #[test]
    fn codex_effort_carries_from_turn_context_across_incremental_scans() {
        let dir = temp_dir();
        let path = dir.join("rollout.jsonl");
        fs::write(
            &path,
            format!("{}\n{}\n", codex_turn("high"), codex_usage("u1")),
        )
        .unwrap();
        let db = Database::in_memory().unwrap();
        assert_eq!(scan_codex(&db, Some(&dir)).inserted, 1);
        assert_eq!(effort_of(&db, "codex-u1").as_deref(), Some("high"));

        // 续读：新行之前没有新的 turn_context，必须沿用上次记住的 high
        append(&path, &format!("{}\n", codex_usage("u2")));
        assert_eq!(scan_codex(&db, Some(&dir)).inserted, 1);
        assert_eq!(effort_of(&db, "codex-u2").as_deref(), Some("high"));

        // 新一轮改了强度：之后的行跟着变
        append(&path, &format!("{}\n{}\n", codex_turn("ultra"), codex_usage("u3")));
        scan_codex(&db, Some(&dir));
        assert_eq!(effort_of(&db, "codex-u3").as_deref(), Some("ultra"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_dir_yields_zero_files() {
        let db = Database::in_memory().unwrap();
        let r = scan_claude(&db, Some(Path::new("/definitely/not/here")));
        assert_eq!(r.files, 0);
        assert_eq!(r.inserted, 0);
    }

    /// 真实目录基准：只读本机会话目录、写内存库，不碰生产库。
    /// `cargo test --release -- --ignored --nocapture bench_real_session_dirs`
    #[test]
    #[ignore]
    fn bench_real_session_dirs() {
        let db = Database::in_memory().unwrap();

        let t = std::time::Instant::now();
        let first = scan_all(&db).unwrap();
        let first_elapsed = t.elapsed();

        let t = std::time::Instant::now();
        let second = scan_all(&db).unwrap();
        let second_elapsed = t.elapsed();

        eprintln!("[bench] first scan  {first_elapsed:?}  {first:?}");
        eprintln!("[bench] second scan {second_elapsed:?}  {second:?}");

        // 思考强度采集分布（核对真实文件结构）
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT app_type, COALESCE(reasoning_effort, '(none)'), COUNT(*) FROM proxy_request_logs GROUP BY 1, 2 ORDER BY 1, 3 DESC")
            .unwrap();
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))
            .unwrap();
        for r in rows.flatten() {
            eprintln!("[bench] effort {:<8} {:<8} {}", r.0, r.1, r.2);
        }
    }
}
