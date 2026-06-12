use crate::models::automation::{
    CreateWorkspaceAutomationInput, UpdateWorkspaceAutomationInput, WorkspaceAutomation,
};
use crate::services::automation_service;
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub fn list_workspace_automations(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<WorkspaceAutomation>, String> {
    automation_service::list_workspace_automations(&state.db, &workspace_id)
}

#[tauri::command]
pub fn create_workspace_automation(
    state: State<'_, AppState>,
    input: CreateWorkspaceAutomationInput,
) -> Result<WorkspaceAutomation, String> {
    automation_service::create_workspace_automation(&state.db, input)
}

#[tauri::command]
pub fn update_workspace_automation(
    state: State<'_, AppState>,
    id: String,
    input: UpdateWorkspaceAutomationInput,
) -> Result<WorkspaceAutomation, String> {
    automation_service::update_workspace_automation(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_workspace_automation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    automation_service::delete_workspace_automation(&state.db, &id)
}
