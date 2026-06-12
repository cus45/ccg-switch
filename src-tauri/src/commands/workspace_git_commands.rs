use crate::services::workspace_git_service::{self, WorkspaceGitStatus};
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub fn get_workspace_git_status(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceGitStatus, String> {
    let workspace = state
        .db
        .get_workspace_by_id(&workspace_id)?
        .ok_or_else(|| "Workspace not found".to_string())?;

    workspace_git_service::get_workspace_git_status(&workspace)
}
