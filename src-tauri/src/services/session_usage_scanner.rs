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
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
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

// ============ 会话日志耗时估算 ============
// 会话文件里没有请求计时，耗时只能按日志时间戳估出来（含首字等待）。估出来的值
// 写进 `latency_ms`（0 = 没估出来），`first_token_ms` 恒为 None。这个口径与代理记账
// 的精确速度（从首字算到结束）分开累计，前端用 ≈ 区分。

/// 估算耗时短于这个毫秒数就不要：真实请求不可能这么快，多半是起点取错了。
const MIN_PLAUSIBLE_LATENCY_MS: i64 = 100;
/// 估算耗时长于这个毫秒数也不要：中间多半夹了休眠或长时间的重试等待。
const MAX_PLAUSIBLE_LATENCY_MS: i64 = 60 * 60 * 1000;

/// 会话日志没有请求计时，耗时只能拿两个时间戳相减估出来（含首字等待）。
/// 落在合理范围之外的返回 None，入库时写 0，表示没有计时。
fn estimated_latency_ms(start_ms: i64, end_ms: i64) -> Option<i64> {
    let latency = end_ms.checked_sub(start_ms)?;
    (MIN_PLAUSIBLE_LATENCY_MS..=MAX_PLAUSIBLE_LATENCY_MS)
        .contains(&latency)
        .then_some(latency)
}

fn parse_timestamp_millis(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

// --- Claude：沿 parentUuid 链找请求起点，各块里最晚的时间戳算结束 ---

/// 一行日志在对话链上的位置，只留估算请求耗时用得到的三样。
struct ChainNode {
    parent: Option<uuid::Uuid>,
    timestamp_ms: Option<i64>,
    /// `attachment` 行的时间戳不可靠（有的是回复开始后才补记的），找请求起点时跳过。
    is_attachment: bool,
}

type ChainNodes = HashMap<uuid::Uuid, ChainNode>;

fn parse_line_uuid(value: &Value, key: &str) -> Option<uuid::Uuid> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .and_then(|s| uuid::Uuid::parse_str(s).ok())
}

fn record_chain_node(chain: &mut ChainNodes, value: &Value) {
    let Some(uuid) = parse_line_uuid(value, "uuid") else {
        return;
    };
    chain.insert(
        uuid,
        ChainNode {
            parent: parse_line_uuid(value, "parentUuid"),
            timestamp_ms: value
                .get("timestamp")
                .and_then(|v| v.as_str())
                .and_then(parse_timestamp_millis),
            is_attachment: value.get("type").and_then(|t| t.as_str()) == Some("attachment"),
        },
    );
}

/// assistant 行的 `message.id`；别的行返回 None。
fn assistant_message_id(value: &Value) -> Option<&str> {
    if value.get("type").and_then(|t| t.as_str()) != Some("assistant") {
        return None;
    }
    value.get("message")?.get("id")?.as_str()
}

/// 一条回复（同一个 message.id 的所有内容块）的计时线索。
struct MessageTiming {
    /// 文件里最先出现的那一块的父行，请求起点沿它往上找。
    first_parent: Option<uuid::Uuid>,
    /// 最先出现的那一块是不是这条回复的第一块。不是的话（前面的块在回看窗口
    /// 之外）起点会取晚、速度偏高，宁可不估。旧版日志没有 `apiBlockIndex`，按是处理。
    starts_at_first_block: bool,
    /// 各块时间戳（块写完的时刻）里最晚的一个，即回复结束。
    end_ms: Option<i64>,
}

fn record_block_timing(timings: &mut HashMap<String, MessageTiming>, value: &Value, msg_id: &str) {
    let block_end_ms = value
        .get("timestamp")
        .and_then(|v| v.as_str())
        .and_then(parse_timestamp_millis);
    let timing = timings
        .entry(msg_id.to_string())
        .or_insert_with(|| MessageTiming {
            first_parent: parse_line_uuid(value, "parentUuid"),
            starts_at_first_block: value
                .get("apiBlockIndex")
                .map_or(true, |index| index.as_u64() == Some(0)),
            end_ms: None,
        });
    timing.end_ms = timing.end_ms.max(block_end_ms);
}

/// 沿父链往上最多走这么多步。
const MAX_CHAIN_HOPS: usize = 32;

/// 请求起点：从回复第一块的父行往上，跳过 `attachment`，第一个别的行（用户
/// 消息、工具结果、出错重试的 system 行）的时间戳。
fn resolve_request_start_ms(chain: &ChainNodes, first_parent: Option<uuid::Uuid>) -> Option<i64> {
    let mut cursor = first_parent?;
    for _ in 0..MAX_CHAIN_HOPS {
        let node = chain.get(&cursor)?;
        if !node.is_attachment {
            return node.timestamp_ms;
        }
        cursor = node.parent?;
    }
    None
}

/// 一条 Claude 回复的估算耗时：只给写完整（有 stop_reason）且看得到第一块的算。
fn claude_latency_ms(
    entry: &Value,
    chain: &ChainNodes,
    timings: &HashMap<String, MessageTiming>,
) -> Option<i64> {
    let msg_id = assistant_message_id(entry)?;
    let timing = timings.get(msg_id)?;
    let has_stop_reason = entry
        .get("message")
        .and_then(|m| m.get("stop_reason"))
        .and_then(|v| v.as_str())
        .is_some();
    if !has_stop_reason || !timing.starts_at_first_block {
        return None;
    }
    let start_ms = resolve_request_start_ms(chain, timing.first_parent)?;
    estimated_latency_ms(start_ms, timing.end_ms?)
}

/// 回看游标前这么多字节，把对话链与回复计时补上（起点行通常在游标前）。
const CHAIN_SEED_BYTES: i64 = 256 * 1024;

/// 把游标前一小段里的行记进对话链和回复计时（只取这两样，不导入）。返回后
/// 文件位置停在 `offset`。回看读不出来不算错，只是少估几条耗时。
fn read_chain_seed(
    file: &mut File,
    offset: i64,
    chain: &mut ChainNodes,
    timings: &mut HashMap<String, MessageTiming>,
) -> std::io::Result<()> {
    let len = offset.clamp(0, CHAIN_SEED_BYTES);
    if len == 0 {
        return Ok(());
    }
    let mut window = vec![0u8; len as usize];
    let read_ok = file
        .seek(SeekFrom::Start((offset - len) as u64))
        .and_then(|_| file.read_exact(&mut window))
        .is_ok();
    file.seek(SeekFrom::Start(offset as u64))?;
    if !read_ok {
        return Ok(());
    }
    let mut lines = window.split(|b| *b == b'\n');
    if offset > len {
        // 窗口不是从文件头开始，第一段多半是半行
        lines.next();
    }
    for line in lines {
        if let Ok(value) = serde_json::from_slice::<Value>(line) {
            record_chain_node(chain, &value);
            if let Some(msg_id) = assistant_message_id(&value) {
                record_block_timing(timings, &value, msg_id);
            }
        }
    }
    Ok(())
}

// --- Codex：按事件顺序估每次请求的耗时 ---

#[derive(Debug)]
struct CumulativeTokens {
    input: u64,
    cached_input: u64,
    output: u64,
}

fn parse_cumulative_tokens(total_usage: &Value) -> Option<CumulativeTokens> {
    let fields = total_usage.as_object()?;
    if ![
        "input_tokens",
        "cached_input_tokens",
        "cache_read_input_tokens",
        "output_tokens",
        "reasoning_output_tokens",
        "total_tokens",
    ]
    .iter()
    .any(|field| fields.contains_key(*field))
    {
        return None;
    }
    Some(CumulativeTokens {
        input: total_usage
            .get("input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        cached_input: total_usage
            .get("cached_input_tokens")
            .or_else(|| total_usage.get("cache_read_input_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        output: total_usage
            .get("output_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
    })
}

/// 只看每行开头这么多字节来判断行的种类：时间戳、类型、角色都在行头，
/// 后面的正文（工具输出可能上百 KB）不用解析。
const LINE_HEAD_BYTES: usize = 512;

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// 从行头里取 `"key":"value"` 的值。只用于时间戳、类型名、角色这类不含转义的短值。
fn head_str<'a>(head: &'a [u8], key: &str) -> Option<&'a str> {
    let needle = format!("\"{key}\":\"");
    let start = find_bytes(head, needle.as_bytes())? + needle.len();
    let len = head[start..].iter().position(|b| *b == b'"')?;
    std::str::from_utf8(&head[start..start + len]).ok()
}

#[derive(Debug, PartialEq, Eq)]
enum TimingLine {
    /// 下一次请求只会在它之后发出：用户消息、`turn_context`
    Boundary,
    /// 工具结果，同样是下一次请求的起点
    ToolOutput,
    /// 模型输出的一项（思考、回复、工具调用），写在这一项生成完的时刻
    ModelOutput,
    /// `token_usage_record`：响应结束时写的用量记录（新版 Codex 才有）
    UsageRecord,
    /// 一轮开始（`task_started`）或被中断（`turn_aborted`）：没等到 `token_count`
    /// 的那次请求到此作废
    TurnReset,
}

fn classify_timing_line(line: &str) -> Option<(i64, TimingLine)> {
    let bytes = line.as_bytes();
    let head = &bytes[..bytes.len().min(LINE_HEAD_BYTES)];
    let (envelope, payload) = match find_bytes(head, b"\"payload\":{") {
        Some(at) => head.split_at(at),
        None => (head, &[][..]),
    };
    let kind = match head_str(envelope, "type")? {
        "turn_context" => TimingLine::Boundary,
        "token_usage_record" => TimingLine::UsageRecord,
        "response_item" => match head_str(payload, "type")? {
            "message" => match head_str(payload, "role")? {
                "assistant" => TimingLine::ModelOutput,
                _ => TimingLine::Boundary,
            },
            "reasoning" => TimingLine::ModelOutput,
            item if item.ends_with("_output") => TimingLine::ToolOutput,
            item if item.ends_with("_call") => TimingLine::ModelOutput,
            _ => return None,
        },
        "event_msg" => match head_str(payload, "type")? {
            "task_started" | "turn_aborted" => TimingLine::TurnReset,
            _ => return None,
        },
        _ => return None,
    };
    let timestamp_ms = head_str(envelope, "timestamp").and_then(parse_timestamp_millis)?;
    Some((timestamp_ms, kind))
}

/// 两行的时间戳相差不超过这个毫秒数，就算是同一批写出的（实测相差 0–1 毫秒，
/// 而一次真实的请求不可能这么快）。
const SAME_FLUSH_SLACK_MS: i64 = 100;

/// 按事件顺序估每次请求的耗时。Codex 日志没有请求级计时，而且各版本的事件顺序
/// 不一样（详见 `finish_request` 注释）。
#[derive(Debug, Default)]
struct RequestTimer {
    last_boundary_ms: Option<i64>,
    last_token_count_ms: Option<i64>,
    request_start_ms: Option<i64>,
    last_model_output_ms: Option<i64>,
    /// 最后一个输出项之后出现的工具结果里最晚的一个；之后再有输出项就清空。
    tool_output_after_model_output_ms: Option<i64>,
    usage_record: Option<(i64, CumulativeTokens)>,
}

impl RequestTimer {
    fn observe_line(&mut self, line: &str) {
        let Some((timestamp_ms, kind)) = classify_timing_line(line) else {
            return;
        };
        match kind {
            TimingLine::Boundary => {
                self.last_boundary_ms = self.last_boundary_ms.max(Some(timestamp_ms));
            }
            TimingLine::ToolOutput => {
                self.last_boundary_ms = self.last_boundary_ms.max(Some(timestamp_ms));
                if self.last_model_output_ms.is_some() {
                    self.tool_output_after_model_output_ms = Some(timestamp_ms);
                }
            }
            TimingLine::ModelOutput => {
                // 2025 年的旧布局把上一次响应的输出项补写在它的 token_count 之后
                // （时间戳和那个 token_count 一样）。这些输出项不属于下一次请求，
                // 直接忽略，否则下一次请求的起点会被钉在上一次响应结束的时刻。
                let trails_token_count = self.request_start_ms.is_none()
                    && self
                        .last_token_count_ms
                        .is_some_and(|at| timestamp_ms - at <= SAME_FLUSH_SLACK_MS);
                if trails_token_count {
                    return;
                }
                if self.request_start_ms.is_none() {
                    self.request_start_ms = self.last_boundary_ms;
                }
                self.last_model_output_ms = Some(timestamp_ms);
                self.tool_output_after_model_output_ms = None;
            }
            TimingLine::UsageRecord => {
                // 行头只够判断种类，用量要解析整行；这类行很短
                let usage = serde_json::from_str::<Value>(line)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("payload")
                            .and_then(|payload| payload.get("usage"))
                            .and_then(parse_cumulative_tokens)
                    });
                self.usage_record = usage.map(|usage| (timestamp_ms, usage));
            }
            TimingLine::TurnReset => {
                // 请求被中断或出错时等不到 token_count，它留下的起点要在下一轮开始时
                // 清掉，否则会被下一次请求沿用。
                *self = RequestTimer {
                    last_boundary_ms: self.last_boundary_ms.max(Some(timestamp_ms)),
                    last_token_count_ms: self.last_token_count_ms,
                    ..RequestTimer::default()
                };
            }
        }
    }

    /// 遇到一次有用量的 `token_count`：结算这次请求的耗时，并把它记成下一次请求的
    /// 起点。`last` 是这次请求自己的用量，用来确认 `token_usage_record` 说的是同一
    /// 次请求。
    fn finish_request(
        &mut self,
        token_count_ms: Option<i64>,
        last: Option<&CumulativeTokens>,
    ) -> Option<i64> {
        let start_ms = self.request_start_ms.or(self.last_boundary_ms);
        let record_end_ms = self
            .usage_record
            .take()
            .filter(|(_, usage)| {
                last.map_or(true, |last| {
                    usage.input == last.input
                        && usage.cached_input == last.cached_input
                        && usage.output == last.output
                })
            })
            .map(|(timestamp_ms, _)| timestamp_ms);
        let token_count_waited_for_tools =
            match (self.tool_output_after_model_output_ms, token_count_ms) {
                (Some(tool_output_ms), Some(token_count_ms)) => {
                    token_count_ms - tool_output_ms <= SAME_FLUSH_SLACK_MS
                }
                (Some(_), None) => true,
                (None, _) => false,
            };
        let end_ms = record_end_ms.or(if token_count_waited_for_tools {
            self.last_model_output_ms
        } else {
            token_count_ms
        });

        *self = RequestTimer {
            last_boundary_ms: self.last_boundary_ms.max(token_count_ms),
            last_token_count_ms: token_count_ms,
            ..RequestTimer::default()
        };
        estimated_latency_ms(start_ms?, end_ms?)
    }
}

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
    // Codex 的思考强度与模型名都写在本轮开头的 turn_context 里；从中途续读时沿用上次读到的值
    let mut effort: Option<String> = None;
    let mut current_model: Option<String> = None;
    if let Some((seen_size, seen_mtime, seen_offset, seen_effort, seen_model)) =
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
            current_model = seen_model;
        }
    }

    let Ok(mut file) = File::open(path) else {
        return;
    };
    // Claude 估算耗时时起点行（用户消息/工具结果）通常在游标前，续读前先回看
    // 游标前一小段把对话链与回复计时补上；Codex 的计时器只向前看，不需要回看。
    let mut chain = ChainNodes::new();
    let mut timings: HashMap<String, MessageTiming> = HashMap::new();
    if matches!(source, Source::Claude) && offset > 0 {
        let _ = read_chain_seed(&mut file, offset, &mut chain, &mut timings);
    }
    let mut reader = BufReader::with_capacity(READ_BUF_BYTES, file);
    if offset > 0 && reader.seek(SeekFrom::Start(offset as u64)).is_err() {
        offset = 0;
        effort = None;
        current_model = None;
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
        &mut current_model,
        &mut chain,
        &mut timings,
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
        current_model.as_deref(),
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
    current_model: &mut Option<String>,
    chain: &mut ChainNodes,
    timings: &mut HashMap<String, MessageTiming>,
    db: &Database,
    pricing: &mut HashMap<String, Option<ModelPricing>>,
    result: &mut ScanResult,
) -> (Vec<RequestLogRow>, i64) {
    let markers = source.markers();
    let mut rows = Vec::new();
    let mut consumed: i64 = 0;
    let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
    let mut timer = RequestTimer::default();
    // 上一个 token_count 的累计用量（限额刷新时重发的快照 total 不变，靠它识别）
    let mut prev_codex_total: Option<(u64, u64, u64)> = None;

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

        // 计时观察（先于预筛选）：Codex 只按行头分类、不解析整行；Claude 逐行解析进对话链
        match source {
            Source::Codex => {
                // Codex：每轮开头的 turn_context 声明思考强度与模型名，本轮后续的用量行沿用
                if line.contains("\"turn_context\"") {
                    if let Ok(entry) = serde_json::from_str::<Value>(line) {
                        if let Some(e) = codex_turn_effort(&entry) {
                            *effort = Some(e);
                        }
                        if let Some(m) = codex_turn_model(&entry) {
                            *current_model = Some(normalize_codex_model(&m));
                        }
                    }
                    timer.observe_line(line);
                    continue;
                }
                timer.observe_line(line);
            }
            Source::Claude => {
                // 估算耗时要用整条对话链，这里对每一行解 JSON（增量续读只读新增行，
                // 代价可控）。这条路径与参考项目 cc-switch 一致。
                if let Ok(entry) = serde_json::from_str::<Value>(line) {
                    record_chain_node(chain, &entry);
                    if let Some(msg_id) = assistant_message_id(&entry) {
                        record_block_timing(timings, &entry, msg_id);
                    }
                }
            }
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

        // 估算耗时：会话文件没有请求计时，按日志时间戳估（含首字等待），估不出写 0
        row.latency_ms = match source {
            Source::Claude => claude_latency_ms(&entry, chain, timings).unwrap_or(0) as u64,
            Source::Codex => {
                let token_count_ms = entry
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .and_then(parse_timestamp_millis);
                let info = entry.get("payload").and_then(|p| p.get("info"));
                let last = info
                    .and_then(|i| i.get("last_token_usage"))
                    .and_then(parse_cumulative_tokens);
                let total_sig = info
                    .and_then(|i| i.get("total_token_usage"))
                    .and_then(parse_cumulative_tokens)
                    .map(|t| (t.input, t.cached_input, t.output));
                // 限额刷新时重发的快照 total 不变、不是一次请求：不结算耗时，也不把
                // 它记成下一次请求的起点（否则下一次请求的起点会被钉在快照时刻）。
                let is_duplicate = total_sig.is_some() && total_sig == prev_codex_total;
                let latency = if is_duplicate {
                    None
                } else {
                    timer.finish_request(token_count_ms, last.as_ref())
                };
                prev_codex_total = total_sig;
                latency.unwrap_or(0) as u64
            }
        };

        if row.reasoning_effort.is_none() {
            row.reasoning_effort = effort.clone();
        }
        // Codex 的用量行本身不带 model，从 turn_context 继承
        if row.model.is_empty() {
            if let Some(m) = current_model {
                row.model = m.clone();
                row.request_model = Some(m.clone());
            }
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
        // 会话文件没有首字计时，参考项目也不写 duration：用 read_new_rows 估出的
        // latency_ms 表达总耗时，展示端在 duration 为空时回退到它
        duration_ms: None,
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
        // 同上：不写 duration，让展示端回退到估算出的 latency_ms
        duration_ms: None,
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

/// Codex turn_context 里的模型名：`payload.model`，个别版本在 `payload.info.model`
fn codex_turn_model(entry: &Value) -> Option<String> {
    let payload = entry.get("payload")?;
    payload
        .get("model")
        .or_else(|| payload.get("info").and_then(|info| info.get("model")))
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// 归一化 Codex 模型名（与参考项目 cc-switch `normalize_codex_model` 一致）
///
/// 处理规则（按顺序）：小写；剥离 `provider/` 前缀；剥离 ISO 日期后缀 `-YYYY-MM-DD`；
/// 剥离紧凑日期后缀 `-YYYYMMDD`。例如 `openai/gpt-5.4-2026-03-05` → `gpt-5.4`。
fn normalize_codex_model(raw: &str) -> String {
    let mut name = raw.to_lowercase();

    // 剥离 "provider/" 前缀（如 openai/, azure/）
    if let Some(pos) = name.rfind('/') {
        name = name[pos + 1..].to_string();
    }

    // 剥离 ISO 日期后缀 -YYYY-MM-DD（正好 11 字符）
    if name.len() > 11 && name.is_char_boundary(name.len() - 11) {
        let suffix = &name[name.len() - 11..];
        if suffix.as_bytes()[0] == b'-'
            && suffix[1..5].chars().all(|c| c.is_ascii_digit())
            && suffix.as_bytes()[5] == b'-'
            && suffix[6..8].chars().all(|c| c.is_ascii_digit())
            && suffix.as_bytes()[8] == b'-'
            && suffix[9..11].chars().all(|c| c.is_ascii_digit())
        {
            name.truncate(name.len() - 11);
        }
    }

    // 剥离紧凑日期后缀 -YYYYMMDD（正好 8 位数字）
    if name.len() > 9 {
        let parts: Vec<&str> = name.rsplitn(2, '-').collect();
        if parts.len() == 2 {
            if let Some(suffix) = parts.first() {
                if suffix.len() == 8 && suffix.chars().all(|c| c.is_ascii_digit()) {
                    name = parts[1].to_string();
                }
            }
        }
    }

    name
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
    fn codex_turn_model_reads_payload_model() {
        // turn_context 里 model 在 payload.model
        let entry = json!({"payload": {"model": "gpt-5-codex"}});
        assert_eq!(codex_turn_model(&entry).as_deref(), Some("gpt-5-codex"));

        // 个别版本在 payload.info.model
        let entry = json!({"payload": {"info": {"model": "gpt-5.2"}}});
        assert_eq!(codex_turn_model(&entry).as_deref(), Some("gpt-5.2"));

        // 没有 model 返回 None
        assert!(codex_turn_model(&json!({"payload": {"effort": "high"}})).is_none());
    }

    #[test]
    fn normalize_codex_model_strips_prefix_and_date_suffix() {
        // 小写 + 去 provider 前缀
        assert_eq!(normalize_codex_model("OpenAI/GPT-5.4"), "gpt-5.4");
        assert_eq!(normalize_codex_model("deepseek/deepseek-v4-pro"), "deepseek-v4-pro");
        // ISO 日期后缀
        assert_eq!(normalize_codex_model("gpt-5.4-2026-03-05"), "gpt-5.4");
        // 紧凑日期后缀
        assert_eq!(normalize_codex_model("gpt-5.4-20260305"), "gpt-5.4");
        // 不带日期的不动
        assert_eq!(normalize_codex_model("gpt-5-codex"), "gpt-5-codex");
        assert_eq!(normalize_codex_model("glm-5"), "glm-5");
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

    // ===== 会话日志耗时估算（速度列 ≈ 的后端部分） =====

    fn chain_uuid(n: u8) -> String {
        format!("00000000-0000-4000-8000-0000000000{n:02x}")
    }

    /// 一行不带用量的 Claude 日志（用户消息、工具结果、attachment），只有链信息
    fn claude_chain_line(kind: &str, uuid: u8, parent: Option<u8>, timestamp: &str) -> Value {
        let parent = parent.map_or("null".to_string(), |p| format!("\"{}\"", chain_uuid(p)));
        serde_json::from_str(&format!(
            r#"{{"parentUuid":{parent},"type":"{kind}","uuid":"{}","timestamp":"{timestamp}"}}"#,
            chain_uuid(uuid)
        ))
        .unwrap()
    }

    /// 一条 Claude 回复块：带 message.id、apiBlockIndex、usage 与 stop_reason
    fn claude_assistant_block(
        msg_id: &str,
        uuid: u8,
        parent: u8,
        block_index: u32,
        timestamp: &str,
        output_tokens: u32,
        finished: bool,
    ) -> Value {
        let stop_reason = if finished { "\"tool_use\"" } else { "null" };
        serde_json::from_str(&format!(
            r#"{{"parentUuid":"{}","type":"assistant","uuid":"{}","apiBlockIndex":{block_index},"message":{{"id":"{msg_id}","model":"claude-opus-4-8","usage":{{"input_tokens":10,"output_tokens":{output_tokens},"cache_read_input_tokens":0,"cache_creation_input_tokens":0}},"stop_reason":{stop_reason}}},"timestamp":"{timestamp}"}}"#,
            chain_uuid(parent),
            chain_uuid(uuid)
        ))
        .unwrap()
    }

    /// 用一组 Claude 行建链与计时，返回指定 message.id 的估算耗时
    fn claude_latency_for(lines: &[Value], msg_id: &str) -> Option<i64> {
        let mut chain = ChainNodes::new();
        let mut timings = HashMap::new();
        for v in lines {
            record_chain_node(&mut chain, v);
            if let Some(id) = assistant_message_id(v) {
                record_block_timing(&mut timings, v, id);
            }
        }
        let entry = lines.iter().find(|v| assistant_message_id(v) == Some(msg_id))?;
        claude_latency_ms(entry, &chain, &timings)
    }

    #[test]
    fn claude_latency_spans_from_tool_result_to_last_block() {
        let lines = [
            // 起点：工具结果
            claude_chain_line("user", 1, None, "2026-06-07T13:00:00.000Z"),
            claude_chain_line("attachment", 2, Some(1), "2026-06-07T13:00:00.003Z"),
            // 回复开始后才补记的 attachment，时间戳比第一块还晚，不能当起点
            claude_chain_line("attachment", 3, Some(2), "2026-06-07T13:00:05.001Z"),
            claude_assistant_block("msg_t", 4, 3, 0, "2026-06-07T13:00:05.000Z", 900, true),
            claude_assistant_block("msg_t", 5, 4, 1, "2026-06-07T13:00:07.000Z", 900, true),
            // 并行工具调用：前一个工具的结果插在同一条回复的两块中间
            claude_chain_line("user", 6, Some(5), "2026-06-07T13:00:08.000Z"),
            claude_assistant_block("msg_t", 7, 6, 2, "2026-06-07T13:00:12.500Z", 900, true),
        ];
        assert_eq!(claude_latency_for(&lines, "msg_t"), Some(12_500));
    }

    #[test]
    fn claude_latency_needs_first_block_and_stop_reason() {
        let lines = [
            claude_chain_line("user", 1, None, "2026-06-07T13:00:00.000Z"),
            // 看不到第一块：最先出现的是第 2 块，起点会取晚、宁可不估
            claude_assistant_block("msg_no_first", 2, 1, 2, "2026-06-07T13:00:09.000Z", 900, true),
            // 没写完（stop_reason 为 null）
            claude_chain_line("user", 4, None, "2026-06-07T13:01:00.000Z"),
            claude_assistant_block("msg_incomplete", 5, 4, 0, "2026-06-07T13:01:05.000Z", 900, false),
        ];
        assert_eq!(claude_latency_for(&lines, "msg_no_first"), None);
        assert_eq!(claude_latency_for(&lines, "msg_incomplete"), None);
    }

    /// 按 Codex 实际写出的键顺序（timestamp、type、payload）拼一行
    fn raw_codex_line(timestamp: &str, kind: &str, payload: &str) -> String {
        format!(r#"{{"timestamp":"{timestamp}","type":"{kind}","payload":{payload}}}"#)
    }

    fn raw_codex_item(timestamp: &str, payload: &str) -> String {
        raw_codex_line(timestamp, "response_item", payload)
    }

    fn raw_codex_usage(input: u64, output: u64) -> String {
        format!(
            r#"{{"input_tokens":{input},"cached_input_tokens":0,"output_tokens":{output},"reasoning_output_tokens":0,"total_tokens":{}}}"#,
            input + output
        )
    }

    fn raw_codex_token_count(timestamp: &str, total: (u64, u64), last: (u64, u64)) -> String {
        raw_codex_line(
            timestamp,
            "event_msg",
            &format!(
                r#"{{"type":"token_count","info":{{"total_token_usage":{},"last_token_usage":{}}},"rate_limits":{{"limit_id":"codex"}}}}"#,
                raw_codex_usage(total.0, total.1),
                raw_codex_usage(last.0, last.1)
            ),
        )
    }

    /// 模拟 read_new_rows 的 Codex 计时路径：逐行 observe，token_count 行结算耗时
    /// （限额刷新重发的快照 total 不变、不结算，与生产逻辑同口径）
    fn codex_latencies(lines: &[String]) -> Vec<Option<i64>> {
        let mut timer = RequestTimer::default();
        let mut prev_total: Option<(u64, u64, u64)> = None;
        let mut out = Vec::new();
        for line in lines {
            timer.observe_line(line);
            let Ok(entry) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let is_token_count = entry.get("type").and_then(Value::as_str) == Some("event_msg")
                && entry
                    .get("payload")
                    .and_then(|p| p.get("type"))
                    .and_then(Value::as_str)
                    == Some("token_count");
            if !is_token_count {
                continue;
            }
            let ts = entry
                .get("timestamp")
                .and_then(Value::as_str)
                .and_then(parse_timestamp_millis);
            let info = entry.get("payload").and_then(|p| p.get("info"));
            let last = info
                .and_then(|i| i.get("last_token_usage"))
                .and_then(parse_cumulative_tokens);
            let total_sig = info
                .and_then(|i| i.get("total_token_usage"))
                .and_then(parse_cumulative_tokens)
                .map(|t| (t.input, t.cached_input, t.output));
            let is_duplicate = total_sig.is_some() && total_sig == prev_total;
            prev_total = total_sig;
            // 重复快照不是一次请求，与参考项目一致：不结算、不产出（等价于 delta=0）
            if !is_duplicate {
                out.push(timer.finish_request(ts, last.as_ref()));
            }
        }
        out
    }

    const CX_USER: &str = r#"{"type":"message","role":"user","content":[]}"#;
    const CX_ASSISTANT: &str = r#"{"type":"message","role":"assistant","content":[]}"#;
    const CX_REASONING: &str = r#"{"type":"reasoning","summary":[]}"#;
    const CX_TOOL_CALL: &str = r#"{"type":"custom_tool_call","call_id":"c1","name":"shell"}"#;
    const CX_TOOL_OUTPUT: &str = r#"{"type":"custom_tool_call_output","call_id":"c1","output":"ok"}"#;

    #[test]
    fn codex_latency_ends_at_usage_record_not_at_delayed_token_count() {
        let lines = vec![
            raw_codex_line("2026-10-02T03:00:00.000Z", "turn_context", r#"{"model":"gpt-5"}"#),
            raw_codex_item("2026-10-02T03:00:01.000Z", CX_USER),
            raw_codex_item("2026-10-02T03:00:05.000Z", CX_REASONING),
            raw_codex_item("2026-10-02T03:00:09.000Z", CX_TOOL_CALL),
            // 响应在这里结束；token_count 要等工具跑完才写
            raw_codex_line(
                "2026-10-02T03:00:09.500Z",
                "token_usage_record",
                &format!(r#"{{"turn_id":"t1","usage":{}}}"#, raw_codex_usage(100, 600)),
            ),
            raw_codex_item("2026-10-02T03:00:20.000Z", CX_TOOL_OUTPUT),
            raw_codex_token_count("2026-10-02T03:00:20.001Z", (100, 600), (100, 600)),
            // 第二次请求：用量记录对不上这次请求，不采信，退回 token_count 的时刻
            raw_codex_item("2026-10-02T03:00:25.000Z", CX_REASONING),
            raw_codex_item("2026-10-02T03:00:30.000Z", CX_ASSISTANT),
            raw_codex_line(
                "2026-10-02T03:00:30.200Z",
                "token_usage_record",
                &format!(r#"{{"turn_id":"other","usage":{}}}"#, raw_codex_usage(1, 999)),
            ),
            raw_codex_token_count("2026-10-02T03:00:30.300Z", (300, 1300), (200, 700)),
        ];

        assert_eq!(codex_latencies(&lines), vec![Some(8_500), Some(10_299)]);
    }

    #[test]
    fn codex_latency_without_usage_record_stops_before_tool_execution() {
        let lines = vec![
            raw_codex_item("2026-08-03T03:00:01.000Z", CX_USER),
            raw_codex_item("2026-08-03T03:00:06.000Z", CX_TOOL_CALL),
            // 工具跑了 10 秒，token_count 紧跟着工具结果写出
            raw_codex_item("2026-08-03T03:00:16.000Z", CX_TOOL_OUTPUT),
            raw_codex_token_count("2026-08-03T03:00:16.001Z", (100, 600), (100, 600)),
            // 限额刷新时重发的快照不是一次请求，不能把下一次请求的起点往后挪
            raw_codex_token_count("2026-08-03T03:00:17.000Z", (100, 600), (100, 600)),
            raw_codex_item("2026-08-03T03:00:20.000Z", CX_REASONING),
            raw_codex_item("2026-08-03T03:00:22.000Z", CX_ASSISTANT),
            raw_codex_token_count("2026-08-03T03:00:22.100Z", (300, 1300), (200, 700)),
        ];

        assert_eq!(codex_latencies(&lines), vec![Some(5_000), Some(6_099)]);
    }

    #[test]
    fn codex_latency_ignores_items_written_after_their_token_count() {
        // 2025 年的布局：输出项和工具结果补写在它们那次响应的 token_count 之后
        let lines = vec![
            raw_codex_item("2025-10-30T08:00:01.000Z", CX_USER),
            raw_codex_token_count("2025-10-30T08:00:08.000Z", (100, 600), (100, 600)),
            raw_codex_item("2025-10-30T08:00:08.000Z", CX_REASONING),
            raw_codex_item("2025-10-30T08:00:08.001Z", CX_TOOL_CALL),
            raw_codex_item("2025-10-30T08:00:08.001Z", CX_TOOL_OUTPUT),
            raw_codex_line("2025-10-30T08:00:08.002Z", "turn_context", r#"{"model":"gpt-5"}"#),
            // 用户隔了一分多钟才发下一条消息，这段空闲不算进请求耗时
            raw_codex_item("2025-10-30T08:01:40.000Z", CX_USER),
            raw_codex_token_count("2025-10-30T08:01:50.000Z", (300, 1300), (200, 700)),
        ];

        assert_eq!(codex_latencies(&lines), vec![Some(7_000), Some(10_000)]);
    }

    #[test]
    fn codex_latency_does_not_inherit_the_start_of_an_aborted_request() {
        const DEVELOPER: &str = r#"{"type":"message","role":"developer","content":[]}"#;
        let lines = vec![
            raw_codex_item("2026-10-02T03:00:01.000Z", CX_USER),
            // 这次请求出了一段思考就被用户中断，等不到 token_count
            raw_codex_item("2026-10-02T03:00:10.000Z", CX_REASONING),
            raw_codex_line(
                "2026-10-02T03:00:20.000Z",
                "event_msg",
                r#"{"type":"turn_aborted","reason":"interrupted"}"#,
            ),
            raw_codex_line("2026-10-02T03:02:00.000Z", "event_msg", r#"{"type":"task_started"}"#),
            raw_codex_item("2026-10-02T03:02:00.010Z", CX_USER),
            raw_codex_item("2026-10-02T03:02:20.000Z", CX_REASONING),
            raw_codex_item("2026-10-02T03:02:30.000Z", CX_ASSISTANT),
            raw_codex_token_count("2026-10-02T03:02:30.100Z", (100, 600), (100, 600)),
            // 响应中途插进来的 developer 消息不是新一轮，起点不动
            raw_codex_item("2026-10-02T03:02:35.000Z", CX_REASONING),
            raw_codex_item("2026-10-02T03:02:36.000Z", DEVELOPER),
            raw_codex_item("2026-10-02T03:02:40.000Z", CX_ASSISTANT),
            raw_codex_token_count("2026-10-02T03:02:40.200Z", (300, 1300), (200, 700)),
        ];

        assert_eq!(codex_latencies(&lines), vec![Some(30_090), Some(10_100)]);
    }

    #[test]
    fn codex_timing_line_is_classified_from_the_line_head() {
        let long_output = format!(
            r#"{{"type":"function_call_output","call_id":"c1","output":"{}"}}"#,
            "x".repeat(4 * LINE_HEAD_BYTES)
        );
        assert_eq!(
            classify_timing_line(&raw_codex_item("2026-10-02T03:00:00.250Z", &long_output)),
            Some((1_790_910_000_250, TimingLine::ToolOutput))
        );
        // 正文里出现的字样不影响判断：种类只看信封上的 type
        let quoted = r#"{"type":"message","role":"user","content":"\"type\":\"token_usage_record\""}"#;
        assert_eq!(
            classify_timing_line(&raw_codex_item("2026-10-02T03:00:00.250Z", quoted))
                .map(|line| line.1),
            Some(TimingLine::Boundary)
        );
        assert_eq!(
            classify_timing_line(&raw_codex_line(
                "2026-10-02T03:00:00.250Z",
                "event_msg",
                r#"{"type":"task_started"}"#
            ))
            .map(|line| line.1),
            Some(TimingLine::TurnReset)
        );
        assert_eq!(
            classify_timing_line(&raw_codex_line(
                "2026-10-02T03:00:00.250Z",
                "event_msg",
                r#"{"type":"item_completed"}"#
            )),
            None
        );
    }
}
