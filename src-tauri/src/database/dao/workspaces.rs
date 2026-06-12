#![allow(dead_code)]

use crate::database::{lock_conn, Database};
use crate::models::workspace::{Workspace, WorkspaceBinding};
use chrono::Utc;
use rusqlite::types::Type;
use rusqlite::{OptionalExtension, Row};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::error::Error;

const WORKSPACE_COLUMNS: &str = "id, name, root_path, normalized_path, git_root, origin_url, description, tags, color, icon, default_app_type, default_provider_id, permission_policy, terminal_policy, metadata, is_favorite, created_at, updated_at, last_opened_at";
const BINDING_COLUMNS: &str = "id, workspace_id, target_type, target_id, binding_type, enabled, priority, config, created_at, updated_at";

impl Database {
    /// 插入完整 Workspace。
    pub fn insert_workspace(&self, workspace: &Workspace) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        let existing_id: Option<String> = conn
            .query_row(
                "SELECT id FROM workspaces WHERE normalized_path = ?1",
                rusqlite::params![workspace.normalized_path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to check workspace normalized_path: {e}"))?;
        if existing_id.is_some() {
            return Err("Workspace normalized_path already exists".to_string());
        }

        let tags = serialize_json("workspace tags", &workspace.tags)?;
        let default_app_type = serialize_optional_string_value(
            "workspace default_app_type",
            workspace.default_app_type,
        )?;
        let metadata = serialize_json("workspace metadata", &workspace.metadata)?;

        conn.execute(
            "INSERT INTO workspaces (id, name, root_path, normalized_path, git_root, origin_url, description, tags, color, icon, default_app_type, default_provider_id, permission_policy, terminal_policy, metadata, is_favorite, created_at, updated_at, last_opened_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            rusqlite::params![
                workspace.id,
                workspace.name,
                workspace.root_path,
                workspace.normalized_path,
                workspace.git_root,
                workspace.origin_url,
                workspace.description,
                tags,
                workspace.color,
                workspace.icon,
                default_app_type,
                workspace.default_provider_id,
                workspace.permission_policy,
                workspace.terminal_policy,
                metadata,
                workspace.is_favorite,
                workspace.created_at,
                workspace.updated_at,
                workspace.last_opened_at,
            ],
        )
        .map_err(|e| map_workspace_write_error("Failed to insert workspace", e))?;
        Ok(())
    }

    /// 获取所有 Workspace，按收藏和最近活动排序。
    pub fn list_workspaces(&self) -> Result<Vec<Workspace>, String> {
        let conn = lock_conn!(self.conn);
        let sql = format!(
            "SELECT {WORKSPACE_COLUMNS} FROM workspaces ORDER BY is_favorite DESC, last_opened_at DESC, updated_at DESC, name ASC, id ASC"
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare workspace list query: {e}"))?;

        let rows = stmt
            .query_map([], workspace_from_row)
            .map_err(|e| format!("Failed to query workspaces: {e}"))?;

        let mut workspaces = Vec::new();
        for row in rows {
            workspaces.push(row.map_err(|e| format!("Failed to read workspace row: {e}"))?);
        }
        Ok(workspaces)
    }

    /// 按 id 获取 Workspace。
    pub fn get_workspace_by_id(&self, id: &str) -> Result<Option<Workspace>, String> {
        let conn = lock_conn!(self.conn);
        let sql = format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?1");
        conn.query_row(&sql, rusqlite::params![id], workspace_from_row)
            .optional()
            .map_err(|e| format!("Failed to get workspace by id: {e}"))
    }

    /// 按 normalized_path 获取 Workspace。
    pub fn get_workspace_by_normalized_path(
        &self,
        normalized_path: &str,
    ) -> Result<Option<Workspace>, String> {
        let conn = lock_conn!(self.conn);
        let sql = format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE normalized_path = ?1");
        conn.query_row(&sql, rusqlite::params![normalized_path], workspace_from_row)
            .optional()
            .map_err(|e| format!("Failed to get workspace by normalized_path: {e}"))
    }

    /// 更新 Workspace 可变字段，不修改 id 和 created_at。
    pub fn update_workspace(&self, workspace: &Workspace) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        let tags = serialize_json("workspace tags", &workspace.tags)?;
        let default_app_type = serialize_optional_string_value(
            "workspace default_app_type",
            workspace.default_app_type,
        )?;
        let metadata = serialize_json("workspace metadata", &workspace.metadata)?;
        let updated_at = Utc::now().timestamp();

        let affected = conn
            .execute(
                "UPDATE workspaces SET name = ?1, root_path = ?2, normalized_path = ?3, git_root = ?4, origin_url = ?5, description = ?6, tags = ?7, color = ?8, icon = ?9, default_app_type = ?10, default_provider_id = ?11, permission_policy = ?12, terminal_policy = ?13, metadata = ?14, is_favorite = ?15, updated_at = ?16, last_opened_at = ?17 WHERE id = ?18",
                rusqlite::params![
                    workspace.name,
                    workspace.root_path,
                    workspace.normalized_path,
                    workspace.git_root,
                    workspace.origin_url,
                    workspace.description,
                    tags,
                    workspace.color,
                    workspace.icon,
                    default_app_type,
                    workspace.default_provider_id,
                    workspace.permission_policy,
                    workspace.terminal_policy,
                    metadata,
                    workspace.is_favorite,
                    updated_at,
                    workspace.last_opened_at,
                    workspace.id,
                ],
            )
            .map_err(|e| map_workspace_write_error("Failed to update workspace", e))?;
        Ok(affected > 0)
    }

    /// 删除 Workspace，workspace_bindings 由外键级联删除。
    pub fn delete_workspace(&self, id: &str) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "DELETE FROM workspaces WHERE id = ?1",
                rusqlite::params![id],
            )
            .map_err(|e| format!("Failed to delete workspace: {e}"))?;
        Ok(affected > 0)
    }

    /// 只刷新 Workspace 的最近打开时间。
    pub fn touch_workspace_last_opened_at(&self, id: &str, timestamp: i64) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE workspaces SET last_opened_at = CASE WHEN COALESCE(last_opened_at, 0) >= ?1 THEN COALESCE(last_opened_at, 0) + 1 ELSE ?1 END, updated_at = MAX(updated_at, CASE WHEN COALESCE(last_opened_at, 0) >= ?1 THEN COALESCE(last_opened_at, 0) + 1 ELSE ?1 END) WHERE id = ?2",
                rusqlite::params![timestamp, id],
            )
            .map_err(|e| format!("Failed to touch workspace: {e}"))?;
        Ok(affected > 0)
    }

    /// 列出某个 Workspace 的绑定。
    pub fn list_bindings_by_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<WorkspaceBinding>, String> {
        let conn = lock_conn!(self.conn);
        let sql = format!(
            "SELECT {BINDING_COLUMNS} FROM workspace_bindings WHERE workspace_id = ?1 ORDER BY priority DESC, target_type ASC, target_id ASC, binding_type ASC, id ASC"
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare workspace binding list query: {e}"))?;

        let rows = stmt
            .query_map(rusqlite::params![workspace_id], workspace_binding_from_row)
            .map_err(|e| format!("Failed to query workspace bindings: {e}"))?;

        let mut bindings = Vec::new();
        for row in rows {
            bindings.push(row.map_err(|e| format!("Failed to read workspace binding row: {e}"))?);
        }
        Ok(bindings)
    }

    /// 插入或更新 Workspace 绑定。
    ///
    /// 命中唯一键时保留原有 id 和 created_at，仅更新业务字段。
    pub fn upsert_binding(&self, binding: &WorkspaceBinding) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        let target_type =
            serialize_string_value("workspace binding target_type", &binding.target_type)?;
        let binding_type =
            serialize_string_value("workspace binding binding_type", &binding.binding_type)?;
        let config = serialize_json("workspace binding config", &binding.config)?;

        conn.execute(
            "INSERT INTO workspace_bindings (id, workspace_id, target_type, target_id, binding_type, enabled, priority, config, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT(workspace_id, target_type, target_id, binding_type) DO UPDATE SET enabled = excluded.enabled, priority = excluded.priority, config = excluded.config, updated_at = excluded.updated_at",
            rusqlite::params![
                binding.id,
                binding.workspace_id,
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
        .map_err(|e| format!("Failed to upsert workspace binding: {e}"))?;
        Ok(())
    }

    /// 删除 Workspace 绑定。
    pub fn delete_binding(&self, id: &str) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "DELETE FROM workspace_bindings WHERE id = ?1",
                rusqlite::params![id],
            )
            .map_err(|e| format!("Failed to delete workspace binding: {e}"))?;
        Ok(affected > 0)
    }
}

fn workspace_from_row(row: &Row<'_>) -> rusqlite::Result<Workspace> {
    let tags: String = row.get(7)?;
    let default_app_type: Option<String> = row.get(10)?;
    let metadata: String = row.get(14)?;

    Ok(Workspace {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        normalized_path: row.get(3)?,
        git_root: row.get(4)?,
        origin_url: row.get(5)?,
        description: row.get(6)?,
        tags: parse_json_column(7, &tags)?,
        color: row.get(8)?,
        icon: row.get(9)?,
        default_app_type: parse_optional_string_value(10, default_app_type)?,
        default_provider_id: row.get(11)?,
        permission_policy: row.get(12)?,
        terminal_policy: row.get(13)?,
        metadata: parse_json_column(14, &metadata)?,
        is_favorite: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        last_opened_at: row.get(18)?,
    })
}

fn workspace_binding_from_row(row: &Row<'_>) -> rusqlite::Result<WorkspaceBinding> {
    let target_type: String = row.get(2)?;
    let binding_type: String = row.get(4)?;
    let config: String = row.get(7)?;

    Ok(WorkspaceBinding {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
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

fn serialize_optional_string_value<T>(
    field: &str,
    value: Option<T>,
) -> Result<Option<String>, String>
where
    T: Serialize,
{
    value
        .map(|value| serialize_string_value(field, &value))
        .transpose()
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

fn parse_optional_string_value<T>(index: usize, raw: Option<String>) -> rusqlite::Result<Option<T>>
where
    T: DeserializeOwned,
{
    raw.map(|value| parse_string_value(index, &value))
        .transpose()
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

fn map_workspace_write_error(context: &str, error: rusqlite::Error) -> String {
    if matches_workspace_normalized_path_unique_error(&error) {
        return "Workspace normalized_path already exists".to_string();
    }
    format!("{context}: {error}")
}

fn matches_workspace_normalized_path_unique_error(error: &rusqlite::Error) -> bool {
    match error {
        rusqlite::Error::SqliteFailure(_, Some(message)) => {
            message.contains("UNIQUE constraint failed: workspaces.normalized_path")
        }
        _ => false,
    }
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
    use crate::models::app_type::AppType;
    use crate::models::workspace::{
        JsonObject, Workspace, WorkspaceBinding, WorkspaceBindingType, WorkspaceTargetType,
    };
    use serde_json::json;

    fn json_object(value: serde_json::Value) -> JsonObject {
        serde_json::from_value(value).expect("test JSON object should parse")
    }

    fn sample_workspace(
        id: &str,
        normalized_path: &str,
        is_favorite: bool,
        last_opened_at: Option<i64>,
        updated_at: i64,
    ) -> Workspace {
        Workspace {
            id: id.to_string(),
            name: id.to_string(),
            root_path: format!("C:\\workspaces\\{id}"),
            normalized_path: normalized_path.to_string(),
            git_root: Some(format!("C:\\workspaces\\{id}")),
            origin_url: Some(format!("https://example.com/{id}.git")),
            description: Some(format!("{id} description")),
            tags: vec!["rust".to_string(), "workspace".to_string()],
            color: Some("#2563eb".to_string()),
            icon: Some("folder".to_string()),
            default_app_type: Some(AppType::Codex),
            default_provider_id: Some("provider-1".to_string()),
            permission_policy: Some("workspace-write".to_string()),
            terminal_policy: Some("powershell".to_string()),
            metadata: json_object(json!({ "source": "test" })),
            is_favorite,
            created_at: 100,
            updated_at,
            last_opened_at,
        }
    }

    fn sample_binding(id: &str, workspace_id: &str) -> WorkspaceBinding {
        WorkspaceBinding {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            target_type: WorkspaceTargetType::Provider,
            target_id: "provider-1".to_string(),
            binding_type: WorkspaceBindingType::Default,
            enabled: true,
            priority: 1,
            config: json_object(json!({ "mode": "default" })),
            created_at: 100,
            updated_at: 100,
        }
    }

    #[test]
    fn insert_workspace_rejects_duplicate_normalized_path() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let workspace = sample_workspace("workspace-1", "c:\\workspaces\\one", false, None, 100);
        let duplicate = sample_workspace("workspace-2", "c:\\workspaces\\one", false, None, 101);

        db.insert_workspace(&workspace)
            .expect("initial workspace insert should pass");
        let error = db
            .insert_workspace(&duplicate)
            .expect_err("duplicate normalized path should be rejected");

        assert!(error.contains("normalized_path already exists"));
        assert_eq!(db.list_workspaces().unwrap().len(), 1);
    }

    #[test]
    fn list_workspaces_orders_favorites_recently_opened_then_updated() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let workspaces = [
            sample_workspace("workspace-a", "c:\\workspaces\\a", false, Some(50), 100),
            sample_workspace("workspace-b", "c:\\workspaces\\b", true, None, 300),
            sample_workspace("workspace-c", "c:\\workspaces\\c", true, Some(10), 100),
            sample_workspace("workspace-d", "c:\\workspaces\\d", false, None, 400),
        ];

        for workspace in &workspaces {
            db.insert_workspace(workspace)
                .expect("workspace insert should pass");
        }

        let ids: Vec<String> = db
            .list_workspaces()
            .expect("workspace list should pass")
            .into_iter()
            .map(|workspace| workspace.id)
            .collect();

        assert_eq!(
            ids,
            vec![
                "workspace-c".to_string(),
                "workspace-b".to_string(),
                "workspace-a".to_string(),
                "workspace-d".to_string(),
            ]
        );
    }

    #[test]
    fn get_workspace_by_id_and_normalized_path_return_expected_rows() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let workspace = sample_workspace("workspace-1", "c:\\workspaces\\one", false, None, 100);
        db.insert_workspace(&workspace)
            .expect("workspace insert should pass");

        assert_eq!(
            db.get_workspace_by_id("workspace-1").unwrap(),
            Some(workspace.clone())
        );
        assert_eq!(
            db.get_workspace_by_normalized_path("c:\\workspaces\\one")
                .unwrap(),
            Some(workspace)
        );
        assert!(db.get_workspace_by_id("missing").unwrap().is_none());
    }

    #[test]
    fn update_workspace_preserves_id_and_created_at_while_refreshing_updated_at() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let original = sample_workspace("workspace-1", "c:\\workspaces\\one", false, None, 100);
        db.insert_workspace(&original)
            .expect("workspace insert should pass");

        let mut update = sample_workspace(
            "workspace-1",
            "c:\\workspaces\\renamed",
            true,
            Some(200),
            101,
        );
        update.name = "renamed".to_string();
        update.created_at = 999;
        update.metadata = json_object(json!({ "source": "updated" }));

        assert!(db
            .update_workspace(&update)
            .expect("workspace update should pass"));
        let updated = db
            .get_workspace_by_id("workspace-1")
            .unwrap()
            .expect("workspace should still exist");

        assert_eq!(updated.id, "workspace-1");
        assert_eq!(updated.created_at, original.created_at);
        assert!(updated.updated_at > original.updated_at);
        assert_eq!(updated.name, "renamed");
        assert_eq!(updated.normalized_path, "c:\\workspaces\\renamed");
        assert_eq!(
            updated.metadata,
            json_object(json!({ "source": "updated" }))
        );
    }

    #[test]
    fn delete_workspace_cascades_workspace_bindings() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let workspace = sample_workspace("workspace-1", "c:\\workspaces\\one", false, None, 100);
        let binding = sample_binding("binding-1", "workspace-1");

        db.insert_workspace(&workspace)
            .expect("workspace insert should pass");
        db.upsert_binding(&binding)
            .expect("binding insert should pass");

        assert!(db
            .delete_workspace("workspace-1")
            .expect("workspace delete should pass"));
        assert!(db
            .list_bindings_by_workspace("workspace-1")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn touch_workspace_last_opened_at_updates_only_touch_fields() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let workspace = sample_workspace("workspace-1", "c:\\workspaces\\one", true, None, 100);
        db.insert_workspace(&workspace)
            .expect("workspace insert should pass");

        assert!(db
            .touch_workspace_last_opened_at("workspace-1", 200)
            .expect("workspace touch should pass"));
        let touched = db
            .get_workspace_by_id("workspace-1")
            .unwrap()
            .expect("workspace should exist");

        assert_eq!(touched.id, workspace.id);
        assert_eq!(touched.name, workspace.name);
        assert_eq!(touched.root_path, workspace.root_path);
        assert_eq!(touched.normalized_path, workspace.normalized_path);
        assert_eq!(touched.metadata, workspace.metadata);
        assert_eq!(touched.is_favorite, workspace.is_favorite);
        assert_eq!(touched.created_at, workspace.created_at);
        assert_eq!(touched.last_opened_at, Some(200));
        assert_eq!(touched.updated_at, 200);
    }

    #[test]
    fn upsert_binding_updates_unique_binding_and_delete_removes_it() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let workspace = sample_workspace("workspace-1", "c:\\workspaces\\one", false, None, 100);
        let binding = sample_binding("binding-1", "workspace-1");

        db.insert_workspace(&workspace)
            .expect("workspace insert should pass");
        db.upsert_binding(&binding)
            .expect("binding insert should pass");

        let mut update = sample_binding("binding-2", "workspace-1");
        update.enabled = false;
        update.priority = 10;
        update.config = json_object(json!({ "mode": "override" }));
        update.updated_at = 200;
        db.upsert_binding(&update)
            .expect("binding upsert should update existing unique binding");

        let bindings = db
            .list_bindings_by_workspace("workspace-1")
            .expect("binding list should pass");
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].id, "binding-1");
        assert!(!bindings[0].enabled);
        assert_eq!(bindings[0].priority, 10);
        assert_eq!(
            bindings[0].config,
            json_object(json!({ "mode": "override" }))
        );

        assert!(db
            .delete_binding("binding-1")
            .expect("binding delete should pass"));
        assert!(db
            .list_bindings_by_workspace("workspace-1")
            .unwrap()
            .is_empty());
    }
}
