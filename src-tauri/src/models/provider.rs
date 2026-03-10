use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use super::app_type::AppType;
use super::token::ApiToken;

/// 供应商单独的代理配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderProxyConfig {
    /// 是否启用单独代理
    #[serde(default)]
    pub enabled: bool,
    /// 代理类型: http | https | socks5
    #[serde(rename = "proxyType", skip_serializing_if = "Option::is_none")]
    pub proxy_type: Option<String>,
    /// 代理主机
    #[serde(rename = "proxyHost", skip_serializing_if = "Option::is_none")]
    pub proxy_host: Option<String>,
    /// 代理端口
    #[serde(rename = "proxyPort", skip_serializing_if = "Option::is_none")]
    pub proxy_port: Option<u16>,
    /// 代理用户名（可选）
    #[serde(rename = "proxyUsername", skip_serializing_if = "Option::is_none")]
    pub proxy_username: Option<String>,
    /// 代理密码（可选）
    #[serde(rename = "proxyPassword", skip_serializing_if = "Option::is_none")]
    pub proxy_password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    #[serde(rename = "appType")]
    pub app_type: AppType,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    pub url: Option<String>,
    #[serde(rename = "defaultSonnetModel")]
    pub default_sonnet_model: Option<String>,
    #[serde(rename = "defaultOpusModel")]
    pub default_opus_model: Option<String>,
    #[serde(rename = "defaultHaikuModel")]
    pub default_haiku_model: Option<String>,
    #[serde(rename = "defaultReasoningModel")]
    pub default_reasoning_model: Option<String>,
    #[serde(rename = "customParams")]
    pub custom_params: Option<HashMap<String, serde_json::Value>>,
    #[serde(rename = "settingsConfig")]
    pub settings_config: Option<serde_json::Value>,
    pub meta: Option<HashMap<String, String>>,
    pub icon: Option<String>,
    #[serde(rename = "inFailoverQueue", default)]
    pub in_failover_queue: bool,
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(rename = "isActive")]
    pub is_active: bool,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    #[serde(rename = "lastUsed")]
    pub last_used: Option<DateTime<Utc>>,
    /// 供应商单独的代理配置
    #[serde(rename = "proxyConfig", skip_serializing_if = "Option::is_none")]
    pub proxy_config: Option<ProviderProxyConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvidersConfig {
    pub providers: Vec<Provider>,
}

impl From<ApiToken> for Provider {
    fn from(token: ApiToken) -> Self {
        Provider {
            id: token.id,
            name: token.name,
            app_type: AppType::Claude,
            api_key: token.api_key,
            url: token.url,
            default_sonnet_model: token.default_sonnet_model,
            default_opus_model: token.default_opus_model,
            default_haiku_model: token.default_haiku_model,
            default_reasoning_model: None,
            custom_params: token.custom_params,
            settings_config: None,
            meta: None,
            icon: None,
            in_failover_queue: false,
            description: token.description,
            tags: None,
            is_active: token.is_active,
            created_at: token.created_at,
            last_used: token.last_used,
            proxy_config: None,
        }
    }
}
