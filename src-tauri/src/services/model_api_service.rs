use serde::Deserialize;
use std::io;

#[derive(Debug, Deserialize)]
struct ModelInfo {
    id: String,
}

#[derive(Debug, Deserialize)]
struct ModelListResponse {
    data: Option<Vec<ModelInfo>>,
}

async fn request_models(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
) -> Result<reqwest::Response, io::Error> {
    client
        .get(endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| io::Error::new(io::ErrorKind::ConnectionRefused, e.to_string()))
}

/// 从 API 获取可用模型列表
pub async fn fetch_models(url: String, api_key: String) -> Result<Vec<String>, io::Error> {
    if url.trim().is_empty() || api_key.trim().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "URL and API Key are required",
        ));
    }

    let base = url.trim().trim_end_matches('/');
    let endpoint = format!("{}/v1/models", base);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

    let api_key = api_key.trim();
    let mut response = request_models(&client, &endpoint, api_key).await?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        if let Some(fallback_base) = base.strip_suffix("/v1") {
            let fallback_endpoint = format!("{}/v1/models", fallback_base.trim_end_matches('/'));
            response = request_models(&client, &fallback_endpoint, api_key).await?;
        }
    }

    if !response.status().is_success() {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("API returned status: {}", response.status()),
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;

    let parsed: ModelListResponse = serde_json::from_str(&body)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;

    let models: Vec<String> = parsed
        .data
        .unwrap_or_default()
        .into_iter()
        .filter(|m| !m.id.trim().is_empty())
        .map(|m| m.id)
        .collect();

    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::fetch_models;
    use axum::{http::StatusCode, routing::get, Json, Router};
    use serde_json::json;

    async fn spawn_model_server(app: Router) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test model server");
        let address = listener.local_addr().expect("read test server address");
        let handle = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve test model API");
        });
        (format!("http://{}", address), handle)
    }

    #[tokio::test]
    async fn retries_without_trailing_v1_after_not_found() {
        let app = Router::new()
            .route("/v1/v1/models", get(|| async { StatusCode::NOT_FOUND }))
            .route(
                "/v1/models",
                get(|| async {
                    Json(json!({
                        "data": [
                            {"id": "gpt-5.2-codex"},
                            {"id": "gpt-5.6-terra"}
                        ]
                    }))
                }),
            );
        let (base_url, server) = spawn_model_server(app).await;

        let models = fetch_models(format!("{}/v1", base_url), "test-key".into())
            .await
            .expect("fallback request should succeed");

        server.abort();
        assert_eq!(models, vec!["gpt-5.2-codex", "gpt-5.6-terra"]);
    }

    #[tokio::test]
    async fn does_not_retry_non_404_failures() {
        let app = Router::new()
            .route("/v1/v1/models", get(|| async { StatusCode::UNAUTHORIZED }))
            .route(
                "/v1/models",
                get(|| async { Json(json!({"data": [{"id": "should-not-be-returned"}]})) }),
            );
        let (base_url, server) = spawn_model_server(app).await;

        let error = fetch_models(format!("{}/v1", base_url), "bad-key".into())
            .await
            .expect_err("401 response should not use the fallback endpoint");

        server.abort();
        assert!(error.to_string().contains("401 Unauthorized"));
    }
}
