#![allow(dead_code)]
use crate::models::app_type::AppType;
use crate::models::provider::Provider;
use crate::services::provider_service;
use chrono::Utc;
use std::io;
use std::str::FromStr;

/// Universal Provider 配置请求
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct UniversalProviderConfig {
    pub name: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    pub url: Option<String>,
    #[serde(rename = "targetApps")]
    pub target_apps: Vec<String>,
    pub description: Option<String>,
}

/// 为多个应用批量添加相同配置的 Provider
/// 每个应用都会新增一个 Provider 条目
/// 返回值：成功添加的 provider id 列表
pub fn apply_universal_provider(config: UniversalProviderConfig) -> Result<Vec<String>, io::Error> {
    let now = Utc::now();
    let timestamp = now.timestamp_millis();
    let mut added_ids: Vec<String> = Vec::new();

    for app_str in &config.target_apps {
        let app_type = AppType::from_str(app_str).map_err(|e| {
            io::Error::new(io::ErrorKind::InvalidInput, format!("无效的应用类型 '{}': {}", app_str, e))
        })?;

        let provider_id = format!("universal-{}-{}", app_str, timestamp);

        let provider = Provider {
            id: provider_id.clone(),
            name: config.name.clone(),
            app_type,
            api_key: config.api_key.clone(),
            url: config.url.clone(),
            default_sonnet_model: None,
            default_opus_model: None,
            default_haiku_model: None,
            default_reasoning_model: None,
            custom_params: None,
            settings_config: None,
            meta: None,
            icon: None,
            in_failover_queue: false,
            description: config.description.clone(),
            tags: None,
            is_active: false,
            created_at: now,
            last_used: None,
            proxy_config: None,
        };

        provider_service::add_provider(provider)?;
        added_ids.push(provider_id);
    }

    Ok(added_ids)
}

/// 为多个应用批量切换到名称相同的 Provider
/// 如果该应用下存在同名 provider 则切换，否则创建后再切换
pub fn switch_universal_provider(provider_name: &str) -> Result<(), io::Error> {
    let all_providers = provider_service::list_all_providers()?;

    for app_type in AppType::all() {
        // 查找该应用下是否已有同名 provider
        let existing = all_providers.iter().find(|p| {
            p.app_type == *app_type && p.name == provider_name
        });

        match existing {
            Some(p) => {
                // 已有同名 provider，直接切换
                provider_service::switch_provider(*app_type, &p.id.clone())?;
            }
            None => {
                // 不存在同名 provider，从其他应用中找一个同名的来参考其配置
                let reference = all_providers.iter().find(|p| p.name == provider_name);
                if let Some(ref_provider) = reference {
                    let now = Utc::now();
                    let new_id = format!("universal-{}-{}", app_type.as_str(), now.timestamp_millis());
                    let new_provider = Provider {
                        id: new_id.clone(),
                        name: provider_name.to_string(),
                        app_type: *app_type,
                        api_key: ref_provider.api_key.clone(),
                        url: ref_provider.url.clone(),
                        default_sonnet_model: ref_provider.default_sonnet_model.clone(),
                        default_opus_model: ref_provider.default_opus_model.clone(),
                        default_haiku_model: ref_provider.default_haiku_model.clone(),
                        default_reasoning_model: ref_provider.default_reasoning_model.clone(),
                        custom_params: ref_provider.custom_params.clone(),
                        settings_config: ref_provider.settings_config.clone(),
                        meta: ref_provider.meta.clone(),
                        icon: ref_provider.icon.clone(),
                        in_failover_queue: false,
                        description: ref_provider.description.clone(),
                        tags: ref_provider.tags.clone(),
                        is_active: false,
                        created_at: now,
                        last_used: None,
                        proxy_config: ref_provider.proxy_config.clone(),
                    };
                    provider_service::add_provider(new_provider)?;
                    provider_service::switch_provider(*app_type, &new_id)?;
                }
                // 若没有任何参考 provider，跳过该应用
            }
        }
    }

    Ok(())
}
