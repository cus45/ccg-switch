use axum::body::Body;
use axum::extract::Request;
use axum::response::{IntoResponse, Response};
use axum::http::StatusCode;
use crate::proxy::error::ProxyError;
use crate::proxy::http_client;
use crate::proxy::provider_router;
use crate::proxy::server;
use crate::proxy::thinking_rectifier;

/// 代理请求处理器：转发所有请求到上游 provider
pub async fn proxy_handler(req: Request<Body>) -> Result<Response, ProxyError> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let query = req.uri().query().map(|q| format!("?{}", q)).unwrap_or_default();
    let request_path = format!("{}{}", path, query);

    // 收集原始请求头（排除 host 等 hop-by-hop 头）
    let original_headers = req.headers().clone();

    // 读取请求体
    let body_bytes = axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024)
        .await
        .map_err(|e| ProxyError::InvalidRequest(e.to_string()))?;

    // 预处理：将 thinking.type "adaptive" 转为 "enabled"（兼容第三方反代）
    let body_bytes = match thinking_rectifier::normalize_thinking_type(&body_bytes) {
        Ok(Some(fixed)) => fixed.into(),
        _ => body_bytes,
    };

    // 解析上游路由
    let route = provider_router::resolve_upstream(&request_path)?;

    // 合并请求头：路由头优先，保留原始请求中的非冲突头
    let mut forward_headers = route.headers;
    for (key, value) in original_headers.iter() {
        let name = key.as_str().to_lowercase();
        // 跳过 hop-by-hop 头和已设置的头
        if matches!(name.as_str(), "host" | "connection" | "transfer-encoding" | "content-length")
        {
            continue;
        }
        if !forward_headers.contains_key(key) {
            forward_headers.insert(key.clone(), value.clone());
        }
    }

    // 转发请求
    let method = reqwest::Method::from_bytes(method.as_str().as_bytes())
        .map_err(|e| ProxyError::InvalidRequest(e.to_string()))?;

    let upstream_resp = http_client::forward_request(
        method,
        &route.target_url,
        forward_headers,
        body_bytes,
    )
    .await
    .map_err(|e| ProxyError::UpstreamError(e.to_string()))?;

    // 递增请求计数
    server::increment_request_count();

    // 构建响应
    let status = StatusCode::from_u16(upstream_resp.status().as_u16())
        .unwrap_or(StatusCode::BAD_GATEWAY);
    let resp_headers = upstream_resp.headers().clone();

    // 流式转发响应体
    let body_stream = upstream_resp.bytes_stream();
    let body = Body::from_stream(body_stream);

    let mut response = Response::builder().status(status);
    for (key, value) in resp_headers.iter() {
        let name = key.as_str().to_lowercase();
        if matches!(name.as_str(), "transfer-encoding" | "connection") {
            continue;
        }
        response = response.header(key, value);
    }

    response
        .body(body)
        .map_err(|e| ProxyError::Internal(e.to_string()))
}

/// 健康检查端点
pub async fn health_handler() -> impl IntoResponse {
    let state = server::get_state();
    (StatusCode::OK, axum::Json(state))
}
