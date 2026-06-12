use crate::models::local_environment::{LocalEnvironmentConfig, LocalEnvironmentUpdateInput};
use crate::services::local_environment_service;
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub fn read_local_environment(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<LocalEnvironmentConfig, String> {
    let workspace = state
        .db
        .get_workspace_by_id(&workspace_id)?
        .ok_or_else(|| "Workspace not found".to_string())?;

    local_environment_service::read_local_environment(&workspace)
}

#[tauri::command]
pub fn save_local_environment(
    state: State<'_, AppState>,
    input: LocalEnvironmentUpdateInput,
) -> Result<LocalEnvironmentConfig, String> {
    let workspace = state
        .db
        .get_workspace_by_id(&input.workspace_id)?
        .ok_or_else(|| "Workspace not found".to_string())?;

    local_environment_service::save_local_environment(&workspace, input)
}
