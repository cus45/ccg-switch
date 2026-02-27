use crate::services::{auto_launch_service, usage_service, webdav_service};
use crate::models::usage::UsageDailySummary;

#[tauri::command]
pub fn get_webdav_config() -> Result<webdav_service::WebDavConfig, String> {
    webdav_service::get_webdav_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_webdav_config(config: webdav_service::WebDavConfig) -> Result<(), String> {
    webdav_service::save_webdav_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_auto_launch_status() -> Result<auto_launch_service::AutoLaunchStatus, String> {
    auto_launch_service::get_auto_launch_status().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_auto_launch(enabled: bool) -> Result<(), String> {
    auto_launch_service::set_auto_launch(enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_usage_summaries(days: u32) -> Result<Vec<UsageDailySummary>, String> {
    if days == 0 || days > 365 {
        return Err("days must be between 1 and 365".to_string());
    }
    usage_service::get_recent_summaries(days).map_err(|e| e.to_string())
}
