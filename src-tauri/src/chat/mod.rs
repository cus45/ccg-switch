//! Chat module — interactive Claude Code / Codex integration.
//!
//! This module ports the daemon-bridge architecture from jetbrains-cc-gui's
//! Java `DaemonBridge` into Rust. It spawns the bundled `ai-bridge` Node.js
//! daemon, speaks NDJSON over stdin/stdout, demultiplexes streamed responses by
//! request id, and forwards stream events to the frontend via Tauri events.
//!
//! Layering:
//!   commands (chat_commands)  →  ChatManager  →  DaemonClient  →  ai-bridge node
//!
//! Protocol (must stay in sync with `resources/ai-bridge/daemon.js`):
//!   request  (stdin):  {"id":"1","method":"claude.send","params":{...}}
//!   lifecycle(stdout): {"type":"daemon","event":"ready","pid":123}
//!   stream   (stdout): {"id":"1","line":"[CONTENT_DELTA] ..."}
//!   done     (stdout): {"id":"1","done":true,"success":true}
//!   heartbeat(stdout): {"id":"2","type":"heartbeat","ts":...}

mod daemon_client;
mod manager;
mod node_runtime;
mod permission_watcher;
mod protocol;
mod resources;
mod sdk_installer;
mod session_fork;
mod slash_commands;

pub use manager::ChatManager;
pub use node_runtime::NodeRuntimeStatus;
pub use permission_watcher::{
    permission_response_session_id, write_ask_user_question_response, write_plan_approval_response,
    write_tool_permission_response,
};
pub use resources::permission_dir;
pub use sdk_installer::SdkStatus;
pub use session_fork::{fork_claude_session_file, locate_claude_session_file};
pub use slash_commands::list_slash_commands;
