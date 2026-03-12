use crate::error::AppError;

/// 校验 HTTP/HTTPS URL
pub fn validate_url(url_str: &str, field_name: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(url_str).map_err(|e| {
        AppError::InvalidInput(format!("{} URL 无效: {} ({})", field_name, url_str, e))
    })?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        scheme => Err(AppError::InvalidInput(format!(
            "{} 仅支持 http/https 协议，当前为: {}",
            field_name, scheme
        ))),
    }
}

/// 遮掩 API Key：前 4 位明文 + `*` x 20，不足 4 位全部 `****`
#[allow(dead_code)]
pub fn mask_api_key(key: &str) -> String {
    if key.len() < 4 {
        "****".to_string()
    } else {
        format!("{}{}", &key[..4], "*".repeat(20))
    }
}

/// 保留 scheme+host+path，去掉 query 中敏感参数值
pub fn redact_url_for_log(url_str: &str) -> String {
    match url::Url::parse(url_str) {
        Ok(mut parsed) => {
            let sensitive_keys = ["apiKey", "api_key", "token", "secret", "password", "key"];
            let pairs: Vec<(String, String)> = parsed
                .query_pairs()
                .map(|(k, v)| {
                    let key_str = k.to_string();
                    if sensitive_keys.iter().any(|s| key_str.eq_ignore_ascii_case(s)) {
                        (key_str, "***".to_string())
                    } else {
                        (key_str, v.to_string())
                    }
                })
                .collect();

            if pairs.is_empty() {
                parsed.set_query(None);
            } else {
                let query_string = pairs
                    .iter()
                    .map(|(k, v)| format!("{}={}", k, v))
                    .collect::<Vec<_>>()
                    .join("&");
                parsed.set_query(Some(&query_string));
            }
            parsed.to_string()
        }
        Err(_) => "[invalid URL]".to_string(),
    }
}

/// 去掉 api. 前缀推断首页
#[allow(dead_code)]
pub fn infer_homepage_from_endpoint(endpoint: &str) -> Option<String> {
    let parsed = url::Url::parse(endpoint).ok()?;
    let host = parsed.host_str()?;
    if let Some(stripped) = host.strip_prefix("api.") {
        Some(format!("{}://{}", parsed.scheme(), stripped))
    } else {
        Some(format!("{}://{}", parsed.scheme(), host))
    }
}
