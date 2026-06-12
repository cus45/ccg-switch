use crate::models::worktree::WorkspaceWorktree;
use crate::services::worktree_service;
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub fn list_workspace_worktrees(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<WorkspaceWorktree>, String> {
    let workspace = state
        .db
        .get_workspace_by_id(&workspace_id)?
        .ok_or_else(|| "Workspace not found".to_string())?;

    worktree_service::list_workspace_worktrees(&workspace)
}
