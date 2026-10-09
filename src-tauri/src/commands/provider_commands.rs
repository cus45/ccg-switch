use crate::models::app_type::AppType;
use crate::models::provider::Provider;
use crate::services::provider_service;
use crate::services::stream_check_service;
use crate::services::usage_query_service::{self, UsageResult, UsageScriptConfig};
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub fn get_providers(app: String, state: State<AppState>) -> Result<Vec<Provider>, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;
    provider_service::list_providers_from_db(&state.db, app_type)
}

#[tauri::command]
pub fn get_all_providers(state: State<AppState>) -> Result<Vec<Provider>, String> {
    provider_service::list_all_providers_from_db(&state.db)
}

#[tauri::command]
pub fn add_provider(provider: Provider, state: State<AppState>, app: tauri::AppHandle) -> Result<(), String> {
    provider_service::add_provider_to_db(&state.db, provider)?;
    crate::tray::refresh(&app);
    Ok(())
}

#[tauri::command]
pub fn update_provider(
    provider_id: String,
    provider: Provider,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    provider_service::update_provider_in_db(&state.db, &provider_id, provider)?;
    crate::tray::refresh(&app);
    Ok(())
}

#[tauri::command]
pub fn delete_provider(provider_id: String, state: State<AppState>, app: tauri::AppHandle) -> Result<(), String> {
    provider_service::delete_provider_from_db(&state.db, &provider_id)?;
    crate::tray::refresh(&app);
    Ok(())
}

#[tauri::command]
pub fn switch_provider(
    app: String,
    provider_id: String,
    state: State<AppState>,
    handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;
    provider_service::switch_provider_in_db(&state.db, app_type, &provider_id)?;
    crate::tray::refresh(&handle);
    Ok(())
}

#[tauri::command]
pub fn move_provider(
    provider_id: String,
    target_index: usize,
    state: State<AppState>,
) -> Result<(), String> {
    provider_service::move_provider_in_db(&state.db, &provider_id, target_index)
}

#[tauri::command]
pub fn get_provider_config_files(app: String) -> Result<Vec<(String, String)>, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;
    provider_service::get_provider_config_files(app_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preview_provider_sync(provider: Provider) -> Result<Vec<(String, String, String)>, String> {
    provider_service::preview_provider_sync(&provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_claude_settings_state() -> Result<serde_json::Value, String> {
    provider_service::get_claude_settings_state().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_provider_health(
    provider_id: String,
    state: State<'_, AppState>,
) -> Result<stream_check_service::ProviderHealthResult, String> {
    stream_check_service::check_provider_health(provider_id, &state.db)
        .await
        .map_err(|e| e.to_string())
}

/// 查询供应商用量/余额
///
/// 优先使用 meta["usageScript"] 中启用的自定义脚本；没有时按 Base URL 走内置余额查询
/// （DeepSeek / SiliconFlow / OpenRouter 等，见 `builtin_balance_service`）。
#[tauri::command]
pub async fn query_provider_usage(
    provider_id: String,
    state: State<'_, AppState>,
) -> Result<UsageResult, String> {
    let provider = provider_service::get_provider_from_db(&state.db, &provider_id)?;
    let script = provider
        .meta
        .as_ref()
        .and_then(|m| m.get("usageScript"))
        .and_then(|s| serde_json::from_str::<UsageScriptConfig>(s).ok())
        .filter(|c| c.enabled);
    if let Some(config) = script {
        return Ok(usage_query_service::execute_and_format(
            &config,
            &provider.api_key,
            provider.url.as_deref(),
        )
        .await);
    }
    match provider.url.as_deref() {
        Some(url) => crate::services::builtin_balance_service::query(url, &provider.api_key)
            .await
            .unwrap_or_else(|| Err("未配置用量查询脚本，且该服务商不支持内置余额查询".to_string())),
        None => Err("未配置用量查询脚本".to_string()),
    }
}

/// 测试用量查询脚本（使用临时传入的脚本内容，不落库）
#[tauri::command]
pub async fn test_usage_script(
    provider_id: String,
    config: UsageScriptConfig,
    state: State<'_, AppState>,
) -> Result<UsageResult, String> {
    let provider = provider_service::get_provider_from_db(&state.db, &provider_id)?;
    Ok(usage_query_service::execute_and_format(&config, &provider.api_key, provider.url.as_deref())
        .await)
}
