use crate::database::dao::mcp::McpServerRow;
use crate::database::Database;
use crate::mcp;
use indexmap::IndexMap;
use std::sync::Arc;

pub struct McpService;

impl McpService {
    pub fn get_all(db: &Arc<Database>) -> Result<IndexMap<String, McpServerRow>, String> {
        db.get_all_mcp_servers()
    }

    pub fn upsert(db: &Arc<Database>, server: McpServerRow) -> Result<(), String> {
        let prev = db.get_all_mcp_servers()?.shift_remove(&server.id);

        // 处理"从启用变为禁用"的应用：需要从对应配置文件移除
        if let Some(ref prev) = prev {
            if prev.enabled_claude && !server.enabled_claude {
                let _ = mcp::remove_server_from_claude(&server.id);
            }
            if prev.enabled_gemini && !server.enabled_gemini {
                let _ = mcp::remove_server_from_gemini(&server.id);
            }
            if prev.enabled_codex && !server.enabled_codex {
                let _ = mcp::remove_server_from_codex(&server.id);
            }
            if prev.enabled_opencode && !server.enabled_opencode {
                let _ = mcp::remove_server_from_opencode(&server.id);
            }
        }

        db.save_mcp_server(&server)?;

        // 同步到各启用的应用配置文件
        if server.enabled_claude {
            let _ = mcp::sync_server_to_claude(&server.id, &server.server_config);
        }
        if server.enabled_gemini {
            let _ = mcp::sync_server_to_gemini(&server.id, &server.server_config);
        }
        if server.enabled_codex {
            let _ = mcp::sync_server_to_codex(&server.id, &server.server_config);
        }
        if server.enabled_opencode {
            let _ = mcp::sync_server_to_opencode(&server.id, &server.server_config);
        }

        Ok(())
    }

    pub fn delete(db: &Arc<Database>, id: &str) -> Result<bool, String> {
        let servers = db.get_all_mcp_servers()?;
        if let Some(server) = servers.get(id) {
            if server.enabled_claude {
                let _ = mcp::remove_server_from_claude(id);
            }
            if server.enabled_gemini {
                let _ = mcp::remove_server_from_gemini(id);
            }
            if server.enabled_codex {
                let _ = mcp::remove_server_from_codex(id);
            }
            if server.enabled_opencode {
                let _ = mcp::remove_server_from_opencode(id);
            }
        }
        db.delete_mcp_server(id)
    }

    pub fn toggle_app(
        db: &Arc<Database>,
        server_id: &str,
        app: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let mut servers = db.get_all_mcp_servers()?;
        let server = servers
            .get_mut(server_id)
            .ok_or_else(|| format!("MCP server '{}' not found", server_id))?;

        match app {
            "claude" => server.enabled_claude = enabled,
            "gemini" => server.enabled_gemini = enabled,
            "codex" => server.enabled_codex = enabled,
            "opencode" => server.enabled_opencode = enabled,
            _ => return Err(format!("Unknown app: {}", app)),
        }

        db.save_mcp_server(server)?;

        match (app, enabled) {
            ("claude", true) => {
                let _ = mcp::sync_server_to_claude(server_id, &server.server_config);
            }
            ("claude", false) => {
                let _ = mcp::remove_server_from_claude(server_id);
            }
            ("gemini", true) => {
                let _ = mcp::sync_server_to_gemini(server_id, &server.server_config);
            }
            ("gemini", false) => {
                let _ = mcp::remove_server_from_gemini(server_id);
            }
            ("codex", true) => {
                let _ = mcp::sync_server_to_codex(server_id, &server.server_config);
            }
            ("codex", false) => {
                let _ = mcp::remove_server_from_codex(server_id);
            }
            ("opencode", true) => {
                let _ = mcp::sync_server_to_opencode(server_id, &server.server_config);
            }
            ("opencode", false) => {
                let _ = mcp::remove_server_from_opencode(server_id);
            }
            _ => {}
        }

        Ok(())
    }
}
