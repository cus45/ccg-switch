use crate::database::{lock_conn, Database};
use crate::models::automation::WorkspaceAutomation;
use rusqlite::{OptionalExtension, Row};

const AUTOMATION_COLUMNS: &str =
    "id, workspace_id, title, prompt, schedule, enabled, memory_path, created_at, updated_at";

impl Database {
    pub fn insert_workspace_automation(
        &self,
        automation: &WorkspaceAutomation,
    ) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT INTO workspace_automations (id, workspace_id, title, prompt, schedule, enabled, memory_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                automation.id,
                automation.workspace_id,
                automation.title,
                automation.prompt,
                automation.schedule,
                automation.enabled,
                automation.memory_path,
                automation.created_at,
                automation.updated_at,
            ],
        )
        .map_err(|e| format!("Failed to insert workspace automation: {e}"))?;
        Ok(())
    }

    pub fn list_workspace_automations(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<WorkspaceAutomation>, String> {
        let conn = lock_conn!(self.conn);
        let sql = format!(
            "SELECT {AUTOMATION_COLUMNS} FROM workspace_automations WHERE workspace_id = ?1 ORDER BY enabled DESC, updated_at DESC, title ASC, id ASC"
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare workspace automation list query: {e}"))?;
        let rows = stmt
            .query_map(
                rusqlite::params![workspace_id],
                workspace_automation_from_row,
            )
            .map_err(|e| format!("Failed to query workspace automations: {e}"))?;

        let mut automations = Vec::new();
        for row in rows {
            automations
                .push(row.map_err(|e| format!("Failed to read workspace automation row: {e}"))?);
        }
        Ok(automations)
    }

    pub fn get_workspace_automation_by_id(
        &self,
        id: &str,
    ) -> Result<Option<WorkspaceAutomation>, String> {
        let conn = lock_conn!(self.conn);
        let sql = format!("SELECT {AUTOMATION_COLUMNS} FROM workspace_automations WHERE id = ?1");
        conn.query_row(&sql, rusqlite::params![id], workspace_automation_from_row)
            .optional()
            .map_err(|e| format!("Failed to get workspace automation by id: {e}"))
    }

    pub fn update_workspace_automation(
        &self,
        automation: &WorkspaceAutomation,
    ) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE workspace_automations SET title = ?1, prompt = ?2, schedule = ?3, enabled = ?4, memory_path = ?5, updated_at = ?6 WHERE id = ?7",
                rusqlite::params![
                    automation.title,
                    automation.prompt,
                    automation.schedule,
                    automation.enabled,
                    automation.memory_path,
                    automation.updated_at,
                    automation.id,
                ],
            )
            .map_err(|e| format!("Failed to update workspace automation: {e}"))?;
        Ok(affected > 0)
    }

    pub fn delete_workspace_automation(&self, id: &str) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "DELETE FROM workspace_automations WHERE id = ?1",
                rusqlite::params![id],
            )
            .map_err(|e| format!("Failed to delete workspace automation: {e}"))?;
        Ok(affected > 0)
    }
}

fn workspace_automation_from_row(row: &Row<'_>) -> rusqlite::Result<WorkspaceAutomation> {
    Ok(WorkspaceAutomation {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        title: row.get(2)?,
        prompt: row.get(3)?,
        schedule: row.get(4)?,
        enabled: row.get(5)?,
        memory_path: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use crate::database::Database;
    use crate::models::automation::WorkspaceAutomation;
    use crate::models::workspace::Workspace;
    use crate::services::workspace_service;

    #[test]
    fn workspace_automation_crud_roundtrip_and_orders_enabled_first() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let workspace = sample_workspace("workspace-1");
        db.insert_workspace(&workspace)
            .expect("workspace insert should pass");

        let mut disabled = sample_automation("automation-1", &workspace.id, "Disabled", false);
        disabled.updated_at = 200;
        let mut enabled = sample_automation("automation-2", &workspace.id, "Enabled", true);
        enabled.updated_at = 100;

        db.insert_workspace_automation(&disabled)
            .expect("disabled automation insert should pass");
        db.insert_workspace_automation(&enabled)
            .expect("enabled automation insert should pass");

        let automations = db
            .list_workspace_automations(&workspace.id)
            .expect("automation list should pass");
        assert_eq!(
            automations
                .iter()
                .map(|automation| automation.id.as_str())
                .collect::<Vec<_>>(),
            vec!["automation-2", "automation-1"]
        );

        let mut updated = enabled.clone();
        updated.title = "Updated".to_string();
        updated.prompt = "Summarize current changes".to_string();
        updated.schedule = "daily 09:00".to_string();
        updated.enabled = false;
        updated.memory_path = Some(".codex/memory.md".to_string());
        updated.updated_at = 300;
        assert!(db
            .update_workspace_automation(&updated)
            .expect("automation update should pass"));

        assert_eq!(
            db.get_workspace_automation_by_id(&updated.id)
                .expect("automation get should pass"),
            Some(updated.clone())
        );
        assert!(db
            .delete_workspace_automation(&updated.id)
            .expect("automation delete should pass"));
        assert!(db
            .get_workspace_automation_by_id(&updated.id)
            .unwrap()
            .is_none());
    }

    #[test]
    fn deleting_workspace_cascades_workspace_automations() {
        let db = Database::in_memory().expect("in-memory db should initialize");
        let workspace = sample_workspace("workspace-cascade");
        let automation = sample_automation("automation-cascade", &workspace.id, "Cascade", true);

        db.insert_workspace(&workspace)
            .expect("workspace insert should pass");
        db.insert_workspace_automation(&automation)
            .expect("automation insert should pass");

        assert!(db
            .delete_workspace(&workspace.id)
            .expect("workspace delete should pass"));
        assert!(db
            .list_workspace_automations(&workspace.id)
            .expect("automation list should pass")
            .is_empty());
    }

    fn sample_workspace(id: &str) -> Workspace {
        let root = std::env::temp_dir().join(id);
        std::fs::create_dir_all(&root).unwrap();
        let db = std::sync::Arc::new(Database::in_memory().expect("workspace helper db"));
        workspace_service::create_workspace(
            &db,
            crate::models::workspace::CreateWorkspaceInput {
                name: Some(id.to_string()),
                root_path: root.to_string_lossy().to_string(),
                description: None,
                tags: None,
                color: None,
                icon: None,
                default_app_type: None,
                default_provider_id: None,
                permission_policy: None,
                terminal_policy: None,
                metadata: None,
                is_favorite: None,
            },
        )
        .expect("workspace should be created")
    }

    fn sample_automation(
        id: &str,
        workspace_id: &str,
        title: &str,
        enabled: bool,
    ) -> WorkspaceAutomation {
        WorkspaceAutomation {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            title: title.to_string(),
            prompt: "Review this workspace".to_string(),
            schedule: "daily 10:00".to_string(),
            enabled,
            memory_path: None,
            created_at: 100,
            updated_at: 100,
        }
    }
}
