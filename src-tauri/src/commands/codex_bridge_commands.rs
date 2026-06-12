use crate::models::conversation::{
    ApprovalResponseInput, CodexConfigSummary, CodexMcpServerStatus, CodexModelInfo,
    ConversationThread, ConversationThreadSnapshot, ConversationTurn, ThreadResumeInput,
    ThreadStartInput, TurnStartInput,
};
use crate::services::{codex_bridge_service, mcp_service::McpService, workspace_service};
use crate::store::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn codex_config_read(
    state: State<'_, AppState>,
    workspace_id: Option<String>,
) -> Result<CodexConfigSummary, String> {
    codex_bridge_service::read_config(&state.db, workspace_id)
}

#[tauri::command]
pub fn codex_model_list(
    state: State<'_, AppState>,
    provider_id: Option<String>,
) -> Result<Vec<CodexModelInfo>, String> {
    codex_bridge_service::list_models(&state.db, provider_id)
}

#[tauri::command]
pub fn codex_thread_start(input: ThreadStartInput) -> Result<ConversationThread, String> {
    codex_bridge_service::start_thread(input)
}

#[tauri::command]
pub fn codex_thread_resume(input: ThreadResumeInput) -> Result<ConversationThread, String> {
    codex_bridge_service::resume_thread(input)
}

#[tauri::command]
pub fn codex_turn_start(
    app: AppHandle,
    state: State<'_, AppState>,
    mut input: TurnStartInput,
) -> Result<ConversationTurn, String> {
    inject_workspace_mcp_projection(&state, &mut input)?;
    codex_bridge_service::start_turn(app, input)
}

#[tauri::command]
pub fn codex_turn_interrupt(
    app: AppHandle,
    thread_id: String,
    turn_id: String,
) -> Result<(), String> {
    codex_bridge_service::interrupt_turn(app, thread_id, turn_id)
}

#[tauri::command]
pub fn codex_thread_read(thread_id: String) -> Result<ConversationThreadSnapshot, String> {
    codex_bridge_service::read_thread(thread_id)
}

#[tauri::command]
pub fn codex_mcp_server_status_list(
    workspace_id: Option<String>,
) -> Result<Vec<CodexMcpServerStatus>, String> {
    codex_bridge_service::list_mcp_server_status(workspace_id)
}

#[tauri::command]
pub fn codex_approval_respond(app: AppHandle, input: ApprovalResponseInput) -> Result<(), String> {
    codex_bridge_service::respond_approval(app, input)
}

fn inject_workspace_mcp_projection(
    state: &State<'_, AppState>,
    input: &mut TurnStartInput,
) -> Result<(), String> {
    let snapshot = codex_bridge_service::read_thread(input.thread_id.clone())?;
    let Some(workspace_id) = snapshot.thread.workspace_id else {
        return Ok(());
    };
    if state.db.get_workspace_by_id(&workspace_id)?.is_none() {
        return Err("Workspace not found".to_string());
    }

    let servers = McpService::get_all(&state.db)?
        .into_values()
        .collect::<Vec<_>>();
    let bindings = state.db.list_bindings_by_workspace(&workspace_id)?;
    let projection = workspace_service::build_codex_mcp_projection(&servers, &bindings);
    input.metadata.insert(
        "mcpServers".to_string(),
        serde_json::to_value(projection)
            .map_err(|e| format!("Failed to serialize Codex MCP projection: {e}"))?,
    );
    Ok(())
}
