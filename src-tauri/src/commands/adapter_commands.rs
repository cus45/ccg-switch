use crate::models::adapter::AdapterRegistry;
use crate::services::adapter_registry_service;

#[tauri::command]
pub fn get_adapter_registry() -> AdapterRegistry {
    adapter_registry_service::get_adapter_registry()
}
