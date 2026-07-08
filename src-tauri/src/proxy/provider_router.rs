use crate::database::Database;
use crate::models::app_type::AppType;
use crate::models::provider::Provider;
use crate::proxy::error::ProxyError;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use std::sync::Arc;

/// 路由结果：目标 URL 与认证头
pub struct RouteResult {
    pub target_url: String,
    pub headers: HeaderMap,
}

/// 根据请求路径识别目标应用类型
///
/// 代理是统一入口，各 CLI 的 API 端点不同：
/// - Claude Code: `/v1/messages`、`/v1/messages/count_tokens`
/// - Codex CLI:   `/v1/responses`、`/v1/chat/completions`（base_url 带 /v1 前缀）
/// - Gemini CLI:  `/v1beta/...`
pub fn detect_app_type(path: &str) -> AppType {
    let p = strip_app_prefix(path);
    if p.starts_with("/v1beta/") || p.starts_with("/v1internal") {
        return AppType::Gemini;
    }
    if p.contains("/chat/completions") || p.contains("/responses") || p.contains("/completions") {
        return AppType::Codex;
    }
    AppType::Claude
}

/// 去掉可选的应用前缀（如 `/claude/v1/messages` → `/v1/messages`）
///
/// 兼容手工把 base_url 配成 `http://127.0.0.1:port/claude` 之类的用法。
pub fn strip_app_prefix(path: &str) -> &str {
    for prefix in ["/claude", "/codex", "/gemini"] {
        if let Some(rest) = path.strip_prefix(prefix) {
            if rest.starts_with('/') {
                return rest;
            }
        }
    }
    path
}

/// 解析故障转移候选列表：活跃 provider 优先，其后按顺序追加故障转移队列成员
pub fn resolve_candidates(db: &Arc<Database>, app: AppType) -> Result<Vec<Provider>, ProxyError> {
    let providers = db
        .list_providers_by_app(app.as_str())
        .map_err(ProxyError::DatabaseError)?;

    if providers.is_empty() {
        return Err(ProxyError::NoProvidersConfigured);
    }

    let mut candidates: Vec<Provider> = Vec::new();
    if let Some(active) = providers.iter().find(|p| p.is_active) {
        candidates.push(active.clone());
    }
    for p in &providers {
        if p.in_failover_queue && !candidates.iter().any(|c| c.id == p.id) {
            candidates.push(p.clone());
        }
    }

    if candidates.is_empty() {
        // 没有活跃 provider 也没有队列成员：回退取第一个，保证代理仍可用
        candidates.push(providers[0].clone());
    }

    Ok(candidates)
}

fn default_base_url(app: AppType) -> &'static str {
    match app {
        AppType::Claude => "https://api.anthropic.com",
        AppType::Codex => "https://api.openai.com/v1",
        AppType::Gemini => "https://generativelanguage.googleapis.com",
        _ => "https://api.anthropic.com",
    }
}

/// 拼接上游 URL，避免 base_url 与请求路径的 `/v1` 重复
///
/// Codex 的 base_url 约定带 `/v1` 后缀（如 `https://xx.com/v1`），
/// 而 CLI 发来的路径也以 `/v1/` 开头（因为 Live 配置写的是 `http://127.0.0.1:port/v1`）。
fn join_url(base_url: &str, request_path: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with("/v1") {
        if let Some(rest) = request_path.strip_prefix("/v1") {
            if rest.starts_with('/') {
                return format!("{}{}", base, rest);
            }
        }
    }
    format!("{}{}", base, request_path)
}

/// 判断 provider 是否声明为"仅 Bearer 认证"（部分中转服务不接受 x-api-key）
fn is_bearer_only(provider: &Provider) -> bool {
    provider
        .meta
        .as_ref()
        .and_then(|m| m.get("auth_mode").or_else(|| m.get("authMode")))
        .map(|v| v == "bearer_only")
        .unwrap_or(false)
}

/// 为指定 provider 构建上游路由（目标 URL + 认证头）
pub fn build_route(
    provider: &Provider,
    app: AppType,
    request_path: &str,
) -> Result<RouteResult, ProxyError> {
    let base_url = provider
        .url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_base_url(app));

    let target_url = join_url(base_url, request_path);

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let api_key = provider.api_key.trim();
    if api_key.is_empty() {
        return Err(ProxyError::ConfigError(format!(
            "Provider {} 未配置 API Key",
            provider.name
        )));
    }

    let key_value = |v: &str| {
        HeaderValue::from_str(v).map_err(|e| ProxyError::ConfigError(e.to_string()))
    };

    match app {
        AppType::Claude => {
            // 与 cc-switch 对齐：默认同时携带 Bearer 与 x-api-key，兼容面最广；
            // 仅当 provider 显式声明 bearer_only 时不发 x-api-key。
            headers.insert(
                AUTHORIZATION,
                key_value(&format!("Bearer {}", api_key))?,
            );
            if !is_bearer_only(provider) {
                headers.insert("x-api-key", key_value(api_key)?);
            }
        }
        AppType::Codex => {
            headers.insert(
                AUTHORIZATION,
                key_value(&format!("Bearer {}", api_key))?,
            );
        }
        AppType::Gemini => {
            headers.insert("x-goog-api-key", key_value(api_key)?);
        }
        _ => {
            headers.insert(
                AUTHORIZATION,
                key_value(&format!("Bearer {}", api_key))?,
            );
        }
    }

    Ok(RouteResult {
        target_url,
        headers,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn provider(app: AppType, url: Option<&str>, key: &str) -> Provider {
        Provider {
            id: "p1".into(),
            name: "P1".into(),
            app_type: app,
            api_key: key.into(),
            url: url.map(String::from),
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
            created_at: Utc::now(),
            last_used: None,
            proxy_config: None,
        }
    }

    #[test]
    fn detect_app_type_by_endpoint() {
        assert_eq!(detect_app_type("/v1/messages"), AppType::Claude);
        assert_eq!(
            detect_app_type("/v1/messages/count_tokens"),
            AppType::Claude
        );
        assert_eq!(detect_app_type("/v1/chat/completions"), AppType::Codex);
        assert_eq!(detect_app_type("/v1/responses"), AppType::Codex);
        assert_eq!(detect_app_type("/responses"), AppType::Codex);
        assert_eq!(
            detect_app_type("/v1beta/models/gemini-pro:generateContent"),
            AppType::Gemini
        );
        assert_eq!(detect_app_type("/claude/v1/messages"), AppType::Claude);
        assert_eq!(detect_app_type("/codex/v1/responses"), AppType::Codex);
    }

    #[test]
    fn join_url_dedupes_v1() {
        assert_eq!(
            join_url("https://x.com/v1", "/v1/responses"),
            "https://x.com/v1/responses"
        );
        assert_eq!(
            join_url("https://x.com", "/v1/messages"),
            "https://x.com/v1/messages"
        );
        assert_eq!(
            join_url("https://x.com/", "/v1/messages"),
            "https://x.com/v1/messages"
        );
    }

    #[test]
    fn claude_route_sets_both_auth_headers() {
        let p = provider(AppType::Claude, Some("https://api.anthropic.com"), "sk-1");
        let route = build_route(&p, AppType::Claude, "/v1/messages").unwrap();
        assert_eq!(route.target_url, "https://api.anthropic.com/v1/messages");
        assert_eq!(route.headers.get("x-api-key").unwrap(), "sk-1");
        assert_eq!(route.headers.get(AUTHORIZATION).unwrap(), "Bearer sk-1");
    }

    #[test]
    fn bearer_only_claude_route_omits_x_api_key() {
        let mut p = provider(AppType::Claude, Some("https://relay.example.com"), "sk-2");
        let mut meta = std::collections::HashMap::new();
        meta.insert("auth_mode".to_string(), "bearer_only".to_string());
        p.meta = Some(meta);

        let route = build_route(&p, AppType::Claude, "/v1/messages").unwrap();
        assert!(route.headers.get("x-api-key").is_none());
        assert_eq!(route.headers.get(AUTHORIZATION).unwrap(), "Bearer sk-2");
    }

    #[test]
    fn gemini_route_uses_goog_api_key() {
        let p = provider(AppType::Gemini, None, "g-key");
        let route = build_route(&p, AppType::Gemini, "/v1beta/models").unwrap();
        assert_eq!(route.headers.get("x-goog-api-key").unwrap(), "g-key");
        assert!(route.headers.get(AUTHORIZATION).is_none());
    }

    #[test]
    fn empty_api_key_is_config_error() {
        let p = provider(AppType::Claude, None, "  ");
        assert!(build_route(&p, AppType::Claude, "/v1/messages").is_err());
    }
}
