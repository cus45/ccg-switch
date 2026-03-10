use std::io;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use crate::models::provider::ProviderProxyConfig;
use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamCheckResult {
    #[serde(rename = "model")]
    pub model: String,
    #[serde(rename = "available")]
    pub available: bool,
    #[serde(rename = "latencyMs")]
    pub latency_ms: u64,
    #[serde(rename = "error")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderHealthResult {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "appType")]
    pub app_type: String,
    pub model: String,
    pub available: bool,
    #[serde(rename = "latencyMs")]
    pub latency_ms: u64,
    pub error: Option<String>,
}

/// 根据 app_type 构建请求的 URL、Headers、Body
fn build_request(
    app_type: &str,
    base_url: &str,
    api_key: &str,
    model: &str,
) -> (String, HeaderMap, serde_json::Value) {
    let base = base_url.trim_end_matches('/');

    match app_type {
        "codex" => {
            let url = if base.ends_with("/v1") {
                format!("{}/responses", base)
            } else {
                format!("{}/v1/responses", base)
            };

            let mut headers = HeaderMap::new();
            headers.insert(
                "Authorization",
                HeaderValue::from_str(&format!("Bearer {}", api_key)).unwrap(),
            );
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

            let body = serde_json::json!({
                "model": model,
                "input": "Hi",
                "stream": true
            });

            (url, headers, body)
        }
        "gemini" => {
            let url = if base.ends_with("/v1beta") {
                format!(
                    "{}/models/{}:streamGenerateContent?alt=sse&key={}",
                    base, model, api_key
                )
            } else {
                format!(
                    "{}/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
                    base, model, api_key
                )
            };

            let mut headers = HeaderMap::new();
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

            let body = serde_json::json!({
                "contents": [{"parts": [{"text": "Hi"}]}]
            });

            (url, headers, body)
        }
        // claude 及其他类型默认走 Claude 协议
        _ => {
            let url = if base.ends_with("/v1") {
                format!("{}/messages", base)
            } else {
                format!("{}/v1/messages", base)
            };

            let mut headers = HeaderMap::new();
            headers.insert(
                "x-api-key",
                HeaderValue::from_str(api_key).unwrap(),
            );
            headers.insert(
                "Authorization",
                HeaderValue::from_str(&format!("Bearer {}", api_key)).unwrap(),
            );
            headers.insert(
                "anthropic-version",
                HeaderValue::from_static("2023-06-01"),
            );
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

            let body = serde_json::json!({
                "model": model,
                "max_tokens": 10,
                "messages": [{"role": "user", "content": "Hi"}],
                "stream": true
            });

            (url, headers, body)
        }
    }
}

/// 等待响应中第一个有效的 SSE chunk
async fn wait_first_valid_chunk(response: reqwest::Response) -> Result<(), String> {
    let timeout_duration = Duration::from_secs(10);
    let fut = async {
        let mut stream = response.bytes_stream();
        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(bytes) => {
                    // 跳过空白 chunk
                    if bytes.is_empty() {
                        continue;
                    }
                    // 跳过 SSE 注释行（以 : 开头）和纯换行
                    let trimmed = bytes.iter().copied().collect::<Vec<u8>>();
                    let text = String::from_utf8_lossy(&trimmed);
                    let text = text.trim();
                    if text.is_empty() || text.starts_with(':') {
                        continue;
                    }
                    // 首个有效 chunk
                    return Ok(());
                }
                Err(e) => return Err(format!("Stream error: {}", e)),
            }
        }
        Err("Stream ended without valid data".to_string())
    };

    tokio::time::timeout(timeout_duration, fut)
        .await
        .map_err(|_| "Timeout waiting for first chunk (10s)".to_string())?
}

/// 检测模型 stream 可用性
pub async fn check_stream(
    url: String,
    api_key: String,
    model: String,
    app_type: Option<String>,
    proxy_config: Option<ProviderProxyConfig>,
) -> Result<StreamCheckResult, io::Error> {
    let app_type_str = app_type.as_deref().unwrap_or("claude");
    let (request_url, headers, body) = build_request(app_type_str, &url, &api_key, &model);

    // 构建 reqwest Client，支持代理配置
    let mut client_builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(30));

    if let Some(ref pc) = proxy_config {
        if pc.enabled {
            if let (Some(ref host), Some(port)) = (&pc.proxy_host, pc.proxy_port) {
                let proxy_type = pc.proxy_type.as_deref().unwrap_or("http");
                let proxy_url = format!("{}://{}:{}", proxy_type, host, port);

                let mut proxy = match proxy_type {
                    "socks5" => reqwest::Proxy::all(&proxy_url),
                    "https" => reqwest::Proxy::https(&proxy_url),
                    _ => reqwest::Proxy::http(&proxy_url),
                }
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

                if let (Some(ref user), Some(ref pass)) = (&pc.proxy_username, &pc.proxy_password) {
                    proxy = proxy.basic_auth(user, pass);
                }

                client_builder = client_builder.proxy(proxy);
            }
        }
    }

    let client = client_builder
        .build()
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

    let start = std::time::Instant::now();

    let result = client
        .post(&request_url)
        .headers(headers)
        .json(&body)
        .send()
        .await;

    match result {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                // 等待首个有效 chunk
                match wait_first_valid_chunk(response).await {
                    Ok(()) => {
                        let latency_ms = start.elapsed().as_millis() as u64;
                        Ok(StreamCheckResult {
                            model,
                            available: true,
                            latency_ms,
                            error: None,
                        })
                    }
                    Err(e) => {
                        let latency_ms = start.elapsed().as_millis() as u64;
                        Ok(StreamCheckResult {
                            model,
                            available: false,
                            latency_ms,
                            error: Some(e),
                        })
                    }
                }
            } else {
                let latency_ms = start.elapsed().as_millis() as u64;
                let error_text = response.text().await.unwrap_or_else(|_| status.to_string());
                Ok(StreamCheckResult {
                    model,
                    available: false,
                    latency_ms,
                    error: Some(error_text),
                })
            }
        }
        Err(e) => {
            let latency_ms = start.elapsed().as_millis() as u64;
            Ok(StreamCheckResult {
                model,
                available: false,
                latency_ms,
                error: Some(e.to_string()),
            })
        }
    }
}

/// 根据 Provider ID 检测健康状态
pub async fn check_provider_health(
    provider_id: String,
) -> Result<ProviderHealthResult, io::Error> {
    let providers = crate::services::provider_service::list_all_providers()?;
    let provider = providers
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Provider not found"))?;

    let app_type_str = provider.app_type.as_str().to_string();

    // 按优先级选择模型
    let model = provider
        .default_sonnet_model
        .as_deref()
        .filter(|s| !s.is_empty())
        .or(provider.default_opus_model.as_deref().filter(|s| !s.is_empty()))
        .or(provider.default_haiku_model.as_deref().filter(|s| !s.is_empty()))
        .or(provider.default_reasoning_model.as_deref().filter(|s| !s.is_empty()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            match app_type_str.as_str() {
                "codex" => "gpt-4o".to_string(),
                "gemini" => "gemini-2.0-flash".to_string(),
                _ => "claude-sonnet-4-20250514".to_string(),
            }
        });

    let base_url = provider
        .url
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            match app_type_str.as_str() {
                "codex" => "https://api.openai.com",
                "gemini" => "https://generativelanguage.googleapis.com",
                _ => "https://api.anthropic.com",
            }
        })
        .to_string();

    let result = check_stream(
        base_url,
        provider.api_key.clone(),
        model.clone(),
        Some(app_type_str.clone()),
        provider.proxy_config.clone(),
    )
    .await?;

    Ok(ProviderHealthResult {
        provider_id,
        app_type: app_type_str,
        model: result.model,
        available: result.available,
        latency_ms: result.latency_ms,
        error: result.error,
    })
}
