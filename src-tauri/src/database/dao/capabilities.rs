#![allow(dead_code)]

use crate::database::{lock_conn, Database};
use crate::models::capability::{
    Capability, CapabilityBinding, CapabilityBindingTargetType, CapabilityType,
};
use rusqlite::types::Type;
use rusqlite::{OptionalExtension, Row};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::error::Error;

const CAPABILITY_COLUMNS: &str =
    "id, capability_type, source_id, display_name, metadata, created_at, updated_at";
const CAPABILITY_BINDING_COLUMNS: &str =
    "id, capability_id, target_type, target_id, binding_type, enabled, priority, config, created_at, updated_at";

impl Database {
    pub fn upsert_capability(&self, capability: &Capability) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        let capability_type =
            serialize_string_value("capability capability_type", &capability.capability_type)?;
        let metadata = serialize_json("capability metadata", &capability.metadata)?;

        conn.execute(
            "INSERT INTO capabilities (id, capability_type, source_id, display_name, metadata, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(capability_type, source_id) DO UPDATE SET display_name = excluded.display_name, metadata = excluded.metadata, updated_at = excluded.updated_at",
            rusqlite::params![
                capability.id,
                capability_type,
                capability.source_id,
                capability.display_name,
                metadata,
                capability.created_at,
                capability.updated_at,
            ],
        )
        .map_err(|e| format!("Failed to upsert capability: {e}"))?;
        Ok(())
    }

    pub fn get_capability_by_type_source(
        &self,
        capability_type: CapabilityType,
        source_id: &str,
    ) -> Result<Option<Capability>, String> {
        let conn = lock_conn!(self.conn);
        let capability_type =
            serialize_string_value("capability capability_type", &capability_type)?;
        let sql = format!(
            "SELECT {CAPABILITY_COLUMNS} FROM capabilities WHERE capability_type = ?1 AND source_id = ?2"
        );
        conn.query_row(
            &sql,
            rusqlite::params![capability_type, source_id],
            capability_from_row,
        )
        .optional()
        .map_err(|e| format!("Failed to get capability by type and source: {e}"))
    }

    pub fn list_capabilities_by_type(
        &self,
        capability_type: CapabilityType,
    ) -> Result<Vec<Capability>, String> {
        let conn = lock_conn!(self.conn);
        let capability_type =
            serialize_string_value("capability capability_type", &capability_type)?;
        let sql = format!(
            "SELECT {CAPABILITY_COLUMNS} FROM capabilities WHERE capability_type = ?1 ORDER BY display_name ASC, source_id ASC, id ASC"
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare capability list query: {e}"))?;
        let rows = stmt
            .query_map(rusqlite::params![capability_type], capability_from_row)
            .map_err(|e| format!("Failed to query capabilities: {e}"))?;

        let mut capabilities = Vec::new();
        for row in rows {
            capabilities.push(row.map_err(|e| format!("Failed to read capability row: {e}"))?);
        }
        Ok(capabilities)
    }

    pub fn upsert_capability_binding(&self, binding: &CapabilityBinding) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        let target_type =
            serialize_string_value("capability binding target_type", &binding.target_type)?;
        let binding_type =
            serialize_string_value("capability binding binding_type", &binding.binding_type)?;
        let config = serialize_json("capability binding config", &binding.config)?;

        conn.execute(
            "INSERT INTO capability_bindings (id, capability_id, target_type, target_id, binding_type, enabled, priority, config, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT(capability_id, target_type, target_id, binding_type) DO UPDATE SET enabled = excluded.enabled, priority = excluded.priority, config = excluded.config, updated_at = excluded.updated_at",
            rusqlite::params![
                binding.id,
                binding.capability_id,
                target_type,
                binding.target_id,
                binding_type,
                binding.enabled,
                binding.priority,
                config,
                binding.created_at,
                binding.updated_at,
            ],
        )
        .map_err(|e| format!("Failed to upsert capability binding: {e}"))?;
        Ok(())
    }

    pub fn list_capability_bindings_by_target(
        &self,
        target_type: CapabilityBindingTargetType,
        target_id: &str,
    ) -> Result<Vec<CapabilityBinding>, String> {
        let conn = lock_conn!(self.conn);
        let target_type = serialize_string_value("capability binding target_type", &target_type)?;
        let sql = format!(
            "SELECT {CAPABILITY_BINDING_COLUMNS} FROM capability_bindings WHERE target_type = ?1 AND target_id = ?2 ORDER BY priority DESC, capability_id ASC, binding_type ASC, id ASC"
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare target capability binding list query: {e}"))?;
        let rows = stmt
            .query_map(
                rusqlite::params![target_type, target_id],
                capability_binding_from_row,
            )
            .map_err(|e| format!("Failed to query target capability bindings: {e}"))?;

        let mut bindings = Vec::new();
        for row in rows {
            bindings.push(row.map_err(|e| format!("Failed to read capability binding row: {e}"))?);
        }
        Ok(bindings)
    }

    pub fn list_capability_bindings_by_capability(
        &self,
        capability_id: &str,
    ) -> Result<Vec<CapabilityBinding>, String> {
        let conn = lock_conn!(self.conn);
        let sql = format!(
            "SELECT {CAPABILITY_BINDING_COLUMNS} FROM capability_bindings WHERE capability_id = ?1 ORDER BY priority DESC, target_type ASC, target_id ASC, binding_type ASC, id ASC"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| {
            format!("Failed to prepare capability binding list by capability query: {e}")
        })?;
        let rows = stmt
            .query_map(
                rusqlite::params![capability_id],
                capability_binding_from_row,
            )
            .map_err(|e| format!("Failed to query capability bindings by capability: {e}"))?;

        let mut bindings = Vec::new();
        for row in rows {
            bindings.push(row.map_err(|e| format!("Failed to read capability binding row: {e}"))?);
        }
        Ok(bindings)
    }

    pub fn delete_capability_by_id(&self, id: &str) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "DELETE FROM capabilities WHERE id = ?1",
                rusqlite::params![id],
            )
            .map_err(|e| format!("Failed to delete capability: {e}"))?;
        Ok(affected > 0)
    }

    pub fn delete_capability_binding(&self, id: &str) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "DELETE FROM capability_bindings WHERE id = ?1",
                rusqlite::params![id],
            )
            .map_err(|e| format!("Failed to delete capability binding: {e}"))?;
        Ok(affected > 0)
    }
}

fn capability_from_row(row: &Row<'_>) -> rusqlite::Result<Capability> {
    let capability_type: String = row.get(1)?;
    let metadata: String = row.get(4)?;

    Ok(Capability {
        id: row.get(0)?,
        capability_type: parse_string_value(1, &capability_type)?,
        source_id: row.get(2)?,
        display_name: row.get(3)?,
        metadata: parse_json_column(4, &metadata)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn capability_binding_from_row(row: &Row<'_>) -> rusqlite::Result<CapabilityBinding> {
    let target_type: String = row.get(2)?;
    let binding_type: String = row.get(4)?;
    let config: String = row.get(7)?;

    Ok(CapabilityBinding {
        id: row.get(0)?,
        capability_id: row.get(1)?,
        target_type: parse_string_value(2, &target_type)?,
        target_id: row.get(3)?,
        binding_type: parse_string_value(4, &binding_type)?,
        enabled: row.get(5)?,
        priority: row.get(6)?,
        config: parse_json_column(7, &config)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn serialize_json<T>(field: &str, value: &T) -> Result<String, String>
where
    T: Serialize,
{
    serde_json::to_string(value).map_err(|e| format!("Failed to serialize {field}: {e}"))
}

fn serialize_string_value<T>(field: &str, value: &T) -> Result<String, String>
where
    T: Serialize,
{
    match serde_json::to_value(value).map_err(|e| format!("Failed to serialize {field}: {e}"))? {
        Value::String(value) => Ok(value),
        other => Err(format!(
            "Failed to serialize {field}: expected string, found {}",
            json_type_name(&other)
        )),
    }
}

fn parse_json_column<T>(index: usize, raw: &str) -> rusqlite::Result<T>
where
    T: DeserializeOwned,
{
    serde_json::from_str(raw).map_err(|e| from_sql_error(index, e))
}

fn parse_string_value<T>(index: usize, raw: &str) -> rusqlite::Result<T>
where
    T: DeserializeOwned,
{
    serde_json::from_value(Value::String(raw.to_string())).map_err(|e| from_sql_error(index, e))
}

fn from_sql_error(index: usize, source: impl Error + Send + Sync + 'static) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, Type::Text, Box::new(source))
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use crate::database::Database;
    use crate::models::capability::{
        Capability, CapabilityBinding, CapabilityBindingTargetType, CapabilityBindingType,
        CapabilityType,
    };
    use serde_json::json;

    #[test]
    fn capability_upsert_is_idempotent() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let capability = sample_capability("capability-1", "server-1", "Server 1");

        db.upsert_capability(&capability)
            .expect("initial capability upsert should pass");

        let mut updated = sample_capability("capability-2", "server-1", "Server 1 updated");
        updated.metadata = serde_json::from_value(json!({ "origin": "updated" })).unwrap();
        updated.updated_at = 200;
        db.upsert_capability(&updated)
            .expect("second capability upsert should update existing row");

        let capabilities = db
            .list_capabilities_by_type(CapabilityType::McpServer)
            .expect("capability list should pass");
        assert_eq!(capabilities.len(), 1);
        assert_eq!(capabilities[0].id, "capability-1");
        assert_eq!(capabilities[0].display_name, "Server 1 updated");
        assert_eq!(capabilities[0].metadata["origin"], "updated");
        assert_eq!(capabilities[0].created_at, 100);
        assert_eq!(capabilities[0].updated_at, 200);
    }

    #[test]
    fn capability_binding_upsert_is_idempotent() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let capability = sample_capability("capability-1", "server-1", "Server 1");
        let binding = sample_binding("binding-1", &capability.id, "codex", true);

        db.upsert_capability(&capability)
            .expect("capability upsert should pass");
        db.upsert_capability_binding(&binding)
            .expect("initial binding upsert should pass");

        let mut updated = sample_binding("binding-2", &capability.id, "codex", false);
        updated.priority = 5;
        updated.config = serde_json::from_value(json!({ "mode": "dynamic" })).unwrap();
        updated.updated_at = 200;
        db.upsert_capability_binding(&updated)
            .expect("second binding upsert should update existing row");

        let bindings = db
            .list_capability_bindings_by_capability(&capability.id)
            .expect("binding list should pass");
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].id, "binding-1");
        assert!(!bindings[0].enabled);
        assert_eq!(bindings[0].priority, 5);
        assert_eq!(bindings[0].config["mode"], "dynamic");
        assert_eq!(bindings[0].created_at, 100);
        assert_eq!(bindings[0].updated_at, 200);
    }

    #[test]
    fn list_capability_bindings_by_target_filters_target() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let capability = sample_capability("capability-1", "server-1", "Server 1");
        db.upsert_capability(&capability)
            .expect("capability upsert should pass");
        db.upsert_capability_binding(&sample_binding(
            "binding-codex",
            &capability.id,
            "codex",
            true,
        ))
        .expect("codex binding upsert should pass");
        db.upsert_capability_binding(&sample_binding(
            "binding-claude",
            &capability.id,
            "claude",
            false,
        ))
        .expect("claude binding upsert should pass");

        let bindings = db
            .list_capability_bindings_by_target(CapabilityBindingTargetType::App, "codex")
            .expect("target binding list should pass");

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].id, "binding-codex");
        assert_eq!(bindings[0].target_id, "codex");
    }

    #[test]
    fn delete_capability_cascades_bindings() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let capability = sample_capability("capability-1", "server-1", "Server 1");
        db.upsert_capability(&capability)
            .expect("capability upsert should pass");
        db.upsert_capability_binding(&sample_binding("binding-1", &capability.id, "codex", true))
            .expect("binding upsert should pass");

        assert!(db
            .delete_capability_by_id(&capability.id)
            .expect("capability delete should pass"));
        assert!(db
            .list_capability_bindings_by_capability(&capability.id)
            .expect("binding list should pass")
            .is_empty());
    }

    fn sample_capability(id: &str, source_id: &str, display_name: &str) -> Capability {
        Capability {
            id: id.to_string(),
            capability_type: CapabilityType::McpServer,
            source_id: source_id.to_string(),
            display_name: display_name.to_string(),
            metadata: serde_json::from_value(json!({ "origin": "legacy" })).unwrap(),
            created_at: 100,
            updated_at: 100,
        }
    }

    fn sample_binding(
        id: &str,
        capability_id: &str,
        target_id: &str,
        enabled: bool,
    ) -> CapabilityBinding {
        CapabilityBinding {
            id: id.to_string(),
            capability_id: capability_id.to_string(),
            target_type: CapabilityBindingTargetType::App,
            target_id: target_id.to_string(),
            binding_type: CapabilityBindingType::Enabled,
            enabled,
            priority: 0,
            config: serde_json::from_value(json!({})).unwrap(),
            created_at: 100,
            updated_at: 100,
        }
    }
}
