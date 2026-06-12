use crate::database::dao::mcp::McpServerRow;
use crate::database::Database;
use crate::mcp;
use crate::models::capability::CapabilityType;
use crate::services::capability_service;
use indexmap::IndexMap;
use std::sync::Arc;

pub struct McpService;

impl McpService {
    pub fn get_all(db: &Arc<Database>) -> Result<IndexMap<String, McpServerRow>, String> {
        capability_service::sync_legacy_capabilities(db)?;
        let mut servers = db.get_all_mcp_servers()?;
        let mut values: Vec<McpServerRow> = servers.values().cloned().collect();
        capability_service::apply_mcp_dynamic_bindings(db, &mut values)?;

        for server in values {
            if let Some(existing) = servers.get_mut(&server.id) {
                existing.enabled_claude = server.enabled_claude;
                existing.enabled_codex = server.enabled_codex;
                existing.enabled_gemini = server.enabled_gemini;
            }
        }
        Ok(servers)
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
        }

        db.save_mcp_server(&server)?;
        capability_service::sync_mcp_server_legacy_bindings(db, &server)?;

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
        }
        let deleted = db.delete_mcp_server(id)?;
        if deleted {
            if let Some(capability) =
                db.get_capability_by_type_source(CapabilityType::McpServer, id)?
            {
                let _ = db.delete_capability_by_id(&capability.id);
            }
        }
        Ok(deleted)
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
            _ => return Err(format!("Unknown app: {}", app)),
        }

        db.save_mcp_server(server)?;
        capability_service::sync_mcp_server_legacy_bindings(db, server)?;

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
            _ => {}
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::McpService;
    use crate::database::dao::mcp::McpServerRow;
    use crate::database::Database;
    use crate::services::capability_service;
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn get_all_applies_dynamic_capability_bindings_over_legacy_columns() {
        let db = Arc::new(Database::in_memory().expect("in-memory db should initialize"));
        let legacy = McpServerRow {
            id: "server-1".to_string(),
            name: "Server 1".to_string(),
            server_config: json!({ "command": "server-1" }),
            description: None,
            tags: Vec::new(),
            enabled_claude: false,
            enabled_codex: false,
            enabled_gemini: true,
        };
        db.save_mcp_server(&legacy)
            .expect("legacy mcp save should pass");
        capability_service::sync_mcp_server_legacy_bindings(&db, &legacy)
            .expect("initial legacy sync should pass");

        let mut dynamic = legacy.clone();
        dynamic.enabled_codex = true;
        dynamic.enabled_gemini = false;
        capability_service::sync_mcp_server_legacy_bindings(&db, &dynamic)
            .expect("dynamic binding sync should pass");

        let servers = McpService::get_all(&db).expect("mcp service get should pass");
        let server = servers.get("server-1").expect("server should exist");

        assert!(!server.enabled_claude);
        assert!(server.enabled_codex);
        assert!(!server.enabled_gemini);

        let raw = db.get_all_mcp_servers().expect("raw mcp list should pass");
        assert!(!raw["server-1"].enabled_codex);
        assert!(raw["server-1"].enabled_gemini);
    }
}
