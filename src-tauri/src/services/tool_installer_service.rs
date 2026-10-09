//! CLI 工具一键安装 / 升级
//!
//! 命令只能从这里的白名单按 (工具, 动作, 平台) 选出，前端只传工具名与动作，
//! 不接受任意命令字符串。执行输出逐行通过事件推给前端，结束后强制刷新版本检测。

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub const EVENT_LOG: &str = "tool-install-log";
pub const EVENT_FINISHED: &str = "tool-install-finished";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolAction {
    Install,
    Upgrade,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Platform {
    Windows,
    Unix,
}

impl Platform {
    fn current() -> Self {
        if cfg!(target_os = "windows") {
            Platform::Windows
        } else {
            Platform::Unix
        }
    }
}

/// 给前端确认框展示的执行计划
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    pub tool: String,
    pub action: ToolAction,
    /// 将在 shell 中执行的完整脚本
    pub command: String,
    pub needs_npm: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallLog {
    tool: String,
    line: String,
    stream: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallFinished {
    tool: String,
    success: bool,
    exit_code: Option<i32>,
    cancelled: bool,
    error: Option<String>,
}

/// 正在运行的任务：tool → pid
static RUNNING: Lazy<Mutex<HashMap<String, u32>>> = Lazy::new(|| Mutex::new(HashMap::new()));
/// 被用户取消的任务（用于把结束事件标成 cancelled）
static CANCELLED: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));

static ANSI_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07").expect("ansi regex"));

/// npm 全局安装命令（与 cc-switch 对齐）
///
/// Claude Code 的 postinstall 会把平台原生程序放到 bin/claude.exe；npm 12 默认拦截该脚本，
/// 留下文本占位文件导致 Windows 报"与 Windows 版本不兼容"，因此显式放行。
fn npm_install_command(tool: &str) -> Option<&'static str> {
    match tool {
        "claude" => Some(
            "npm i -g @anthropic-ai/claude-code@latest --ignore-scripts=false --include=optional --allow-scripts=@anthropic-ai/claude-code",
        ),
        "codex" => Some("npm i -g @openai/codex@latest"),
        "gemini" => Some("npm i -g @google/gemini-cli@latest"),
        "opencode" => Some("npm i -g opencode-ai@latest"),
        _ => None,
    }
}

/// 工具自带的升级子命令（gemini 没有）
fn official_update_command(tool: &str) -> Option<&'static str> {
    match tool {
        "claude" => Some("claude update"),
        "codex" => Some("codex update"),
        "opencode" => Some("opencode upgrade"),
        _ => None,
    }
}

/// 官方安装脚本（仅 Unix；Windows 统一走 npm，与 cc-switch 一致）
fn unix_installer(tool: &str) -> Option<&'static str> {
    match tool {
        "claude" => Some("curl -fsSL https://claude.ai/install.sh | bash"),
        "opencode" => Some("curl -fsSL https://opencode.ai/install | bash"),
        _ => None,
    }
}

/// `primary || fallback`。Windows PowerShell 5.1 不支持 `||`：
/// primary 抛异常（命令不存在）或退出码非零时都执行 fallback。
fn chain(primary: &str, fallback: &str, platform: Platform) -> String {
    match platform {
        Platform::Unix => format!("{primary} || {fallback}"),
        Platform::Windows => format!(
            "try {{ {primary} }} catch {{ $global:LASTEXITCODE = 1 }}; if ($LASTEXITCODE) {{ {fallback} }}"
        ),
    }
}

/// 白名单：返回 (脚本, 是否只能靠 npm)
///
/// 升级：官方自更新优先、失败回退 npm；安装：Unix 官方脚本优先、失败回退 npm，Windows 直接 npm。
fn resolve_script(tool: &str, action: ToolAction, platform: Platform) -> Result<(String, bool), String> {
    let npm = npm_install_command(tool).ok_or_else(|| format!("不支持的工具: {tool}"))?;
    let primary = match action {
        ToolAction::Upgrade => official_update_command(tool),
        ToolAction::Install => match platform {
            Platform::Unix => unix_installer(tool),
            Platform::Windows => None,
        },
    };
    Ok(match primary {
        Some(primary) => (chain(primary, npm, platform), false),
        None => (npm.to_string(), true),
    })
}

/// 用平台 shell 包装脚本
///
/// Windows 走 PowerShell 并强制 UTF-8 输出，避免 GBK 乱码；
/// Unix 用 login shell，让桌面应用也能拿到用户 PATH（nvm / homebrew）。
fn shell_command(script: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        // cmdlet 失败（如 irm 网络错误）不会设置 $LASTEXITCODE，靠 Stop + catch 转成非零退出码；
        // 原生命令写 stderr 不会触发 catch（已实测 npm warn 不影响结果）
        let wrapped = format!(
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; try {{ {script}; if ($LASTEXITCODE) {{ exit $LASTEXITCODE }} }} catch {{ [Console]::Error.WriteLine($_); exit 1 }}"
        );
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &wrapped,
        ]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("bash");
        // pipefail：curl 下载失败时 `curl | bash` 不能被当成成功
        cmd.args(["-lc", &format!("set -o pipefail; {script}")]);
        // 独立进程组，取消时整组结束（curl | bash 有子进程）
        cmd.process_group(0);
        cmd
    }
}

async fn has_npm() -> bool {
    shell_command("npm --version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 生成执行计划；依赖 npm 而本机没有 npm 时返回 `npm_missing`
pub async fn get_install_plan(tool: &str, action: ToolAction) -> Result<InstallPlan, String> {
    let (command, needs_npm) = resolve_script(tool, action, Platform::current())?;
    if needs_npm && !has_npm().await {
        return Err("npm_missing".to_string());
    }
    Ok(InstallPlan {
        tool: tool.to_string(),
        action,
        command,
        needs_npm,
    })
}

/// 把一段输出切成可显示的行：按 \n / \r 切分（npm 进度条用 \r 覆写），去 ANSI
fn split_lines(pending: &mut Vec<u8>, chunk: &[u8]) -> Vec<String> {
    pending.extend_from_slice(chunk);
    let mut lines = Vec::new();
    while let Some(pos) = pending.iter().position(|b| *b == b'\n' || *b == b'\r') {
        let raw: Vec<u8> = pending.drain(..=pos).collect();
        let text = String::from_utf8_lossy(&raw[..raw.len() - 1]);
        let clean = ANSI_RE.replace_all(&text, "").trim_end().to_string();
        if !clean.trim().is_empty() {
            lines.push(clean);
        }
    }
    lines
}

async fn pump<R: AsyncRead + Unpin>(app: AppHandle, tool: String, stream: &'static str, mut reader: R) {
    let mut buf = [0u8; 4096];
    let mut pending = Vec::new();
    loop {
        match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                for line in split_lines(&mut pending, &buf[..n]) {
                    let _ = app.emit(EVENT_LOG, InstallLog { tool: tool.clone(), line, stream });
                }
            }
        }
    }
    // 收尾：最后一行可能没有换行符
    for line in split_lines(&mut pending, b"\n") {
        let _ = app.emit(EVENT_LOG, InstallLog { tool: tool.clone(), line, stream });
    }
}

/// 启动安装 / 升级；立即返回，进度与结果走事件
pub async fn run_install(app: AppHandle, tool: String, action: ToolAction) -> Result<(), String> {
    let plan = get_install_plan(&tool, action).await?;

    if RUNNING.lock().unwrap().contains_key(&tool) {
        return Err(format!("{tool} 正在执行中"));
    }

    let mut child = shell_command(&plan.command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(false)
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;

    let pid = child.id().unwrap_or(0);
    RUNNING.lock().unwrap().insert(tool.clone(), pid);
    CANCELLED.lock().unwrap().retain(|t| t != &tool);

    let _ = app.emit(
        EVENT_LOG,
        InstallLog { tool: tool.clone(), line: format!("$ {}", plan.command), stream: "stdout" },
    );

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    tauri::async_runtime::spawn(async move {
        let out_task = stdout.map(|s| tokio::spawn(pump(app.clone(), tool.clone(), "stdout", s)));
        let err_task = stderr.map(|s| tokio::spawn(pump(app.clone(), tool.clone(), "stderr", s)));

        let status = child.wait().await;
        if let Some(t) = out_task {
            let _ = t.await;
        }
        if let Some(t) = err_task {
            let _ = t.await;
        }

        RUNNING.lock().unwrap().remove(&tool);
        let cancelled = {
            let mut c = CANCELLED.lock().unwrap();
            let was = c.contains(&tool);
            c.retain(|t| t != &tool);
            was
        };

        let (success, exit_code, error) = match status {
            Ok(s) => (s.success() && !cancelled, s.code(), None),
            Err(e) => (false, None, Some(e.to_string())),
        };
        let _ = app.emit(
            EVENT_FINISHED,
            InstallFinished { tool: tool.clone(), success, exit_code, cancelled, error },
        );

        // 版本检测走 stale-while-revalidate：force 时后台检测并推 tool-versions-updated
        crate::services::tool_version_service::get_tool_versions(None, true, Some(app)).await;
    });

    Ok(())
}

/// 取消：结束整个进程树
pub async fn cancel_install(tool: &str) -> Result<(), String> {
    let pid = RUNNING
        .lock()
        .unwrap()
        .get(tool)
        .copied()
        .ok_or_else(|| format!("{tool} 没有正在执行的任务"))?;
    CANCELLED.lock().unwrap().push(tool.to_string());

    #[cfg(target_os = "windows")]
    let result = {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/T", "/F", "/PID", &pid.to_string()]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.status().await
    };

    #[cfg(not(target_os = "windows"))]
    let result = Command::new("kill")
        .args(["-TERM", "--", &format!("-{pid}")])
        .status()
        .await;

    result.map(|_| ()).map_err(|e| format!("取消失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_tool() {
        assert!(resolve_script("rm", ToolAction::Install, Platform::Unix).is_err());
        assert!(resolve_script("claude; rm -rf /", ToolAction::Upgrade, Platform::Windows).is_err());
    }

    #[test]
    fn gemini_is_npm_only() {
        for action in [ToolAction::Install, ToolAction::Upgrade] {
            let (script, needs_npm) = resolve_script("gemini", action, Platform::Unix).unwrap();
            assert!(needs_npm);
            assert_eq!(script, "npm i -g @google/gemini-cli@latest");
        }
    }

    #[test]
    fn upgrade_prefers_official_then_npm() {
        let (unix, needs_npm) = resolve_script("claude", ToolAction::Upgrade, Platform::Unix).unwrap();
        assert!(unix.starts_with("claude update || npm i -g @anthropic-ai/claude-code@latest"));
        assert!(unix.contains("--allow-scripts=@anthropic-ai/claude-code"));
        assert!(!needs_npm);
        let (win, _) = resolve_script("opencode", ToolAction::Upgrade, Platform::Windows).unwrap();
        assert!(win.starts_with("try { opencode upgrade }"));
        assert!(win.ends_with("if ($LASTEXITCODE) { npm i -g opencode-ai@latest }"));
        assert!(!win.contains("||"), "PowerShell 5.1 不支持 ||");
    }

    #[test]
    fn install_is_platform_specific() {
        let (unix, _) = resolve_script("claude", ToolAction::Install, Platform::Unix).unwrap();
        assert!(unix.starts_with("curl -fsSL https://claude.ai/install.sh | bash || npm i -g"));
        let (win, needs_npm) = resolve_script("claude", ToolAction::Install, Platform::Windows).unwrap();
        assert!(win.starts_with("npm i -g @anthropic-ai/claude-code@latest"));
        assert!(needs_npm);
        let (codex, _) = resolve_script("codex", ToolAction::Install, Platform::Unix).unwrap();
        assert_eq!(codex, "npm i -g @openai/codex@latest");
    }

    #[test]
    fn split_lines_handles_cr_and_ansi() {
        let mut pending = Vec::new();
        let lines = split_lines(&mut pending, b"\x1b[32madded\x1b[0m 1 pkg\r\nprog 10%\rprog 100%\npart");
        assert_eq!(lines, vec!["added 1 pkg", "prog 10%", "prog 100%"]);
        assert_eq!(pending, b"part");
        let rest = split_lines(&mut pending, b"\n");
        assert_eq!(rest, vec!["part"]);
    }
}
