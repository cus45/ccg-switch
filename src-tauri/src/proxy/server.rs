use axum::Router;
use axum::routing::{any, get};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tracing;

use crate::proxy::handlers;
use crate::proxy::types::ProxyState;

struct ProxyServer {
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    port: u16,
    host: String,
}

impl ProxyServer {
    fn new() -> Self {
        Self {
            shutdown_tx: None,
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
        },
        Err(_) => {
            // 锁被占用时返回默认状态
            ProxyState {
                running: false,
                port: 8080,
                host: "0.0.0.0".to_string(),
                request_count: REQUEST_COUNT.load(Ordering::Relaxed),
            }
        }
    }
}

/// 启动代理服务器
pub async fn start(host: &str, port: u16) -> Result<ProxyState, String> {
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

    // 构建路由
    let app = Router::new()
        .route("/health", get(handlers::health_handler))
        .fallback(any(handlers::proxy_handler))
        .layer(cors);

    let addr = format!("{}:{}", host, port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind {}: {}", addr, e))?;

    tracing::info!("Proxy server starting on {}", addr);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // 在后台 spawn axum 服务
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
        tracing::info!("Proxy server stopped");
    });

    guard.host = host.to_string();
    guard.port = port;
    guard.shutdown_tx = Some(shutdown_tx);

    Ok(ProxyState {
        running: true,
        port,
        host: host.to_string(),
        request_count: REQUEST_COUNT.load(Ordering::Relaxed),
    })
}

/// 停止代理服务器
pub async fn stop() -> Result<(), String> {
    let server = global_server();
    let mut guard = server.lock().await;

    if let Some(tx) = guard.shutdown_tx.take() {
        let _ = tx.send(());
        tracing::info!("Proxy server shutdown signal sent");
        Ok(())
    } else {
        Err("Proxy server is not running".to_string())
    }
}
