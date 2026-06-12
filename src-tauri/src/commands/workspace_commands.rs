use crate::models::workspace::{
    CreateWorkspaceInput, JsonObject, UpdateField, UpdateWorkspaceInput, Workspace,
    WorkspaceBinding, WorkspaceBindingInput,
};
use crate::services::workspace_service;
use crate::store::AppState;
use chrono::Utc;
use tauri::State;

#[tauri::command]
pub fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    state.db.list_workspaces()
}

#[tauri::command]
pub fn get_workspace(state: State<'_, AppState>, id: String) -> Result<Workspace, String> {
    state
        .db
        .get_workspace_by_id(&id)?
        .ok_or_else(|| "Workspace not found".to_string())
}

#[tauri::command]
pub fn create_workspace(
    state: State<'_, AppState>,
    input: CreateWorkspaceInput,
) -> Result<Workspace, String> {
    workspace_service::create_workspace(&state.db, input)
}

#[tauri::command]
pub fn update_workspace(
    state: State<'_, AppState>,
    id: String,
    input: UpdateWorkspaceInput,
) -> Result<Workspace, String> {
    let mut workspace = state
        .db
        .get_workspace_by_id(&id)?
        .ok_or_else(|| "Workspace not found".to_string())?;

    apply_workspace_update(&mut workspace, input)?;
    if !state.db.update_workspace(&workspace)? {
        return Err("Workspace not found".to_string());
    }

    state
        .db
        .get_workspace_by_id(&id)?
        .ok_or_else(|| "Workspace not found".to_string())
}

#[tauri::command]
pub fn delete_workspace(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if state.db.delete_workspace(&id)? {
        Ok(())
    } else {
        Err("Workspace not found".to_string())
    }
}

#[tauri::command]
pub fn import_project_as_workspace(
    state: State<'_, AppState>,
    root_path: String,
) -> Result<Workspace, String> {
    workspace_service::import_project_as_workspace(&state.db, &root_path)
}

#[tauri::command]
pub fn touch_workspace(state: State<'_, AppState>, id: String) -> Result<Workspace, String> {
    workspace_service::touch_workspace(&state.db, &id)
}

#[tauri::command]
pub fn list_workspace_bindings(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<WorkspaceBinding>, String> {
    ensure_workspace_exists(&state, &workspace_id)?;
    state.db.list_bindings_by_workspace(&workspace_id)
}

#[tauri::command]
pub fn set_workspace_binding(
    state: State<'_, AppState>,
    input: WorkspaceBindingInput,
) -> Result<WorkspaceBinding, String> {
    ensure_workspace_exists(&state, &input.workspace_id)?;
    if input.target_id.trim().is_empty() {
        return Err("workspace binding target_id cannot be empty".to_string());
    }

    let now = current_timestamp();
    let binding = WorkspaceBinding {
        id: format!("workspace-binding-{}", uuid::Uuid::new_v4()),
        workspace_id: input.workspace_id.clone(),
        target_type: input.target_type,
        target_id: input.target_id,
        binding_type: input.binding_type,
        enabled: input.enabled.unwrap_or(true),
        priority: input.priority.unwrap_or(0),
        config: input.config.unwrap_or_else(JsonObject::new),
        created_at: now,
        updated_at: now,
    };

    state.db.upsert_binding(&binding)?;
    state
        .db
        .list_bindings_by_workspace(&binding.workspace_id)?
        .into_iter()
        .find(|existing| {
            existing.target_type == binding.target_type
                && existing.target_id == binding.target_id
                && existing.binding_type == binding.binding_type
        })
        .ok_or_else(|| "Workspace binding not found after upsert".to_string())
}

#[tauri::command]
pub fn delete_workspace_binding(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if state.db.delete_binding(&id)? {
        Ok(())
    } else {
        Err("Workspace binding not found".to_string())
    }
}

fn ensure_workspace_exists(state: &State<'_, AppState>, workspace_id: &str) -> Result<(), String> {
    if state.db.get_workspace_by_id(workspace_id)?.is_some() {
        Ok(())
    } else {
        Err("Workspace not found".to_string())
    }
}

fn apply_workspace_update(
    workspace: &mut Workspace,
    input: UpdateWorkspaceInput,
) -> Result<(), String> {
    if let Some(name) = input.name {
        if name.trim().is_empty() {
            return Err("workspace name cannot be empty".to_string());
        }
        workspace.name = name;
    }
    if let Some(tags) = input.tags {
        workspace.tags = tags;
    }
    if let Some(metadata) = input.metadata {
        workspace.metadata = metadata;
    }
    if let Some(is_favorite) = input.is_favorite {
        workspace.is_favorite = is_favorite;
    }

    apply_optional_update(&mut workspace.description, input.description);
    apply_optional_update(&mut workspace.color, input.color);
    apply_optional_update(&mut workspace.icon, input.icon);
    apply_optional_update(&mut workspace.default_app_type, input.default_app_type);
    apply_optional_update(
        &mut workspace.default_provider_id,
        input.default_provider_id,
    );
    apply_optional_update(&mut workspace.permission_policy, input.permission_policy);
    apply_optional_update(&mut workspace.terminal_policy, input.terminal_policy);

    Ok(())
}

fn apply_optional_update<T>(target: &mut Option<T>, update: UpdateField<T>) {
    match update {
        UpdateField::Unset => {}
        UpdateField::Clear => *target = None,
        UpdateField::Set(value) => *target = Some(value),
    }
}

fn current_timestamp() -> i64 {
    Utc::now().timestamp()
}
