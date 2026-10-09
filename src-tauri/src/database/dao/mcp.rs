use crate::database::{lock_conn, Database};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerRow {
    pub id: String,
    pub name: String,
    pub server_config: serde_json::Value,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub enabled_claude: bool,
    pub enabled_codex: bool,
    pub enabled_gemini: bool,
    /// 旧版本导出的数据没有该字段
    #[serde(default)]
    pub enabled_opencode: bool,
}

impl Database {
    pub fn get_all_mcp_servers(&self) -> Result<IndexMap<String, McpServerRow>, String> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id, name, server_config, description, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode FROM mcp_servers ORDER BY name ASC, id ASC")
            .map_err(|e| format!("Failed to prepare query: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                let config_str: String = row.get(2)?;
                let tags_str: String = row.get(4)?;
                Ok(McpServerRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    server_config: serde_json::from_str(&config_str).unwrap_or_default(),
                    description: row.get(3)?,
                    tags: serde_json::from_str(&tags_str).unwrap_or_default(),
                    enabled_claude: row.get(5)?,
                    enabled_codex: row.get(6)?,
                    enabled_gemini: row.get(7)?,
                    enabled_opencode: row.get(8)?,
                })
            })
            .map_err(|e| format!("Failed to query mcp_servers: {e}"))?;

        let mut map = IndexMap::new();
        for row in rows {
            let server = row.map_err(|e| format!("Failed to read row: {e}"))?;
            map.insert(server.id.clone(), server);
        }
        Ok(map)
    }

    pub fn save_mcp_server(&self, server: &McpServerRow) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        let config_str = serde_json::to_string(&server.server_config)
            .map_err(|e| format!("Failed to serialize config: {e}"))?;
        let tags_str = serde_json::to_string(&server.tags)
            .map_err(|e| format!("Failed to serialize tags: {e}"))?;

        conn.execute(
            "INSERT OR REPLACE INTO mcp_servers (id, name, server_config, description, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                server.id,
                server.name,
                config_str,
                server.description,
                tags_str,
                server.enabled_claude,
                server.enabled_codex,
                server.enabled_gemini,
                server.enabled_opencode,
            ],
        )
        .map_err(|e| format!("Failed to save mcp_server: {e}"))?;
        Ok(())
    }

    pub fn delete_mcp_server(&self, id: &str) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "DELETE FROM mcp_servers WHERE id = ?1",
                rusqlite::params![id],
            )
            .map_err(|e| format!("Failed to delete mcp_server: {e}"))?;
        Ok(affected > 0)
    }
}
