//! 响应处理：透传给客户端的同时旁路采集用量
//!
//! 两条路径：
//! - **非流式**：读全 body → 解析 → 异步落库 → 原样返回
//! - **流式（SSE）**：tee 流。逐 chunk 转发**原始字节**，同时把 `data:` 帧
//!   累积到收集器；流结束后异步落库。
//!
//! 铁律：转发路径上只做切帧与内存累积，DB 写入全在 `tokio::spawn` 里，
//! 失败只 `warn`。记账绝不能影响转发。

use super::usage::logger::{UsageLogger, UsageRecord};
use super::usage::parser::TokenUsage;
use crate::database::Database;
use crate::models::app_type::AppType;
use crate::proxy::error::ProxyError;
use axum::body::Body;
use axum::http::StatusCode;
use axum::response::Response;
use bytes::Bytes;
use futures::stream::{Stream, StreamExt};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// 响应头里由 hyper 重新生成的部分，不能照抄
const HOP_BY_HOP_HEADERS: &[&str] = &["content-length", "transfer-encoding", "connection"];

/// 采集一次请求所需的上下文
#[derive(Debug, Clone)]
pub struct UsageContext {
    pub provider_id: String,
    pub app_type: AppType,
    /// 请求里声明的模型名
    pub request_model: String,
    pub start_time: Instant,
    pub session_id: Option<String>,
    /// 请求体里声明的思考强度
    pub reasoning_effort: Option<String>,
}

impl UsageContext {
    pub fn latency_ms(&self) -> u64 {
        self.start_time.elapsed().as_millis() as u64
    }
}

/// content-type 是否为 SSE
pub fn is_sse_response(resp: &reqwest::Response) -> bool {
    resp.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| ct.contains("text/event-stream"))
        .unwrap_or(false)
}

/// 按 app_type 选非流式解析器
///
/// `OpenCode` / `OpenClaw` 走 Claude 分支：`detect_app_type` 只会产出
/// Claude / Codex / Gemini，这两个是纯配置管理类型、到不了代理路径；
/// 万一将来接进来，它们也是 Anthropic 兼容形状。
fn parse_response_usage(app_type: AppType, body: &Value) -> Option<TokenUsage> {
    match app_type {
        AppType::Codex => TokenUsage::from_codex_response_auto(body),
        AppType::Gemini => TokenUsage::from_gemini_response(body),
        // Claude | OpenCode | OpenClaw
        _ => TokenUsage::from_claude_response(body)
            // 反代可能返回 OpenAI 形状，兜一层
            .or_else(|| TokenUsage::from_openai_response(body)),
    }
}

/// 按 app_type 选流式解析器
fn parse_stream_usage(app_type: AppType, events: &[Value]) -> Option<TokenUsage> {
    match app_type {
        AppType::Codex => TokenUsage::from_codex_stream_events_auto(events),
        AppType::Gemini => TokenUsage::from_gemini_stream_chunks(events),
        _ => TokenUsage::from_claude_stream_events(events)
            .or_else(|| TokenUsage::from_openai_stream_events(events)),
    }
}

/// 按 app_type 从流式事件里取模型名
fn extract_stream_model(app_type: AppType, events: &[Value], fallback: &str) -> String {
    match app_type {
        AppType::Codex => TokenUsage::model_from_openai_stream(events, fallback),
        AppType::Gemini => TokenUsage::model_from_gemini_stream(events, fallback),
        _ => TokenUsage::model_from_claude_stream(events, fallback),
    }
}

/// 拷贝上游响应头（跳过 hop-by-hop）
fn copy_headers(
    builder: axum::http::response::Builder,
    headers: &reqwest::header::HeaderMap,
) -> axum::http::response::Builder {
    let mut builder = builder;
    for (key, value) in headers.iter() {
        let name = key.as_str();
        if HOP_BY_HOP_HEADERS
            .iter()
            .any(|h| name.eq_ignore_ascii_case(h))
        {
            continue;
        }
        builder = builder.header(key, value);
    }
    builder
}

/// 异步落库，绝不阻塞转发
fn spawn_log(
    db: Arc<Database>,
    ctx: &UsageContext,
    usage: TokenUsage,
    status_code: u16,
    is_streaming: bool,
    first_token_ms: Option<u64>,
    model_override: Option<String>,
) {
    let latency_ms = ctx.latency_ms();
    let provider_id = ctx.provider_id.clone();
    let app_type = ctx.app_type.as_str().to_string();
    let request_model = ctx.request_model.clone();
    let session_id = ctx.session_id.clone();
    let reasoning_effort = ctx.reasoning_effort.clone();

    // 响应自报的模型名优先；拿不到就退请求里声明的
    let model = model_override
        .or_else(|| usage.model.clone())
        .unwrap_or_else(|| request_model.clone());

    tokio::spawn(async move {
        let logger = UsageLogger::new(db);
        let record = UsageRecord {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id,
            app_type,
            model,
            request_model,
            usage,
            latency_ms,
            first_token_ms,
            status_code,
            error_message: None,
            session_id,
            provider_type: None,
            reasoning_effort: reasoning_effort.clone(),
            is_streaming,
        };

        if let Err(e) = logger.log_usage(record) {
            tracing::warn!("[Usage] 记录用量失败（不影响转发）: {e}");
        }
    });
}

/// 记录一次失败请求
pub fn spawn_log_error(
    db: Arc<Database>,
    ctx: &UsageContext,
    status_code: u16,
    error_message: Option<String>,
) {
    let latency_ms = ctx.latency_ms();
    let provider_id = ctx.provider_id.clone();
    let app_type = ctx.app_type.as_str().to_string();
    let request_model = ctx.request_model.clone();
    let session_id = ctx.session_id.clone();
    let reasoning_effort = ctx.reasoning_effort.clone();

    tokio::spawn(async move {
        let logger = UsageLogger::new(db);
        let record = UsageRecord {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id,
            app_type,
            model: request_model.clone(),
            request_model,
            usage: TokenUsage::default(),
            latency_ms,
            first_token_ms: None,
            status_code,
            error_message,
            session_id,
            provider_type: None,
            reasoning_effort: reasoning_effort.clone(),
            is_streaming: false,
        };

        if let Err(e) = logger.log_error(record) {
            tracing::warn!("[Usage] 记录错误请求失败: {e}");
        }
    });
}

// ============================================================================
// SSE 事件收集器
// ============================================================================

/// 累积 SSE 事件，流结束时触发一次回调
///
/// `finish` 幂等 —— 流正常结束与客户端提前断开都会走到，不能重复记账。
#[derive(Clone)]
pub struct SseUsageCollector {
    inner: Arc<CollectorInner>,
}

struct CollectorInner {
    events: Mutex<Vec<Value>>,
    first_event_at: Mutex<Option<Instant>>,
    start_time: Instant,
    finished: AtomicBool,
    on_complete: Box<dyn Fn(Vec<Value>, Option<u64>) + Send + Sync>,
}

impl SseUsageCollector {
    pub fn new(
        start_time: Instant,
        on_complete: impl Fn(Vec<Value>, Option<u64>) + Send + Sync + 'static,
    ) -> Self {
        Self {
            inner: Arc::new(CollectorInner {
                events: Mutex::new(Vec::new()),
                first_event_at: Mutex::new(None),
                start_time,
                finished: AtomicBool::new(false),
                on_complete: Box::new(on_complete),
            }),
        }
    }

    /// 推入一个已解析的 SSE data 帧
    pub fn push(&self, event: Value) {
        if let Ok(mut first) = self.inner.first_event_at.lock() {
            if first.is_none() {
                *first = Some(Instant::now());
            }
        }
        if let Ok(mut events) = self.inner.events.lock() {
            events.push(event);
        }
    }

    /// 结束收集并触发回调（幂等）
    pub fn finish(&self) {
        if self.inner.finished.swap(true, Ordering::SeqCst) {
            return;
        }

        let events = self
            .inner
            .events
            .lock()
            .map(|mut guard| std::mem::take(&mut *guard))
            .unwrap_or_default();

        let first_token_ms = self
            .inner
            .first_event_at
            .lock()
            .ok()
            .and_then(|guard| *guard)
            .map(|t| t.duration_since(self.inner.start_time).as_millis() as u64);

        (self.inner.on_complete)(events, first_token_ms);
    }
}

/// 从一段 SSE 文本缓冲里切出完整帧，解析 `data:` 行为 JSON
///
/// 返回解析出的事件，并把已消费部分从 buffer 移除。
/// 半帧留在 buffer 里等下一个 chunk。
fn drain_sse_events(buffer: &mut String) -> Vec<Value> {
    let mut events = Vec::new();

    while let Some(pos) = buffer.find("\n\n") {
        let frame: String = buffer.drain(..pos + 2).collect();

        for line in frame.lines() {
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(data) {
                events.push(value);
            }
        }
    }

    events
}

// ============================================================================
// 处理入口
// ============================================================================

/// 统一入口：SSE 走 tee 流，其余走整体读取
pub async fn process_response(
    upstream: reqwest::Response,
    ctx: UsageContext,
    db: Arc<Database>,
) -> Result<Response, ProxyError> {
    if is_sse_response(&upstream) {
        Ok(handle_streaming(upstream, ctx, db))
    } else {
        handle_non_streaming(upstream, ctx, db).await
    }
}

/// 非流式：读全 body → 解析 → 异步落库 → 原样返回
pub async fn handle_non_streaming(
    upstream: reqwest::Response,
    ctx: UsageContext,
    db: Arc<Database>,
) -> Result<Response, ProxyError> {
    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let headers = upstream.headers().clone();

    let body_bytes = upstream
        .bytes()
        .await
        .map_err(|e| ProxyError::ForwardFailed(format!("读取响应体失败: {e}")))?;

    // 解析失败不影响返回：非 JSON 响应（如 SSE 误判、纯文本错误）直接跳过采集
    match serde_json::from_slice::<Value>(&body_bytes) {
        Ok(json) => match parse_response_usage(ctx.app_type, &json) {
            Some(usage) => spawn_log(
                db,
                &ctx,
                usage,
                status.as_u16(),
                false,
                None,
                None,
            ),
            None => tracing::debug!("[Usage] 非流式响应无 usage 字段，跳过采集"),
        },
        Err(_) => tracing::debug!("[Usage] 响应体非 JSON，跳过采集"),
    }

    let builder = copy_headers(Response::builder().status(status), &headers);
    builder
        .body(Body::from(body_bytes))
        .map_err(|e| ProxyError::Internal(e.to_string()))
}

/// 流式：tee。转发原始字节，旁路累积 SSE 事件
pub fn handle_streaming(
    upstream: reqwest::Response,
    ctx: UsageContext,
    db: Arc<Database>,
) -> Response {
    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let headers = upstream.headers().clone();
    let status_code = status.as_u16();

    let collector = {
        let db = db.clone();
        let ctx = ctx.clone();
        SseUsageCollector::new(ctx.start_time, move |events, first_token_ms| {
            let model = extract_stream_model(ctx.app_type, &events, &ctx.request_model);
            match parse_stream_usage(ctx.app_type, &events) {
                Some(usage) => spawn_log(
                    db.clone(),
                    &ctx,
                    usage,
                    status_code,
                    true,
                    first_token_ms,
                    Some(model),
                ),
                None => {
                    // 没有 usage 也记一行：请求确实发生了，成本记 0
                    tracing::debug!("[Usage] 流式响应无 usage，按 0 token 记录");
                    spawn_log(
                        db.clone(),
                        &ctx,
                        TokenUsage::default(),
                        status_code,
                        true,
                        first_token_ms,
                        Some(model),
                    );
                }
            }
        })
    };

    let body = Body::from_stream(tee_sse_stream(upstream.bytes_stream(), collector));
    let builder = copy_headers(Response::builder().status(status), &headers);

    match builder.body(body) {
        Ok(resp) => resp,
        Err(e) => {
            tracing::error!("[Proxy] 构建流式响应失败: {e}");
            ProxyError::Internal(e.to_string()).into_response_fallback()
        }
    }
}

/// tee 流：原样 yield 上游字节，旁路把 SSE 帧喂给收集器
fn tee_sse_stream<S, E>(
    stream: S,
    collector: SseUsageCollector,
) -> impl Stream<Item = Result<Bytes, std::io::Error>> + Send
where
    S: Stream<Item = Result<Bytes, E>> + Send + 'static,
    E: std::fmt::Display + Send + 'static,
{
    async_stream::stream! {
        let mut buffer = String::new();
        tokio::pin!(stream);

        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    // 先解析后转发：解析只读不改，yield 的是原始 bytes
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    for event in drain_sse_events(&mut buffer) {
                        collector.push(event);
                    }
                    yield Ok(bytes);
                }
                Err(e) => {
                    tracing::warn!("[Proxy] 上游流中断: {e}");
                    yield Err(std::io::Error::other(e.to_string()));
                    break;
                }
            }
        }

        // 正常结束与中断都要触发（finish 幂等）
        collector.finish();
    }
}

impl ProxyError {
    /// 构建响应失败时的兜底（避免在 handle_streaming 里再传播 Result）
    fn into_response_fallback(self) -> Response {
        Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from(self.to_string()))
            .unwrap_or_else(|_| Response::new(Body::empty()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ctx() -> UsageContext {
        UsageContext {
            provider_id: "p1".into(),
            app_type: AppType::Claude,
            request_model: "req-model".into(),
            start_time: Instant::now(),
            session_id: None,
            reasoning_effort: None,
        }
    }

    // ---------- SSE 切帧 ----------

    #[test]
    fn drains_complete_frames_only() {
        let mut buffer = String::from("data: {\"a\":1}\n\ndata: {\"b\":2}\n\ndata: {\"c\"");
        let events = drain_sse_events(&mut buffer);

        assert_eq!(events.len(), 2);
        assert_eq!(events[0], json!({"a": 1}));
        assert_eq!(events[1], json!({"b": 2}));
        assert_eq!(buffer, "data: {\"c\"", "半帧必须留在 buffer 里");
    }

    #[test]
    fn handles_frame_split_across_chunks() {
        let mut buffer = String::new();

        buffer.push_str("data: {\"partial\"");
        assert!(drain_sse_events(&mut buffer).is_empty());

        buffer.push_str(": true}\n\n");
        let events = drain_sse_events(&mut buffer);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], json!({"partial": true}));
        assert!(buffer.is_empty());
    }

    #[test]
    fn skips_done_marker_and_non_data_lines() {
        let mut buffer =
            String::from("event: message_stop\ndata: [DONE]\n\ndata: {\"real\":1}\n\n");
        let events = drain_sse_events(&mut buffer);
        assert_eq!(events.len(), 1, "[DONE] 与 event: 行都不算事件");
        assert_eq!(events[0], json!({"real": 1}));
    }

    #[test]
    fn skips_malformed_json_without_losing_later_frames() {
        let mut buffer = String::from("data: not-json\n\ndata: {\"ok\":1}\n\n");
        let events = drain_sse_events(&mut buffer);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], json!({"ok": 1}));
    }

    #[test]
    fn accepts_data_without_space_after_colon() {
        let mut buffer = String::from("data:{\"tight\":1}\n\n");
        let events = drain_sse_events(&mut buffer);
        assert_eq!(events.len(), 1, "data: 后无空格也要能解析");
    }

    // ---------- 收集器 ----------

    #[test]
    fn finish_is_idempotent() {
        let calls = Arc::new(AtomicBool::new(false));
        let double_called = Arc::new(AtomicBool::new(false));

        let c1 = calls.clone();
        let c2 = double_called.clone();
        let collector = SseUsageCollector::new(Instant::now(), move |_events, _ms| {
            if c1.swap(true, Ordering::SeqCst) {
                c2.store(true, Ordering::SeqCst);
            }
        });

        collector.finish();
        collector.finish();
        collector.finish();

        assert!(calls.load(Ordering::SeqCst), "回调应触发一次");
        assert!(
            !double_called.load(Ordering::SeqCst),
            "finish 必须幂等，否则同一请求会记两次账"
        );
    }

    #[test]
    fn collector_passes_events_in_order() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = received.clone();

        let collector = SseUsageCollector::new(Instant::now(), move |events, _ms| {
            *sink.lock().unwrap() = events;
        });

        collector.push(json!({"n": 1}));
        collector.push(json!({"n": 2}));
        collector.finish();

        let got = received.lock().unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], json!({"n": 1}));
        assert_eq!(got[1], json!({"n": 2}));
    }

    #[test]
    fn first_token_ms_is_none_without_events() {
        let seen = Arc::new(Mutex::new(Some(999u64)));
        let sink = seen.clone();
        let collector = SseUsageCollector::new(Instant::now(), move |_events, ms| {
            *sink.lock().unwrap() = ms;
        });
        collector.finish();
        assert_eq!(*seen.lock().unwrap(), None);
    }

    #[test]
    fn first_token_ms_is_recorded_when_events_arrive() {
        let seen = Arc::new(Mutex::new(None));
        let sink = seen.clone();
        let collector = SseUsageCollector::new(Instant::now(), move |_events, ms| {
            *sink.lock().unwrap() = ms;
        });
        collector.push(json!({"x": 1}));
        collector.finish();
        assert!(seen.lock().unwrap().is_some(), "有事件就应有首字节耗时");
    }

    // ---------- tee 流：透传保真 ----------

    #[tokio::test]
    async fn tee_forwards_bytes_unchanged() {
        let chunks: Vec<Result<Bytes, std::io::Error>> = vec![
            Ok(Bytes::from("data: {\"type\":\"message_start\"}\n\n")),
            Ok(Bytes::from("data: {\"type\":\"message_delta\"}\n\n")),
        ];
        let original: Vec<u8> = chunks
            .iter()
            .filter_map(|c| c.as_ref().ok())
            .flat_map(|b| b.to_vec())
            .collect();

        let collector = SseUsageCollector::new(Instant::now(), |_, _| {});
        let stream = futures::stream::iter(chunks);

        let out: Vec<u8> = tee_sse_stream(stream, collector)
            .filter_map(|r| async move { r.ok() })
            .collect::<Vec<Bytes>>()
            .await
            .into_iter()
            .flat_map(|b| b.to_vec())
            .collect();

        assert_eq!(out, original, "转发字节必须与上游完全一致");
    }

    #[tokio::test]
    async fn tee_collects_events_and_finishes_on_stream_end() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = received.clone();
        let collector = SseUsageCollector::new(Instant::now(), move |events, _| {
            *sink.lock().unwrap() = events;
        });

        let chunks: Vec<Result<Bytes, std::io::Error>> = vec![
            Ok(Bytes::from(
                "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10}}}\n\n",
            )),
            Ok(Bytes::from(
                "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":5}}\n\n",
            )),
        ];

        let _: Vec<_> = tee_sse_stream(futures::stream::iter(chunks), collector)
            .collect::<Vec<_>>()
            .await;

        let events = received.lock().unwrap();
        assert_eq!(events.len(), 2, "流结束应自动 finish 并交出事件");

        let usage = TokenUsage::from_claude_stream_events(&events).unwrap();
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 5);
    }

    #[tokio::test]
    async fn tee_finishes_even_when_upstream_errors_midway() {
        let called = Arc::new(AtomicBool::new(false));
        let flag = called.clone();
        let collector = SseUsageCollector::new(Instant::now(), move |_, _| {
            flag.store(true, Ordering::SeqCst);
        });

        let chunks: Vec<Result<Bytes, std::io::Error>> = vec![
            Ok(Bytes::from("data: {\"a\":1}\n\n")),
            Err(std::io::Error::other("upstream died")),
        ];

        let results: Vec<_> = tee_sse_stream(futures::stream::iter(chunks), collector)
            .collect()
            .await;

        assert_eq!(results.len(), 2);
        assert!(results[1].is_err(), "上游错误要传递给客户端");
        assert!(
            called.load(Ordering::SeqCst),
            "中断也必须记账，否则这次请求凭空消失"
        );
    }

    // ---------- 解析器路由 ----------

    #[test]
    fn routes_claude_response_parser() {
        let body = json!({"usage": {"input_tokens": 1, "output_tokens": 2}});
        assert!(parse_response_usage(AppType::Claude, &body).is_some());
    }

    #[test]
    fn claude_route_falls_back_to_openai_shape() {
        // 第三方反代以 OpenAI 形状返回 Claude 请求
        let body = json!({"usage": {"prompt_tokens": 3, "completion_tokens": 4}});
        let usage = parse_response_usage(AppType::Claude, &body).unwrap();
        assert_eq!(usage.input_tokens, 3);
    }

    #[test]
    fn routes_gemini_response_parser() {
        let body = json!({
            "usageMetadata": {"promptTokenCount": 10, "totalTokenCount": 25}
        });
        let usage = parse_response_usage(AppType::Gemini, &body).unwrap();
        assert_eq!(usage.output_tokens, 15);
    }

    #[test]
    fn stream_model_extraction_falls_back_to_request_model() {
        let events = vec![json!({"type": "ping"})];
        assert_eq!(
            extract_stream_model(AppType::Claude, &events, "req-model"),
            "req-model"
        );
    }

    #[test]
    fn latency_is_measured_from_ctx_start() {
        let c = ctx();
        std::thread::sleep(std::time::Duration::from_millis(2));
        assert!(c.latency_ms() >= 1);
    }
}
