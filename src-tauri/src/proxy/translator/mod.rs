pub mod gemini;
pub mod openai;

use crate::models::app_type::AppType;
use crate::models::provider::Provider;
use serde::{Deserialize, Serialize};

/// 供应商支持的 API 协议格式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ApiFormat {
    /// Anthropic Messages API 原生协议（/v1/messages）
    #[default]
    Anthropic,
    /// OpenAI Chat Completions 兼容协议（/v1/chat/completions）
    #[serde(rename = "openai")]
    OpenAi,
    /// Google Gemini 原生协议（/v1beta/models/...）
    Gemini,
}

impl ApiFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            ApiFormat::Anthropic => "anthropic",
            ApiFormat::OpenAi => "openai",
            ApiFormat::Gemini => "gemini",
        }
    }
}

/// 根据 Provider 元数据、应用类型和 URL 智能识别供应商的 API 协议
pub fn detect_api_format(provider: &Provider, app_type: AppType) -> ApiFormat {
    // 1. 如果 Provider meta 显式指定了 api_format 或 apiFormat
    if let Some(meta) = &provider.meta {
        if let Some(format_str) = meta.get("api_format").or_else(|| meta.get("apiFormat")) {
            match format_str.trim().to_lowercase().as_str() {
                "openai" => return ApiFormat::OpenAi,
                "gemini" => return ApiFormat::Gemini,
                "anthropic" => return ApiFormat::Anthropic,
                _ => {}
            }
        }
    }

    // 2. 如果是针对原生 Codex 或 Gemini 应用
    if app_type == AppType::Codex {
        return ApiFormat::OpenAi;
    }
    if app_type == AppType::Gemini {
        return ApiFormat::Gemini;
    }

    // 3. 基于 Provider URL 兜底自动推断（针对 Claude / ClaudeDesktop）
    if let Some(url) = provider.url.as_deref() {
        let url_lower = url.to_lowercase();
        if url_lower.contains("generativelanguage.googleapis.com") || url_lower.contains("/gemini") {
            return ApiFormat::Gemini;
        }
        if url_lower.contains("api.openai.com")
            || url_lower.contains("api.deepseek.com")
            || url_lower.contains("dashscope.aliyuncs.com")
            || url_lower.contains("api.groq.com")
            || url_lower.contains("openrouter.ai/api/v1")
            || url_lower.contains("localhost:11434")
            || url_lower.contains("127.0.0.1:11434")
            || (url_lower.ends_with("/v1") && !url_lower.contains("anthropic"))
        {
            return ApiFormat::OpenAi;
        }
    }

    ApiFormat::Anthropic
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use std::collections::HashMap;

    fn create_test_provider(url: Option<&str>, meta_format: Option<&str>) -> Provider {
        let mut meta = HashMap::new();
        if let Some(f) = meta_format {
            meta.insert("api_format".to_string(), f.to_string());
        }

        Provider {
            id: "test".to_string(),
            name: "Test".to_string(),
            app_type: AppType::Claude,
            api_key: "test-key".to_string(),
            url: url.map(|s| s.to_string()),
            default_sonnet_model: None,
            default_opus_model: None,
            default_haiku_model: None,
            default_reasoning_model: None,
            custom_params: None,
            settings_config: None,
            meta: if meta.is_empty() { None } else { Some(meta) },
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
    fn test_detect_explicit_meta() {
        let p_openai = create_test_provider(Some("https://api.anthropic.com"), Some("openai"));
        assert_eq!(detect_api_format(&p_openai, AppType::Claude), ApiFormat::OpenAi);

        let p_gemini = create_test_provider(Some("https://api.anthropic.com"), Some("gemini"));
        assert_eq!(detect_api_format(&p_gemini, AppType::Claude), ApiFormat::Gemini);

        let p_anthropic = create_test_provider(Some("https://api.openai.com/v1"), Some("anthropic"));
        assert_eq!(detect_api_format(&p_anthropic, AppType::Claude), ApiFormat::Anthropic);
    }

    #[test]
    fn test_detect_url_heuristic() {
        let p1 = create_test_provider(Some("https://api.openai.com/v1"), None);
        assert_eq!(detect_api_format(&p1, AppType::Claude), ApiFormat::OpenAi);

        let p2 = create_test_provider(Some("https://api.deepseek.com"), None);
        assert_eq!(detect_api_format(&p2, AppType::Claude), ApiFormat::OpenAi);

        let p3 = create_test_provider(Some("https://generativelanguage.googleapis.com"), None);
        assert_eq!(detect_api_format(&p3, AppType::Claude), ApiFormat::Gemini);

        let p4 = create_test_provider(Some("https://api.anthropic.com"), None);
        assert_eq!(detect_api_format(&p4, AppType::Claude), ApiFormat::Anthropic);
    }
}
