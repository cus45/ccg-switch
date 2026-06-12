use crate::database::dao::mcp::McpServerRow;
use crate::database::dao::prompts::PromptRow;
use crate::database::dao::skills::{InstalledSkillRow, SkillRepo};
use crate::database::{lock_conn, Database};
use crate::models::provider::Provider;
use crate::proxy::types::AppProxyConfig;
use crate::services::capability_service;
use crate::services::global_proxy_service::GlobalProxyConfig;
use chrono::Utc;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FailoverQueueRow {
    app_type: String,
    provider_id: String,
    sort_order: i32,
}

/// 导出所有数据库配置为单个 JSON。
pub fn export_all_config(db: &Arc<Database>) -> Result<Value, String> {
    let app_configs = export_app_configs(db)?;
    let providers = db.list_providers()?;
    let mcp_servers: Vec<McpServerRow> = db.get_all_mcp_servers()?.into_values().collect();
    let skills: Vec<InstalledSkillRow> = db.get_all_installed_skills()?.into_values().collect();
    let skill_repos = db.get_skill_repos()?;
    let prompts = export_prompts(db)?;
    let global_proxy = db.get_global_proxy()?;
    let proxy_config = export_proxy_config(db)?;
    let failover_queue = export_failover_queue(db)?;

    let config = app_configs
        .get("app_config")
        .cloned()
        .unwrap_or(Value::Null);

    Ok(json!({
        "version": "2.0",
        "storage": "database",
        "exportedAt": Utc::now().to_rfc3339(),
        "data": {
            "config": config,
            "app_configs": app_configs,
            "providers": providers,
            "mcp_servers": mcp_servers,
            "skills": skills,
            "skill_repos": skill_repos,
            "prompts": prompts,
            "global_proxy": global_proxy,
            "proxy_config": proxy_config,
            "failover_queue": failover_queue,
        }
    }))
}

/// 从导出的 JSON 恢复数据库配置。
pub fn import_config(db: &Arc<Database>, data: Value) -> Result<Vec<String>, String> {
    let data = data_section(&data)?;
    let mut imported = Vec::new();

    if let Some(app_configs) = data.get("app_configs") {
        import_app_configs(db, app_configs)?;
        imported.push("app_configs".to_string());
    } else if let Some(config) = data.get("config") {
        db.set_app_config("app_config", &serialize_config_value(config)?)?;
        imported.push("app_config".to_string());
    }

    if let Some(providers) = data.get("providers") {
        import_providers_value(db, providers)?;
        imported.push("providers".to_string());
    }

    if let Some(mcp_servers) = data.get("mcp_servers") {
        for server in parse_rows::<McpServerRow>(mcp_servers, "mcp_servers")? {
            db.save_mcp_server(&server)?;
            capability_service::sync_mcp_server_legacy_bindings(db, &server)?;
        }
        imported.push("mcp_servers".to_string());
    }

    if let Some(skills) = data.get("skills") {
        for skill in parse_rows::<InstalledSkillRow>(skills, "skills")? {
            db.save_skill(&skill)?;
            capability_service::sync_skill_legacy_bindings(db, &skill)?;
        }
        imported.push("skills".to_string());
    }

    if let Some(skill_repos) = data.get("skill_repos") {
        for repo in parse_rows::<SkillRepo>(skill_repos, "skill_repos")? {
            db.save_skill_repo(&repo)?;
        }
        imported.push("skill_repos".to_string());
    }

    if let Some(prompts) = data.get("prompts") {
        for prompt in parse_rows::<PromptRow>(prompts, "prompts")? {
            db.save_prompt(&prompt)?;
            capability_service::sync_prompt_legacy_binding(db, &prompt)?;
        }
        imported.push("prompts".to_string());
    }

    if let Some(global_proxy) = data.get("global_proxy") {
        if !global_proxy.is_null() {
            let config: GlobalProxyConfig = parse_value(global_proxy, "global_proxy")?;
            db.upsert_global_proxy(&config)?;
            imported.push("global_proxy".to_string());
        }
    }

    if let Some(proxy_config) = data.get("proxy_config") {
        for config in parse_rows::<AppProxyConfig>(proxy_config, "proxy_config")? {
            upsert_proxy_config(db, &config)?;
        }
        imported.push("proxy_config".to_string());
    }

    if let Some(failover_queue) = data.get("failover_queue") {
        for item in parse_rows::<FailoverQueueRow>(failover_queue, "failover_queue")? {
            upsert_failover_queue_item(db, &item)?;
        }
        imported.push("failover_queue".to_string());
    }

    if imported.is_empty() {
        return Err("未发现可导入的数据库配置".to_string());
    }

    Ok(imported)
}

/// 仅导出 providers 配置。
pub fn export_providers_config(db: &Arc<Database>) -> Result<Value, String> {
    Ok(json!({
        "version": "2.0",
        "type": "providers",
        "storage": "database",
        "exportedAt": Utc::now().to_rfc3339(),
        "data": {
            "providers": db.list_providers()?
        }
    }))
}

/// 仅导入 providers 配置。
pub fn import_providers_config(db: &Arc<Database>, data: Value) -> Result<Vec<String>, String> {
    let data = data_section(&data)?;
    let providers = data
        .get("providers")
        .ok_or_else(|| "导入文件缺少 data.providers".to_string())?;

    import_providers_value(db, providers)?;
    Ok(vec!["providers".to_string()])
}

fn data_section(data: &Value) -> Result<&serde_json::Map<String, Value>, String> {
    data.get("data")
        .and_then(Value::as_object)
        .ok_or_else(|| "导入文件缺少 data 对象".to_string())
}

fn parse_value<T: DeserializeOwned>(value: &Value, label: &str) -> Result<T, String> {
    serde_json::from_value(value.clone()).map_err(|e| format!("解析 {label} 失败: {e}"))
}

fn parse_rows<T: DeserializeOwned>(value: &Value, label: &str) -> Result<Vec<T>, String> {
    if let Some(object) = value.as_object() {
        if let Some(rows) = object.get(label) {
            return parse_value(rows, label);
        }
    }
    parse_value(value, label)
}

fn parse_providers(value: &Value) -> Result<Vec<Provider>, String> {
    if let Some(object) = value.as_object() {
        if let Some(providers) = object.get("providers") {
            return parse_value(providers, "providers");
        }
    }
    parse_value(value, "providers")
}

fn import_providers_value(db: &Arc<Database>, value: &Value) -> Result<(), String> {
    for provider in parse_providers(value)? {
        db.upsert_provider(&provider)?;
    }
    Ok(())
}

fn serialize_config_value(value: &Value) -> Result<String, String> {
    match value {
        Value::String(raw) => Ok(raw.clone()),
        _ => serde_json::to_string(value).map_err(|e| format!("序列化配置值失败: {e}")),
    }
}

fn export_app_configs(db: &Arc<Database>) -> Result<BTreeMap<String, Value>, String> {
    let conn = lock_conn!(db.conn);
    let mut stmt = conn
        .prepare("SELECT key, value FROM app_configs ORDER BY key ASC")
        .map_err(|e| format!("查询 app_configs 失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("读取 app_configs 失败: {e}"))?;

    let mut configs = BTreeMap::new();
    for row in rows {
        let (key, raw) = row.map_err(|e| format!("读取 app_configs 行失败: {e}"))?;
        let value = serde_json::from_str::<Value>(&raw).unwrap_or(Value::String(raw));
        configs.insert(key, value);
    }
    Ok(configs)
}

fn import_app_configs(db: &Arc<Database>, value: &Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "app_configs 必须是对象".to_string())?;

    for (key, config_value) in object {
        db.set_app_config(key, &serialize_config_value(config_value)?)?;
    }
    Ok(())
}

fn export_prompts(db: &Arc<Database>) -> Result<Vec<PromptRow>, String> {
    let conn = lock_conn!(db.conn);
    let mut stmt = conn
        .prepare(
            "SELECT id, app_type, name, content, description, enabled, created_at, updated_at
             FROM prompts ORDER BY app_type ASC, name ASC",
        )
        .map_err(|e| format!("查询 prompts 失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(PromptRow {
                id: row.get(0)?,
                app_type: row.get(1)?,
                name: row.get(2)?,
                content: row.get(3)?,
                description: row.get(4)?,
                enabled: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("读取 prompts 失败: {e}"))?;

    let mut prompts = Vec::new();
    for row in rows {
        prompts.push(row.map_err(|e| format!("读取 prompts 行失败: {e}"))?);
    }
    Ok(prompts)
}

fn export_proxy_config(db: &Arc<Database>) -> Result<Vec<AppProxyConfig>, String> {
    let conn = lock_conn!(db.conn);
    let mut stmt = conn
        .prepare(
            "SELECT app_type, enabled, auto_failover_enabled, max_retries,
             streaming_first_byte_timeout, streaming_idle_timeout, non_streaming_timeout,
             circuit_failure_threshold, circuit_success_threshold, circuit_timeout_seconds,
             circuit_error_rate_threshold, circuit_min_requests
             FROM proxy_config ORDER BY app_type ASC",
        )
        .map_err(|e| format!("查询 proxy_config 失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(AppProxyConfig {
                app_type: row.get(0)?,
                enabled: row.get(1)?,
                auto_failover_enabled: row.get(2)?,
                max_retries: row.get(3)?,
                streaming_first_byte_timeout: row.get(4)?,
                streaming_idle_timeout: row.get(5)?,
                non_streaming_timeout: row.get(6)?,
                circuit_failure_threshold: row.get(7)?,
                circuit_success_threshold: row.get(8)?,
                circuit_timeout_seconds: row.get(9)?,
                circuit_error_rate_threshold: row.get(10)?,
                circuit_min_requests: row.get(11)?,
            })
        })
        .map_err(|e| format!("读取 proxy_config 失败: {e}"))?;

    let mut configs = Vec::new();
    for row in rows {
        configs.push(row.map_err(|e| format!("读取 proxy_config 行失败: {e}"))?);
    }
    Ok(configs)
}

fn upsert_proxy_config(db: &Arc<Database>, config: &AppProxyConfig) -> Result<(), String> {
    let conn = lock_conn!(db.conn);
    conn.execute(
        "INSERT OR REPLACE INTO proxy_config (app_type, enabled, auto_failover_enabled,
         max_retries, streaming_first_byte_timeout, streaming_idle_timeout, non_streaming_timeout,
         circuit_failure_threshold, circuit_success_threshold, circuit_timeout_seconds,
         circuit_error_rate_threshold, circuit_min_requests)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            config.app_type,
            config.enabled,
            config.auto_failover_enabled,
            config.max_retries,
            config.streaming_first_byte_timeout,
            config.streaming_idle_timeout,
            config.non_streaming_timeout,
            config.circuit_failure_threshold,
            config.circuit_success_threshold,
            config.circuit_timeout_seconds,
            config.circuit_error_rate_threshold,
            config.circuit_min_requests,
        ],
    )
    .map_err(|e| format!("写入 proxy_config 失败: {e}"))?;
    Ok(())
}

fn export_failover_queue(db: &Arc<Database>) -> Result<Vec<FailoverQueueRow>, String> {
    let conn = lock_conn!(db.conn);
    let mut stmt = conn
        .prepare(
            "SELECT app_type, provider_id, sort_order
             FROM failover_queue ORDER BY app_type ASC, sort_order ASC",
        )
        .map_err(|e| format!("查询 failover_queue 失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(FailoverQueueRow {
                app_type: row.get(0)?,
                provider_id: row.get(1)?,
                sort_order: row.get(2)?,
            })
        })
        .map_err(|e| format!("读取 failover_queue 失败: {e}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("读取 failover_queue 行失败: {e}"))?);
    }
    Ok(items)
}

fn upsert_failover_queue_item(db: &Arc<Database>, item: &FailoverQueueRow) -> Result<(), String> {
    let conn = lock_conn!(db.conn);
    conn.execute(
        "INSERT OR REPLACE INTO failover_queue (app_type, provider_id, sort_order)
         VALUES (?1, ?2, ?3)",
        rusqlite::params![item.app_type, item.provider_id, item.sort_order],
    )
    .map_err(|e| format!("写入 failover_queue 失败: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::models::app_type::AppType;
    use crate::models::provider::Provider;
    use chrono::Utc;
    use std::sync::Arc;

    fn test_provider(id: &str, name: &str) -> Provider {
        Provider {
            id: id.to_string(),
            name: name.to_string(),
            app_type: AppType::Claude,
            api_key: "sk-test".to_string(),
            url: Some("https://example.com".to_string()),
            default_sonnet_model: Some("claude-sonnet-test".to_string()),
            default_opus_model: None,
            default_haiku_model: None,
            default_reasoning_model: None,
            custom_params: None,
            settings_config: None,
            meta: None,
            icon: None,
            in_failover_queue: false,
            description: None,
            tags: Some(vec!["test".to_string()]),
            is_active: true,
            created_at: Utc::now(),
            last_used: None,
            proxy_config: None,
        }
    }

    #[test]
    fn import_providers_config_writes_to_database() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let provider = test_provider("provider-1", "Provider One");
        let data = json!({
            "version": "2.0",
            "type": "providers",
            "data": {
                "providers": [provider]
            }
        });

        let imported = import_providers_config(&db, data).expect("import providers");

        assert_eq!(imported, vec!["providers"]);
        let providers = db.list_providers().expect("list providers");
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, "provider-1");
        assert_eq!(providers[0].name, "Provider One");
    }

    #[test]
    fn export_then_import_all_config_uses_database_tables() {
        let source = Arc::new(Database::in_memory().expect("init source db"));
        let target = Arc::new(Database::in_memory().expect("init target db"));
        source
            .set_app_config("app_config", r#"{"theme":"dark","language":"zh"}"#)
            .expect("seed app config");
        source
            .upsert_provider(&test_provider("provider-2", "Provider Two"))
            .expect("seed provider");

        let exported = export_all_config(&source).expect("export all config");
        let imported = import_config(&target, exported).expect("import all config");

        assert!(imported.contains(&"app_configs".to_string()));
        assert!(imported.contains(&"providers".to_string()));
        assert_eq!(
            target.get_app_config("app_config").expect("get config"),
            Some(r#"{"theme":"dark","language":"zh"}"#.to_string())
        );
        let providers = target.list_providers().expect("list providers");
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, "provider-2");
    }
}
