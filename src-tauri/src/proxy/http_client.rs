use bytes::Bytes;
use reqwest::Client;
use std::sync::OnceLock;
use std::time::Duration;
use tracing::{debug, error, info};

use crate::models::provider::ProviderProxyConfig;

/// 全局 HTTP 客户端（无代理或使用系统代理）
fn global_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client")
    })
}

/// 根据 Provider 代理配置构建代理 URL
fn build_proxy_url_from_config(config: &ProviderProxyConfig) -> Option<String> {
    if !config.enabled {
        return None;
    }

    let proxy_type = config.proxy_type.as_deref().unwrap_or("http");
    let host = config.proxy_host.as_deref()?;
    let port = config.proxy_port?;

    // 构建带认证的代理 URL
    if let (Some(username), Some(password)) = (&config.proxy_username, &config.proxy_password) {
        if !username.is_empty() && !password.is_empty() {
            return Some(format!(
                "{}://{}:{}@{}:{}",
                proxy_type, username, password, host, port
            ));
        }
    }

    Some(format!("{}://{}:{}", proxy_type, host, port))
}

/// 根据 Provider 代理配置构建 HTTP 客户端
///
/// 如果 Provider 配置了单独代理（enabled = true），则使用该代理构建客户端；
/// 否则返回 None，调用方应使用全局客户端。
pub fn build_client_for_provider(proxy_config: Option<&ProviderProxyConfig>) -> Option<Client> {
    let config = proxy_config.filter(|c| c.enabled)?;

    let proxy_url = build_proxy_url_from_config(config)?;

    debug!(
        "[ProviderProxy] Building client with proxy: {}",
        mask_url(&proxy_url)
    );

    // 构建带代理的客户端
    let proxy = match reqwest::Proxy::all(&proxy_url) {
        Ok(p) => p,
        Err(e) => {
            error!(
                "[ProviderProxy] Failed to create proxy from '{}': {}",
                mask_url(&proxy_url),
                e
            );
            return None;
        }
    };

    match Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .proxy(proxy)
        .build()
    {
        Ok(client) => {
            info!(
                "[ProviderProxy] Client built with proxy: {}",
                mask_url(&proxy_url)
            );
            Some(client)
        }
        Err(e) => {
            error!("[ProviderProxy] Failed to build client: {}", e);
            None
        }
    }
}

/// 获取 Provider 专用的 HTTP 客户端
///
/// 优先使用 Provider 单独代理配置，如果未启用则返回全局客户端。
pub fn get_for_provider(proxy_config: Option<&ProviderProxyConfig>) -> Client {
    // 优先使用 Provider 单独代理
    if let Some(client) = build_client_for_provider(proxy_config) {
        return client;
    }

    // 回退到全局客户端
    global_client().clone()
}

/// 隐藏 URL 中的敏感信息（用于日志）
fn mask_url(url: &str) -> String {
    if let Ok(parsed) = url::Url::parse(url) {
        // 隐藏用户名和密码，保留 scheme、host 和端口
        let host = parsed.host_str().unwrap_or("?");
        match parsed.port() {
            Some(port) => format!("{}://{}:{}", parsed.scheme(), host, port),
            None => format!("{}://{}", parsed.scheme(), host),
        }
    } else {
        // URL 解析失败，返回部分内容
        if url.len() > 20 {
            format!("{}...", &url[..20])
        } else {
            url.to_string()
        }
    }
}

pub async fn forward_request(
    method: reqwest::Method,
    url: &str,
    headers: reqwest::header::HeaderMap,
    body: Bytes,
) -> Result<reqwest::Response, reqwest::Error> {
    global_client()
        .request(method, url)
        .headers(headers)
        .body(body)
        .send()
        .await
}

/// 使用指定代理配置转发请求
pub async fn forward_request_with_proxy(
    method: reqwest::Method,
    url: &str,
    headers: reqwest::header::HeaderMap,
    body: Bytes,
    proxy_config: Option<&ProviderProxyConfig>,
) -> Result<reqwest::Response, reqwest::Error> {
    let client = get_for_provider(proxy_config);
    client
        .request(method, url)
        .headers(headers)
        .body(body)
        .send()
        .await
}
