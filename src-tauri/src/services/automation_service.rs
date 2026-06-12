use crate::database::Database;
use crate::models::automation::{
    CreateWorkspaceAutomationInput, UpdateWorkspaceAutomationInput, WorkspaceAutomation,
};
use chrono::Utc;
use std::sync::Arc;

pub fn list_workspace_automations(
    db: &Arc<Database>,
    workspace_id: &str,
) -> Result<Vec<WorkspaceAutomation>, String> {
    ensure_workspace_exists(db, workspace_id)?;
    db.list_workspace_automations(workspace_id)
}

pub fn create_workspace_automation(
    db: &Arc<Database>,
    input: CreateWorkspaceAutomationInput,
) -> Result<WorkspaceAutomation, String> {
    ensure_workspace_exists(db, &input.workspace_id)?;
    let now = current_timestamp();
    let automation = WorkspaceAutomation {
        id: format!("automation-{}", uuid::Uuid::new_v4()),
        workspace_id: input.workspace_id,
        title: required_text("title", input.title)?,
        prompt: required_text("prompt", input.prompt)?,
        schedule: required_text("schedule", input.schedule)?,
        enabled: input.enabled.unwrap_or(false),
        memory_path: optional_text(input.memory_path),
        created_at: now,
        updated_at: now,
    };

    db.insert_workspace_automation(&automation)?;
    Ok(automation)
}

pub fn update_workspace_automation(
    db: &Arc<Database>,
    id: &str,
    input: UpdateWorkspaceAutomationInput,
) -> Result<WorkspaceAutomation, String> {
    let mut automation = db
        .get_workspace_automation_by_id(id)?
        .ok_or_else(|| "Automation not found".to_string())?;

    if let Some(title) = input.title {
        automation.title = required_text("title", title)?;
    }
    if let Some(prompt) = input.prompt {
        automation.prompt = required_text("prompt", prompt)?;
    }
    if let Some(schedule) = input.schedule {
        automation.schedule = required_text("schedule", schedule)?;
    }
    if let Some(enabled) = input.enabled {
        automation.enabled = enabled;
    }
    if let Some(memory_path) = input.memory_path {
        automation.memory_path = optional_text(memory_path);
    }
    automation.updated_at = current_timestamp().max(automation.updated_at + 1);

    if !db.update_workspace_automation(&automation)? {
        return Err("Automation not found".to_string());
    }
    db.get_workspace_automation_by_id(id)?
        .ok_or_else(|| "Automation not found".to_string())
}

pub fn delete_workspace_automation(db: &Arc<Database>, id: &str) -> Result<(), String> {
    if db.delete_workspace_automation(id)? {
        Ok(())
    } else {
        Err("Automation not found".to_string())
    }
}

fn ensure_workspace_exists(db: &Arc<Database>, workspace_id: &str) -> Result<(), String> {
    if db.get_workspace_by_id(workspace_id)?.is_some() {
        Ok(())
    } else {
        Err("Workspace not found".to_string())
    }
}

fn required_text(field: &str, value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{field} cannot be empty"))
    } else {
        Ok(trimmed.to_string())
    }
}

fn optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn current_timestamp() -> i64 {
    Utc::now().timestamp()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::models::automation::{
        CreateWorkspaceAutomationInput, UpdateWorkspaceAutomationInput,
    };
    use crate::models::workspace::CreateWorkspaceInput;
    use crate::services::workspace_service;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn create_update_list_and_delete_workspace_automation() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("automation-crud");
        let workspace = create_workspace(&db, &root);

        let created = create_workspace_automation(
            &db,
            CreateWorkspaceAutomationInput {
                workspace_id: workspace.id.clone(),
                title: "Morning review".to_string(),
                prompt: "Review current changes".to_string(),
                schedule: "daily 09:00".to_string(),
                enabled: Some(true),
                memory_path: Some(".codex/memory.md".to_string()),
            },
        )
        .expect("automation create should pass");

        assert!(created.id.starts_with("automation-"));
        assert_eq!(created.workspace_id, workspace.id);
        assert_eq!(created.title, "Morning review");
        assert!(created.enabled);

        let updated = update_workspace_automation(
            &db,
            &created.id,
            UpdateWorkspaceAutomationInput {
                title: Some("Evening review".to_string()),
                prompt: Some("Summarize today's work".to_string()),
                schedule: Some("daily 18:00".to_string()),
                enabled: Some(false),
                memory_path: Some(None),
            },
        )
        .expect("automation update should pass");

        assert_eq!(updated.title, "Evening review");
        assert_eq!(updated.prompt, "Summarize today's work");
        assert_eq!(updated.schedule, "daily 18:00");
        assert!(!updated.enabled);
        assert_eq!(updated.memory_path, None);
        assert!(updated.updated_at >= updated.created_at);

        let list =
            list_workspace_automations(&db, &workspace.id).expect("automation list should pass");
        assert_eq!(list, vec![updated.clone()]);

        delete_workspace_automation(&db, &updated.id).expect("automation delete should pass");
        assert!(list_workspace_automations(&db, &workspace.id)
            .unwrap()
            .is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_workspace_automation_rejects_missing_workspace_and_blank_required_fields() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));

        let missing_workspace = create_workspace_automation(
            &db,
            CreateWorkspaceAutomationInput {
                workspace_id: "workspace-missing".to_string(),
                title: "Title".to_string(),
                prompt: "Prompt".to_string(),
                schedule: "daily".to_string(),
                enabled: None,
                memory_path: None,
            },
        )
        .expect_err("missing workspace should fail");
        assert!(missing_workspace.contains("Workspace not found"));

        let root = create_temp_dir("automation-validation");
        let workspace = create_workspace(&db, &root);
        let blank_title = create_workspace_automation(
            &db,
            CreateWorkspaceAutomationInput {
                workspace_id: workspace.id.clone(),
                title: " ".to_string(),
                prompt: "Prompt".to_string(),
                schedule: "daily".to_string(),
                enabled: None,
                memory_path: None,
            },
        )
        .expect_err("blank title should fail");
        assert!(blank_title.contains("title cannot be empty"));

        let blank_prompt = create_workspace_automation(
            &db,
            CreateWorkspaceAutomationInput {
                workspace_id: workspace.id.clone(),
                title: "Title".to_string(),
                prompt: " ".to_string(),
                schedule: "daily".to_string(),
                enabled: None,
                memory_path: None,
            },
        )
        .expect_err("blank prompt should fail");
        assert!(blank_prompt.contains("prompt cannot be empty"));

        let blank_schedule = create_workspace_automation(
            &db,
            CreateWorkspaceAutomationInput {
                workspace_id: workspace.id,
                title: "Title".to_string(),
                prompt: "Prompt".to_string(),
                schedule: " ".to_string(),
                enabled: None,
                memory_path: None,
            },
        )
        .expect_err("blank schedule should fail");
        assert!(blank_schedule.contains("schedule cannot be empty"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn update_and_delete_workspace_automation_return_clear_not_found_errors() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));

        let update_error = update_workspace_automation(
            &db,
            "automation-missing",
            UpdateWorkspaceAutomationInput {
                title: Some("Title".to_string()),
                prompt: None,
                schedule: None,
                enabled: None,
                memory_path: None,
            },
        )
        .expect_err("missing update should fail");
        assert!(update_error.contains("Automation not found"));

        let delete_error = delete_workspace_automation(&db, "automation-missing")
            .expect_err("missing delete should fail");
        assert!(delete_error.contains("Automation not found"));
    }

    fn create_workspace(db: &Arc<Database>, root: &Path) -> crate::models::workspace::Workspace {
        workspace_service::create_workspace(
            db,
            CreateWorkspaceInput {
                name: None,
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
        .expect("workspace create should pass")
    }

    fn create_temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ccg-switch-automation-service-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
