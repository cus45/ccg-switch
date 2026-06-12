#![allow(dead_code)]

use crate::database::Database;
use crate::models::app_type::AppType;
use crate::models::conversation::{
    ApprovalDecision, ApprovalRequest, ApprovalRequestType, ApprovalResponseInput,
    CodexConfigSummary, CodexMcpServerStatus, CodexModelInfo, ConversationEvent,
    ConversationEventType, ConversationItem, ConversationItemStatus, ConversationItemType,
    ConversationRole, ConversationThread, ConversationThreadSnapshot, ConversationThreadStatus,
    ConversationTurn, ConversationTurnStatus, ThreadResumeInput, ThreadStartInput, TurnStartInput,
};
use crate::models::provider::Provider;
use chrono::Utc;
use once_cell::sync::Lazy;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use tauri::{AppHandle, Emitter};

const NOT_IMPLEMENTED_PREFIX: &str = "CodexBridge";
pub const CONVERSATION_EVENT_NAME: &str = "codex://conversation-event";

type ConversationEventEmitter = Arc<dyn Fn(ConversationEvent) + Send + Sync + 'static>;

static CODEX_RUNTIME: Lazy<Mutex<HashMap<String, CodexThreadRuntime>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

struct CodexThreadRuntime {
    thread: ConversationThread,
    turns: Vec<ConversationTurn>,
    items: Vec<ConversationItem>,
    pending_approvals: Vec<ApprovalRequest>,
    executable_path: PathBuf,
    model: Option<String>,
    provider_id: Option<String>,
    approval_policy: Option<String>,
    sandbox_policy: Option<String>,
    running_turn: Option<RunningCodexTurn>,
}

struct RunningCodexTurn {
    turn_id: String,
    assistant_item_id: String,
    child: Option<Arc<Mutex<Child>>>,
}

#[derive(Debug, Clone)]
struct CodexExecRequest {
    executable_path: PathBuf,
    cwd: String,
    prompt: String,
    model: Option<String>,
    approval_policy: Option<String>,
    sandbox_policy: Option<String>,
    mcp_servers: Vec<CodexMcpProjectionServer>,
    output_path: PathBuf,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexMcpProjectionServer {
    server_id: String,
    name: String,
    server_config: serde_json::Value,
}

pub fn read_config(
    db: &Arc<Database>,
    workspace_id: Option<String>,
) -> Result<CodexConfigSummary, String> {
    if let Some(workspace_id) = workspace_id.as_deref() {
        if db.get_workspace_by_id(workspace_id)?.is_none() {
            return Err("Workspace not found".to_string());
        }
    }

    let codex_home = resolve_codex_home()?;
    if !codex_home.exists() {
        return Err(format!(
            "Codex home not found: {}",
            codex_home.to_string_lossy()
        ));
    }
    if !codex_home.is_dir() {
        return Err(format!(
            "Codex home is not a directory: {}",
            codex_home.to_string_lossy()
        ));
    }

    let config_path = codex_home.join("config.toml");
    if !config_path.exists() {
        return Ok(empty_config_summary(
            workspace_id,
            &codex_home,
            &config_path,
            false,
        ));
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read Codex config: {e}"))?;
    parse_codex_config_summary(&content, workspace_id, &codex_home, &config_path)
}

pub fn list_models(
    db: &Arc<Database>,
    provider_id: Option<String>,
) -> Result<Vec<CodexModelInfo>, String> {
    let providers = if let Some(provider_id) = provider_id.as_deref() {
        vec![db
            .get_provider(provider_id)?
            .ok_or_else(|| format!("Provider {provider_id} not found"))?]
    } else {
        db.list_providers()?
            .into_iter()
            .filter(|provider| provider.app_type == AppType::Codex)
            .collect()
    };

    Ok(build_codex_model_list(&providers))
}

pub fn start_thread(input: ThreadStartInput) -> Result<ConversationThread, String> {
    let cwd = validate_thread_cwd(&input.cwd)?;
    let executable_path = resolve_codex_executable(&input.metadata)?;
    let now = current_timestamp();
    let thread = ConversationThread {
        id: format!("codex-thread-{}", uuid::Uuid::new_v4()),
        workspace_id: input.workspace_id,
        cwd,
        title: None,
        status: ConversationThreadStatus::Idle,
        created_at: now,
        updated_at: now,
    };

    let runtime = CodexThreadRuntime {
        thread: thread.clone(),
        turns: Vec::new(),
        items: Vec::new(),
        pending_approvals: Vec::new(),
        executable_path,
        model: input.model,
        provider_id: input.provider_id,
        approval_policy: input.approval_policy,
        sandbox_policy: input.sandbox_policy,
        running_turn: None,
    };

    lock_runtime()?.insert(thread.id.clone(), runtime);
    Ok(thread)
}

pub fn resume_thread(input: ThreadResumeInput) -> Result<ConversationThread, String> {
    if let Some(existing) = lock_runtime()?
        .get(&input.thread_id)
        .map(|runtime| runtime.thread.clone())
    {
        return Ok(existing);
    }

    let cwd = input
        .cwd
        .as_deref()
        .ok_or_else(|| "Codex thread resume requires cwd for uncached threads".to_string())?;
    let cwd = validate_thread_cwd(cwd)?;
    let executable_path = resolve_codex_executable(&input.metadata)?;
    let now = current_timestamp();
    let thread = ConversationThread {
        id: input.thread_id,
        workspace_id: input.workspace_id,
        cwd,
        title: input.source_path.as_ref().and_then(|source_path| {
            Path::new(source_path)
                .file_name()
                .and_then(|name| name.to_str())
                .map(ToString::to_string)
        }),
        status: ConversationThreadStatus::Idle,
        created_at: now,
        updated_at: now,
    };
    let runtime = CodexThreadRuntime {
        thread: thread.clone(),
        turns: Vec::new(),
        items: Vec::new(),
        pending_approvals: Vec::new(),
        executable_path,
        model: None,
        provider_id: None,
        approval_policy: None,
        sandbox_policy: None,
        running_turn: None,
    };

    lock_runtime()?.insert(thread.id.clone(), runtime);
    Ok(thread)
}

pub fn start_turn(app: AppHandle, input: TurnStartInput) -> Result<ConversationTurn, String> {
    let emitter: ConversationEventEmitter = Arc::new(move |event| {
        let _ = app.emit(CONVERSATION_EVENT_NAME, event);
    });
    start_turn_with_event_emitter(input, emitter, true)
}

pub fn interrupt_turn(app: AppHandle, thread_id: String, turn_id: String) -> Result<(), String> {
    let emitter: ConversationEventEmitter = Arc::new(move |event| {
        let _ = app.emit(CONVERSATION_EVENT_NAME, event);
    });
    interrupt_turn_with_event_emitter(thread_id, turn_id, emitter)
}

pub fn read_thread(thread_id: String) -> Result<ConversationThreadSnapshot, String> {
    let runtime = lock_runtime()?;
    let thread_runtime = runtime
        .get(&thread_id)
        .ok_or_else(|| "Codex thread not found".to_string())?;

    Ok(ConversationThreadSnapshot {
        thread: thread_runtime.thread.clone(),
        items: thread_runtime.items.clone(),
        pending_approvals: thread_runtime.pending_approvals.clone(),
    })
}

pub fn list_mcp_server_status(
    _workspace_id: Option<String>,
) -> Result<Vec<CodexMcpServerStatus>, String> {
    not_implemented("MCP server status list")
}

pub fn respond_approval(app: AppHandle, input: ApprovalResponseInput) -> Result<(), String> {
    let emitter: ConversationEventEmitter = Arc::new(move |event| {
        let _ = app.emit(CONVERSATION_EVENT_NAME, event);
    });
    respond_approval_with_event_emitter(input, emitter)
}

fn not_implemented<T>(operation: &str) -> Result<T, String> {
    Err(format!(
        "{NOT_IMPLEMENTED_PREFIX} {operation} is not implemented"
    ))
}

fn lock_runtime() -> Result<MutexGuard<'static, HashMap<String, CodexThreadRuntime>>, String> {
    CODEX_RUNTIME
        .lock()
        .map_err(|_| "Codex runtime lock poisoned".to_string())
}

fn current_timestamp() -> i64 {
    Utc::now().timestamp()
}

fn validate_thread_cwd(cwd: &str) -> Result<String, String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err("Codex thread cwd cannot be empty".to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("Codex thread cwd must be an absolute path".to_string());
    }
    if !path.exists() {
        return Err(format!(
            "Codex thread cwd not found: {}",
            display_path(&path)
        ));
    }
    if !path.is_dir() {
        return Err(format!(
            "Codex thread cwd is not a directory: {}",
            display_path(&path)
        ));
    }

    path.canonicalize()
        .map(|path| format_local_path(&path))
        .map_err(|e| format!("Failed to normalize Codex thread cwd: {e}"))
}

fn resolve_codex_executable(
    metadata: &serde_json::Map<String, serde_json::Value>,
) -> Result<PathBuf, String> {
    if let Some(path) = first_metadata_string(metadata, &["codexExecutablePath", "codexExecutable"])
    {
        return validate_configured_codex_executable(&path);
    }

    let path_env = std::env::var_os("PATH").ok_or_else(|| {
        "Codex executable not found: PATH is not available and no codexExecutablePath was configured"
            .to_string()
    })?;

    resolve_codex_executable_from_path_env(&path_env).ok_or_else(|| {
        "Codex executable not found: install Codex CLI or configure codexExecutablePath".to_string()
    })
}

fn validate_configured_codex_executable(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Configured Codex executable path cannot be empty".to_string());
    }
    if looks_like_remote_path(trimmed) {
        return Err("Configured Codex executable must be a local filesystem path".to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("Configured Codex executable path must be absolute".to_string());
    }
    if !path.exists() {
        return Err(format!(
            "Configured Codex executable not found: {}",
            display_path(&path)
        ));
    }
    if path.is_dir() {
        return Err(format!(
            "Configured Codex executable is a directory: {}",
            display_path(&path)
        ));
    }

    path.canonicalize()
        .map_err(|e| format!("Configured Codex executable cannot be normalized: {e}"))
}

fn resolve_codex_executable_from_path_env(path_env: impl AsRef<OsStr>) -> Option<PathBuf> {
    std::env::split_paths(path_env.as_ref())
        .flat_map(|dir| {
            codex_executable_candidates()
                .iter()
                .map(move |name| dir.join(name))
        })
        .find(|path| path.is_file())
}

#[cfg(windows)]
fn codex_executable_candidates() -> &'static [&'static str] {
    &["codex.exe", "codex.cmd", "codex.bat", "codex"]
}

#[cfg(not(windows))]
fn codex_executable_candidates() -> &'static [&'static str] {
    &["codex"]
}

fn first_metadata_string(
    metadata: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .filter_map(|key| metadata.get(*key).and_then(serde_json::Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn looks_like_remote_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn format_local_path(path: &Path) -> String {
    strip_windows_extended_path_prefix(&path.to_string_lossy())
}

fn strip_windows_extended_path_prefix(path: &str) -> String {
    if let Some(stripped) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{stripped}");
    }

    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

fn start_turn_with_event_emitter(
    input: TurnStartInput,
    emit_event: ConversationEventEmitter,
    spawn_worker: bool,
) -> Result<ConversationTurn, String> {
    let prompt = input.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("Codex turn prompt cannot be empty".to_string());
    }
    let mcp_servers = read_mcp_projection_from_metadata(&input.metadata)?;

    let now = current_timestamp();
    let turn = ConversationTurn {
        id: format!("codex-turn-{}", uuid::Uuid::new_v4()),
        thread_id: input.thread_id.clone(),
        status: ConversationTurnStatus::Running,
        created_at: now,
        completed_at: None,
    };
    let user_item = ConversationItem {
        id: format!("codex-item-{}", uuid::Uuid::new_v4()),
        thread_id: input.thread_id.clone(),
        turn_id: Some(turn.id.clone()),
        item_type: ConversationItemType::Message,
        role: Some(ConversationRole::User),
        status: ConversationItemStatus::Completed,
        content: Some(prompt.clone()),
        summary: None,
        metadata: serde_json::Map::new(),
        created_at: now,
        completed_at: Some(now),
    };
    let assistant_item = ConversationItem {
        id: format!("codex-item-{}", uuid::Uuid::new_v4()),
        thread_id: input.thread_id.clone(),
        turn_id: Some(turn.id.clone()),
        item_type: ConversationItemType::Message,
        role: Some(ConversationRole::Assistant),
        status: ConversationItemStatus::Running,
        content: None,
        summary: None,
        metadata: serde_json::Map::new(),
        created_at: now,
        completed_at: None,
    };

    let request = {
        let mut runtime = lock_runtime()?;
        let thread_runtime = runtime
            .get_mut(&input.thread_id)
            .ok_or_else(|| "Codex thread not found".to_string())?;
        if thread_runtime.thread.status == ConversationThreadStatus::Running {
            return Err("Codex thread already has a running turn".to_string());
        }

        thread_runtime.thread.status = ConversationThreadStatus::Running;
        thread_runtime.thread.updated_at = now;
        thread_runtime.turns.push(turn.clone());
        thread_runtime.items.push(user_item.clone());
        thread_runtime.items.push(assistant_item.clone());
        thread_runtime.running_turn = Some(RunningCodexTurn {
            turn_id: turn.id.clone(),
            assistant_item_id: assistant_item.id.clone(),
            child: None,
        });

        CodexExecRequest {
            executable_path: thread_runtime.executable_path.clone(),
            cwd: thread_runtime.thread.cwd.clone(),
            prompt,
            model: input.model.or_else(|| thread_runtime.model.clone()),
            approval_policy: input
                .approval_policy
                .or_else(|| thread_runtime.approval_policy.clone()),
            sandbox_policy: input
                .sandbox_policy
                .or_else(|| thread_runtime.sandbox_policy.clone()),
            mcp_servers: mcp_servers.clone(),
            output_path: make_codex_output_path(&turn.id),
        }
    };

    let mut turn_started_metadata = json_map(json!({
        "cwd": request.cwd,
        "model": request.model,
    }));
    append_safe_mcp_projection_summary(&mut turn_started_metadata, &mcp_servers);
    emit_event(make_event(
        &input.thread_id,
        Some(&turn.id),
        ConversationEventType::TurnStarted,
        None,
        None,
        None,
        turn_started_metadata,
    ));
    emit_event(make_event(
        &input.thread_id,
        Some(&turn.id),
        ConversationEventType::ItemCompleted,
        Some(user_item),
        None,
        None,
        serde_json::Map::new(),
    ));
    emit_event(make_event(
        &input.thread_id,
        Some(&turn.id),
        ConversationEventType::ItemStarted,
        Some(assistant_item.clone()),
        None,
        None,
        serde_json::Map::new(),
    ));

    if spawn_worker {
        let thread_id = input.thread_id.clone();
        let turn_id = turn.id.clone();
        let assistant_item_id = assistant_item.id.clone();
        thread::spawn(move || {
            run_codex_turn_worker(request, thread_id, turn_id, assistant_item_id, emit_event);
        });
    }

    Ok(turn)
}

fn interrupt_turn_with_event_emitter(
    thread_id: String,
    turn_id: String,
    emit_event: ConversationEventEmitter,
) -> Result<(), String> {
    let child = {
        let mut runtime = lock_runtime()?;
        let thread_runtime = runtime
            .get_mut(&thread_id)
            .ok_or_else(|| "Codex thread not found".to_string())?;
        let running_turn = thread_runtime
            .running_turn
            .as_ref()
            .ok_or_else(|| "Codex turn is not running".to_string())?;
        if running_turn.turn_id != turn_id {
            return Err("Codex turn is not running".to_string());
        }
        running_turn.child.clone()
    };

    if let Some(child) = child {
        let mut child = child
            .lock()
            .map_err(|_| "Codex child process lock poisoned".to_string())?;
        let _ = child.kill();
    }

    mark_codex_turn_interrupted(&thread_id, &turn_id, &emit_event)?;
    Ok(())
}

fn run_codex_turn_worker(
    request: CodexExecRequest,
    thread_id: String,
    turn_id: String,
    assistant_item_id: String,
    emit_event: ConversationEventEmitter,
) {
    let result = run_codex_exec(
        &request,
        &thread_id,
        &turn_id,
        &assistant_item_id,
        &emit_event,
    );
    match result {
        Ok(content) => complete_codex_turn(
            &thread_id,
            &turn_id,
            &assistant_item_id,
            content,
            &emit_event,
        ),
        Err(message) => fail_codex_turn(
            &thread_id,
            &turn_id,
            &assistant_item_id,
            message,
            &emit_event,
        ),
    }
    let _ = std::fs::remove_file(&request.output_path);
}

fn run_codex_exec(
    request: &CodexExecRequest,
    thread_id: &str,
    turn_id: &str,
    assistant_item_id: &str,
    emit_event: &ConversationEventEmitter,
) -> Result<String, String> {
    let args = build_codex_exec_args(request);
    let child = Command::new(&request.executable_path)
        .args(&args)
        .current_dir(&request.cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start Codex CLI: {e}"))?;
    let child = Arc::new(Mutex::new(child));
    attach_running_child(thread_id, turn_id, Arc::clone(&child))?;

    let stdout = {
        let mut child = child
            .lock()
            .map_err(|_| "Codex child process lock poisoned".to_string())?;
        child.stdout.take()
    };

    if let Some(stdout) = stdout {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(approval) = extract_codex_approval_request(
                &line,
                thread_id,
                Some(turn_id),
                Some(assistant_item_id),
                &request.cwd,
            ) {
                record_approval_request(approval, emit_event)?;
                continue;
            }
            if let Some(delta) = extract_codex_output_text(&line) {
                append_assistant_delta(thread_id, turn_id, assistant_item_id, &delta, emit_event);
            }
        }
    }

    let status = child
        .lock()
        .map_err(|_| "Codex child process lock poisoned".to_string())?
        .wait()
        .map_err(|e| format!("Failed to wait for Codex CLI: {e}"))?;
    if !status.success() {
        return Err(format!(
            "Codex CLI exited with status {}",
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ));
    }

    let output = std::fs::read_to_string(&request.output_path).unwrap_or_default();
    let output = output.trim().to_string();
    if !output.is_empty() {
        return Ok(output);
    }

    Ok(read_assistant_content(thread_id, assistant_item_id).unwrap_or_default())
}

fn build_codex_exec_args(request: &CodexExecRequest) -> Vec<String> {
    let mut args = vec![
        "exec".to_string(),
        "--json".to_string(),
        "-C".to_string(),
        request.cwd.clone(),
        "--skip-git-repo-check".to_string(),
    ];

    if let Some(model) = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        args.push("-m".to_string());
        args.push(model.to_string());
    }
    if let Some(sandbox) = request
        .sandbox_policy
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        args.push("-s".to_string());
        args.push(sandbox.to_string());
    }
    if let Some(approval_policy) = request
        .approval_policy
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        args.push("-c".to_string());
        args.push(format!(
            "approval_policy={}",
            encode_toml_string(approval_policy)
        ));
    }
    for server in &request.mcp_servers {
        if let Some(config) = encode_mcp_server_config_override(server) {
            args.push("-c".to_string());
            args.push(format!(
                "mcp_servers.{}={config}",
                encode_toml_key_segment(&server.server_id)
            ));
        }
    }

    args.push("-o".to_string());
    args.push(request.output_path.to_string_lossy().to_string());
    args.push(request.prompt.clone());
    args
}

fn attach_running_child(
    thread_id: &str,
    turn_id: &str,
    child: Arc<Mutex<Child>>,
) -> Result<(), String> {
    let mut runtime = lock_runtime()?;
    let thread_runtime = runtime
        .get_mut(thread_id)
        .ok_or_else(|| "Codex thread not found".to_string())?;
    let running_turn = thread_runtime
        .running_turn
        .as_mut()
        .ok_or_else(|| "Codex turn is not running".to_string())?;
    if running_turn.turn_id != turn_id {
        return Err("Codex turn is not running".to_string());
    }
    running_turn.child = Some(child);
    Ok(())
}

fn append_assistant_delta(
    thread_id: &str,
    turn_id: &str,
    assistant_item_id: &str,
    delta: &str,
    emit_event: &ConversationEventEmitter,
) {
    if delta.is_empty() {
        return;
    }
    let now = current_timestamp();
    if let Ok(mut runtime) = lock_runtime() {
        if let Some(thread_runtime) = runtime.get_mut(thread_id) {
            if let Some(item) = thread_runtime
                .items
                .iter_mut()
                .find(|item| item.id == assistant_item_id)
            {
                let next_content =
                    format!("{}{}", item.content.as_deref().unwrap_or_default(), delta);
                item.content = Some(next_content);
                item.status = ConversationItemStatus::Running;
            }
            thread_runtime.thread.updated_at = now;
        }
    }

    emit_event(make_event(
        thread_id,
        Some(turn_id),
        ConversationEventType::ItemDelta,
        None,
        None,
        Some(delta.to_string()),
        json_map(json!({ "itemId": assistant_item_id })),
    ));
}

fn complete_codex_turn(
    thread_id: &str,
    turn_id: &str,
    assistant_item_id: &str,
    content: String,
    emit_event: &ConversationEventEmitter,
) {
    let now = current_timestamp();
    let completed_item = {
        let mut runtime = match lock_runtime() {
            Ok(runtime) => runtime,
            Err(message) => {
                emit_turn_failed(thread_id, turn_id, message, emit_event);
                return;
            }
        };
        let Some(thread_runtime) = runtime.get_mut(thread_id) else {
            emit_turn_failed(
                thread_id,
                turn_id,
                "Codex thread not found".to_string(),
                emit_event,
            );
            return;
        };
        if thread_runtime
            .running_turn
            .as_ref()
            .is_some_and(|running_turn| running_turn.turn_id != turn_id)
        {
            return;
        }
        thread_runtime.thread.status = ConversationThreadStatus::Idle;
        thread_runtime.thread.updated_at = now;
        thread_runtime.running_turn = None;
        if let Some(turn) = thread_runtime
            .turns
            .iter_mut()
            .find(|turn| turn.id == turn_id)
        {
            turn.status = ConversationTurnStatus::Completed;
            turn.completed_at = Some(now);
        }
        let Some(item) = thread_runtime
            .items
            .iter_mut()
            .find(|item| item.id == assistant_item_id)
        else {
            emit_turn_failed(
                thread_id,
                turn_id,
                "Codex assistant item not found".to_string(),
                emit_event,
            );
            return;
        };
        if !content.is_empty() {
            item.content = Some(content);
        }
        item.status = ConversationItemStatus::Completed;
        item.completed_at = Some(now);
        item.clone()
    };

    emit_event(make_event(
        thread_id,
        Some(turn_id),
        ConversationEventType::ItemCompleted,
        Some(completed_item),
        None,
        None,
        serde_json::Map::new(),
    ));
    emit_event(make_event(
        thread_id,
        Some(turn_id),
        ConversationEventType::TurnCompleted,
        None,
        None,
        None,
        serde_json::Map::new(),
    ));
}

fn fail_codex_turn(
    thread_id: &str,
    turn_id: &str,
    assistant_item_id: &str,
    message: String,
    emit_event: &ConversationEventEmitter,
) {
    let now = current_timestamp();
    if let Ok(mut runtime) = lock_runtime() {
        if let Some(thread_runtime) = runtime.get_mut(thread_id) {
            if thread_runtime
                .running_turn
                .as_ref()
                .is_some_and(|running_turn| running_turn.turn_id != turn_id)
            {
                return;
            }
            thread_runtime.thread.status = ConversationThreadStatus::Failed;
            thread_runtime.thread.updated_at = now;
            thread_runtime.running_turn = None;
            if let Some(turn) = thread_runtime
                .turns
                .iter_mut()
                .find(|turn| turn.id == turn_id)
            {
                turn.status = ConversationTurnStatus::Failed;
                turn.completed_at = Some(now);
            }
            if let Some(item) = thread_runtime
                .items
                .iter_mut()
                .find(|item| item.id == assistant_item_id)
            {
                item.status = ConversationItemStatus::Failed;
                item.completed_at = Some(now);
            }
        }
    }

    emit_turn_failed(thread_id, turn_id, message, emit_event);
}

fn mark_codex_turn_interrupted(
    thread_id: &str,
    turn_id: &str,
    emit_event: &ConversationEventEmitter,
) -> Result<(), String> {
    let now = current_timestamp();
    let interrupted_item = {
        let mut runtime = lock_runtime()?;
        let thread_runtime = runtime
            .get_mut(thread_id)
            .ok_or_else(|| "Codex thread not found".to_string())?;
        let running_turn = thread_runtime
            .running_turn
            .take()
            .ok_or_else(|| "Codex turn is not running".to_string())?;
        if running_turn.turn_id != turn_id {
            return Err("Codex turn is not running".to_string());
        }
        thread_runtime.thread.status = ConversationThreadStatus::Interrupted;
        thread_runtime.thread.updated_at = now;
        if let Some(turn) = thread_runtime
            .turns
            .iter_mut()
            .find(|turn| turn.id == turn_id)
        {
            turn.status = ConversationTurnStatus::Interrupted;
            turn.completed_at = Some(now);
        }
        let Some(item) = thread_runtime
            .items
            .iter_mut()
            .find(|item| item.id == running_turn.assistant_item_id)
        else {
            return Err("Codex assistant item not found".to_string());
        };
        item.status = ConversationItemStatus::Failed;
        item.completed_at = Some(now);
        item.clone()
    };

    emit_event(make_event(
        thread_id,
        Some(turn_id),
        ConversationEventType::ItemCompleted,
        Some(interrupted_item),
        None,
        None,
        serde_json::Map::new(),
    ));
    emit_event(make_event(
        thread_id,
        Some(turn_id),
        ConversationEventType::TurnInterrupted,
        None,
        None,
        None,
        serde_json::Map::new(),
    ));
    Ok(())
}

fn emit_turn_failed(
    thread_id: &str,
    turn_id: &str,
    message: String,
    emit_event: &ConversationEventEmitter,
) {
    emit_event(make_event(
        thread_id,
        Some(turn_id),
        ConversationEventType::TurnFailed,
        None,
        None,
        Some(message),
        serde_json::Map::new(),
    ));
}

fn read_assistant_content(thread_id: &str, assistant_item_id: &str) -> Option<String> {
    lock_runtime().ok().and_then(|runtime| {
        runtime.get(thread_id).and_then(|thread_runtime| {
            thread_runtime
                .items
                .iter()
                .find(|item| item.id == assistant_item_id)
                .and_then(|item| item.content.clone())
        })
    })
}

fn extract_codex_approval_request(
    line: &str,
    thread_id: &str,
    turn_id: Option<&str>,
    item_id: Option<&str>,
    fallback_cwd: &str,
) -> Option<ApprovalRequest> {
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    extract_approval_request_from_value(&value, thread_id, turn_id, item_id, fallback_cwd)
}

fn extract_approval_request_from_value(
    value: &serde_json::Value,
    thread_id: &str,
    turn_id: Option<&str>,
    item_id: Option<&str>,
    fallback_cwd: &str,
) -> Option<ApprovalRequest> {
    let object = value.as_object()?;
    let event_type = object
        .get("type")
        .or_else(|| object.get("eventType"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !event_type.contains("approval") || !event_type.contains("request") {
        return None;
    }

    let payload = object
        .get("payload")
        .or_else(|| object.get("data"))
        .or_else(|| object.get("item"))
        .and_then(serde_json::Value::as_object)
        .unwrap_or(object);
    let request_type = read_approval_request_type(payload, object)?;
    let approval_id = first_json_string(payload, object, &["id", "approvalId", "approval_id"])
        .unwrap_or_else(|| format!("codex-approval-{}", uuid::Uuid::new_v4()));
    let command = first_json_string(
        payload,
        object,
        &["command", "shellCommand", "shell_command"],
    )
    .or_else(|| command_array_to_string(first_json_value(payload, object, &["command"])?));
    let cwd = first_json_string(
        payload,
        object,
        &["cwd", "workdir", "workingDirectory", "working_directory"],
    )
    .or_else(|| {
        if fallback_cwd.trim().is_empty() {
            None
        } else {
            Some(fallback_cwd.to_string())
        }
    });
    let body = first_json_string(
        payload,
        object,
        &["body", "reason", "message", "description", "prompt"],
    );
    let title = first_json_string(payload, object, &["title"])
        .unwrap_or_else(|| default_approval_title(&request_type).to_string());
    let tool_name = first_json_string(payload, object, &["toolName", "tool_name", "tool", "name"]);

    Some(ApprovalRequest {
        id: approval_id,
        thread_id: thread_id.to_string(),
        turn_id: turn_id.map(ToString::to_string),
        item_id: item_id.map(ToString::to_string),
        request_type,
        title,
        body,
        command,
        cwd,
        tool_name,
        metadata: build_approval_metadata(payload, object),
        created_at: current_timestamp(),
    })
}

fn read_approval_request_type(
    payload: &serde_json::Map<String, serde_json::Value>,
    root: &serde_json::Map<String, serde_json::Value>,
) -> Option<ApprovalRequestType> {
    if let Some(raw) = first_json_string(payload, root, &["requestType", "request_type", "type"]) {
        let normalized = raw.replace('-', "_").to_ascii_lowercase();
        if normalized.contains("file") || normalized.contains("patch") {
            return Some(ApprovalRequestType::FileChange);
        }
        if normalized.contains("mcp") || normalized.contains("tool") {
            return Some(ApprovalRequestType::McpTool);
        }
        if normalized.contains("user_input") || normalized.contains("input") {
            return Some(ApprovalRequestType::UserInput);
        }
        if normalized.contains("command")
            || normalized.contains("exec")
            || normalized.contains("shell")
        {
            return Some(ApprovalRequestType::Command);
        }
    }

    if first_json_value(payload, root, &["command", "shellCommand", "shell_command"]).is_some() {
        return Some(ApprovalRequestType::Command);
    }
    if first_json_value(
        payload,
        root,
        &["filePath", "file_path", "path", "diffSummary"],
    )
    .is_some()
    {
        return Some(ApprovalRequestType::FileChange);
    }
    if first_json_value(payload, root, &["options", "choices", "prompt"]).is_some() {
        return Some(ApprovalRequestType::UserInput);
    }
    if first_json_value(payload, root, &["toolName", "tool_name", "tool"]).is_some() {
        return Some(ApprovalRequestType::McpTool);
    }
    None
}

fn default_approval_title(request_type: &ApprovalRequestType) -> &'static str {
    match request_type {
        ApprovalRequestType::Command => "Run command",
        ApprovalRequestType::FileChange => "Apply file change",
        ApprovalRequestType::McpTool => "Run MCP tool",
        ApprovalRequestType::UserInput => "User input requested",
    }
}

fn build_approval_metadata(
    payload: &serde_json::Map<String, serde_json::Value>,
    root: &serde_json::Map<String, serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut metadata = serde_json::Map::new();
    copy_string_metadata(
        &mut metadata,
        payload,
        root,
        "filePath",
        &["filePath", "file_path", "path"],
    );
    copy_string_metadata(
        &mut metadata,
        payload,
        root,
        "diffSummary",
        &["diffSummary", "diff_summary", "summary"],
    );
    copy_string_metadata(
        &mut metadata,
        payload,
        root,
        "prompt",
        &["prompt", "question", "label"],
    );
    if let Some(options) =
        first_json_value(payload, root, &["options", "choices"]).and_then(string_array_value)
    {
        metadata.insert("options".to_string(), options);
    }
    metadata
}

fn copy_string_metadata(
    metadata: &mut serde_json::Map<String, serde_json::Value>,
    payload: &serde_json::Map<String, serde_json::Value>,
    root: &serde_json::Map<String, serde_json::Value>,
    output_key: &str,
    keys: &[&str],
) {
    if let Some(value) = first_json_string(payload, root, keys) {
        metadata.insert(output_key.to_string(), serde_json::Value::String(value));
    }
}

fn first_json_string(
    payload: &serde_json::Map<String, serde_json::Value>,
    root: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    first_json_value(payload, root, keys).and_then(json_value_to_string)
}

fn first_json_value<'a>(
    payload: &'a serde_json::Map<String, serde_json::Value>,
    root: &'a serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<&'a serde_json::Value> {
    keys.iter()
        .find_map(|key| payload.get(*key).or_else(|| root.get(*key)))
}

fn json_value_to_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        serde_json::Value::Number(value) => Some(value.to_string()),
        serde_json::Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn command_array_to_string(value: &serde_json::Value) -> Option<String> {
    let values = value.as_array()?;
    let command = values
        .iter()
        .filter_map(json_value_to_string)
        .collect::<Vec<_>>()
        .join(" ");
    if command.trim().is_empty() {
        None
    } else {
        Some(command)
    }
}

fn string_array_value(value: &serde_json::Value) -> Option<serde_json::Value> {
    let options = value
        .as_array()?
        .iter()
        .filter_map(json_value_to_string)
        .filter(|value| !value.trim().is_empty())
        .map(serde_json::Value::String)
        .collect::<Vec<_>>();
    if options.is_empty() {
        None
    } else {
        Some(serde_json::Value::Array(options))
    }
}

fn record_approval_request(
    approval: ApprovalRequest,
    emit_event: &ConversationEventEmitter,
) -> Result<(), String> {
    let thread_id = approval.thread_id.clone();
    let turn_id = approval.turn_id.clone();
    let now = current_timestamp();
    {
        let mut runtime = lock_runtime()?;
        let thread_runtime = runtime
            .get_mut(&thread_id)
            .ok_or_else(|| "Codex thread not found".to_string())?;
        thread_runtime
            .pending_approvals
            .retain(|pending| pending.id != approval.id);
        thread_runtime.pending_approvals.push(approval.clone());
        thread_runtime.thread.status = ConversationThreadStatus::Running;
        thread_runtime.thread.updated_at = now;
        if let Some(turn_id) = turn_id.as_deref() {
            if let Some(turn) = thread_runtime
                .turns
                .iter_mut()
                .find(|turn| turn.id == turn_id)
            {
                turn.status = ConversationTurnStatus::WaitingApproval;
            }
        }
    }

    emit_event(make_event(
        &thread_id,
        turn_id.as_deref(),
        ConversationEventType::ApprovalRequested,
        None,
        Some(approval),
        None,
        serde_json::Map::new(),
    ));
    Ok(())
}

fn respond_approval_with_event_emitter(
    input: ApprovalResponseInput,
    emit_event: ConversationEventEmitter,
) -> Result<(), String> {
    let target_thread_id = first_metadata_string(&input.metadata, &["threadId", "thread_id"]);
    let (thread_id, turn_id, request_type) = {
        let mut runtime = lock_runtime()?;
        let resolved = if let Some(thread_id) = target_thread_id {
            let thread_runtime = runtime
                .get_mut(&thread_id)
                .ok_or_else(|| "Codex approval not found".to_string())?;
            remove_pending_approval(thread_runtime, &input.approval_id)
                .map(|approval| (thread_id, approval))
        } else {
            runtime.iter_mut().find_map(|(thread_id, thread_runtime)| {
                remove_pending_approval(thread_runtime, &input.approval_id)
                    .map(|approval| (thread_id.clone(), approval))
            })
        };
        let (thread_id, approval) =
            resolved.ok_or_else(|| "Codex approval not found".to_string())?;
        if let Some(thread_runtime) = runtime.get_mut(&thread_id) {
            thread_runtime.thread.updated_at = current_timestamp();
            if let Some(turn_id) = approval.turn_id.as_deref() {
                if !thread_runtime
                    .pending_approvals
                    .iter()
                    .any(|pending| pending.turn_id.as_deref() == Some(turn_id))
                {
                    if let Some(turn) = thread_runtime
                        .turns
                        .iter_mut()
                        .find(|turn| turn.id == turn_id)
                    {
                        if turn.status == ConversationTurnStatus::WaitingApproval {
                            turn.status = ConversationTurnStatus::Running;
                        }
                    }
                }
            }
        }
        (thread_id, approval.turn_id, approval.request_type)
    };

    let mut metadata = json_map(json!({
        "approvalId": input.approval_id,
        "decision": approval_decision_label(&input.decision),
        "requestType": request_type,
    }));
    if let Some(message) = input
        .message
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        metadata.insert(
            "message".to_string(),
            serde_json::Value::String(message.to_string()),
        );
    }

    let mut event = make_event(
        &thread_id,
        turn_id.as_deref(),
        ConversationEventType::ApprovalResolved,
        None,
        None,
        None,
        metadata,
    );
    event.approval_id = Some(input.approval_id);
    emit_event(event);
    Ok(())
}

fn remove_pending_approval(
    thread_runtime: &mut CodexThreadRuntime,
    approval_id: &str,
) -> Option<ApprovalRequest> {
    let index = thread_runtime
        .pending_approvals
        .iter()
        .position(|approval| approval.id == approval_id)?;
    Some(thread_runtime.pending_approvals.remove(index))
}

fn approval_decision_label(decision: &ApprovalDecision) -> &'static str {
    match decision {
        ApprovalDecision::Approved => "approved",
        ApprovalDecision::Denied => "denied",
    }
}

fn extract_codex_output_text(line: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    extract_text_delta_from_value(&value)
}

fn extract_text_delta_from_value(value: &serde_json::Value) -> Option<String> {
    let object = value.as_object()?;
    let event_type = object
        .get("type")
        .or_else(|| object.get("eventType"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let is_text_event = event_type.contains("delta")
        || event_type.contains("message")
        || event_type.contains("output_text");
    if !is_text_event {
        return None;
    }

    for key in ["delta", "text", "content", "message"] {
        if let Some(text) = object.get(key).and_then(serde_json::Value::as_str) {
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }

    object
        .get("item")
        .or_else(|| object.get("payload"))
        .or_else(|| object.get("data"))
        .and_then(extract_text_delta_from_value)
}

fn make_codex_output_path(turn_id: &str) -> PathBuf {
    std::env::temp_dir().join(format!("{turn_id}-codex-last-message.txt"))
}

fn make_event(
    thread_id: &str,
    turn_id: Option<&str>,
    event_type: ConversationEventType,
    item: Option<ConversationItem>,
    approval_request: Option<ApprovalRequest>,
    delta: Option<String>,
    metadata: serde_json::Map<String, serde_json::Value>,
) -> ConversationEvent {
    ConversationEvent {
        id: format!("codex-event-{}", uuid::Uuid::new_v4()),
        thread_id: thread_id.to_string(),
        turn_id: turn_id.map(ToString::to_string),
        approval_id: approval_request
            .as_ref()
            .map(|approval| approval.id.clone()),
        event_type,
        item,
        approval_request,
        delta,
        metadata,
        created_at: current_timestamp(),
    }
}

fn json_map(value: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
    value.as_object().cloned().unwrap_or_default()
}

fn encode_toml_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn read_mcp_projection_from_metadata(
    metadata: &serde_json::Map<String, serde_json::Value>,
) -> Result<Vec<CodexMcpProjectionServer>, String> {
    let Some(value) = metadata.get("mcpServers") else {
        return Ok(Vec::new());
    };
    serde_json::from_value::<Vec<CodexMcpProjectionServer>>(value.clone())
        .map_err(|_| "Invalid Codex MCP projection metadata".to_string())
}

fn append_safe_mcp_projection_summary(
    metadata: &mut serde_json::Map<String, serde_json::Value>,
    mcp_servers: &[CodexMcpProjectionServer],
) {
    if mcp_servers.is_empty() {
        return;
    }

    metadata.insert("mcpServerCount".to_string(), json!(mcp_servers.len()));
    metadata.insert(
        "mcpServerIds".to_string(),
        json!(mcp_servers
            .iter()
            .map(|server| server.server_id.clone())
            .collect::<Vec<_>>()),
    );
    metadata.insert(
        "mcpServerNames".to_string(),
        json!(mcp_servers
            .iter()
            .map(|server| server.name.clone())
            .collect::<Vec<_>>()),
    );
}

fn encode_mcp_server_config_override(server: &CodexMcpProjectionServer) -> Option<String> {
    let value = json_value_to_toml_value(&server.server_config)?;
    match value {
        toml::Value::Table(table) => Some(toml::Value::Table(table).to_string()),
        _ => None,
    }
}

fn json_value_to_toml_value(value: &serde_json::Value) -> Option<toml::Value> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::Bool(value) => Some(toml::Value::Boolean(*value)),
        serde_json::Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                Some(toml::Value::Integer(value))
            } else {
                value.as_f64().map(toml::Value::Float)
            }
        }
        serde_json::Value::String(value) => Some(toml::Value::String(value.clone())),
        serde_json::Value::Array(values) => values
            .iter()
            .map(json_value_to_toml_value)
            .collect::<Option<Vec<_>>>()
            .map(toml::Value::Array),
        serde_json::Value::Object(values) => {
            let mut table = toml::map::Map::new();
            for (key, value) in values {
                if let Some(value) = json_value_to_toml_value(value) {
                    table.insert(key.clone(), value);
                }
            }
            Some(toml::Value::Table(table))
        }
    }
}

fn encode_toml_key_segment(value: &str) -> String {
    if is_bare_toml_key(value) {
        value.to_string()
    } else {
        encode_toml_string(value)
    }
}

fn is_bare_toml_key(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn resolve_codex_home() -> Result<PathBuf, String> {
    if let Some(value) = std::env::var_os("CODEX_HOME") {
        let path = PathBuf::from(value);
        if path.as_os_str().is_empty() {
            return Err("CODEX_HOME is empty".to_string());
        }
        return Ok(path);
    }

    dirs::home_dir()
        .map(|home| home.join(".codex"))
        .ok_or_else(|| "Home directory not found".to_string())
}

fn parse_codex_config_summary(
    content: &str,
    workspace_id: Option<String>,
    codex_home: &Path,
    config_path: &Path,
) -> Result<CodexConfigSummary, String> {
    let value = content
        .parse::<toml::Value>()
        .map_err(|e| format!("Failed to parse Codex config: {e}"))?;
    let table = value
        .as_table()
        .ok_or_else(|| "Codex config root must be a TOML table".to_string())?;

    Ok(CodexConfigSummary {
        workspace_id,
        codex_home: Some(codex_home.to_string_lossy().to_string()),
        config_path: Some(config_path.to_string_lossy().to_string()),
        config_exists: true,
        model: first_string(table, &["model"]),
        provider_id: first_string(table, &["model_provider", "provider_id"]),
        approval_policy: first_string(table, &["approval_policy", "approvalPolicy"]),
        sandbox_policy: first_string(table, &["sandbox_mode", "sandbox_policy", "sandboxPolicy"]),
        metadata: serde_json::from_value(json!({
            "source": "config.toml",
            "containsSensitiveValues": false
        }))
        .unwrap_or_default(),
    })
}

fn empty_config_summary(
    workspace_id: Option<String>,
    codex_home: &Path,
    config_path: &Path,
    config_exists: bool,
) -> CodexConfigSummary {
    CodexConfigSummary {
        workspace_id,
        codex_home: Some(codex_home.to_string_lossy().to_string()),
        config_path: Some(config_path.to_string_lossy().to_string()),
        config_exists,
        model: None,
        provider_id: None,
        approval_policy: None,
        sandbox_policy: None,
        metadata: serde_json::from_value(json!({
            "source": "config.toml",
            "containsSensitiveValues": false
        }))
        .unwrap_or_default(),
    }
}

fn first_string(table: &toml::Table, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| table.get(*key).and_then(toml::Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn build_codex_model_list(providers: &[Provider]) -> Vec<CodexModelInfo> {
    let mut seen = HashSet::new();
    let mut models = Vec::new();

    for provider in providers {
        for model in [
            provider.default_sonnet_model.as_deref(),
            provider.default_opus_model.as_deref(),
            provider.default_haiku_model.as_deref(),
            provider.default_reasoning_model.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            let model = model.trim();
            if model.is_empty() {
                continue;
            }
            let key = format!("{}::{model}", provider.id);
            if seen.insert(key) {
                models.push(CodexModelInfo {
                    id: model.to_string(),
                    name: model.to_string(),
                    provider_id: Some(provider.id.clone()),
                    supports_reasoning: provider.default_reasoning_model.as_deref() == Some(model),
                    supports_tools: true,
                });
            }
        }
    }

    models
}

#[cfg(test)]
mod tests {
    use super::{
        build_codex_exec_args, build_codex_model_list, extract_codex_approval_request,
        interrupt_turn_with_event_emitter, parse_codex_config_summary, record_approval_request,
        resolve_codex_executable_from_path_env, respond_approval_with_event_emitter, resume_thread,
        start_thread, start_turn_with_event_emitter, CodexExecRequest, CodexMcpProjectionServer,
        ConversationEventEmitter,
    };
    use crate::models::app_type::AppType;
    use crate::models::conversation::{
        ApprovalDecision, ApprovalRequestType, ApprovalResponseInput, ConversationEventType,
        ConversationItemStatus, ConversationItemType, ConversationRole, ConversationThreadStatus,
        ConversationTurnStatus, ThreadResumeInput, ThreadStartInput, TurnStartInput,
    };
    use crate::models::provider::Provider;
    use chrono::Utc;
    use serde_json::json;
    use std::fs;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    #[test]
    fn start_thread_rejects_missing_workspace_directory() {
        let missing_dir =
            std::env::temp_dir().join(format!("ccg-missing-cwd-{}", uuid::Uuid::new_v4()));

        let error = start_thread(ThreadStartInput {
            workspace_id: Some("workspace-1".to_string()),
            cwd: missing_dir.to_string_lossy().to_string(),
            model: None,
            provider_id: None,
            approval_policy: None,
            sandbox_policy: None,
            metadata: serde_json::Map::new(),
        })
        .expect_err("missing cwd should be rejected");

        assert!(error.contains("Codex thread cwd not found"));
    }

    #[test]
    fn start_thread_rejects_missing_configured_executable() {
        let cwd = create_temp_dir("missing-configured-executable-cwd");
        let missing_executable = cwd.join("missing-codex.cmd");

        let error = start_thread(ThreadStartInput {
            workspace_id: None,
            cwd: cwd.to_string_lossy().to_string(),
            model: None,
            provider_id: None,
            approval_policy: None,
            sandbox_policy: None,
            metadata: serde_json::from_value(json!({
                "codexExecutablePath": missing_executable.to_string_lossy()
            }))
            .unwrap(),
        })
        .expect_err("missing configured executable should be rejected");

        assert!(error.contains("Configured Codex executable not found"));

        fs::remove_dir_all(cwd).unwrap();
    }

    #[test]
    fn resolve_codex_executable_from_path_env_finds_codex_candidate() {
        let bin_dir = create_temp_dir("codex-path-bin");
        let executable = bin_dir.join(codex_test_executable_name());
        fs::write(&executable, "").unwrap();

        let found = resolve_codex_executable_from_path_env(bin_dir.as_os_str())
            .expect("codex candidate should be found");

        assert_eq!(found, executable);

        fs::remove_dir_all(bin_dir).unwrap();
    }

    #[test]
    fn start_thread_uses_configured_executable_and_can_read_snapshot() {
        let cwd = create_temp_dir("configured-executable-thread-cwd");
        let executable = cwd.join(codex_test_executable_name());
        fs::write(&executable, "").unwrap();

        let thread = start_thread(ThreadStartInput {
            workspace_id: Some("workspace-1".to_string()),
            cwd: cwd.to_string_lossy().to_string(),
            model: Some("gpt-5".to_string()),
            provider_id: Some("provider-1".to_string()),
            approval_policy: Some("on-request".to_string()),
            sandbox_policy: Some("workspace-write".to_string()),
            metadata: serde_json::from_value(json!({
                "codexExecutablePath": executable.to_string_lossy()
            }))
            .unwrap(),
        })
        .expect("configured executable should create an idle thread");

        assert_eq!(thread.workspace_id, Some("workspace-1".to_string()));
        assert_eq!(thread.cwd, cwd.to_string_lossy().to_string());
        assert_eq!(thread.status, ConversationThreadStatus::Idle);

        let snapshot = super::read_thread(thread.id.clone()).expect("thread should be readable");
        assert_eq!(snapshot.thread.id, thread.id);
        assert!(snapshot.items.is_empty());
        assert!(snapshot.pending_approvals.is_empty());

        fs::remove_dir_all(cwd).unwrap();
    }

    #[test]
    fn start_turn_initializes_user_and_assistant_items_and_emits_events() {
        let cwd = create_temp_dir("turn-lifecycle-cwd");
        let executable = cwd.join(codex_test_executable_name());
        fs::write(&executable, "").unwrap();
        let thread = start_thread(ThreadStartInput {
            workspace_id: Some("workspace-1".to_string()),
            cwd: cwd.to_string_lossy().to_string(),
            model: Some("gpt-5".to_string()),
            provider_id: Some("provider-1".to_string()),
            approval_policy: Some("on-request".to_string()),
            sandbox_policy: Some("workspace-write".to_string()),
            metadata: serde_json::from_value(json!({
                "codexExecutablePath": executable.to_string_lossy()
            }))
            .unwrap(),
        })
        .expect("thread should start");
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured_events = Arc::clone(&events);

        let turn = start_turn_with_event_emitter(
            TurnStartInput {
                thread_id: thread.id.clone(),
                prompt: "hello".to_string(),
                model: None,
                approval_policy: None,
                sandbox_policy: None,
                metadata: serde_json::Map::new(),
            },
            Arc::new(move |event| {
                captured_events.lock().unwrap().push(event);
            }),
            false,
        )
        .expect("turn should start");

        assert_eq!(turn.thread_id, thread.id);
        let snapshot = super::read_thread(thread.id.clone()).expect("thread should be readable");
        assert_eq!(snapshot.thread.status, ConversationThreadStatus::Running);
        assert_eq!(snapshot.items.len(), 2);
        assert_eq!(snapshot.items[0].item_type, ConversationItemType::Message);
        assert_eq!(snapshot.items[0].role, Some(ConversationRole::User));
        assert_eq!(snapshot.items[0].content, Some("hello".to_string()));
        assert_eq!(snapshot.items[1].role, Some(ConversationRole::Assistant));
        assert_eq!(snapshot.items[1].status, ConversationItemStatus::Running);

        let events = events.lock().unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].event_type, ConversationEventType::TurnStarted);
        assert_eq!(events[1].event_type, ConversationEventType::ItemCompleted);
        assert_eq!(events[2].event_type, ConversationEventType::ItemStarted);

        fs::remove_dir_all(cwd).unwrap();
    }

    #[test]
    fn interrupt_turn_marks_running_turn_interrupted_and_emits_events() {
        let cwd = create_temp_dir("interrupt-turn-cwd");
        let executable = cwd.join(codex_test_executable_name());
        fs::write(&executable, "").unwrap();
        let thread = start_thread(ThreadStartInput {
            workspace_id: Some("workspace-1".to_string()),
            cwd: cwd.to_string_lossy().to_string(),
            model: Some("gpt-5".to_string()),
            provider_id: Some("provider-1".to_string()),
            approval_policy: Some("on-request".to_string()),
            sandbox_policy: Some("workspace-write".to_string()),
            metadata: serde_json::from_value(json!({
                "codexExecutablePath": executable.to_string_lossy()
            }))
            .unwrap(),
        })
        .expect("thread should start");
        let events = Arc::new(Mutex::new(Vec::new()));
        let start_events = Arc::clone(&events);
        let turn = start_turn_with_event_emitter(
            TurnStartInput {
                thread_id: thread.id.clone(),
                prompt: "hello".to_string(),
                model: None,
                approval_policy: None,
                sandbox_policy: None,
                metadata: serde_json::Map::new(),
            },
            Arc::new(move |event| {
                start_events.lock().unwrap().push(event);
            }),
            false,
        )
        .expect("turn should start");
        let interrupt_events = Arc::clone(&events);

        interrupt_turn_with_event_emitter(
            thread.id.clone(),
            turn.id.clone(),
            Arc::new(move |event| {
                interrupt_events.lock().unwrap().push(event);
            }),
        )
        .expect("running turn should interrupt");

        let snapshot = super::read_thread(thread.id.clone()).expect("thread should be readable");
        assert_eq!(
            snapshot.thread.status,
            ConversationThreadStatus::Interrupted
        );
        assert_eq!(snapshot.items[1].status, ConversationItemStatus::Failed);
        let events = events.lock().unwrap();
        assert!(events
            .iter()
            .any(|event| event.event_type == ConversationEventType::TurnInterrupted));

        fs::remove_dir_all(cwd).unwrap();
    }

    #[test]
    fn resume_thread_returns_cached_thread() {
        let cwd = create_temp_dir("resume-cached-cwd");
        let executable = cwd.join(codex_test_executable_name());
        fs::write(&executable, "").unwrap();
        let thread = start_thread(ThreadStartInput {
            workspace_id: Some("workspace-1".to_string()),
            cwd: cwd.to_string_lossy().to_string(),
            model: Some("gpt-5".to_string()),
            provider_id: Some("provider-1".to_string()),
            approval_policy: Some("on-request".to_string()),
            sandbox_policy: Some("workspace-write".to_string()),
            metadata: serde_json::from_value(json!({
                "codexExecutablePath": executable.to_string_lossy()
            }))
            .unwrap(),
        })
        .expect("thread should start");

        let resumed = resume_thread(ThreadResumeInput {
            thread_id: thread.id.clone(),
            workspace_id: None,
            cwd: None,
            source_path: None,
            metadata: serde_json::Map::new(),
        })
        .expect("cached thread should resume");

        assert_eq!(resumed, thread);

        fs::remove_dir_all(cwd).unwrap();
    }

    #[test]
    fn resume_thread_creates_idle_runtime_for_uncached_thread_with_cwd() {
        let cwd = create_temp_dir("resume-uncached-cwd");
        let executable = cwd.join(codex_test_executable_name());
        fs::write(&executable, "").unwrap();

        let resumed = resume_thread(ThreadResumeInput {
            thread_id: format!("codex-thread-{}", uuid::Uuid::new_v4()),
            workspace_id: Some("workspace-1".to_string()),
            cwd: Some(cwd.to_string_lossy().to_string()),
            source_path: Some(r"C:\Users\tester\.codex\sessions\rollout.jsonl".to_string()),
            metadata: serde_json::from_value(json!({
                "codexExecutablePath": executable.to_string_lossy()
            }))
            .unwrap(),
        })
        .expect("uncached thread with cwd should create resumable runtime");

        assert_eq!(resumed.workspace_id, Some("workspace-1".to_string()));
        assert_eq!(resumed.cwd, cwd.to_string_lossy().to_string());
        assert_eq!(resumed.title, Some("rollout.jsonl".to_string()));
        assert_eq!(resumed.status, ConversationThreadStatus::Idle);
        let snapshot = super::read_thread(resumed.id.clone()).expect("thread should be readable");
        assert_eq!(snapshot.thread, resumed);

        fs::remove_dir_all(cwd).unwrap();
    }

    #[test]
    fn resume_thread_rejects_uncached_thread_without_cwd() {
        let error = resume_thread(ThreadResumeInput {
            thread_id: format!("codex-thread-{}", uuid::Uuid::new_v4()),
            workspace_id: Some("workspace-1".to_string()),
            cwd: None,
            source_path: Some(r"C:\Users\tester\.codex\sessions\rollout.jsonl".to_string()),
            metadata: serde_json::Map::new(),
        })
        .expect_err("uncached thread should require cwd");

        assert!(error.contains("requires cwd"));
    }

    #[test]
    fn start_turn_rejects_empty_prompt() {
        let error = start_turn_with_event_emitter(
            TurnStartInput {
                thread_id: "missing".to_string(),
                prompt: "   ".to_string(),
                model: None,
                approval_policy: None,
                sandbox_policy: None,
                metadata: serde_json::Map::new(),
            },
            Arc::new(|_| {}),
            false,
        )
        .expect_err("empty prompt should be rejected");

        assert!(error.contains("prompt cannot be empty"));
    }

    #[test]
    fn start_turn_rejects_unknown_thread() {
        let error = start_turn_with_event_emitter(
            TurnStartInput {
                thread_id: "missing".to_string(),
                prompt: "hello".to_string(),
                model: None,
                approval_policy: None,
                sandbox_policy: None,
                metadata: serde_json::Map::new(),
            },
            Arc::new(|_| {}),
            false,
        )
        .expect_err("unknown thread should be rejected");

        assert_eq!(error, "Codex thread not found");
    }

    #[test]
    fn build_codex_exec_args_preserves_policies_without_bypass_flag() {
        let request = CodexExecRequest {
            executable_path: Path::new(r"C:\tools\codex.cmd").to_path_buf(),
            cwd: r"C:\workspace".to_string(),
            prompt: "hello".to_string(),
            model: Some("gpt-5".to_string()),
            approval_policy: Some("on-request".to_string()),
            sandbox_policy: Some("workspace-write".to_string()),
            mcp_servers: Vec::new(),
            output_path: Path::new(r"C:\Temp\last-message.txt").to_path_buf(),
        };

        let args = build_codex_exec_args(&request);

        assert!(args.contains(&"exec".to_string()));
        assert!(args.contains(&"--json".to_string()));
        assert!(args.contains(&"-C".to_string()));
        assert!(args.contains(&r"C:\workspace".to_string()));
        assert!(args.contains(&"-m".to_string()));
        assert!(args.contains(&"gpt-5".to_string()));
        assert!(args.contains(&"-s".to_string()));
        assert!(args.contains(&"workspace-write".to_string()));
        assert!(args.contains(&"-c".to_string()));
        assert!(args.contains(&"approval_policy=\"on-request\"".to_string()));
        assert!(args.contains(&"-o".to_string()));
        assert!(args.contains(&r"C:\Temp\last-message.txt".to_string()));
        assert_eq!(args.last(), Some(&"hello".to_string()));
        assert!(!args
            .iter()
            .any(|arg| arg.contains("dangerously-bypass-approvals-and-sandbox")));
    }

    #[test]
    fn build_codex_exec_args_injects_mcp_servers_as_config_overrides() {
        let request = CodexExecRequest {
            executable_path: Path::new(r"C:\tools\codex.cmd").to_path_buf(),
            cwd: r"C:\workspace".to_string(),
            prompt: "hello".to_string(),
            model: None,
            approval_policy: None,
            sandbox_policy: None,
            mcp_servers: vec![
                CodexMcpProjectionServer {
                    server_id: "filesystem".to_string(),
                    name: "Filesystem".to_string(),
                    server_config: json!({
                        "command": "node",
                        "args": ["server.js"],
                        "env": { "TOKEN": "secret" }
                    }),
                },
                CodexMcpProjectionServer {
                    server_id: "with.dot".to_string(),
                    name: "Quoted".to_string(),
                    server_config: json!({ "command": "quoted" }),
                },
            ],
            output_path: Path::new(r"C:\Temp\last-message.txt").to_path_buf(),
        };

        let args = build_codex_exec_args(&request);

        assert!(args
            .iter()
            .any(|arg| arg.starts_with("mcp_servers.filesystem={")));
        assert!(args
            .iter()
            .any(|arg| arg.starts_with("mcp_servers.\"with.dot\"={")));
        assert!(args.iter().any(|arg| arg.contains("command = \"node\"")));
        assert!(args.iter().any(|arg| arg.contains("TOKEN = \"secret\"")));
    }

    #[test]
    fn start_turn_emits_safe_mcp_projection_summary_without_secrets() {
        let cwd = create_temp_dir("mcp-summary-cwd");
        let executable = cwd.join(codex_test_executable_name());
        fs::write(&executable, "").unwrap();
        let thread = start_thread(ThreadStartInput {
            workspace_id: Some("workspace-1".to_string()),
            cwd: cwd.to_string_lossy().to_string(),
            model: Some("gpt-5".to_string()),
            provider_id: Some("provider-1".to_string()),
            approval_policy: Some("on-request".to_string()),
            sandbox_policy: Some("workspace-write".to_string()),
            metadata: serde_json::from_value(json!({
                "codexExecutablePath": executable.to_string_lossy()
            }))
            .unwrap(),
        })
        .expect("thread should start");
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured_events = Arc::clone(&events);

        start_turn_with_event_emitter(
            TurnStartInput {
                thread_id: thread.id.clone(),
                prompt: "hello".to_string(),
                model: None,
                approval_policy: None,
                sandbox_policy: None,
                metadata: serde_json::from_value(json!({
                    "mcpServers": [
                        {
                            "serverId": "filesystem",
                            "name": "Filesystem",
                            "serverConfig": {
                                "command": "node",
                                "env": { "TOKEN": "secret" },
                                "headers": { "Authorization": "Bearer secret" }
                            }
                        },
                        {
                            "serverId": "git",
                            "name": "Git",
                            "serverConfig": { "command": "git-mcp" }
                        }
                    ]
                }))
                .unwrap(),
            },
            Arc::new(move |event| {
                captured_events.lock().unwrap().push(event);
            }),
            false,
        )
        .expect("turn should start");

        let events = events.lock().unwrap();
        let turn_started = events
            .iter()
            .find(|event| event.event_type == ConversationEventType::TurnStarted)
            .expect("turn_started should be emitted");
        assert_eq!(turn_started.metadata["mcpServerCount"], 2);
        assert_eq!(
            turn_started.metadata["mcpServerIds"],
            json!(["filesystem", "git"])
        );
        let metadata = serde_json::to_string(&turn_started.metadata).unwrap();
        assert!(!metadata.contains("secret"));
        assert!(!metadata.contains("TOKEN"));
        assert!(!metadata.contains("Authorization"));

        fs::remove_dir_all(cwd).unwrap();
    }

    #[test]
    fn parse_codex_approval_request_extracts_command() {
        let approval = extract_codex_approval_request(
            r#"{"type":"approval_requested","payload":{"id":"approval-1","type":"command","command":"npm run build","cwd":"C:\\guodevelop\\ccg-switch","reason":"Needs permission"}}"#,
            "thread-1",
            Some("turn-1"),
            Some("item-1"),
            r"C:\fallback",
        )
        .expect("command approval should parse");

        assert_eq!(approval.id, "approval-1");
        assert_eq!(approval.thread_id, "thread-1");
        assert_eq!(approval.turn_id, Some("turn-1".to_string()));
        assert_eq!(approval.item_id, Some("item-1".to_string()));
        assert_eq!(approval.request_type, ApprovalRequestType::Command);
        assert_eq!(approval.command, Some("npm run build".to_string()));
        assert_eq!(approval.cwd, Some(r"C:\guodevelop\ccg-switch".to_string()));
        assert_eq!(approval.body, Some("Needs permission".to_string()));
    }

    #[test]
    fn parse_codex_approval_request_extracts_file_change_metadata() {
        let approval = extract_codex_approval_request(
            r#"{"type":"approval_request","approvalId":"approval-file","requestType":"file_change","title":"Apply patch","filePath":"src/main.ts","diffSummary":"+1 -1" }"#,
            "thread-1",
            Some("turn-1"),
            None,
            r"C:\workspace",
        )
        .expect("file approval should parse");

        assert_eq!(approval.request_type, ApprovalRequestType::FileChange);
        assert_eq!(approval.title, "Apply patch");
        assert_eq!(approval.cwd, Some(r"C:\workspace".to_string()));
        assert_eq!(approval.metadata["filePath"], "src/main.ts");
        assert_eq!(approval.metadata["diffSummary"], "+1 -1");
    }

    #[test]
    fn record_approval_request_adds_pending_and_emits_event() {
        let cwd = create_temp_dir("approval-record-cwd");
        let executable = cwd.join(codex_test_executable_name());
        fs::write(&executable, "").unwrap();
        let thread = start_thread(ThreadStartInput {
            workspace_id: Some("workspace-1".to_string()),
            cwd: cwd.to_string_lossy().to_string(),
            model: None,
            provider_id: None,
            approval_policy: Some("on-request".to_string()),
            sandbox_policy: Some("workspace-write".to_string()),
            metadata: serde_json::from_value(json!({
                "codexExecutablePath": executable.to_string_lossy()
            }))
            .unwrap(),
        })
        .expect("thread should start");
        let turn = start_turn_with_event_emitter(
            TurnStartInput {
                thread_id: thread.id.clone(),
                prompt: "hello".to_string(),
                model: None,
                approval_policy: None,
                sandbox_policy: None,
                metadata: serde_json::Map::new(),
            },
            Arc::new(|_| {}),
            false,
        )
        .expect("turn should start");
        let approval = extract_codex_approval_request(
            r#"{"type":"approval_requested","payload":{"id":"approval-record","type":"command","command":"npm run build"}}"#,
            &thread.id,
            Some(&turn.id),
            None,
            &thread.cwd,
        )
        .expect("approval should parse");
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured_events = Arc::clone(&events);
        let emitter: ConversationEventEmitter = Arc::new(move |event| {
            captured_events.lock().unwrap().push(event);
        });

        record_approval_request(approval.clone(), &emitter).expect("approval should record");

        let snapshot = super::read_thread(thread.id.clone()).expect("thread should be readable");
        assert_eq!(snapshot.pending_approvals, vec![approval]);
        let turn_status = super::lock_runtime()
            .unwrap()
            .get(&thread.id)
            .unwrap()
            .turns
            .iter()
            .find(|candidate| candidate.id == turn.id)
            .unwrap()
            .status
            .clone();
        assert_eq!(turn_status, ConversationTurnStatus::WaitingApproval);
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event_type,
            ConversationEventType::ApprovalRequested
        );
        assert_eq!(events[0].approval_id, Some("approval-record".to_string()));

        fs::remove_dir_all(cwd).unwrap();
    }

    #[test]
    fn respond_approval_resolves_pending_and_emits_event() {
        let cwd = create_temp_dir("approval-respond-cwd");
        let executable = cwd.join(codex_test_executable_name());
        fs::write(&executable, "").unwrap();
        let thread = start_thread(ThreadStartInput {
            workspace_id: Some("workspace-1".to_string()),
            cwd: cwd.to_string_lossy().to_string(),
            model: None,
            provider_id: None,
            approval_policy: Some("on-request".to_string()),
            sandbox_policy: Some("workspace-write".to_string()),
            metadata: serde_json::from_value(json!({
                "codexExecutablePath": executable.to_string_lossy()
            }))
            .unwrap(),
        })
        .expect("thread should start");
        let turn = start_turn_with_event_emitter(
            TurnStartInput {
                thread_id: thread.id.clone(),
                prompt: "hello".to_string(),
                model: None,
                approval_policy: None,
                sandbox_policy: None,
                metadata: serde_json::Map::new(),
            },
            Arc::new(|_| {}),
            false,
        )
        .expect("turn should start");
        let approval = extract_codex_approval_request(
            r#"{"type":"approval_requested","payload":{"id":"approval-resolve","type":"user_input","prompt":"Choose","options":["A","B"]}}"#,
            &thread.id,
            Some(&turn.id),
            None,
            &thread.cwd,
        )
        .expect("approval should parse");
        let record_emitter: ConversationEventEmitter = Arc::new(|_| {});
        record_approval_request(approval, &record_emitter).expect("approval should record");
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured_events = Arc::clone(&events);

        respond_approval_with_event_emitter(
            ApprovalResponseInput {
                approval_id: "approval-resolve".to_string(),
                decision: ApprovalDecision::Approved,
                message: Some("A".to_string()),
                metadata: serde_json::from_value(json!({
                    "threadId": thread.id.clone()
                }))
                .unwrap(),
            },
            Arc::new(move |event| {
                captured_events.lock().unwrap().push(event);
            }),
        )
        .expect("approval should resolve");

        let snapshot = super::read_thread(thread.id.clone()).expect("thread should be readable");
        assert!(snapshot.pending_approvals.is_empty());
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event_type,
            ConversationEventType::ApprovalResolved
        );
        assert_eq!(events[0].approval_id, Some("approval-resolve".to_string()));
        assert_eq!(events[0].metadata["decision"], "approved");
        assert_eq!(events[0].metadata["message"], "A");

        fs::remove_dir_all(cwd).unwrap();
    }

    #[test]
    fn respond_approval_rejects_missing_approval() {
        let error = respond_approval_with_event_emitter(
            ApprovalResponseInput {
                approval_id: "missing-approval".to_string(),
                decision: ApprovalDecision::Denied,
                message: None,
                metadata: serde_json::Map::new(),
            },
            Arc::new(|_| {}),
        )
        .expect_err("missing approval should fail");

        assert!(error.contains("Codex approval not found"));
    }

    fn create_temp_dir(name: &str) -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("ccg-codex-{}-{}", name, uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[cfg(windows)]
    fn codex_test_executable_name() -> &'static str {
        "codex.cmd"
    }

    #[cfg(not(windows))]
    fn codex_test_executable_name() -> &'static str {
        "codex"
    }

    #[test]
    fn parse_codex_config_summary_only_returns_safe_fields() {
        let summary = parse_codex_config_summary(
            r#"
model_provider = "newapi"
model = "gpt-5"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[model_providers.newapi]
base_url = "https://example.com/v1"
env_key = "OPENAI_API_KEY"
"#,
            Some("workspace-1".to_string()),
            Path::new(r"C:\Users\tester\.codex"),
            Path::new(r"C:\Users\tester\.codex\config.toml"),
        )
        .expect("safe summary should parse");

        assert_eq!(summary.workspace_id, Some("workspace-1".to_string()));
        assert!(summary.config_exists);
        assert_eq!(summary.model, Some("gpt-5".to_string()));
        assert_eq!(summary.provider_id, Some("newapi".to_string()));
        assert_eq!(summary.approval_policy, Some("on-request".to_string()));
        assert_eq!(summary.sandbox_policy, Some("workspace-write".to_string()));
        assert!(!summary.metadata.contains_key("base_url"));
        assert!(!summary.metadata.contains_key("env_key"));
    }

    #[test]
    fn build_codex_model_list_uses_provider_defaults_without_api_key() {
        let provider = Provider {
            id: "provider-1".to_string(),
            name: "Provider".to_string(),
            app_type: AppType::Codex,
            api_key: "secret-key".to_string(),
            url: Some("https://example.com".to_string()),
            default_sonnet_model: Some("gpt-5".to_string()),
            default_opus_model: Some("gpt-5".to_string()),
            default_haiku_model: None,
            default_reasoning_model: Some("o4-mini".to_string()),
            custom_params: None,
            settings_config: None,
            meta: None,
            icon: None,
            in_failover_queue: false,
            description: None,
            tags: None,
            is_active: true,
            created_at: Utc::now(),
            last_used: None,
            proxy_config: None,
        };

        let models = build_codex_model_list(&[provider]);

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-5");
        assert_eq!(models[0].provider_id, Some("provider-1".to_string()));
        assert!(!models[0].supports_reasoning);
        assert_eq!(models[1].id, "o4-mini");
        assert!(models[1].supports_reasoning);
    }
}
