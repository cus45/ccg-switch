use crate::services::{auto_launch_service, webdav_service};

#[tauri::command]
pub fn get_webdav_config() -> Result<webdav_service::WebDavConfig, String> {
    webdav_service::get_webdav_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_webdav_config(config: webdav_service::WebDavConfig) -> Result<(), String> {
    webdav_service::save_webdav_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_auto_launch_status() -> Result<auto_launch_service::AutoLaunchStatus, String> {
    auto_launch_service::get_auto_launch_status()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_auto_launch(enabled: bool) -> Result<(), String> {
    auto_launch_service::set_auto_launch(enabled)
        .await
        .map_err(|e| e.to_string())
}

