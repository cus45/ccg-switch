use crate::models::proxy::ProxyConfig;
use crate::proxy::types::ProxyState;
use crate::services::proxy_service;
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub fn get_proxy_config(state: State<AppState>) -> Result<ProxyConfig, String> {
    proxy_service::load_proxy_config_from_db(&state.db)
}

#[tauri::command]
pub fn save_proxy_config(config: ProxyConfig, state: State<AppState>) -> Result<(), String> {
    proxy_service::save_proxy_config_to_db(&state.db, &config)
}

#[tauri::command]
pub async fn start_proxy(
    config: ProxyConfig,
    state: State<'_, AppState>,
) -> Result<ProxyState, String> {
    // 持久化本次启动使用的配置，保证下次打开面板回显一致
    let _ = proxy_service::save_proxy_config_to_db(&state.db, &config);
    proxy_service::start_proxy(&state.db, config).await
}

#[tauri::command]
pub async fn stop_proxy(state: State<'_, AppState>) -> Result<(), String> {
    proxy_service::stop_proxy(&state.db).await
}

#[tauri::command]
pub fn get_proxy_status(state: State<AppState>) -> Result<ProxyState, String> {
    proxy_service::get_proxy_status(&state.db)
}
