#![allow(dead_code)]
//! 模型映射模块
//!
//! 在请求转发前，根据 Provider 配置替换请求中的模型名称

use crate::models::provider::Provider;
use serde_json::Value;

/// 模型映射配置
pub struct ModelMapping {
    pub haiku_model: Option<String>,
    pub sonnet_model: Option<String>,
    pub opus_model: Option<String>,
    pub default_model: Option<String>,
    pub reasoning_model: Option<String>,
}

impl ModelMapping {
    /// 从 Provider 配置中提取模型映射
    ///
    /// 优先读取 Provider 的一级字段（ProvidersPage 编辑的即这些字段），
    /// 缺失时回退到 settings_config.env 中的同名环境变量。
    pub fn from_provider(provider: &Provider) -> Self {
        let env = provider
            .settings_config
            .as_ref()
            .and_then(|sc| sc.get("env"));

        let from_env = |key: &str| -> Option<String> {
            env.and_then(|e| e.get(key))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from)
        };
        let from_field = |field: &Option<String>| -> Option<String> {
            field
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from)
        };

        Self {
            haiku_model: from_field(&provider.default_haiku_model)
                .or_else(|| from_env("ANTHROPIC_DEFAULT_HAIKU_MODEL")),
            sonnet_model: from_field(&provider.default_sonnet_model)
                .or_else(|| from_env("ANTHROPIC_DEFAULT_SONNET_MODEL")),
            opus_model: from_field(&provider.default_opus_model)
                .or_else(|| from_env("ANTHROPIC_DEFAULT_OPUS_MODEL")),
            default_model: from_env("ANTHROPIC_MODEL"),
            reasoning_model: from_field(&provider.default_reasoning_model)
                .or_else(|| from_env("ANTHROPIC_REASONING_MODEL")),
        }
    }

    /// 检查是否配置了任何模型映射
    pub fn has_mapping(&self) -> bool {
        self.haiku_model.is_some()
            || self.sonnet_model.is_some()
            || self.opus_model.is_some()
            || self.default_model.is_some()
            || self.reasoning_model.is_some()
    }

    /// 根据原始模型名称获取映射后的模型
    pub fn map_model(&self, original_model: &str, has_thinking: bool) -> String {
        let model_lower = original_model.to_lowercase();

        // 1. thinking 模式优先使用推理模型
        if has_thinking {
            if let Some(ref m) = self.reasoning_model {
                return m.clone();
            }
        }

        // 2. 按模型类型匹配
        if model_lower.contains("haiku") {
            if let Some(ref m) = self.haiku_model {
                return m.clone();
            }
        }
        if model_lower.contains("opus") {
            if let Some(ref m) = self.opus_model {
                return m.clone();
            }
        }
        if model_lower.contains("sonnet") {
            if let Some(ref m) = self.sonnet_model {
                return m.clone();
            }
        }

        // 3. 默认模型
        if let Some(ref m) = self.default_model {
            return m.clone();
        }

        // 4. 无映射，保持原样
        original_model.to_string()
    }
}

/// 检测请求是否启用了 thinking 模式
pub fn has_thinking_enabled(body: &Value) -> bool {
    match body
        .get("thinking")
        .and_then(|v| v.as_object())
        .and_then(|o| o.get("type"))
        .and_then(|t| t.as_str())
    {
        Some("enabled") | Some("adaptive") => true,
        Some("disabled") | None => false,
        Some(other) => {
            tracing::warn!("[ModelMapper] 未知 thinking.type='{other}'，按 disabled 处理");
            false
        }
    }
}

/// 对请求体应用模型映射
///
/// 返回 (映射后的请求体, 原始模型名, 映射后模型名)
pub fn apply_model_mapping(
    mut body: Value,
    provider: &Provider,
) -> (Value, Option<String>, Option<String>) {
    let mapping = ModelMapping::from_provider(provider);

    if !mapping.has_mapping() {
        let original = body.get("model").and_then(|m| m.as_str()).map(String::from);
        return (body, original, None);
    }

    let original_model = body.get("model").and_then(|m| m.as_str()).map(String::from);

    if let Some(ref original) = original_model {
        let has_thinking = has_thinking_enabled(&body);
        let mapped = mapping.map_model(original, has_thinking);

        if mapped != *original {
            tracing::debug!("[ModelMapper] 模型映射: {original} → {mapped}");
            body["model"] = serde_json::json!(mapped);
            return (body, Some(original.clone()), Some(mapped));
        }
    }

    (body, original_model, None)
}
