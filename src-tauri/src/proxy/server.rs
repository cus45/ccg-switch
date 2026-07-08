use axum::extract::DefaultBodyLimit;
use axum::routing::{any, get};
use axum::Router;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tower_http::cors::{Any, CorsLayer};
use tracing;

use crate::database::Database;
use crate::proxy::handlers;
use crate::proxy::types::ProxyState;

struct ProxyServer {
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    server_handle: Option<JoinHandle<()>>,
    port: u16,
    host: String,
}

impl ProxyServer {
    fn new() -> Self {
        Self {
            shutdown_tx: None,
            server_handle: None,
            port: 8080,
            host: "0.0.0.0".to_string(),
        }
    }

    fn is_running(&self) -> bool {
        self.shutdown_tx.is_some()
    }
}

// 全局单例
fn global_server() -> &'static Arc<Mutex<ProxyServer>> {
    static SERVER: OnceLock<Arc<Mutex<ProxyServer>>> = OnceLock::new();
    SERVER.get_or_init(|| Arc::new(Mutex::new(ProxyServer::new())))
}

// 全局请求计数
static REQUEST_COUNT: AtomicU64 = AtomicU64::new(0);

pub fn increment_request_count() {
    REQUEST_COUNT.fetch_add(1, Ordering::Relaxed);
}

pub fn get_state() -> ProxyState {
    // 尝试非阻塞获取锁来读取状态
    let server = global_server();
    let guard = server.try_lock();
    match guard {
        Ok(s) => ProxyState {
            running: s.is_running(),
            port: s.port,
            host: s.host.clone(),
            request_count: REQUEST_COUNT.load(Ordering::Relaxed),
            takeover_active: false,
            taken_over_apps: Vec::new(),
        },
        Err(_) => {
            // 锁被占用时返回默认状态
            ProxyState {
                running: false,
                port: 8080,
                host: "0.0.0.0".to_string(),
                request_count: REQUEST_COUNT.load(Ordering::Relaxed),
                takeover_active: false,
                taken_over_apps: Vec::new(),
            }
        }
    }
}

/// 检查代理服务器是否正在运行
pub async fn is_running() -> bool {
    global_server().lock().await.is_running()
}

/// 启动代理服务器
///
/// 需要传入数据库句柄：转发时按请求实时读取活跃 provider 与故障转移队列。
pub async fn start(host: &str, port: u16, db: Arc<Database>) -> Result<ProxyState, String> {
    let server = global_server();
    let mut guard = server.lock().await;

    if guard.is_running() {
        return Err("Proxy server is already running".to_string());
    }

    // 构建 CORS 层
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // 构建路由：所有未匹配路径统一进入转发 handler
    let app = Router::new()
        .route("/health", get(handlers::health_handler))
        .fallback(any(handlers::proxy_handler))
        .layer(DefaultBodyLimit::max(handlers::MAX_BODY_SIZE))
        .layer(cors)
        .with_state(db);

    let addr = format!("{}:{}", host, port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind {}: {}", addr, e))?;

    // port 传 0 时由系统分配临时端口，这里取回真实端口
    let actual_port = listener
        .local_addr()
        .map(|a| a.port())
        .unwrap_or(port);

    tracing::info!("Proxy server starting on {}:{}", host, actual_port);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // 在后台 spawn axum 服务
    let handle = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
        tracing::info!("Proxy server stopped");
    });

    guard.host = host.to_string();
    guard.port = actual_port;
    guard.shutdown_tx = Some(shutdown_tx);
    guard.server_handle = Some(handle);

    Ok(ProxyState {
        running: true,
        port: actual_port,
        host: host.to_string(),
        request_count: REQUEST_COUNT.load(Ordering::Relaxed),
        takeover_active: false,
        taken_over_apps: Vec::new(),
    })
}

/// 停止代理服务器（等待端口真正释放，避免立刻重启时绑定失败）
pub async fn stop() -> Result<(), String> {
    let server = global_server();
    let mut guard = server.lock().await;

    let Some(tx) = guard.shutdown_tx.take() else {
        return Err("Proxy server is not running".to_string());
    };

    let _ = tx.send(());
    tracing::info!("Proxy server shutdown signal sent");

    if let Some(handle) = guard.server_handle.take() {
        match tokio::time::timeout(std::time::Duration::from_secs(5), handle).await {
            Ok(_) => {}
            Err(_) => tracing::warn!("Proxy server stop timed out after 5s, continuing"),
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::app_type::AppType;
    use crate::models::provider::Provider;
    use axum::routing::post;
    use chrono::Utc;
    use serde_json::json;

    fn test_provider(
        id: &str,
        name: &str,
        url: &str,
        key: &str,
        active: bool,
        queued: bool,
    ) -> Provider {
        Provider {
            id: id.into(),
            name: name.into(),
            app_type: AppType::Claude,
            api_key: key.into(),
            url: Some(url.into()),
            default_sonnet_model: None,
            default_opus_model: None,
            default_haiku_model: None,
            default_reasoning_model: None,
            custom_params: None,
            settings_config: None,
            meta: None,
            icon: None,
            in_failover_queue: queued,
            description: None,
            tags: None,
            is_active: active,
            created_at: Utc::now(),
            last_used: None,
            proxy_config: None,
        }
    }

    /// mock 上游：回显收到的认证头与请求体，用于断言代理的注入与剥离行为；
    /// stream=true 时返回 SSE 流，用于验证流式透传
    async fn spawn_mock_upstream() -> u16 {
        let app = Router::new().route(
            "/v1/messages",
            post(
                |headers: axum::http::HeaderMap,
                 axum::Json(body): axum::Json<serde_json::Value>| async move {
                    let is_stream = body
                        .get("stream")
                        .and_then(|s| s.as_bool())
                        .unwrap_or(false);

                    if is_stream {
                        let chunks: Vec<Result<bytes::Bytes, std::io::Error>> = vec![
                            Ok(bytes::Bytes::from("event: message_start\ndata: {\"type\":\"message_start\"}\n\n")),
                            Ok(bytes::Bytes::from("event: content_block_delta\ndata: {\"delta\":\"hello\"}\n\n")),
                            Ok(bytes::Bytes::from("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")),
                        ];
                        let stream = futures::stream::iter(chunks);
                        return axum::response::Response::builder()
                            .status(200)
                            .header("content-type", "text/event-stream")
                            .body(axum::body::Body::from_stream(stream))
                            .unwrap();
                    }

                    let h = |name: &str| {
                        headers
                            .get(name)
                            .and_then(|v| v.to_str().ok())
                            .map(String::from)
                    };
                    axum::response::IntoResponse::into_response(axum::Json(json!({
                        "echo_x_api_key": h("x-api-key"),
                        "echo_authorization": h("authorization"),
                        "echo_beta": h("anthropic-beta"),
                        "echo_version": h("anthropic-version"),
                        "echo_accept_encoding": h("accept-encoding"),
                        "echo_model": body.get("model").cloned().unwrap_or(json!(null)),
                    })))
                },
            ),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock upstream");
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });
        port
    }

    #[tokio::test]
    async fn reverse_proxy_forwards_with_auth_injection_and_failover() {
        let db = Arc::new(Database::in_memory().expect("init db"));
        let upstream_port = spawn_mock_upstream().await;

        // 占一个临时端口后立即释放：作为"连接必然被拒"的死上游，触发故障转移
        let dead_port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };

        // A：活跃但不可达；B：故障转移队列成员，指向 mock 上游并配置模型映射
        db.upsert_provider(&test_provider(
            "a",
            "Dead",
            &format!("http://127.0.0.1:{dead_port}"),
            "key-a",
            true,
            false,
        ))
        .unwrap();
        let mut b = test_provider(
            "b",
            "Alive",
            &format!("http://127.0.0.1:{upstream_port}"),
            "key-b",
            false,
            true,
        );
        b.default_sonnet_model = Some("mapped-sonnet".into());
        db.upsert_provider(&b).unwrap();

        let state = start("127.0.0.1", 0, db.clone()).await.expect("start proxy");
        assert!(state.running);
        let proxy_port = state.port;
        assert_ne!(proxy_port, 0, "should report actual bound port");

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let resp = client
            .post(format!("http://127.0.0.1:{proxy_port}/v1/messages"))
            .header("x-api-key", "stale-client-key")
            .header("authorization", "Bearer stale-client-key")
            .header("anthropic-beta", "context-1m-2025")
            .header("accept-encoding", "gzip")
            .json(&json!({"model": "claude-sonnet-4-6", "stream": false}))
            .send()
            .await
            .expect("request through proxy");

        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = resp.json().await.unwrap();

        // 认证头按 provider 重新注入，客户端旧凭证被剥离
        assert_eq!(body["echo_x_api_key"], "key-b");
        assert_eq!(body["echo_authorization"], "Bearer key-b");
        // anthropic-beta 补齐 claude-code 标记且保留客户端原值
        let beta = body["echo_beta"].as_str().unwrap();
        assert!(beta.contains("claude-code-20250219"), "beta={beta}");
        assert!(beta.contains("context-1m-2025"), "beta={beta}");
        // 版本兜底 + 压缩禁用
        assert_eq!(body["echo_version"], "2023-06-01");
        assert_eq!(body["echo_accept_encoding"], "identity");
        // 模型映射按 provider 配置生效（sonnet → mapped-sonnet）
        assert_eq!(body["echo_model"], "mapped-sonnet");

        assert!(REQUEST_COUNT.load(Ordering::Relaxed) >= 1);

        // 流式请求：SSE 响应完整透传（content-type 保留、事件不丢失）
        let sse = client
            .post(format!("http://127.0.0.1:{proxy_port}/v1/messages"))
            .json(&json!({"model": "claude-sonnet-4-6", "stream": true}))
            .send()
            .await
            .expect("streaming request through proxy");
        assert_eq!(sse.status(), 200);
        assert!(sse
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .starts_with("text/event-stream"));
        let sse_text = sse.text().await.unwrap();
        assert!(sse_text.contains("message_start"), "sse={sse_text}");
        assert!(sse_text.contains("content_block_delta"), "sse={sse_text}");
        assert!(sse_text.contains("message_stop"), "sse={sse_text}");

        // 未配置 provider 的应用（gemini）→ 快速返回服务错误而非挂起
        let resp2 = client
            .post(format!(
                "http://127.0.0.1:{proxy_port}/v1beta/models/gemini-pro:generateContent"
            ))
            .json(&json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp2.status(), 503);

        // 健康检查
        let health = client
            .get(format!("http://127.0.0.1:{proxy_port}/health"))
            .send()
            .await
            .unwrap();
        assert_eq!(health.status(), 200);

        stop().await.expect("stop proxy");
        assert!(!get_state().running);
    }
}
