//! High-level chat orchestration: owns the DaemonClient, lazily starts it,
//! forwards streamed lines and lifecycle events to the frontend via Tauri
//! events, and runs the heartbeat loop.
//!
//! Frontend event channels (listen on these):
//!   "chat://stream"    — { requestId, kind: "line"|"stderr", text }
//!   "chat://done"      — { requestId, success, error? }
//!   "chat://message"   — { requestId, json }
//!   "chat://daemon"    — { event, pid?, message?, provider? }

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, OnceCell};

use crate::models::chat::ChatMessageEvent;

use super::daemon_client::{DaemonClient, EventSink, SESSION_ID};
use super::permission_watcher::PermissionWatcher;
use super::protocol::StreamLine;
use super::resources;

type ClientFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
type ClientResultFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

trait ManagerDaemonClient: Send + Sync {
    fn is_running(&self) -> bool;
    fn set_event_sink(&self, sink: EventSink) -> ClientFuture<'_, ()>;
    fn start(&self) -> ClientResultFuture<'_, ()>;
    fn restart(&self) -> ClientResultFuture<'_, ()>;
    fn update_provider_config(
        &self,
        api_key: Option<String>,
        base_url: Option<String>,
    ) -> ClientFuture<'_, ()>;
    fn heartbeat(&self) -> ClientResultFuture<'_, ()>;
    fn send_streaming(
        &self,
        method: String,
        params: Value,
    ) -> ClientResultFuture<'_, (String, mpsc::UnboundedReceiver<StreamLine>)>;
    fn abort(&self) -> ClientResultFuture<'_, ()>;
    fn stop(&self) -> ClientFuture<'_, ()>;
}

impl ManagerDaemonClient for DaemonClient {
    fn is_running(&self) -> bool {
        DaemonClient::is_running(self)
    }

    fn set_event_sink(&self, sink: EventSink) -> ClientFuture<'_, ()> {
        Box::pin(async move {
            DaemonClient::set_event_sink(self, sink).await;
        })
    }

    fn start(&self) -> ClientResultFuture<'_, ()> {
        Box::pin(async move { DaemonClient::start(self).await })
    }

    fn restart(&self) -> ClientResultFuture<'_, ()> {
        Box::pin(async move { DaemonClient::restart(self).await })
    }

    fn update_provider_config(
        &self,
        api_key: Option<String>,
        base_url: Option<String>,
    ) -> ClientFuture<'_, ()> {
        Box::pin(async move {
            DaemonClient::update_provider_config(self, api_key, base_url).await;
        })
    }

    fn heartbeat(&self) -> ClientResultFuture<'_, ()> {
        Box::pin(async move { DaemonClient::heartbeat(self).await })
    }

    fn send_streaming(
        &self,
        method: String,
        params: Value,
    ) -> ClientResultFuture<'_, (String, mpsc::UnboundedReceiver<StreamLine>)> {
        Box::pin(async move { DaemonClient::send_streaming(self, method, params).await })
    }

    fn abort(&self) -> ClientResultFuture<'_, ()> {
        Box::pin(async move { DaemonClient::abort(self).await })
    }

    fn stop(&self) -> ClientFuture<'_, ()> {
        Box::pin(async move {
            DaemonClient::stop(self).await;
        })
    }
}

pub struct ChatManager {
    app: AppHandle,
    client: OnceCell<Arc<dyn ManagerDaemonClient>>,
    permission_watcher: OnceCell<PermissionWatcher<tauri::Wry>>,
}

impl ChatManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            client: OnceCell::new(),
            permission_watcher: OnceCell::new(),
        }
    }

    /// Access the app handle (for commands needing it).
    pub fn app(&self) -> &AppHandle {
        &self.app
    }

    /// Get the daemon client, starting the daemon on first use.
    async fn client(&self) -> Result<Arc<dyn ManagerDaemonClient>, String> {
        self.client
            .get_or_try_init(|| async {
                let node = resources::detect_node()?;
                let bridge = resources::resolve_bridge_dir(&self.app)?;
                let deps = resources::deps_dir(&self.app)?;
                let perm_dir = resources::permission_dir(&self.app)?;

                // Read active Provider for Claude
                let (api_key, base_url) = self.get_active_provider_config().await?;
                let debug = self.debug_mode();

                let client = Arc::new(DaemonClient::new(
                    node, bridge, deps, perm_dir, api_key, base_url, debug,
                )) as Arc<dyn ManagerDaemonClient>;

                // Forward lifecycle events to the frontend.
                let app = self.app.clone();
                client
                    .set_event_sink(Arc::new(move |ev| {
                        let _ = app.emit(
                            "chat://daemon",
                            json!({
                                "event": ev.event,
                                "pid": ev.pid,
                                "message": ev.message,
                                "provider": ev.provider,
                            }),
                        );
                    }))
                    .await;

                client.start().await?;
                Self::spawn_heartbeat(client.clone());

                // Start permission watcher (only once, on first daemon start).
                if self.permission_watcher.get().is_none() {
                    let perm_dir = resources::permission_dir(&self.app)?;
                    let watcher =
                        PermissionWatcher::new(perm_dir, SESSION_ID.to_string(), self.app.clone());
                    watcher.start();
                    let _ = self.permission_watcher.set(watcher);
                }

                Ok::<Arc<dyn ManagerDaemonClient>, String>(client)
            })
            .await.cloned()
    }

    /// Get the daemon client and restart it if the cached process has exited.
    async fn running_client(&self) -> Result<Arc<dyn ManagerDaemonClient>, String> {
        let client = self.client().await?;
        Self::ensure_running_client_with_heartbeat(client, Self::spawn_heartbeat).await
    }

    async fn ensure_running_client_with_heartbeat<F>(
        client: Arc<dyn ManagerDaemonClient>,
        spawn_heartbeat: F,
    ) -> Result<Arc<dyn ManagerDaemonClient>, String>
    where
        F: FnOnce(Arc<dyn ManagerDaemonClient>),
    {
        if !client.is_running() {
            client.restart().await?;
            spawn_heartbeat(client.clone());
        }
        Ok(client)
    }

    async fn refresh_cached_client_provider_config<F>(
        client: Arc<dyn ManagerDaemonClient>,
        api_key: Option<String>,
        base_url: Option<String>,
        spawn_heartbeat: F,
    ) -> Result<(), String>
    where
        F: FnOnce(Arc<dyn ManagerDaemonClient>),
    {
        client.update_provider_config(api_key, base_url).await;
        client.restart().await?;
        spawn_heartbeat(client);
        Ok(())
    }

    /// Whether the app config has debug mode enabled. Falls back to `false` if
    /// the config can't be read, so diagnostics never block daemon startup.
    fn debug_mode(&self) -> bool {
        let state = self.app.state::<crate::store::AppState>();
        crate::services::config_service::load_config_from_db(&state.db)
            .map(|config| config.debug_mode)
            .unwrap_or(false)
    }

    /// Get active Provider config (API Key and base URL)
    async fn get_active_provider_config(&self) -> Result<(Option<String>, Option<String>), String> {
        let state = self.app.state::<crate::store::AppState>();
        let db = &state.db;

        // Get active provider for "claude" app type
        if let Some(provider_id) = db.get_current_provider_id("claude")? {
            if let Some(provider) = db.get_provider(&provider_id)? {
                return Ok((Some(provider.api_key), provider.url));
            }
        }

        Ok((None, None))
    }

    /// Periodic heartbeat so the daemon can detect a dead parent and we can
    /// detect a dead daemon. Mirrors DaemonBridge's 15s interval.
    fn spawn_heartbeat(client: Arc<dyn ManagerDaemonClient>) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
            loop {
                interval.tick().await;
                if !client.is_running() {
                    break;
                }
                if client.heartbeat().await.is_err() {
                    break;
                }
            }
        });
    }

    /// Send a message to a provider and stream the response to the frontend.
    ///
    /// `method` is e.g. "claude.send"; `params` is the JSON payload the
    /// ai-bridge command expects. Returns the request id immediately; lines
    /// arrive via the "chat://stream" / "chat://done" events.
    pub async fn send(&self, method: String, params: Value) -> Result<String, String> {
        let client = self.running_client().await?;
        let (id, mut rx) = client.send_streaming(method, params).await?;

        let app = self.app.clone();
        let request_id = id.clone();
        tokio::spawn(async move {
            use super::protocol::StreamLine;
            while let Some(item) = rx.recv().await {
                match item {
                    StreamLine::Line { text } => {
                        // 子代理(Task)消息:带 parentToolUseId,走专用 chat://subagent-message
                        // 路由到对应卡片,不进主 transcript / 主 stream。
                        if let Some(rest) = text.strip_prefix("[SUBAGENT_MESSAGE]") {
                            let rest = rest.trim();
                            if let Ok(value) = serde_json::from_str::<Value>(rest) {
                                let parent = value
                                    .get("parentToolUseId")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                if let (false, Some(message)) =
                                    (parent.is_empty(), value.get("message"))
                                {
                                    let _ = app.emit(
                                        "chat://subagent-message",
                                        crate::models::chat::SubagentMessageEvent {
                                            request_id: request_id.clone(),
                                            parent_tool_use_id: parent.to_string(),
                                            json: message.to_string(),
                                        },
                                    );
                                }
                            }
                            continue;
                        }

                        // 检测 [MESSAGE] 标签，发送专用事件
                        if let Some(json) = text.strip_prefix("[MESSAGE]") {
                            let json_trimmed = json.trim();
                            if !json_trimmed.is_empty() {
                                let _ = app.emit(
                                    "chat://message",
                                    ChatMessageEvent {
                                        request_id: request_id.clone(),
                                        json: json_trimmed.to_string(),
                                    },
                                );
                            }
                        }

                        // 继续发送原始 stream 事件（向后兼容）
                        let _ = app.emit(
                            "chat://stream",
                            json!({ "requestId": request_id, "kind": "line", "text": text }),
                        );
                    }
                    StreamLine::Stderr { text } => {
                        let _ = app.emit(
                            "chat://stream",
                            json!({ "requestId": request_id, "kind": "stderr", "text": text }),
                        );
                    }
                    StreamLine::Done { success, error } => {
                        let _ = app.emit(
                            "chat://done",
                            json!({ "requestId": request_id, "success": success, "error": error }),
                        );
                        break;
                    }
                }
            }
        });

        Ok(id)
    }

    /// Abort the current in-flight turn.
    pub async fn abort(&self) -> Result<(), String> {
        let client = self.client().await?;
        client.abort().await
    }

    /// Force daemon startup without sending a command (lazy init trigger).
    pub async fn warm_up(&self) -> Result<(), String> {
        self.running_client().await.map(|_| ())
    }

    /// Whether the daemon is currently running.
    pub async fn is_running(&self) -> bool {
        match self.client.get() {
            Some(c) => c.is_running(),
            None => false,
        }
    }

    /// Stop the daemon (called on app shutdown).
    pub async fn shutdown(&self) {
        if let Some(c) = self.client.get() {
            c.stop().await;
        }
    }

    // ===== SDK 依赖管理 =====

    /// 列出所有 SDK 的安装状态。
    pub async fn sdk_status(&self) -> Result<Vec<super::sdk_installer::SdkStatus>, String> {
        let deps = resources::deps_dir(&self.app)?;
        Ok(super::sdk_installer::all_status(&deps).await)
    }

    /// 返回 Node.js 运行环境状态。优先报告 CCG Switch 私有 runtime。
    pub async fn node_runtime_status(
        &self,
    ) -> Result<super::node_runtime::NodeRuntimeStatus, String> {
        super::node_runtime::status()
    }

    /// 一键安装 CCG Switch 私有 Node.js runtime。不会修改系统 PATH 或全局 Node。
    pub async fn install_node_runtime(
        &self,
    ) -> Result<super::node_runtime::NodeRuntimeStatus, String> {
        let app = self.app.clone();
        let result = super::node_runtime::install(move |line| {
            let _ = app.emit("chat://node-runtime-install-log", json!({ "line": line }));
        })
        .await;

        let status_for_event = result.as_ref().ok().cloned();
        let _ = self.app.emit(
            "chat://node-runtime-install-done",
            json!({
                "success": result.is_ok(),
                "error": result.as_ref().err(),
                "status": status_for_event,
            }),
        );

        result
    }

    /// 安装指定 SDK，npm 日志通过 "chat://sdk-install-log" 事件推送。
    /// 安装成功后重启 daemon 以加载新装的 SDK。
    pub async fn install_sdk(&self, sdk_id: String, version: Option<String>) -> Result<(), String> {
        let sdk = super::sdk_installer::sdk_by_id(&sdk_id)
            .ok_or_else(|| format!("未知 SDK: {sdk_id}"))?;
        let node = resources::detect_node()?;
        let deps = resources::deps_dir(&self.app)?;

        let app = self.app.clone();
        let sdk_id_for_log = sdk_id.clone();
        let result =
            super::sdk_installer::install_sdk(sdk, &node, &deps, version.as_deref(), move |line| {
                let _ = app.emit(
                    "chat://sdk-install-log",
                    json!({ "sdkId": sdk_id_for_log, "line": line }),
                );
            })
            .await;

        // 通知安装结束（成功或失败）。
        let _ = self.app.emit(
            "chat://sdk-install-done",
            json!({ "sdkId": sdk_id, "success": result.is_ok(),
                    "error": result.as_ref().err() }),
        );

        result?;

        // 安装成功：重启 daemon 以预加载新装的 SDK。
        self.restart_daemon().await
    }

    /// 卸载指定 SDK。
    pub async fn uninstall_sdk(&self, sdk_id: String) -> Result<(), String> {
        let sdk = super::sdk_installer::sdk_by_id(&sdk_id)
            .ok_or_else(|| format!("未知 SDK: {sdk_id}"))?;
        let deps = resources::deps_dir(&self.app)?;
        Self::stop_cached_daemon_before_sdk_uninstall(self.client.get().cloned()).await;
        super::sdk_installer::uninstall_sdk(sdk, &deps)
    }

    async fn stop_cached_daemon_before_sdk_uninstall(client: Option<Arc<dyn ManagerDaemonClient>>) {
        if let Some(client) = client {
            if client.is_running() {
                client.stop().await;
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            }
        }
    }

    /// 重启 daemon：停止当前实例并以新进程重新启动（用于安装 SDK 后刷新）。
    pub async fn restart_daemon(&self) -> Result<(), String> {
        if let Some(c) = self.client.get() {
            let (api_key, base_url) = self.get_active_provider_config().await?;
            Self::refresh_cached_client_provider_config(
                c.clone(),
                api_key,
                base_url,
                Self::spawn_heartbeat,
            )
            .await
        } else {
            // 尚未初始化，直接懒启动（client() 内部会启动心跳）。
            self.warm_up().await
        }
    }

    /// 一键润色 Prompt：以子进程方式跑 ai-bridge 的 prompt-enhancer 脚本。
    ///
    /// 复用 daemon 的 node/bridge/deps 解析与环境注入（API Key、Base URL、
    /// AI_BRIDGE_DEPS_DIR），通过 stdin 传 `{prompt, legacyModel}` JSON，
    /// 读取 stdout 的 `[ENHANCED]<text>`（脚本把换行编码为 {{NEWLINE}}）。
    pub async fn enhance_prompt(&self, prompt: String, model: String) -> Result<String, String> {
        use std::process::Stdio;
        use tokio::io::AsyncWriteExt;

        if prompt.trim().is_empty() {
            return Ok(String::new());
        }

        let node = resources::detect_node()?;
        let bridge = resources::resolve_bridge_dir(&self.app)?;
        let deps = resources::deps_dir(&self.app)?;
        let (api_key, base_url) = self.get_active_provider_config().await?;

        // 规范化路径：去掉 Windows UNC 前缀，Node ESM loader 不认。
        let normalize = |p: &std::path::Path| -> std::path::PathBuf {
            let s = p.to_string_lossy();
            if s.starts_with(r"\\?\") {
                std::path::PathBuf::from(s.trim_start_matches(r"\\?\"))
            } else {
                p.to_path_buf()
            }
        };
        let script = normalize(&bridge.join("services").join("prompt-enhancer.js"));
        if !script.exists() {
            return Err(format!(
                "prompt-enhancer.js not found at {}",
                script.display()
            ));
        }
        let bridge_norm = normalize(&bridge);

        let payload = serde_json::json!({
            "prompt": prompt,
            "legacyModel": model,
        })
        .to_string();

        let mut cmd = tokio::process::Command::new(&node);
        let path_env =
            resources::node_execution_path_env(&node, None, std::env::var_os("PATH").as_deref());
        cmd.arg(&script)
            .current_dir(&bridge_norm)
            .env("AI_BRIDGE_DEPS_DIR", &deps)
            .env("CLAUDE_SESSION_ID", "default")
            .env("PATH", path_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(ref key) = api_key {
            cmd.env("ANTHROPIC_AUTH_TOKEN", key);
        }
        if let Some(ref url) = base_url {
            cmd.env("ANTHROPIC_BASE_URL", url);
        }
        #[cfg(windows)]
        {
            cmd.creation_flags(0x0800_0000);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("启动 prompt-enhancer 失败: {e}"))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(payload.as_bytes())
                .await
                .map_err(|e| format!("写入 enhancer stdin 失败: {e}"))?;
            stdin
                .shutdown()
                .await
                .map_err(|e| format!("关闭 enhancer stdin 失败: {e}"))?;
        }

        let output = child
            .wait_with_output()
            .await
            .map_err(|e| format!("等待 enhancer 进程失败: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        // 解析最后一行 [ENHANCED] 标签（脚本可能先打印若干诊断日志）。
        for line in stdout.lines().rev() {
            if let Some(rest) = line.strip_prefix("[ENHANCED]") {
                let decoded = rest.replace("{{NEWLINE}}", "\n");
                return Ok(decoded);
            }
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "prompt-enhancer 未返回结果。stderr: {}",
            stderr.trim()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use tokio::sync::mpsc;

    struct FakeDaemonClient {
        running: AtomicBool,
        restart_calls: AtomicUsize,
        stop_calls: AtomicUsize,
        config_update_calls: AtomicUsize,
        fail_restart: bool,
    }

    impl FakeDaemonClient {
        fn new(running: bool) -> Self {
            Self {
                running: AtomicBool::new(running),
                restart_calls: AtomicUsize::new(0),
                stop_calls: AtomicUsize::new(0),
                config_update_calls: AtomicUsize::new(0),
                fail_restart: false,
            }
        }

        fn with_restart_failure() -> Self {
            Self {
                running: AtomicBool::new(false),
                restart_calls: AtomicUsize::new(0),
                stop_calls: AtomicUsize::new(0),
                config_update_calls: AtomicUsize::new(0),
                fail_restart: true,
            }
        }
    }

    impl ManagerDaemonClient for FakeDaemonClient {
        fn is_running(&self) -> bool {
            self.running.load(Ordering::SeqCst)
        }

        fn set_event_sink(&self, _sink: EventSink) -> ClientFuture<'_, ()> {
            Box::pin(async {})
        }

        fn start(&self) -> ClientResultFuture<'_, ()> {
            Box::pin(async {
                self.running.store(true, Ordering::SeqCst);
                Ok(())
            })
        }

        fn restart(&self) -> ClientResultFuture<'_, ()> {
            Box::pin(async {
                self.restart_calls.fetch_add(1, Ordering::SeqCst);
                if self.fail_restart {
                    return Err("restart failed".into());
                }
                self.running.store(true, Ordering::SeqCst);
                Ok(())
            })
        }

        fn update_provider_config(
            &self,
            _api_key: Option<String>,
            _base_url: Option<String>,
        ) -> ClientFuture<'_, ()> {
            Box::pin(async {
                self.config_update_calls.fetch_add(1, Ordering::SeqCst);
            })
        }

        fn heartbeat(&self) -> ClientResultFuture<'_, ()> {
            Box::pin(async { Ok(()) })
        }

        fn send_streaming(
            &self,
            _method: String,
            _params: Value,
        ) -> ClientResultFuture<'_, (String, mpsc::UnboundedReceiver<StreamLine>)> {
            Box::pin(async {
                let (_tx, rx) = mpsc::unbounded_channel();
                Ok(("req-fake".into(), rx))
            })
        }

        fn abort(&self) -> ClientResultFuture<'_, ()> {
            Box::pin(async { Ok(()) })
        }

        fn stop(&self) -> ClientFuture<'_, ()> {
            Box::pin(async {
                self.stop_calls.fetch_add(1, Ordering::SeqCst);
                self.running.store(false, Ordering::SeqCst);
            })
        }
    }

    #[tokio::test]
    async fn sdk_uninstall_stops_cached_daemon_before_removing_dependencies() {
        let fake = Arc::new(FakeDaemonClient::new(true));
        let client: Arc<dyn ManagerDaemonClient> = fake.clone();

        ChatManager::stop_cached_daemon_before_sdk_uninstall(Some(client)).await;

        assert!(!fake.is_running());
        assert_eq!(fake.stop_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn running_client_restarts_stopped_cached_client_and_spawns_heartbeat() {
        let fake = Arc::new(FakeDaemonClient::new(false));
        let client: Arc<dyn ManagerDaemonClient> = fake.clone();
        let heartbeat_spawns = Arc::new(AtomicUsize::new(0));
        let captured_spawns = heartbeat_spawns.clone();

        ChatManager::ensure_running_client_with_heartbeat(client, move |_| {
            captured_spawns.fetch_add(1, Ordering::SeqCst);
        })
        .await
        .expect("stopped cached client should restart");

        assert!(fake.is_running());
        assert_eq!(fake.restart_calls.load(Ordering::SeqCst), 1);
        assert_eq!(heartbeat_spawns.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn running_client_keeps_running_cached_client_without_restart() {
        let fake = Arc::new(FakeDaemonClient::new(true));
        let client: Arc<dyn ManagerDaemonClient> = fake.clone();
        let heartbeat_spawns = Arc::new(AtomicUsize::new(0));
        let captured_spawns = heartbeat_spawns.clone();

        ChatManager::ensure_running_client_with_heartbeat(client, move |_| {
            captured_spawns.fetch_add(1, Ordering::SeqCst);
        })
        .await
        .expect("running cached client should be reused");

        assert_eq!(fake.restart_calls.load(Ordering::SeqCst), 0);
        assert_eq!(heartbeat_spawns.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn running_client_does_not_spawn_heartbeat_when_restart_fails() {
        let fake = Arc::new(FakeDaemonClient::with_restart_failure());
        let client: Arc<dyn ManagerDaemonClient> = fake.clone();
        let heartbeat_spawns = Arc::new(AtomicUsize::new(0));
        let captured_spawns = heartbeat_spawns.clone();

        let result = ChatManager::ensure_running_client_with_heartbeat(client, move |_| {
            captured_spawns.fetch_add(1, Ordering::SeqCst);
        })
        .await;
        let error = match result {
            Ok(_) => panic!("restart failure should propagate"),
            Err(error) => error,
        };

        assert_eq!(error, "restart failed");
        assert!(!fake.is_running());
        assert_eq!(fake.restart_calls.load(Ordering::SeqCst), 1);
        assert_eq!(heartbeat_spawns.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn provider_config_refresh_updates_cached_client_before_restart() {
        let fake = Arc::new(FakeDaemonClient::new(true));
        let client: Arc<dyn ManagerDaemonClient> = fake.clone();
        let heartbeat_spawns = Arc::new(AtomicUsize::new(0));
        let captured_spawns = heartbeat_spawns.clone();

        ChatManager::refresh_cached_client_provider_config(
            client,
            Some("secret-token".into()),
            Some("https://api.example.invalid".into()),
            move |_| {
                captured_spawns.fetch_add(1, Ordering::SeqCst);
            },
        )
        .await
        .expect("provider config refresh should restart cached daemon");

        assert_eq!(fake.config_update_calls.load(Ordering::SeqCst), 1);
        assert_eq!(fake.restart_calls.load(Ordering::SeqCst), 1);
        assert_eq!(heartbeat_spawns.load(Ordering::SeqCst), 1);
    }
}
