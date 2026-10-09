use super::DeepLinkImportRequest;
use crate::database::Database;
use crate::error::AppError;
use crate::models::app_type::AppType;
use crate::models::provider::Provider;
use crate::services::provider_service;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;

/// 将 DeepLinkImportRequest 映射为 CCG Switch 的 Provider 结构
pub fn build_provider_from_deeplink(request: &DeepLinkImportRequest) -> Result<Provider, AppError> {
    let app_type = AppType::from_str(&request.app.clone().unwrap_or_default())
        .map_err(AppError::InvalidInput)?;

    // endpoint: 取逗号分隔的第一个 URL
    let url = request
        .endpoint
        .as_ref()
        .and_then(|ep| ep.split(',').next())
        .map(|s| s.trim().to_string());

    // sonnet_model: 先取 sonnet_model，若无则用 model
    let default_sonnet_model = request
        .sonnet_model
        .clone()
        .or_else(|| request.model.clone());

    // meta: 如有 homepage 则写入
    let meta = request.homepage.as_ref().map(|hp| {
        let mut m = HashMap::new();
        m.insert("homepage".to_string(), hp.clone());
        m
    });

    Ok(Provider {
        id: uuid::Uuid::new_v4().to_string(),
        name: request.name.clone().unwrap_or_default(),
        app_type,
        api_key: request.api_key.clone().unwrap_or_default(),
        url,
        default_sonnet_model,
        default_opus_model: request.opus_model.clone(),
        default_haiku_model: request.haiku_model.clone(),
        default_reasoning_model: None,
        custom_params: None,
        settings_config: None,
        meta,
        icon: request.icon.clone(),
        in_failover_queue: false,
        description: request.notes.clone(),
        tags: None,
        is_active: false,
        created_at: chrono::Utc::now(),
        last_used: None,
        proxy_config: None,
    })
}

/// 导入 Provider 到数据库，如需启用则同时切换活跃
pub fn import_provider_from_deeplink(
    db: &Arc<Database>,
    request: &DeepLinkImportRequest,
) -> Result<String, AppError> {
    let provider = build_provider_from_deeplink(request)?;
    let provider_id = provider.id.clone();
    let app_type = provider.app_type;

    provider_service::add_provider_to_db(db, provider).map_err(AppError::Message)?;

    if request.enabled == Some(true) {
        provider_service::switch_provider_in_db(db, app_type, &provider_id)
            .map_err(AppError::Message)?;
    }

    Ok(provider_id)
}
