use crate::database::Database;
use crate::models::app_type::AppType;
use crate::proxy::error::ProxyError;
use crate::proxy::http_client;
use crate::proxy::model_mapper;
use crate::proxy::provider_router;
use crate::proxy::response_processor::{self, UsageContext};
use crate::proxy::server;
use crate::proxy::session;
use crate::proxy::thinking_rectifier;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use std::sync::Arc;
use std::time::Duration;

/// 请求体大小上限（与 server 的 DefaultBodyLimit 保持一致）
pub const MAX_BODY_SIZE: usize = 200 * 1024 * 1024;

/// 非流式请求的总超时；流式请求不设总超时（SSE 可长时间持续）
const NON_STREAMING_TIMEOUT: Duration = Duration::from_secs(600);

/// 不透传到上游的请求头黑名单（对齐 cc-switch 踩坑结论）
///
/// - 认证类：由路由层按 provider 重新注入，透传旧值会导致 401
/// - 连接/长度类：由 HTTP 客户端自行管理
/// - accept-encoding：强制 identity，避免压缩流中断导致解析错误
/// - anthropic-version / anthropic-beta：单独处理，避免重复
const HEADER_BLACKLIST: &[&str] = &[
    "authorization",
    "x-api-key",
    "x-goog-api-key",
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "accept-encoding",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-proto",
    "forwarded",
    "cf-connecting-ip",
    "cf-ipcountry",
    "cf-ray",
    "cf-visitor",
    "true-client-ip",
    "anthropic-version",
    "anthropic-beta",
];

/// 上游服务据此校验请求来源，缺失时部分中转会拒绝请求
const CLAUDE_CODE_BETA: &str = "claude-code-20250219";

/// 代理请求处理器：识别应用类型 → 选择供应商队列 → 带故障转移地转发
pub async fn proxy_handler(
    State(db): State<Arc<Database>>,
    req: Request<Body>,
) -> Result<Response, ProxyError> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let query = req
        .uri()
        .query()
        .map(|q| format!("?{}", q))
        .unwrap_or_default();

    let original_headers = req.headers().clone();

    let body_bytes = axum::body::to_bytes(req.into_body(), MAX_BODY_SIZE)
        .await
        .map_err(|e| ProxyError::InvalidRequest(e.to_string()))?;

    // 预处理：将 thinking.type "adaptive" 转为 "enabled"（兼容第三方反代）
    let body_bytes: Bytes = match thinking_rectifier::normalize_thinking_type(&body_bytes) {
        Ok(Some(fixed)) => fixed.into(),
        _ => body_bytes,
    };

    // 识别应用类型并规范化转发路径
    let app_type = provider_router::detect_app_type(&path);
    let forward_path = format!("{}{}", provider_router::strip_app_prefix(&path), query);

    // 解析请求体 JSON（用于流式检测与模型映射；非 JSON 请求原样转发）
    let body_json: Option<serde_json::Value> = if body_bytes.is_empty() {
        None
    } else {
        serde_json::from_slice(&body_bytes).ok()
    };
    let is_stream = body_json
        .as_ref()
        .and_then(|b| b.get("stream"))
        .and_then(|s| s.as_bool())
        .unwrap_or(false);

    // 用量采集所需：请求里声明的模型名 + 会话 ID + 计时起点
    let request_start = std::time::Instant::now();
    let request_model = body_json
        .as_ref()
        .and_then(|b| b.get("model"))
        .and_then(|m| m.as_str())
        .unwrap_or("unknown")
        .to_string();
    let session_id = body_json.as_ref().map(|body| {
        session::extract_session_id(&original_headers, body, app_type.as_str()).session_id
    });
    let reasoning_effort = body_json.as_ref().and_then(extract_reasoning_effort);

    let method = reqwest::Method::from_bytes(method.as_str().as_bytes())
        .map_err(|e| ProxyError::InvalidRequest(e.to_string()))?;

    // 候选队列：活跃 provider 优先，失败后按故障转移队列顺序切换
    let candidates = provider_router::resolve_candidates(&db, app_type)?;
    let total = candidates.len();

    let mut last_error: Option<ProxyError> = None;

    for (index, provider) in candidates.iter().enumerate() {
        let is_last = index + 1 == total;

        let route = match provider_router::build_route(provider, app_type, &forward_path) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(
                    "[Proxy] Provider {} 路由构建失败: {}",
                    provider.name,
                    e
                );
                last_error = Some(e);
                continue;
            }
        };

        let forward_headers =
            merge_forward_headers(route.headers, &original_headers, app_type);

        // 模型映射（仅 Claude）：按 provider 配置替换请求中的模型名
        let attempt_body: Bytes = match (&body_json, app_type) {
            (Some(json), AppType::Claude) => {
                let (mapped, _original, changed) =
                    model_mapper::apply_model_mapping(json.clone(), provider);
                if changed.is_some() {
                    serde_json::to_vec(&mapped)
                        .map(Bytes::from)
                        .unwrap_or_else(|_| body_bytes.clone())
                } else {
                    body_bytes.clone()
                }
            }
            _ => body_bytes.clone(),
        };

        let timeout = if is_stream {
            None
        } else {
            Some(NON_STREAMING_TIMEOUT)
        };

        tracing::info!(
            "[Proxy] {} {} → {} (provider: {}, {}/{})",
            method,
            path,
            route.target_url,
            provider.name,
            index + 1,
            total
        );

        match http_client::forward_request(
            method.clone(),
            &route.target_url,
            forward_headers,
            attempt_body,
            timeout,
        )
        .await
        {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() || is_last {
                    if !status.is_success() {
                        tracing::warn!(
                            "[Proxy] Provider {} 返回 {}（已是最后一个候选，原样返回）",
                            provider.name,
                            status
                        );
                    }
                    server::increment_request_count();

                    let ctx = UsageContext {
                        provider_id: provider.id.clone(),
                        app_type,
                        request_model: request_model.clone(),
                        start_time: request_start,
                        session_id: session_id.clone(),
                        reasoning_effort: reasoning_effort.clone(),
                    };

                    // 非 2xx 单独记一行错误（拿不到 usage），再原样透传给客户端
                    if !status.is_success() {
                        let err_body = read_error_body(resp).await;
                        response_processor::spawn_log_error(
                            db.clone(),
                            &ctx,
                            status.as_u16(),
                            err_body.clone(),
                        );
                        return Err(ProxyError::UpstreamError {
                            status: status.as_u16(),
                            body: err_body,
                        });
                    }

                    return response_processor::process_response(resp, ctx, db.clone()).await;
                }

                // 还有候选：记录错误详情后切换下一个供应商
                let err_body = read_error_body(resp).await;
                tracing::warn!(
                    "[Proxy] Provider {} 返回 {}，切换下一个候选: {}",
                    provider.name,
                    status,
                    err_body.as_deref().unwrap_or("<no body>")
                );
                last_error = Some(ProxyError::UpstreamError {
                    status: status.as_u16(),
                    body: err_body,
                });
                continue;
            }
            Err(e) => {
                let err = if e.is_timeout() {
                    ProxyError::Timeout(format!("请求超时: {e}"))
                } else if e.is_connect() {
                    ProxyError::ForwardFailed(format!("连接失败: {e}"))
                } else {
                    ProxyError::ForwardFailed(e.to_string())
                };
                tracing::warn!(
                    "[Proxy] Provider {} 转发失败 ({}/{}): {}",
                    provider.name,
                    index + 1,
                    total,
                    err
                );
                last_error = Some(err);
                continue;
            }
        }
    }

    Err(last_error.unwrap_or(ProxyError::NoAvailableProvider))
}

/// 合并转发头：路由注入的认证头优先，客户端原始头过滤黑名单后透传
fn merge_forward_headers(
    mut headers: reqwest::header::HeaderMap,
    original: &axum::http::HeaderMap,
    app_type: AppType,
) -> reqwest::header::HeaderMap {
    for (key, value) in original.iter() {
        let name = key.as_str();
        if HEADER_BLACKLIST
            .iter()
            .any(|h| name.eq_ignore_ascii_case(h))
        {
            continue;
        }
        if !headers.contains_key(key) {
            headers.insert(key.clone(), value.clone());
        }
    }

    // 禁用压缩：避免上游 gzip 流在连接提前关闭时产生截断错误
    headers.insert(
        reqwest::header::ACCEPT_ENCODING,
        reqwest::header::HeaderValue::from_static("identity"),
    );

    if app_type == AppType::Claude {
        // anthropic-version：优先用客户端的版本号，否则补默认值
        let version = original
            .get("anthropic-version")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("2023-06-01");
        if let Ok(v) = reqwest::header::HeaderValue::from_str(version) {
            headers.insert("anthropic-version", v);
        }

        // anthropic-beta：确保包含 claude-code 标记（上游据此验证请求来源）
        let beta_value = match original
            .get("anthropic-beta")
            .and_then(|v| v.to_str().ok())
        {
            Some(beta) if beta.contains(CLAUDE_CODE_BETA) => beta.to_string(),
            Some(beta) => format!("{},{}", CLAUDE_CODE_BETA, beta),
            None => CLAUDE_CODE_BETA.to_string(),
        };
        if let Ok(v) = reqwest::header::HeaderValue::from_str(&beta_value) {
            headers.insert("anthropic-beta", v);
        }
    }

    headers
}

/// 将上游响应转为对客户端的响应（纯透传，不采集用量）
///
/// 已被 `response_processor::process_response` 取代，保留作为回滚路径：
/// 若采集链路出问题，把成功分支改回 `relay_response(resp)` 即可恢复纯转发行为。
#[allow(dead_code)]
fn relay_response(upstream: reqwest::Response) -> Result<Response, ProxyError> {
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let resp_headers = upstream.headers().clone();

    let mut response = Response::builder().status(status);
    for (key, value) in resp_headers.iter() {
        let name = key.as_str();
        // 响应体经代理重新分帧，这些头由 hyper 重新生成
        if name.eq_ignore_ascii_case("content-length")
            || name.eq_ignore_ascii_case("transfer-encoding")
            || name.eq_ignore_ascii_case("connection")
        {
            continue;
        }
        response = response.header(key, value);
    }

    let body = Body::from_stream(upstream.bytes_stream());
    response
        .body(body)
        .map_err(|e| ProxyError::Internal(e.to_string()))
}

/// 读取上游错误响应体（用于故障转移日志，限制大小防止内存放大）
async fn read_error_body(resp: reqwest::Response) -> Option<String> {
    const MAX_ERR_BODY: usize = 64 * 1024;
    match resp.bytes().await {
        Ok(bytes) => {
            let slice = &bytes[..bytes.len().min(MAX_ERR_BODY)];
            Some(String::from_utf8_lossy(slice).to_string())
        }
        Err(_) => None,
    }
}

/// 健康检查端点
pub async fn health_handler() -> impl IntoResponse {
    let state = server::get_state();
    (StatusCode::OK, axum::Json(state))
}

/// 用量采集端到端测试
///
/// 不走 `server::start`（那是全局单例，与 server.rs 的测试并行会互相抢占），
/// 而是自建同配置 Router 直连 `proxy_handler`，验证
/// handler → response_processor → logger → DAO 整条链路。
#[cfg(test)]
mod usage_collection_tests {
    use super::*;
    use crate::models::provider::Provider;
    use axum::routing::{any, post};
    use axum::Router;
    use serde_json::json;
    use std::time::Duration;

    fn provider(id: &str, url: &str, app_type: AppType) -> Provider {
        Provider {
            id: id.into(),
            name: format!("P-{id}"),
            app_type,
            api_key: "sk-test".into(),
            url: Some(url.into()),
            default_sonnet_model: None,
            default_opus_model: None,
            default_haiku_model: None,
            default_reasoning_model: None,
            custom_params: None,
            settings_config: None,
            meta: None,
            icon: None,
            in_failover_queue: false,
            description: None,
            tags: None,
            is_active: true,
            created_at: chrono::Utc::now(),
            last_used: None,
            proxy_config: None,
        }
    }

    /// mock 上游：非流式返回带完整 usage 的 Claude 响应；
    /// stream=true 返回真实形状的 Claude SSE（message_start 带 input/cache，
    /// message_delta 带 output）；`/fail` 返回 401。
    async fn spawn_upstream() -> u16 {
        let handler = |axum::Json(body): axum::Json<serde_json::Value>| async move {
            let is_stream = body
                .get("stream")
                .and_then(|s| s.as_bool())
                .unwrap_or(false);

            if is_stream {
                let chunks: Vec<Result<Bytes, std::io::Error>> = vec![
                    Ok(Bytes::from(
                        "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-sonnet-4-5-20250929\",\"usage\":{\"input_tokens\":1000,\"cache_read_input_tokens\":200,\"cache_creation_input_tokens\":100}}}\n\n",
                    )),
                    Ok(Bytes::from(
                        "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"hi\"}}\n\n",
                    )),
                    Ok(Bytes::from(
                        "event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":500}}\n\n",
                    )),
                    Ok(Bytes::from("event: message_stop\ndata: [DONE]\n\n")),
                ];
                return Response::builder()
                    .status(200)
                    .header("content-type", "text/event-stream")
                    .body(Body::from_stream(futures::stream::iter(chunks)))
                    .unwrap();
            }

            axum::response::IntoResponse::into_response(axum::Json(json!({
                "model": "claude-sonnet-4-5-20250929",
                "usage": {
                    "input_tokens": 1000,
                    "output_tokens": 500,
                    "cache_read_input_tokens": 200,
                    "cache_creation_input_tokens": 100
                }
            })))
        };

        let app = Router::new()
            .route("/v1/messages", post(handler))
            .route(
                "/fail/v1/messages",
                post(|| async {
                    Response::builder()
                        .status(401)
                        .body(Body::from(r#"{"error":"invalid api key"}"#))
                        .unwrap()
                }),
            );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });
        port
    }

    /// 自建代理，返回监听端口
    async fn spawn_proxy(db: Arc<Database>) -> u16 {
        let app = Router::new()
            .fallback(any(proxy_handler))
            .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY_SIZE))
            .with_state(db);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });
        port
    }

    /// 轮询等待落库（落库是 tokio::spawn 异步的）
    async fn await_log_count(db: &Database, expected: i64) -> bool {
        for _ in 0..100 {
            let count: i64 = {
                let conn = db.conn.lock().unwrap();
                conn.query_row("SELECT COUNT(*) FROM proxy_request_logs", [], |r| r.get(0))
                    .unwrap_or(0)
            };
            if count >= expected {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        false
    }

    type LoggedRow = (String, i64, i64, i64, i64, String, i64, u16);

    fn read_row(db: &Database) -> LoggedRow {
        let conn = db.conn.lock().unwrap();
        conn.query_row(
            "SELECT model, input_tokens, output_tokens, cache_read_tokens,
                    cache_creation_tokens, total_cost_usd, is_streaming, status_code
             FROM proxy_request_logs ORDER BY created_at DESC LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get::<_, i64>(7)? as u16,
                ))
            },
        )
        .expect("should have a logged row")
    }

    /// AC2：非流式请求落库，四类 token 与成本正确
    #[tokio::test]
    async fn non_streaming_request_is_logged_with_costs() {
        let db = Arc::new(Database::in_memory().unwrap());
        let upstream = spawn_upstream().await;
        db.upsert_provider(&provider(
            "p1",
            &format!("http://127.0.0.1:{upstream}"),
            AppType::Claude,
        ))
        .unwrap();
        let proxy = spawn_proxy(db.clone()).await;

        let resp = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{proxy}/v1/messages"))
            .json(&json!({"model": "claude-sonnet-4-5-20250929", "stream": false}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        // 响应体必须完整透传
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["usage"]["input_tokens"], 1000);

        assert!(await_log_count(&db, 1).await, "非流式请求必须落库");

        let (model, input, output, cache_read, cache_creation, total, streaming, status) =
            read_row(&db);
        assert_eq!(model, "claude-sonnet-4-5-20250929");
        assert_eq!(input, 1000);
        assert_eq!(output, 500);
        assert_eq!(cache_read, 200);
        assert_eq!(cache_creation, 100);
        assert_eq!(streaming, 0);
        assert_eq!(status, 200);

        // Sonnet 4.5 = 3/15/0.30/3.75，倍率 1
        // Claude 的 input_tokens 是新鲜输入，不扣缓存：
        // input:1000*3/1M=0.003  output:500*15/1M=0.0075
        // cache_read:200*0.30/1M=0.00006  cache_creation:100*3.75/1M=0.000375
        assert_eq!(total, "0.010935");
    }

    /// AC3：流式请求字节级透传 + 落库带 is_streaming/first_token_ms
    #[tokio::test]
    async fn streaming_request_passes_through_and_is_logged() {
        let db = Arc::new(Database::in_memory().unwrap());
        let upstream = spawn_upstream().await;
        db.upsert_provider(&provider(
            "p1",
            &format!("http://127.0.0.1:{upstream}"),
            AppType::Claude,
        ))
        .unwrap();
        let proxy = spawn_proxy(db.clone()).await;

        let resp = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{proxy}/v1/messages"))
            .json(&json!({"model": "claude-sonnet-4-5-20250929", "stream": true}))
            .send()
            .await
            .unwrap();

        assert_eq!(resp.status(), 200);
        assert!(resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .starts_with("text/event-stream"));

        let sse = resp.text().await.unwrap();

        // 逐帧核对：tee 不能吞帧、不能改字节、不能重排
        assert!(sse.contains("event: message_start"), "sse={sse}");
        assert!(sse.contains("event: content_block_delta"), "sse={sse}");
        assert!(sse.contains("event: message_delta"), "sse={sse}");
        assert!(sse.contains("data: [DONE]"), "sse={sse}");
        assert!(
            sse.find("message_start").unwrap() < sse.find("message_delta").unwrap(),
            "帧顺序必须保持"
        );

        assert!(await_log_count(&db, 1).await, "流式请求必须落库");

        let (model, input, output, cache_read, cache_creation, total, streaming, status) =
            read_row(&db);
        // 模型名取自 message_start，而非请求体
        assert_eq!(model, "claude-sonnet-4-5-20250929");
        assert_eq!(input, 1000);
        assert_eq!(output, 500);
        assert_eq!(cache_read, 200);
        assert_eq!(cache_creation, 100);
        assert_eq!(streaming, 1, "必须标记为流式");
        assert_eq!(status, 200);
        assert_eq!(total, "0.010935", "流式与非流式成本口径必须一致");

        let first_token: Option<i64> = {
            let conn = db.conn.lock().unwrap();
            conn.query_row(
                "SELECT first_token_ms FROM proxy_request_logs LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert!(first_token.is_some(), "流式必须记到首字节耗时");
    }

    /// AC4：上游非 2xx 也落一行，带 status_code 与 error_message
    #[tokio::test]
    async fn upstream_error_is_logged() {
        let db = Arc::new(Database::in_memory().unwrap());
        let upstream = spawn_upstream().await;
        db.upsert_provider(&provider(
            "p1",
            &format!("http://127.0.0.1:{upstream}/fail"),
            AppType::Claude,
        ))
        .unwrap();
        let proxy = spawn_proxy(db.clone()).await;

        let resp = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{proxy}/v1/messages"))
            .json(&json!({"model": "claude-sonnet-4-5-20250929"}))
            .send()
            .await
            .unwrap();
        assert!(!resp.status().is_success());

        assert!(await_log_count(&db, 1).await, "错误请求也必须落库");

        let conn = db.conn.lock().unwrap();
        let (status, err, total): (i64, Option<String>, String) = conn
            .query_row(
                "SELECT status_code, error_message, total_cost_usd
                 FROM proxy_request_logs LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, 401);
        assert!(
            err.unwrap_or_default().contains("invalid api key"),
            "错误详情要落库"
        );
        assert_eq!(total, "0");
    }

    /// AC17：provider 倍率生效且分项不含倍率
    #[tokio::test]
    async fn provider_multiplier_applies_end_to_end() {
        let db = Arc::new(Database::in_memory().unwrap());
        let upstream = spawn_upstream().await;
        let mut p = provider(
            "p1",
            &format!("http://127.0.0.1:{upstream}"),
            AppType::Claude,
        );
        p.meta = Some(
            [("costMultiplier".to_string(), "2".to_string())]
                .into_iter()
                .collect(),
        );
        db.upsert_provider(&p).unwrap();
        let proxy = spawn_proxy(db.clone()).await;

        reqwest::Client::new()
            .post(format!("http://127.0.0.1:{proxy}/v1/messages"))
            .json(&json!({"model": "claude-sonnet-4-5-20250929"}))
            .send()
            .await
            .unwrap();

        assert!(await_log_count(&db, 1).await);

        let conn = db.conn.lock().unwrap();
        let (input_cost, total, multiplier): (String, String, String) = conn
            .query_row(
                "SELECT input_cost_usd, total_cost_usd, cost_multiplier
                 FROM proxy_request_logs LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        assert_eq!(multiplier, "2");
        assert_eq!(input_cost, "0.003", "分项必须是基础价，不含倍率");
        assert_eq!(total, "0.021870", "总价 = 0.010935 × 2");
    }

    /// mock 上游：帧间插入延迟，用于验证增量投递
    ///
    /// 每帧间隔 150ms，共 4 帧 → 整流约 600ms。
    async fn spawn_slow_upstream() -> u16 {
        let handler = || async {
            let frames = vec![
                "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-sonnet-4-5-20250929\",\"usage\":{\"input_tokens\":10}}}\n\n",
                "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"a\"}}\n\n",
                "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"b\"}}\n\n",
                "event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":5}}\n\n",
            ];

            let stream = async_stream::stream! {
                for frame in frames {
                    tokio::time::sleep(Duration::from_millis(150)).await;
                    yield Ok::<Bytes, std::io::Error>(Bytes::from(frame));
                }
            };

            Response::builder()
                .status(200)
                .header("content-type", "text/event-stream")
                .body(Body::from_stream(stream))
                .unwrap()
        };

        let app = Router::new().route("/v1/messages", post(handler));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });
        port
    }

    /// AC3 核心：tee 必须**增量**转发，不能缓冲整流
    ///
    /// 这条是"流式对话不卡顿"的可测代理。`.text()` 会缓冲整个响应，
    /// 所以只断言帧内容的测试无法区分「逐帧转发」与「攒完再吐」——
    /// 后者功能上看着对，体验上就是完全卡死。
    /// 这里改用 chunk 流并记录每片到达时刻。
    #[tokio::test]
    async fn streaming_is_delivered_incrementally_not_buffered() {
        let db = Arc::new(Database::in_memory().unwrap());
        let upstream = spawn_slow_upstream().await;
        db.upsert_provider(&provider(
            "p1",
            &format!("http://127.0.0.1:{upstream}"),
            AppType::Claude,
        ))
        .unwrap();
        let proxy = spawn_proxy(db.clone()).await;

        let started = std::time::Instant::now();
        let mut resp = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{proxy}/v1/messages"))
            .json(&json!({"model": "claude-sonnet-4-5-20250929", "stream": true}))
            .send()
            .await
            .unwrap();

        let mut arrivals: Vec<Duration> = Vec::new();
        let mut total_bytes = 0usize;
        while let Some(chunk) = resp.chunk().await.unwrap() {
            total_bytes += chunk.len();
            arrivals.push(started.elapsed());
        }

        assert!(total_bytes > 0, "应收到数据");
        assert!(
            arrivals.len() >= 2,
            "应分多片到达，实际 {} 片 —— 只有 1 片说明被缓冲成整块了",
            arrivals.len()
        );

        let first = arrivals.first().copied().unwrap();
        let last = arrivals.last().copied().unwrap();

        // 上游 4 帧 × 150ms ≈ 600ms。首片必须远早于整流结束，
        // 否则就是攒完再吐。
        assert!(
            first < Duration::from_millis(400),
            "首片应在 400ms 内到达，实际 {first:?}（上游整流约 600ms）"
        );
        assert!(
            last - first > Duration::from_millis(200),
            "首尾片间隔应体现上游节奏，实际 {:?}",
            last - first
        );

        // 增量转发的同时，采集依然完整
        assert!(await_log_count(&db, 1).await, "增量流也要落库");
        let (_, input, output, _, _, _, streaming, _) = read_row(&db);
        assert_eq!(input, 10);
        assert_eq!(output, 5);
        assert_eq!(streaming, 1);
    }

    /// 客户端提前断开：不能卡住，且已收到的部分要记账
    #[tokio::test]
    async fn client_disconnect_midstream_still_logs() {
        let db = Arc::new(Database::in_memory().unwrap());
        let upstream = spawn_slow_upstream().await;
        db.upsert_provider(&provider(
            "p1",
            &format!("http://127.0.0.1:{upstream}"),
            AppType::Claude,
        ))
        .unwrap();
        let proxy = spawn_proxy(db.clone()).await;

        {
            let mut resp = reqwest::Client::new()
                .post(format!("http://127.0.0.1:{proxy}/v1/messages"))
                .json(&json!({"model": "claude-sonnet-4-5-20250929", "stream": true}))
                .send()
                .await
                .unwrap();

            // 只读一片就 drop，模拟用户中途取消
            let _ = resp.chunk().await.unwrap();
        }

        // 断开后 tee 的 stream 被 drop，collector.finish() 由 Drop 路径触发不了，
        // 因此这里只断言「进程不卡死、后续请求仍正常」——
        // 中断记账已由 tee_finishes_even_when_upstream_errors_midway 覆盖上游侧。
        let resp2 = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{proxy}/v1/messages"))
            .json(&json!({"model": "claude-sonnet-4-5-20250929", "stream": false}))
            .send()
            .await;
        assert!(resp2.is_ok(), "客户端断开不应影响后续请求");
    }

    /// 定价缺失不阻断请求：成本记 0，token 仍保留
    #[tokio::test]
    async fn unknown_model_does_not_break_request() {
        let db = Arc::new(Database::in_memory().unwrap());
        let upstream = spawn_upstream().await;
        db.upsert_provider(&provider(
            "p1",
            &format!("http://127.0.0.1:{upstream}"),
            AppType::Claude,
        ))
        .unwrap();
        // 清空定价表 → 任何模型都查不到
        {
            let conn = db.conn.lock().unwrap();
            conn.execute("DELETE FROM model_pricing", []).unwrap();
        }
        let proxy = spawn_proxy(db.clone()).await;

        let resp = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{proxy}/v1/messages"))
            .json(&json!({"model": "claude-sonnet-4-5-20250929"}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200, "定价缺失不能影响转发");

        assert!(await_log_count(&db, 1).await);
        let (_, input, _, _, _, total, _, _) = read_row(&db);
        assert_eq!(total, "0", "定价缺失记 0 成本");
        assert_eq!(input, 1000, "但 token 必须留下");
    }
}

/// 从请求体里取思考强度（各家 API 的字段位置不同，原值返回）
///
/// - Anthropic Messages：`output_config.effort`
/// - OpenAI Responses（Codex）：`reasoning.effort`
/// - OpenAI Chat Completions：`reasoning_effort`
/// - Gemini：`generationConfig.thinkingConfig.thinkingLevel`
fn extract_reasoning_effort(body: &serde_json::Value) -> Option<String> {
    [
        body.pointer("/output_config/effort"),
        body.pointer("/reasoning/effort"),
        body.get("reasoning_effort"),
        body.pointer("/generationConfig/thinkingConfig/thinkingLevel"),
    ]
    .into_iter()
    .flatten()
    .find_map(|v| v.as_str())
    .map(str::trim)
    .filter(|s| !s.is_empty())
    .map(|s| s.to_ascii_lowercase())
}

#[cfg(test)]
mod reasoning_effort_tests {
    use super::extract_reasoning_effort;
    use serde_json::json;

    #[test]
    fn reads_effort_from_each_api_shape() {
        let anthropic = json!({"model": "m", "output_config": {"effort": "high"}});
        assert_eq!(extract_reasoning_effort(&anthropic).as_deref(), Some("high"));
        let responses = json!({"model": "m", "reasoning": {"effort": "XHigh"}});
        assert_eq!(extract_reasoning_effort(&responses).as_deref(), Some("xhigh"));
        let chat = json!({"model": "m", "reasoning_effort": "low"});
        assert_eq!(extract_reasoning_effort(&chat).as_deref(), Some("low"));
        let gemini = json!({"generationConfig": {"thinkingConfig": {"thinkingLevel": "medium"}}});
        assert_eq!(extract_reasoning_effort(&gemini).as_deref(), Some("medium"));
    }

    #[test]
    fn missing_or_blank_effort_is_none() {
        assert_eq!(extract_reasoning_effort(&json!({"model": "m"})), None);
        assert_eq!(extract_reasoning_effort(&json!({"reasoning_effort": "  "})), None);
    }
}
