use crate::database::dao::mcp::McpServerRow;
use crate::mcp::import;
use crate::services::mcp_service::McpService;
use crate::services::mcp_status_service::{self, McpStatusResult};
use crate::store::AppState;
use indexmap::IndexMap;
use tauri::State;

#[tauri::command]
pub fn get_mcp_servers(
    state: State<'_, AppState>,
) -> Result<IndexMap<String, McpServerRow>, String> {
    McpService::get_all(&state.db)
}

#[tauri::command]
pub fn upsert_mcp_server(state: State<'_, AppState>, server: McpServerRow) -> Result<(), String> {
    McpService::upsert(&state.db, server)
}

#[tauri::command]
pub fn delete_mcp_server_v2(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    McpService::delete(&state.db, &id)
}

#[tauri::command]
pub fn toggle_mcp_app(
    state: State<'_, AppState>,
    server_id: String,
    app: String,
    enabled: bool,
) -> Result<(), String> {
    McpService::toggle_app(&state.db, &server_id, &app, enabled)
}

#[tauri::command]
pub fn import_mcp_from_apps(state: State<'_, AppState>) -> Result<usize, String> {
    import::import_from_all(&state.db)
}

#[tauri::command]
pub async fn check_mcp_status(
    state: State<'_, AppState>,
    server_ids: Vec<String>,
) -> Result<Vec<McpStatusResult>, String> {
    mcp_status_service::check_batch(&state.db, server_ids).await
}
