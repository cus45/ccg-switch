use crate::models::app_type::AppType;
use crate::models::provider::Provider;
use crate::services::provider_service;
use crate::services::stream_check_service;

#[tauri::command]
pub fn get_providers(app: String) -> Result<Vec<Provider>, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;
    provider_service::list_providers(app_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_providers() -> Result<Vec<Provider>, String> {
    provider_service::list_all_providers().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_provider(provider: Provider) -> Result<(), String> {
    provider_service::add_provider(provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_provider(provider_id: String, provider: Provider) -> Result<(), String> {
    provider_service::update_provider(&provider_id, provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_provider(provider_id: String) -> Result<(), String> {
    provider_service::delete_provider(&provider_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn switch_provider(app: String, provider_id: String) -> Result<(), String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;
    provider_service::switch_provider(app_type, &provider_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_provider(provider_id: String, target_index: usize) -> Result<(), String> {
    provider_service::move_provider(&provider_id, target_index).map_err(|e| e.to_string())
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
) -> Result<stream_check_service::ProviderHealthResult, String> {
    stream_check_service::check_provider_health(provider_id)
        .await
        .map_err(|e| e.to_string())
}
