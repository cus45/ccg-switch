use bytes::Bytes;
use reqwest::Client;
use std::sync::OnceLock;
use std::time::Duration;
use tracing::{debug, error, info};

use crate::models::provider::ProviderProxyConfig;

/// 全局 HTTP 客户端（跟随系统代理，用于外部上游）
///
/// 注意：不设置总超时。SSE 流式响应可持续远超任何固定时长，
/// 总超时会在中途掐断长回复；非流式请求的超时由调用方按请求设置。
fn global_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .pool_idle_timeout(Duration::from_secs(90))
            .build()
            .expect("Failed to create HTTP client")
    })
}

/// 直连客户端（绕过一切代理，用于回环地址上游）
///
/// 系统代理（HTTP_PROXY 等）常见于国内环境；若把发往 127.0.0.1 上游的请求
/// 也交给外部代理，会出现连接黑洞/超时，且存在代理自环风险，因此回环目标强制直连。
fn direct_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .pool_idle_timeout(Duration::from_secs(90))
            .no_proxy()
            .build()
            .expect("Failed to create direct HTTP client")
    })
}

/// 判断目标 URL 是否指向本机回环地址
fn is_loopback_target(target_url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(target_url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<std::net::IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

/// 按目标地址选择客户端：回环直连，其余跟随系统代理
fn client_for_target(target_url: &str) -> &'static Client {
    if is_loopback_target(target_url) {
        direct_client()
    } else {
        global_client()
    }
}

/// 根据 Provider 代理配置构建代理 URL
#[allow(dead_code)]
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
#[allow(dead_code)]
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
        .connect_timeout(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(90))
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
#[allow(dead_code)]
pub fn get_for_provider(proxy_config: Option<&ProviderProxyConfig>) -> Client {
    // 优先使用 Provider 单独代理
    if let Some(client) = build_client_for_provider(proxy_config) {
        return client;
    }

    // 回退到全局客户端
    global_client().clone()
}

/// 隐藏 URL 中的敏感信息（用于日志）
#[allow(dead_code)]
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
    timeout: Option<Duration>,
) -> Result<reqwest::Response, reqwest::Error> {
    let mut request = client_for_target(url)
        .request(method, url)
        .headers(headers)
        .body(body);

    // 仅非流式请求设置总超时；流式响应依赖 connect_timeout + 客户端主动断开
    if let Some(t) = timeout {
        request = request.timeout(t);
    }

    request.send().await
}

/// 使用指定代理配置转发请求
#[allow(dead_code)]
pub async fn forward_request_with_proxy(
    method: reqwest::Method,
    url: &str,
    headers: reqwest::header::HeaderMap,
    body: Bytes,
    proxy_config: Option<&ProviderProxyConfig>,
    timeout: Option<Duration>,
) -> Result<reqwest::Response, reqwest::Error> {
    let client = get_for_provider(proxy_config);
    let mut request = client.request(method, url).headers(headers).body(body);
    if let Some(t) = timeout {
        request = request.timeout(t);
    }
    request.send().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_targets_are_detected() {
        assert!(is_loopback_target("http://127.0.0.1:8080/v1/messages"));
        assert!(is_loopback_target("http://localhost:3000/api"));
        assert!(is_loopback_target("http://[::1]:9000/v1"));
        assert!(!is_loopback_target("https://api.anthropic.com/v1/messages"));
        assert!(!is_loopback_target("http://192.168.1.10:3000"));
        assert!(!is_loopback_target("not a url"));
    }
}
