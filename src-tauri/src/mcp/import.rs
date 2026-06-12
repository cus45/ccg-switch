use crate::database::dao::mcp::McpServerRow;
use crate::database::Database;
use crate::services::capability_service;
use std::sync::Arc;

/// 从 ~/.claude.json 导入 MCP 服务器到数据库
/// 已存在的服务器仅启用 Claude，不覆盖其他字段
pub fn import_from_claude(db: &Arc<Database>) -> Result<usize, String> {
    let servers = super::claude::read_claude_mcp_servers();
    let mut existing = db.get_all_mcp_servers()?;
    let mut count = 0;

    for (id, spec) in servers {
        if let Some(row) = existing.get_mut(&id) {
            if !row.enabled_claude {
                row.enabled_claude = true;
                db.save_mcp_server(row)?;
                capability_service::sync_mcp_server_legacy_bindings(db, row)?;
                count += 1;
            }
        } else {
            let row = McpServerRow {
                id: id.clone(),
                name: id.clone(),
                server_config: spec,
                description: None,
                tags: vec![],
                enabled_claude: true,
                enabled_codex: false,
                enabled_gemini: false,
            };
            db.save_mcp_server(&row)?;
            capability_service::sync_mcp_server_legacy_bindings(db, &row)?;
            existing.insert(id, row);
            count += 1;
        }
    }

    Ok(count)
}

/// 从 ~/.codex/mcp.toml 导入 MCP 服务器到数据库
pub fn import_from_codex(db: &Arc<Database>) -> Result<usize, String> {
    let servers = super::codex::read_codex_mcp_servers();
    let mut existing = db.get_all_mcp_servers()?;
    let mut count = 0;

    for (id, spec) in servers {
        if let Some(row) = existing.get_mut(&id) {
            if !row.enabled_codex {
                row.enabled_codex = true;
                db.save_mcp_server(row)?;
                capability_service::sync_mcp_server_legacy_bindings(db, row)?;
                count += 1;
            }
        } else {
            let row = McpServerRow {
                id: id.clone(),
                name: id.clone(),
                server_config: spec,
                description: None,
                tags: vec![],
                enabled_claude: false,
                enabled_codex: true,
                enabled_gemini: false,
            };
            db.save_mcp_server(&row)?;
            capability_service::sync_mcp_server_legacy_bindings(db, &row)?;
            existing.insert(id, row);
            count += 1;
        }
    }

    Ok(count)
}

/// 从 ~/.gemini/settings.json 导入 MCP 服务器到数据库
pub fn import_from_gemini(db: &Arc<Database>) -> Result<usize, String> {
    let servers = super::gemini::read_gemini_mcp_servers();
    let mut existing = db.get_all_mcp_servers()?;
    let mut count = 0;

    for (id, spec) in servers {
        if let Some(row) = existing.get_mut(&id) {
            if !row.enabled_gemini {
                row.enabled_gemini = true;
                db.save_mcp_server(row)?;
                capability_service::sync_mcp_server_legacy_bindings(db, row)?;
                count += 1;
            }
        } else {
            let row = McpServerRow {
                id: id.clone(),
                name: id.clone(),
                server_config: spec,
                description: None,
                tags: vec![],
                enabled_claude: false,
                enabled_codex: false,
                enabled_gemini: true,
            };
            db.save_mcp_server(&row)?;
            capability_service::sync_mcp_server_legacy_bindings(db, &row)?;
            existing.insert(id, row);
            count += 1;
        }
    }

    Ok(count)
}

/// 从所有应用导入（合并去重）
pub fn import_from_all(db: &Arc<Database>) -> Result<usize, String> {
    let mut total = 0;
    total += import_from_claude(db).unwrap_or(0);
    total += import_from_codex(db).unwrap_or(0);
    total += import_from_gemini(db).unwrap_or(0);
    Ok(total)
}
