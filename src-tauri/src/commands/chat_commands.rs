//! Tauri commands for interactive chat (Claude Code / Codex).
//!
//! Thin command layer: parse args, delegate to ChatManager, map errors to
//! String. Follows the project's command-layer convention.

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, State};

use crate::chat::ChatManager;

/// 当前聊天工作目录的只读工作区状态。
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
pub struct ChatWorkspaceStatus {
    pub is_git_repository: bool,
    pub git_root: Option<String>,
    pub git_branch: Option<String>,
}

/// 一个 Git 本地分支。
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatGitBranch {
    pub name: String,
    pub current: bool,
}

/// 一个工作目录文件项（供 `@` 文件引用补全使用）。
#[derive(serde::Serialize)]
pub struct WorkspaceFile {
    /// 相对工作目录的路径（用 `/` 分隔，跨平台统一）
    pub rel_path: String,
    /// 文件名
    pub name: String,
    /// 是否为目录
    pub is_dir: bool,
}

/// 一个 Slash 命令补全项，格式对齐 cc-gui 的 SlashCommandRegistry。
#[derive(serde::Serialize)]
pub struct SlashCommandItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source: String,
}

/// Shared chat manager, stored in Tauri managed state.
pub struct ChatState {
    pub manager: ChatManager,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SystemNotificationPayload {
    title: String,
    body: String,
}

fn normalize_system_notification_payload(
    title: &str,
    body: &str,
) -> Result<SystemNotificationPayload, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("发送系统通知失败: 标题不能为空".to_string());
    }

    Ok(SystemNotificationPayload {
        title,
        body: body.trim().to_string(),
    })
}

fn windows_terminal_start_args<'a>(
    project_dir: Option<&'a str>,
    command: Option<&'a str>,
) -> Vec<&'a str> {
    let mut args: Vec<&'a str> = vec!["/c", "start", ""];
    if let Some(dir) = project_dir.filter(|dir| !dir.is_empty()) {
        args.extend(["/D", dir]);
    }
    args.extend(["cmd", "/K"]);
    if let Some(command) = command.filter(|command| !command.is_empty()) {
        args.push(command);
    }
    args
}

fn empty_chat_workspace_status() -> ChatWorkspaceStatus {
    ChatWorkspaceStatus {
        is_git_repository: false,
        git_root: None,
        git_branch: None,
    }
}

fn find_git_entry(start: &Path) -> Option<(PathBuf, PathBuf)> {
    let mut current = if start.is_file() {
        start.parent()?.to_path_buf()
    } else {
        start.to_path_buf()
    };

    loop {
        let git_entry = current.join(".git");
        if git_entry.exists() {
            return Some((current, git_entry));
        }
        if !current.pop() {
            return None;
        }
    }
}

fn resolve_git_dir(repo_root: &Path, git_entry: &Path) -> Option<PathBuf> {
    if git_entry.is_dir() {
        return Some(git_entry.to_path_buf());
    }

    let content = std::fs::read_to_string(git_entry).ok()?;
    let git_dir = content.trim().strip_prefix("gitdir:")?.trim();
    if git_dir.is_empty() {
        return None;
    }

    let path = PathBuf::from(git_dir);
    Some(if path.is_absolute() {
        path
    } else {
        repo_root.join(path)
    })
}

fn read_git_branch(git_dir: &Path) -> Option<String> {
    let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let head = head.trim();
    if head.is_empty() {
        return None;
    }

    if let Some(reference) = head.strip_prefix("ref:") {
        let reference = reference.trim();
        return Some(
            reference
                .strip_prefix("refs/heads/")
                .unwrap_or(reference)
                .to_string(),
        )
        .filter(|branch| !branch.is_empty());
    }

    if head.len() >= 7 {
        return Some(head.chars().take(7).collect());
    }

    None
}

fn resolve_chat_workspace_status(cwd: Option<String>) -> Result<ChatWorkspaceStatus, String> {
    let Some(cwd) = cwd
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(empty_chat_workspace_status());
    };

    let path = PathBuf::from(cwd);
    if !path.exists() {
        return Ok(empty_chat_workspace_status());
    }

    let Some((repo_root, git_entry)) = find_git_entry(&path) else {
        return Ok(empty_chat_workspace_status());
    };

    let git_branch = resolve_git_dir(&repo_root, &git_entry)
        .as_deref()
        .and_then(read_git_branch);

    Ok(ChatWorkspaceStatus {
        is_git_repository: true,
        git_root: Some(repo_root.to_string_lossy().to_string()),
        git_branch,
    })
}

fn resolve_existing_chat_path(path: String, label: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(format!("{label}不能为空"));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(format!("{label}包含非法控制字符"));
    }

    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(format!("{label}不存在: {trimmed}"));
    }
    Ok(path)
}

fn resolve_existing_chat_directory(path: String, label: &str) -> Result<PathBuf, String> {
    let path = resolve_existing_chat_path(path, label)?;
    if !path.is_dir() {
        return Err(format!("{label}不是目录: {}", path.to_string_lossy()));
    }
    Ok(path)
}

fn normalize_chat_git_branch_name(branch_name: &str) -> Result<String, String> {
    let branch = branch_name.trim();
    if branch.is_empty() {
        return Err("创建 Git 分支失败: 分支名不能为空".to_string());
    }
    if branch.starts_with('-') {
        return Err("创建 Git 分支失败: 分支名不能以 - 开头".to_string());
    }
    if branch.chars().any(char::is_control) {
        return Err("创建 Git 分支失败: 分支名包含非法控制字符".to_string());
    }
    if branch.contains("..")
        || branch.contains("//")
        || branch.contains('\\')
        || branch.contains(' ')
        || branch.contains('~')
        || branch.contains('^')
        || branch.contains(':')
        || branch.contains('?')
        || branch.contains('*')
        || branch.contains('[')
        || branch.ends_with('/')
        || branch.ends_with('.')
        || branch.ends_with(".lock")
        || branch == "@{"
        || branch.contains("@{")
    {
        return Err("创建 Git 分支失败: 分支名格式不合法".to_string());
    }
    Ok(branch.to_string())
}

fn resolve_git_repository(cwd: &Path) -> Result<(PathBuf, PathBuf), String> {
    let Some((repo_root, git_entry)) = find_git_entry(cwd) else {
        return Err("当前工作目录不是 Git 仓库".to_string());
    };
    let Some(git_dir) = resolve_git_dir(&repo_root, &git_entry) else {
        return Err("无法解析 Git 目录".to_string());
    };
    Ok((repo_root, git_dir))
}

fn collect_refs_heads(
    root: &Path,
    current_branch: Option<&str>,
    prefix: &str,
    out: &mut Vec<ChatGitBranch>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(root).map_err(|e| format!("读取 Git 分支失败: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.is_empty() {
            continue;
        }
        let branch_name = if prefix.is_empty() {
            file_name
        } else {
            format!("{prefix}/{file_name}")
        };
        if path.is_dir() {
            collect_refs_heads(&path, current_branch, &branch_name, out)?;
        } else {
            out.push(ChatGitBranch {
                current: current_branch == Some(branch_name.as_str()),
                name: branch_name,
            });
        }
    }
    Ok(())
}

fn list_chat_git_branches_for_path(cwd: &Path) -> Result<Vec<ChatGitBranch>, String> {
    let (repo_root, git_dir) = resolve_git_repository(cwd)?;
    let current_branch = read_git_branch(&git_dir);
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .args([
            "branch",
            "--format=%(if)%(HEAD)%(then)*%(else) %(end)%(refname:short)",
        ])
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            let mut branches: Vec<ChatGitBranch> = String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|line| {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        return None;
                    }
                    let current = trimmed.starts_with('*');
                    let name = trimmed.trim_start_matches('*').trim().to_string();
                    if name.is_empty() {
                        return None;
                    }
                    Some(ChatGitBranch { name, current })
                })
                .collect();
            branches.sort_by(|a, b| a.name.cmp(&b.name));
            return Ok(branches);
        }
    }

    let refs_heads = git_dir.join("refs").join("heads");
    if !refs_heads.exists() {
        return Ok(Vec::new());
    }

    let mut branches = Vec::new();
    collect_refs_heads(&refs_heads, current_branch.as_deref(), "", &mut branches)?;
    branches.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(branches)
}

/// Send a chat message and stream the response via "chat://stream"/"chat://done".
///
/// `provider` is "claude" or "codex". `command` is the ai-bridge verb, e.g.
/// "send". `params` is the payload (message, sessionId, model, cwd, …).
/// Returns the request id for correlating streamed events.
#[tauri::command]
pub async fn chat_send(
    provider: String,
    command: String,
    params: Value,
    state: State<'_, ChatState>,
) -> Result<String, String> {
    let method = format!("{provider}.{command}");
    state.manager.send(method, params).await
}

/// Abort the current in-flight turn.
#[tauri::command]
pub async fn chat_abort(state: State<'_, ChatState>) -> Result<(), String> {
    state.manager.abort().await
}

/// Whether the daemon is running.
#[tauri::command]
pub async fn chat_is_running(state: State<'_, ChatState>) -> Result<bool, String> {
    Ok(state.manager.is_running().await)
}

/// Explicitly start the daemon (otherwise it starts lazily on first send).
#[tauri::command]
pub async fn chat_start_daemon(state: State<'_, ChatState>) -> Result<(), String> {
    // A no-op send path: starting happens inside the manager's lazy init.
    // We trigger it via is_running which forces client init only on send, so
    // instead expose a dedicated warm-up by sending a heartbeat-like start.
    state.manager.warm_up().await
}

/// 发送系统级桌面通知，用于聊天任务完成/失败/中断后的右下角提示。
#[tauri::command]
pub fn chat_show_system_notification(
    app: AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let payload = normalize_system_notification_payload(&title, &body)?;

    app.notification()
        .builder()
        .title(payload.title)
        .body(payload.body)
        .show()
        .map_err(|e| format!("发送系统通知失败: {e}"))
}

/// 返回当前 Chat 工作目录的 Git 状态；非 Git 或路径不可读时返回空状态。
#[tauri::command]
pub fn chat_workspace_status(cwd: Option<String>) -> Result<ChatWorkspaceStatus, String> {
    resolve_chat_workspace_status(cwd)
}

/// 在系统资源管理器中打开 Chat 相关路径。
#[tauri::command]
pub fn chat_open_path_in_explorer(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let path = resolve_existing_chat_path(path, "路径")?;
    app.opener()
        .open_path(path.to_string_lossy().as_ref(), None::<String>)
        .map_err(|e| format!("在资源管理器中打开失败: {e}"))
}

/// 列出当前 Chat 工作目录所在 Git 仓库的本地分支。
#[tauri::command]
pub fn chat_git_list_branches(cwd: String) -> Result<Vec<ChatGitBranch>, String> {
    let cwd = resolve_existing_chat_directory(cwd, "工作目录")?;
    list_chat_git_branches_for_path(&cwd)
}

/// 创建并检出一个新的 Git 分支，成功后返回最新工作区状态。
#[tauri::command]
pub fn chat_git_create_and_checkout_branch(
    cwd: String,
    branch_name: String,
) -> Result<ChatWorkspaceStatus, String> {
    let cwd = resolve_existing_chat_directory(cwd, "工作目录")?;
    let branch_name = normalize_chat_git_branch_name(&branch_name)?;
    let (repo_root, _) = resolve_git_repository(&cwd)?;

    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .args(["checkout", "-b"])
        .arg(&branch_name)
        .output()
        .map_err(|e| format!("创建 Git 分支失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "创建 Git 分支失败".to_string()
        } else {
            format!("创建 Git 分支失败: {stderr}")
        });
    }

    resolve_chat_workspace_status(Some(repo_root.to_string_lossy().to_string()))
}

/// 列出所有 SDK 的安装状态（Claude / Codex）。
#[tauri::command]
pub async fn chat_sdk_status(
    state: State<'_, ChatState>,
) -> Result<Vec<crate::chat::SdkStatus>, String> {
    state.manager.sdk_status().await
}

/// 返回 Node.js 运行环境状态。系统 Node 可用或私有 runtime 已安装时为 installed。
#[tauri::command]
pub async fn chat_node_runtime_status(
    state: State<'_, ChatState>,
) -> Result<crate::chat::NodeRuntimeStatus, String> {
    state.manager.node_runtime_status().await
}

/// 安装 CCG Switch 私有 Node.js runtime。
#[tauri::command]
pub async fn chat_install_node_runtime(
    state: State<'_, ChatState>,
) -> Result<crate::chat::NodeRuntimeStatus, String> {
    state.manager.install_node_runtime().await
}

/// 安装指定 SDK。npm 日志通过 "chat://sdk-install-log" 事件流式推送，
/// 结束时发 "chat://sdk-install-done"。
#[tauri::command]
pub async fn chat_install_sdk(
    sdk_id: String,
    version: Option<String>,
    state: State<'_, ChatState>,
) -> Result<(), String> {
    state.manager.install_sdk(sdk_id, version).await
}

/// 卸载指定 SDK。
#[tauri::command]
pub async fn chat_uninstall_sdk(sdk_id: String, state: State<'_, ChatState>) -> Result<(), String> {
    state.manager.uninstall_sdk(sdk_id).await
}

/// 重启 daemon（用于手动刷新）。
#[tauri::command]
pub async fn chat_restart_daemon(state: State<'_, ChatState>) -> Result<(), String> {
    state.manager.restart_daemon().await
}

/// 列出 Slash 命令，用于输入框 `/` 补全。
///
/// 内置命令对齐 cc-gui 的 SlashCommandRegistry，并额外扫描当前项目向上的
/// `.claude/commands/**/*.md`，避免补全长期依赖前端硬编码列表。
#[tauri::command]
pub fn chat_list_slash_commands(
    cwd: Option<String>,
    provider: Option<String>,
) -> Result<Vec<SlashCommandItem>, String> {
    Ok(
        crate::chat::list_slash_commands(provider.as_deref(), cwd.as_deref())
            .into_iter()
            .map(|command| SlashCommandItem {
                id: command.id,
                name: command.name,
                description: command.description,
                source: command.source,
            })
            .collect(),
    )
}

/// 响应 AskUserQuestion 权限请求。
///
/// `request_id` 来自 "permission://ask-user-question" 事件，`answers` 是
/// { "问题文本": "用户选择的答案" } 的 map。
#[tauri::command]
pub async fn permission_respond_ask_user_question(
    request_id: String,
    session_id: Option<String>,
    answers: std::collections::HashMap<String, String>,
    state: State<'_, ChatState>,
) -> Result<(), String> {
    let perm_dir = crate::chat::permission_dir(state.manager.app())?;
    let session_id = crate::chat::permission_response_session_id(session_id);
    crate::chat::write_ask_user_question_response(&perm_dir, &session_id, &request_id, answers)
}

/// 响应普通工具权限请求。
///
/// `request_id` 来自 "permission://tool" 事件，`allow` 会写入
/// `response-<sessionId>-<requestId>.json`，供 ai-bridge 继续执行或拒绝工具。
#[tauri::command]
pub async fn permission_respond_tool(
    request_id: String,
    session_id: Option<String>,
    allow: bool,
    state: State<'_, ChatState>,
) -> Result<(), String> {
    let perm_dir = crate::chat::permission_dir(state.manager.app())?;
    let session_id = crate::chat::permission_response_session_id(session_id);
    crate::chat::write_tool_permission_response(&perm_dir, &session_id, &request_id, allow)
}

/// 列出工作目录下的文件，用于 `@` 文件引用补全。
///
/// `dir` 为工作目录（缺省用用户主目录）；`query` 为已输入的过滤词（按文件名/
/// 相对路径子串匹配，大小写不敏感）。最多返回 50 项，跳过常见的重型目录
/// （node_modules / .git / target / dist 等）与隐藏目录，限制扫描深度防卡顿。
///
/// 注意：文件系统遍历是阻塞操作，必须放到 `spawn_blocking` 线程池执行，
/// 否则会阻塞 Tauri 主线程导致界面卡死（"未响应"）。
#[tauri::command]
pub async fn chat_list_workspace_files(
    dir: Option<String>,
    query: Option<String>,
) -> Result<Vec<WorkspaceFile>, String> {
    tauri::async_runtime::spawn_blocking(move || list_workspace_files_blocking(dir, query))
        .await
        .map_err(|e| format!("文件扫描任务失败: {e}"))?
}

/// 同步执行工作目录文件扫描（阻塞）。由 `chat_list_workspace_files` 在
/// 后台线程池调用，不可直接在命令层（主线程）调用。
fn list_workspace_files_blocking(
    dir: Option<String>,
    query: Option<String>,
) -> Result<Vec<WorkspaceFile>, String> {
    use std::path::PathBuf;

    let root: PathBuf = match dir {
        Some(d) if !d.trim().is_empty() => PathBuf::from(d),
        _ => dirs::home_dir().ok_or_else(|| "无法定位主目录".to_string())?,
    };
    let query = query.unwrap_or_default().to_lowercase();

    const SKIP_DIRS: &[&str] = &[
        "node_modules",
        ".git",
        "target",
        "dist",
        "build",
        ".next",
        ".cache",
        "__pycache__",
        ".venv",
        "vendor",
    ];
    const MAX_RESULTS: usize = 50;
    const MAX_DEPTH: usize = 6;

    let mut out: Vec<WorkspaceFile> = Vec::new();
    // 广度优先，避免单分支过深；用栈记录 (路径, 深度)。
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.clone(), 0)];

    while let Some((cur, depth)) = stack.pop() {
        if out.len() >= MAX_RESULTS {
            break;
        }
        let entries = match std::fs::read_dir(&cur) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            // 跳过隐藏项与重型目录
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            let is_dir = path.is_dir();
            let rel = path
                .strip_prefix(&root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");

            let matches = query.is_empty()
                || rel.to_lowercase().contains(&query)
                || name.to_lowercase().contains(&query);
            if matches {
                out.push(WorkspaceFile {
                    rel_path: rel,
                    name,
                    is_dir,
                });
                if out.len() >= MAX_RESULTS {
                    break;
                }
            }
            if is_dir && depth < MAX_DEPTH {
                stack.push((path, depth + 1));
            }
        }
    }

    // 目录在前、文件在后，再按路径排序，便于浏览。
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.rel_path.cmp(&b.rel_path),
    });
    Ok(out)
}

/// 一键润色当前输入的 Prompt。返回增强后的文本（失败返回 Err，前端保留原文）。
#[tauri::command]
pub async fn chat_enhance_prompt(
    prompt: String,
    model: String,
    state: State<'_, ChatState>,
) -> Result<String, String> {
    state.manager.enhance_prompt(prompt, model).await
}

/// 响应 PlanApproval 权限请求。
///
/// `approved`: 是否批准；`target_mode`: "default" / "auto" / "bypassPermissions"。
#[tauri::command]
pub async fn permission_respond_plan_approval(
    request_id: String,
    session_id: Option<String>,
    approved: bool,
    target_mode: String,
    message: Option<String>,
    state: State<'_, ChatState>,
) -> Result<(), String> {
    let perm_dir = crate::chat::permission_dir(state.manager.app())?;
    let session_id = crate::chat::permission_response_session_id(session_id);
    crate::chat::write_plan_approval_response(
        &perm_dir,
        &session_id,
        &request_id,
        approved,
        target_mode,
        message,
    )
}

/// 在系统终端打开会话的工作目录。
///
/// - 路径验证：拒绝空路径、不存在的目录、控制字符。
/// - 根据平台调用系统终端：
///   - Windows: cmd /c start "" /D <projectDir> cmd /K
///   - macOS: osascript -e 'tell app "Terminal" to do script "cd <projectDir>"'
///   - Linux: 检测常见终端（gnome-terminal / konsole / xterm）
#[tauri::command]
pub fn chat_open_project_in_terminal(project_dir: String) -> Result<(), String> {
    let trimmed = project_dir.trim();
    if trimmed.is_empty() {
        return Err("工作目录路径为空".to_string());
    }
    if trimmed.contains(|c: char| c.is_control()) {
        return Err("工作目录路径包含非法字符".to_string());
    }

    let path = Path::new(trimmed);
    if !path.exists() {
        return Err(format!("工作目录不存在: {}", trimmed));
    }
    if !path.is_dir() {
        return Err(format!("路径不是目录: {}", trimmed));
    }

    #[cfg(target_os = "windows")]
    {
        let args = windows_terminal_start_args(Some(trimmed), None);
        Command::new("cmd")
            .args(args)
            .spawn()
            .map_err(|e| format!("无法打开终端: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell app \"Terminal\" to do script \"cd \\\"{}\\\"\"",
            trimmed
        );
        Command::new("osascript")
            .args(&["-e", &script])
            .spawn()
            .map_err(|e| format!("无法打开终端: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        let cmd = format!("cd \"{}\" && exec bash", trimmed);

        // 尝试检测常见终端
        let terminals = vec![
            ("gnome-terminal", vec!["--", "bash", "-c", &cmd]),
            ("konsole", vec!["-e", "bash", "-c", &cmd]),
            ("xterm", vec!["-e", "bash", "-c", &cmd]),
            ("x-terminal-emulator", vec!["-e", "bash", "-c", &cmd]),
        ];

        let mut opened = false;
        for (terminal, args) in terminals {
            if let Ok(mut child) = Command::new(terminal).args(&args).spawn() {
                let _ = child.wait();
                opened = true;
                break;
            }
        }

        if !opened {
            return Err("无法打开终端：未找到可用的终端模拟器".to_string());
        }
    }

    Ok(())
}

/// 在系统终端恢复会话继续对话。
///
/// - 直接使用会话的 resume_command（如 "claude --resume <id>" / "codex resume <id>"）。
/// - 如果提供 project_dir，Windows 通过 start /D 指定目录，其他平台先 cd 再执行命令。
/// - 根据平台调用系统终端执行命令。
#[tauri::command]
pub fn chat_resume_session_in_terminal(
    resume_command: String,
    project_dir: Option<String>,
) -> Result<(), String> {
    let trimmed_cmd = resume_command.trim();
    if trimmed_cmd.is_empty() {
        return Err("恢复命令为空".to_string());
    }
    if trimmed_cmd.contains(|c: char| c.is_control()) {
        return Err("恢复命令包含非法字符".to_string());
    }

    let valid_project_dir = project_dir.as_deref().map(str::trim).filter(|dir| {
        if dir.is_empty() {
            return false;
        }
        let path = Path::new(dir);
        path.exists() && path.is_dir()
    });

    #[cfg(target_os = "windows")]
    {
        let args = windows_terminal_start_args(valid_project_dir, Some(trimmed_cmd));
        Command::new("cmd")
            .args(args)
            .spawn()
            .map_err(|e| format!("无法打开终端: {}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    let full_cmd = {
        let mut cmd_parts = Vec::new();
        if let Some(dir) = valid_project_dir {
            cmd_parts.push(format!("cd \"{}\"", dir));
        }
        cmd_parts.push(trimmed_cmd.to_string());
        cmd_parts.join(" && ")
    };

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell app \"Terminal\" to do script \"{}\"",
            full_cmd.replace("\"", "\\\"")
        );
        Command::new("osascript")
            .args(&["-e", &script])
            .spawn()
            .map_err(|e| format!("无法打开终端: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        let terminals = vec![
            (
                "gnome-terminal",
                vec!["--", "bash", "-c", &format!("{}; exec bash", full_cmd)],
            ),
            (
                "konsole",
                vec!["-e", "bash", "-c", &format!("{}; exec bash", full_cmd)],
            ),
            (
                "xterm",
                vec!["-e", "bash", "-c", &format!("{}; exec bash", full_cmd)],
            ),
            (
                "x-terminal-emulator",
                vec!["-e", "bash", "-c", &format!("{}; exec bash", full_cmd)],
            ),
        ];

        let mut opened = false;
        for (terminal, args) in terminals {
            if let Ok(mut child) = Command::new(terminal).args(&args).spawn() {
                let _ = child.wait();
                opened = true;
                break;
            }
        }

        if !opened {
            return Err("无法打开终端：未找到可用的终端模拟器".to_string());
        }
    }

    Ok(())
}

// =============================================================================
// 右侧 dock：文件树 / 文件预览 / git 工作区改动（附加式命令）
// =============================================================================

/// 一个目录项（供右侧 dock 文件树按需展开）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

/// 读取文本文件用于只读预览的结果。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTextFile {
    pub content: String,
    /// 文件超过上限，content 只含前 max_bytes 字节。
    pub truncated: bool,
    /// 疑似二进制文件，未返回内容。
    pub binary: bool,
}

/// 一个 git 工作区改动文件。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

/// git 工作区改动汇总；非 git 仓库时 `is_git` 为 false。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFiles {
    pub is_git: bool,
    pub files: Vec<GitChangedFile>,
}

/// 单个文件的 HEAD 内容与工作区内容（供审查 diff）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileContents {
    pub old_content: String,
    pub new_content: String,
}

const DIR_SKIP_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".cache",
    "__pycache__",
    ".venv",
    "vendor",
];

const READ_TEXT_FILE_DEFAULT_MAX_BYTES: u64 = 512 * 1024;

/// 列出目录的单层子项（目录在前、跳过重型/隐藏项），供文件树按需展开。
#[tauri::command]
pub async fn chat_list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || list_directory_blocking(path))
        .await
        .map_err(|e| format!("目录扫描任务失败: {e}"))?
}

fn list_directory_blocking(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = resolve_existing_chat_directory(path, "目录")?;
    let mut entries: Vec<DirEntry> = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() || name.starts_with('.') || DIR_SKIP_NAMES.contains(&name.as_str()) {
            continue;
        }
        let is_dir = entry.path().is_dir();
        entries.push(DirEntry { name, is_dir });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

/// 读取文本文件用于只读预览；二进制/超限给标记，不返回全部内容。
#[tauri::command]
pub async fn chat_read_text_file(
    path: String,
    max_bytes: Option<u64>,
) -> Result<ReadTextFile, String> {
    tauri::async_runtime::spawn_blocking(move || read_text_file_blocking(path, max_bytes))
        .await
        .map_err(|e| format!("文件读取任务失败: {e}"))?
}

fn read_text_file_blocking(path: String, max_bytes: Option<u64>) -> Result<ReadTextFile, String> {
    use std::io::Read;

    let file_path = resolve_existing_chat_path(path, "文件")?;
    if file_path.is_dir() {
        return Err("路径是目录而非文件".to_string());
    }
    let limit = max_bytes.unwrap_or(READ_TEXT_FILE_DEFAULT_MAX_BYTES);
    let size = std::fs::metadata(&file_path)
        .map_err(|e| format!("读取文件信息失败: {e}"))?
        .len();

    // 只读前 limit 字节，避免把超大文件全部载入内存。
    let file = std::fs::File::open(&file_path).map_err(|e| format!("打开文件失败: {e}"))?;
    let mut bytes = Vec::new();
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取文件失败: {e}"))?;

    // 二进制嗅探：前 8KB 含 NUL 字节视为二进制。
    let head_len = bytes.len().min(8192);
    if bytes[..head_len].contains(&0) {
        return Ok(ReadTextFile {
            content: String::new(),
            truncated: false,
            binary: true,
        });
    }

    Ok(ReadTextFile {
        content: String::from_utf8_lossy(&bytes).to_string(),
        truncated: size > limit,
        binary: false,
    })
}

/// 列出 git 工作区改动文件（含已暂存）；非 git 仓库返回 `is_git: false`。
#[tauri::command]
pub async fn chat_git_changed_files(cwd: String) -> Result<GitChangedFiles, String> {
    tauri::async_runtime::spawn_blocking(move || git_changed_files_blocking(cwd))
        .await
        .map_err(|e| format!("git 任务失败: {e}"))?
}

fn git_changed_files_blocking(cwd: String) -> Result<GitChangedFiles, String> {
    let cwd = resolve_existing_chat_directory(cwd, "工作目录")?;
    let Some((repo_root, _)) = find_git_entry(&cwd) else {
        return Ok(GitChangedFiles {
            is_git: false,
            files: Vec::new(),
        });
    };

    let porcelain = run_git(
        &repo_root,
        &["-c", "core.quotepath=false", "status", "--porcelain"],
    )?;
    let numstat = run_git(
        &repo_root,
        &["-c", "core.quotepath=false", "diff", "--numstat", "HEAD"],
    )
    .unwrap_or_default();

    let stats = parse_git_numstat(&numstat);
    let files = parse_git_porcelain(&porcelain, &stats);
    Ok(GitChangedFiles {
        is_git: true,
        files,
    })
}

/// 取某文件的 HEAD 内容与工作区内容，供审查 diff。
#[tauri::command]
pub async fn chat_git_file_contents(
    cwd: String,
    path: String,
) -> Result<GitFileContents, String> {
    tauri::async_runtime::spawn_blocking(move || git_file_contents_blocking(cwd, path))
        .await
        .map_err(|e| format!("git 任务失败: {e}"))?
}

fn git_file_contents_blocking(cwd: String, path: String) -> Result<GitFileContents, String> {
    let cwd = resolve_existing_chat_directory(cwd, "工作目录")?;
    let Some((repo_root, _)) = find_git_entry(&cwd) else {
        return Err("当前工作目录不是 Git 仓库".to_string());
    };
    let rel = to_repo_relative_git_path(&repo_root, &path)?;

    // 旧 = HEAD 版本（新增文件取不到 → 空）；新 = 工作区（删除文件 → 空）。
    let old_content = run_git(&repo_root, &["show", &format!("HEAD:{rel}")]).unwrap_or_default();
    let new_content = std::fs::read_to_string(repo_root.join(&rel)).unwrap_or_default();
    Ok(GitFileContents {
        old_content,
        new_content,
    })
}

/// 在仓库根运行 git 子命令并返回 stdout。Windows 加 CREATE_NO_WINDOW 防闪窗。
fn run_git(repo_root: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo_root).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let output = cmd.output().map_err(|e| format!("执行 git 失败: {e}"))?;
    if !output.status.success() {
        return Err(format!("git {args:?} 执行失败"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// 把传入路径(绝对或仓库相对)归一化为相对仓库根、`/` 分隔的 git 路径，拒绝越界/`..`。
fn to_repo_relative_git_path(repo_root: &Path, path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("文件路径为空".to_string());
    }
    if trimmed.chars().any(char::is_control) {
        return Err("文件路径包含非法控制字符".to_string());
    }
    let candidate = PathBuf::from(trimmed);
    let rel = if candidate.is_absolute() {
        candidate
            .strip_prefix(repo_root)
            .map_err(|_| "文件不在仓库范围内".to_string())?
            .to_path_buf()
    } else {
        candidate
    };
    let normalized = normalize_git_path(&rel.to_string_lossy());
    if normalized.split('/').any(|seg| seg == "..") {
        return Err("文件路径非法".to_string());
    }
    Ok(normalized)
}

fn normalize_git_path(path: &str) -> String {
    path.replace('\\', "/")
}

/// 解析 `git diff --numstat HEAD`：每行 `<add>\t<del>\t<path>`；二进制行 `-\t-\t<path>` → (0,0)。
fn parse_git_numstat(numstat: &str) -> std::collections::HashMap<String, (u32, u32)> {
    let mut map = std::collections::HashMap::new();
    for line in numstat.lines() {
        let mut parts = line.splitn(3, '\t');
        let add = parts.next().unwrap_or("").trim();
        let del = parts.next().unwrap_or("").trim();
        let path = match parts.next() {
            Some(p) if !p.trim().is_empty() => p.trim().to_string(),
            _ => continue,
        };
        map.insert(
            normalize_git_path(&path),
            (add.parse().unwrap_or(0), del.parse().unwrap_or(0)),
        );
    }
    map
}

/// 解析 `git status --porcelain`：每行 `XY <path>`（重命名为 `XY old -> new`，取新路径）。
fn parse_git_porcelain(
    porcelain: &str,
    stats: &std::collections::HashMap<String, (u32, u32)>,
) -> Vec<GitChangedFile> {
    let mut files = Vec::new();
    for line in porcelain.lines() {
        if line.len() < 4 {
            continue;
        }
        let status = line[..2].trim().to_string();
        let rest = line[3..].trim();
        let path_part = rest.rsplit("->").next().unwrap_or(rest).trim();
        let path = normalize_git_path(path_part.trim_matches('"'));
        if path.is_empty() {
            continue;
        }
        let (additions, deletions) = stats.get(&path).copied().unwrap_or((0, 0));
        files.push(GitChangedFile {
            status: if status.is_empty() {
                "M".to_string()
            } else {
                status
            },
            path,
            additions,
            deletions,
        });
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn unique_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ccg-switch-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    fn write_file(path: &Path, text: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        fs::write(path, text).expect("write test file");
    }

    #[test]
    fn lists_directory_entries_dirs_first_skipping_heavy_and_hidden() {
        let dir = unique_test_dir("dock-list-dir");
        fs::create_dir_all(dir.join("zsub")).expect("create subdir");
        fs::create_dir_all(dir.join("node_modules")).expect("create node_modules");
        fs::create_dir_all(dir.join(".hidden")).expect("create hidden");
        write_file(&dir.join("a.txt"), "x");
        write_file(&dir.join("b.txt"), "y");

        let entries = list_directory_blocking(dir.to_string_lossy().to_string()).expect("list");
        let names: Vec<(String, bool)> =
            entries.iter().map(|e| (e.name.clone(), e.is_dir)).collect();
        assert_eq!(
            names,
            vec![
                ("zsub".to_string(), true),
                ("a.txt".to_string(), false),
                ("b.txt".to_string(), false),
            ]
        );
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn reads_text_file_flags_binary_and_truncation() {
        let dir = unique_test_dir("dock-read-file");
        let text = dir.join("a.txt");
        write_file(&text, "hello\nworld");
        let result =
            read_text_file_blocking(text.to_string_lossy().to_string(), None).expect("read text");
        assert_eq!(result.content, "hello\nworld");
        assert!(!result.truncated);
        assert!(!result.binary);

        let bin = dir.join("b.bin");
        fs::write(&bin, [0u8, 1, 2, 3]).expect("write binary");
        let result =
            read_text_file_blocking(bin.to_string_lossy().to_string(), None).expect("read binary");
        assert!(result.binary);
        assert_eq!(result.content, "");

        write_file(&text, "abcdefghij");
        let result = read_text_file_blocking(text.to_string_lossy().to_string(), Some(4))
            .expect("read truncated");
        assert_eq!(result.content, "abcd");
        assert!(result.truncated);

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn parses_git_numstat_including_binary_rows() {
        let stats = parse_git_numstat("1\t2\tsrc/a.rs\n-\t-\tassets/img.png\n10\t0\tb.txt\n");
        assert_eq!(stats.get("src/a.rs").copied(), Some((1, 2)));
        assert_eq!(stats.get("assets/img.png").copied(), Some((0, 0)));
        assert_eq!(stats.get("b.txt").copied(), Some((10, 0)));
    }

    #[test]
    fn parses_git_porcelain_with_status_rename_and_stats() {
        let mut stats = std::collections::HashMap::new();
        stats.insert("src/new.rs".to_string(), (3u32, 1u32));
        let files = parse_git_porcelain(
            " M src/mod.rs\n?? untracked.txt\nR  src/old.rs -> src/new.rs\n",
            &stats,
        );
        let by_path: std::collections::HashMap<&str, (&str, u32, u32)> = files
            .iter()
            .map(|f| (f.path.as_str(), (f.status.as_str(), f.additions, f.deletions)))
            .collect();
        assert_eq!(by_path.get("src/mod.rs"), Some(&("M", 0, 0)));
        assert_eq!(by_path.get("untracked.txt"), Some(&("??", 0, 0)));
        assert_eq!(by_path.get("src/new.rs"), Some(&("R", 3, 1)));
    }

    #[test]
    fn to_repo_relative_strips_root_and_rejects_traversal() {
        let root = unique_test_dir("dock-rel");
        let abs = root.join("src").join("a.rs").to_string_lossy().to_string();
        assert_eq!(to_repo_relative_git_path(&root, &abs).expect("rel"), "src/a.rs");
        assert_eq!(
            to_repo_relative_git_path(&root, "src/b.rs").expect("rel rel"),
            "src/b.rs"
        );
        assert!(to_repo_relative_git_path(&root, "../escape.rs").is_err());
        assert!(to_repo_relative_git_path(&root, "").is_err());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn normalizes_system_notification_payload_trims_title_and_body() -> Result<(), String> {
        let payload = normalize_system_notification_payload("  CCG Switch  ", "  done\n")?;

        assert_eq!(payload.title, "CCG Switch");
        assert_eq!(payload.body, "done");
        Ok(())
    }

    #[test]
    fn normalizes_system_notification_payload_rejects_empty_title() {
        let error =
            normalize_system_notification_payload(" \n\t ", "body").expect_err("empty title");

        assert_eq!(error, "发送系统通知失败: 标题不能为空");
    }

    #[test]
    fn normalizes_system_notification_payload_allows_empty_body() -> Result<(), String> {
        let payload = normalize_system_notification_payload("CCG Switch", " \n\t ")?;

        assert_eq!(payload.title, "CCG Switch");
        assert_eq!(payload.body, "");
        Ok(())
    }

    #[test]
    fn resolves_workspace_status_none_for_non_git_directory() -> Result<(), String> {
        let dir = unique_test_dir("workspace-status-no-git");
        let status = resolve_chat_workspace_status(Some(dir.to_string_lossy().to_string()))?;

        assert!(!status.is_git_repository);
        assert_eq!(status.git_branch, None);
        assert_eq!(status.git_root, None);

        fs::remove_dir_all(dir).ok();
        Ok(())
    }

    #[test]
    fn resolves_workspace_status_from_git_head_branch() -> Result<(), String> {
        let dir = unique_test_dir("workspace-status-git-branch");
        let nested = dir.join("packages").join("app");
        fs::create_dir_all(&nested).expect("create nested dir");
        write_file(
            &dir.join(".git").join("HEAD"),
            "ref: refs/heads/feature/chat-status\n",
        );

        let status = resolve_chat_workspace_status(Some(nested.to_string_lossy().to_string()))?;

        assert!(status.is_git_repository);
        assert_eq!(status.git_branch.as_deref(), Some("feature/chat-status"));
        assert_eq!(
            status.git_root.as_deref(),
            Some(dir.to_string_lossy().as_ref())
        );

        fs::remove_dir_all(dir).ok();
        Ok(())
    }

    #[test]
    fn resolves_workspace_status_from_gitdir_file() -> Result<(), String> {
        let dir = unique_test_dir("workspace-status-gitdir-file");
        let actual_git_dir = dir.join(".git-worktrees").join("app");
        write_file(&dir.join(".git"), "gitdir: .git-worktrees/app\n");
        write_file(
            &actual_git_dir.join("HEAD"),
            "ref: refs/heads/worktree/status-strip\n",
        );

        let status = resolve_chat_workspace_status(Some(dir.to_string_lossy().to_string()))?;

        assert!(status.is_git_repository);
        assert_eq!(status.git_branch.as_deref(), Some("worktree/status-strip"));
        assert_eq!(
            status.git_root.as_deref(),
            Some(dir.to_string_lossy().as_ref())
        );

        fs::remove_dir_all(dir).ok();
        Ok(())
    }

    #[test]
    fn normalizes_chat_git_branch_name_rejects_unsafe_values() {
        assert_eq!(
            normalize_chat_git_branch_name(" feature/workspace-switch ").as_deref(),
            Ok("feature/workspace-switch")
        );
        assert!(normalize_chat_git_branch_name(" ").is_err());
        assert!(normalize_chat_git_branch_name("-danger").is_err());
        assert!(normalize_chat_git_branch_name("feature\nbad").is_err());
        assert!(normalize_chat_git_branch_name("feature..bad").is_err());
        assert!(normalize_chat_git_branch_name("feature.lock").is_err());
    }

    #[test]
    fn windows_terminal_args_open_project_use_start_directory() {
        let project_dir = r"C:\guodevelop\ccg-switch\src-tauri";
        let args = windows_terminal_start_args(Some(project_dir), None);

        assert_eq!(
            args,
            vec!["/c", "start", "", "/D", project_dir, "cmd", "/K",]
        );
        assert!(!args.iter().any(|arg| arg.contains("cd /d")));
    }

    #[test]
    fn windows_terminal_args_resume_use_start_directory_and_resume_command() {
        let project_dir = r"C:\guodevelop\ccg-switch\src-tauri";
        let resume_command = "codex resume abc123";
        let args = windows_terminal_start_args(Some(project_dir), Some(resume_command));

        assert_eq!(
            args,
            vec![
                "/c",
                "start",
                "",
                "/D",
                project_dir,
                "cmd",
                "/K",
                resume_command,
            ]
        );
        assert!(!args.iter().any(|arg| arg.contains("cd /d")));
    }

    #[test]
    fn lists_chat_git_branches_from_refs_heads() -> Result<(), String> {
        let dir = unique_test_dir("chat-git-list-branches");
        write_file(
            &dir.join(".git").join("HEAD"),
            "ref: refs/heads/feature/chat-ui\n",
        );
        write_file(
            &dir.join(".git").join("refs").join("heads").join("main"),
            "0000000\n",
        );
        write_file(
            &dir.join(".git")
                .join("refs")
                .join("heads")
                .join("feature")
                .join("chat-ui"),
            "0000000\n",
        );

        let branches = list_chat_git_branches_for_path(&dir)?;

        assert_eq!(
            branches,
            vec![
                ChatGitBranch {
                    name: "feature/chat-ui".to_string(),
                    current: true,
                },
                ChatGitBranch {
                    name: "main".to_string(),
                    current: false,
                },
            ]
        );

        fs::remove_dir_all(dir).ok();
        Ok(())
    }
}
