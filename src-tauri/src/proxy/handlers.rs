use crate::database::Database;
use crate::models::app_type::AppType;
use crate::proxy::error::ProxyError;
use crate::proxy::http_client;
use crate::proxy::model_mapper;
use crate::proxy::provider_router;
use crate::proxy::server;
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
                    return relay_response(resp);
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

/// 将上游响应转为对客户端的响应（流式透传）
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
