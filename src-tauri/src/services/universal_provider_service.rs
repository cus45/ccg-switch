use crate::database::Database;
use crate::models::app_type::AppType;
use crate::models::provider::Provider;
use crate::services::provider_service;
use chrono::Utc;
use std::str::FromStr;
use std::sync::Arc;

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

/// 为多个应用批量添加相同配置的 Provider（写入数据库，不自动切换）
///
/// 每个目标应用新增一条非激活的 Provider；返回成功添加的 provider id 列表。
/// 先校验全部目标应用，避免写到一半才发现非法应用名。
pub fn apply_universal_provider(
    db: &Arc<Database>,
    config: UniversalProviderConfig,
) -> Result<Vec<String>, String> {
    let apps = config
        .target_apps
        .iter()
        .map(|s| AppType::from_str(s))
        .collect::<Result<Vec<_>, String>>()?;

    let now = Utc::now();
    let timestamp = now.timestamp_millis();
    let mut added_ids: Vec<String> = Vec::new();

    for app_type in apps {
        let provider_id = format!("universal-{}-{}", app_type.as_str(), timestamp);
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

        provider_service::add_provider_to_db(db, provider)?;
        added_ids.push(provider_id);
    }

    Ok(added_ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_one_inactive_provider_per_target_app() {
        let db = Arc::new(Database::in_memory().unwrap());
        let ids = apply_universal_provider(
            &db,
            UniversalProviderConfig {
                name: "Relay".into(),
                api_key: "sk-u".into(),
                url: Some("https://relay.example.com".into()),
                target_apps: vec!["claude".into(), "codex".into()],
                description: None,
            },
        )
        .unwrap();

        assert_eq!(ids.len(), 2);
        let all = db.list_providers().unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().all(|p| p.name == "Relay" && !p.is_active));
        assert!(all.iter().any(|p| p.app_type == AppType::Claude));
        assert!(all.iter().any(|p| p.app_type == AppType::Codex));
    }

    #[test]
    fn rejects_unknown_app_before_writing() {
        let db = Arc::new(Database::in_memory().unwrap());
        let result = apply_universal_provider(
            &db,
            UniversalProviderConfig {
                name: "Relay".into(),
                api_key: "sk-u".into(),
                url: None,
                target_apps: vec!["claude".into(), "nope".into()],
                description: None,
            },
        );
        assert!(result.is_err());
        assert!(db.list_providers().unwrap().is_empty());
    }
}
