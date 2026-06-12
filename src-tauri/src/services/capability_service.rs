use crate::database::dao::mcp::McpServerRow;
use crate::database::dao::prompts::PromptRow;
use crate::database::dao::skills::InstalledSkillRow;
use crate::database::Database;
use crate::models::app_type::AppType;
use crate::models::capability::{
    Capability, CapabilityBinding, CapabilityBindingTargetType, CapabilityBindingType,
    CapabilityType,
};
use chrono::Utc;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

const LEGACY_APPS: [AppType; 3] = [AppType::Claude, AppType::Codex, AppType::Gemini];

pub fn sync_legacy_capabilities(db: &Arc<Database>) -> Result<(), String> {
    sync_mcp_legacy_capabilities(db)?;

    for skill in db.get_all_installed_skills()?.values() {
        let capability = upsert_legacy_capability(
            db,
            CapabilityType::Skill,
            &skill.id,
            &skill.name,
            json!({
                "legacySource": "skills",
                "directory": skill.directory,
            }),
        )?;
        ensure_app_binding(
            db,
            &capability.id,
            AppType::Claude,
            skill.enabled_claude,
            capability.updated_at,
        )?;
        ensure_app_binding(
            db,
            &capability.id,
            AppType::Codex,
            skill.enabled_codex,
            capability.updated_at,
        )?;
        ensure_app_binding(
            db,
            &capability.id,
            AppType::Gemini,
            skill.enabled_gemini,
            capability.updated_at,
        )?;
    }

    for app_type in LEGACY_APPS {
        let app_id = app_type.as_str();
        for prompt in db.get_prompts_by_app(app_id)? {
            let source_id = prompt_source_id(&prompt.id, app_id);
            let capability = upsert_legacy_capability(
                db,
                CapabilityType::Prompt,
                &source_id,
                &prompt.name,
                json!({
                    "legacySource": "prompts",
                    "promptId": prompt.id,
                    "appType": app_id,
                }),
            )?;
            ensure_app_binding(
                db,
                &capability.id,
                app_type,
                prompt.enabled,
                capability.updated_at,
            )?;
        }
    }

    Ok(())
}

pub fn sync_mcp_legacy_capabilities(db: &Arc<Database>) -> Result<(), String> {
    for server in db.get_all_mcp_servers()?.values() {
        ensure_mcp_server_legacy_bindings(db, server)?;
    }
    Ok(())
}

pub fn sync_mcp_server_legacy_bindings(
    db: &Arc<Database>,
    server: &McpServerRow,
) -> Result<(), String> {
    let capability = upsert_legacy_capability(
        db,
        CapabilityType::McpServer,
        &server.id,
        &server.name,
        json!({ "legacySource": "mcp_servers" }),
    )?;
    sync_app_binding(
        db,
        &capability.id,
        AppType::Claude,
        server.enabled_claude,
        capability.updated_at,
    )?;
    sync_app_binding(
        db,
        &capability.id,
        AppType::Codex,
        server.enabled_codex,
        capability.updated_at,
    )?;
    sync_app_binding(
        db,
        &capability.id,
        AppType::Gemini,
        server.enabled_gemini,
        capability.updated_at,
    )?;
    Ok(())
}

fn ensure_mcp_server_legacy_bindings(
    db: &Arc<Database>,
    server: &McpServerRow,
) -> Result<(), String> {
    let capability = upsert_legacy_capability(
        db,
        CapabilityType::McpServer,
        &server.id,
        &server.name,
        json!({ "legacySource": "mcp_servers" }),
    )?;
    ensure_app_binding(
        db,
        &capability.id,
        AppType::Claude,
        server.enabled_claude,
        capability.updated_at,
    )?;
    ensure_app_binding(
        db,
        &capability.id,
        AppType::Codex,
        server.enabled_codex,
        capability.updated_at,
    )?;
    ensure_app_binding(
        db,
        &capability.id,
        AppType::Gemini,
        server.enabled_gemini,
        capability.updated_at,
    )?;
    Ok(())
}

pub fn sync_skill_legacy_bindings(
    db: &Arc<Database>,
    skill: &InstalledSkillRow,
) -> Result<(), String> {
    let capability = upsert_legacy_capability(
        db,
        CapabilityType::Skill,
        &skill.id,
        &skill.name,
        json!({
            "legacySource": "skills",
            "directory": skill.directory,
        }),
    )?;
    sync_app_binding(
        db,
        &capability.id,
        AppType::Claude,
        skill.enabled_claude,
        capability.updated_at,
    )?;
    sync_app_binding(
        db,
        &capability.id,
        AppType::Codex,
        skill.enabled_codex,
        capability.updated_at,
    )?;
    sync_app_binding(
        db,
        &capability.id,
        AppType::Gemini,
        skill.enabled_gemini,
        capability.updated_at,
    )?;
    Ok(())
}

pub fn sync_prompt_legacy_binding(db: &Arc<Database>, prompt: &PromptRow) -> Result<(), String> {
    let source_id = prompt_source_id(&prompt.id, &prompt.app_type);
    let capability = upsert_legacy_capability(
        db,
        CapabilityType::Prompt,
        &source_id,
        &prompt.name,
        json!({
            "legacySource": "prompts",
            "promptId": prompt.id,
            "appType": prompt.app_type,
        }),
    )?;
    sync_app_binding_target_id(
        db,
        &capability.id,
        &prompt.app_type,
        prompt.enabled,
        capability.updated_at,
    )
}

pub fn sync_prompts_for_app(db: &Arc<Database>, app_type: &str) -> Result<(), String> {
    for prompt in db.get_prompts_by_app(app_type)? {
        sync_prompt_legacy_binding(db, &prompt)?;
    }
    Ok(())
}

pub fn apply_mcp_dynamic_bindings(
    db: &Arc<Database>,
    servers: &mut [McpServerRow],
) -> Result<(), String> {
    let capabilities = db.list_capabilities_by_type(CapabilityType::McpServer)?;
    let capability_by_source: HashMap<String, Capability> = capabilities
        .into_iter()
        .map(|capability| (capability.source_id.clone(), capability))
        .collect();

    for server in servers {
        let Some(capability) = capability_by_source.get(&server.id) else {
            continue;
        };
        let bindings = db.list_capability_bindings_by_capability(&capability.id)?;
        for binding in bindings {
            if binding.target_type != CapabilityBindingTargetType::App
                || binding.binding_type != CapabilityBindingType::Enabled
            {
                continue;
            }

            match binding.target_id.as_str() {
                "claude" => server.enabled_claude = binding.enabled,
                "codex" => server.enabled_codex = binding.enabled,
                "gemini" => server.enabled_gemini = binding.enabled,
                _ => {}
            }
        }
    }
    Ok(())
}

#[cfg(test)]
pub fn get_app_binding_enabled(
    db: &Arc<Database>,
    capability_type: CapabilityType,
    source_id: &str,
    app_type: AppType,
) -> Result<Option<bool>, String> {
    let Some(capability) = db.get_capability_by_type_source(capability_type, source_id)? else {
        return Ok(None);
    };

    Ok(db
        .list_capability_bindings_by_capability(&capability.id)?
        .into_iter()
        .find(|binding| {
            binding.target_type == CapabilityBindingTargetType::App
                && binding.target_id == app_type.as_str()
                && binding.binding_type == CapabilityBindingType::Enabled
        })
        .map(|binding| binding.enabled))
}

fn upsert_legacy_capability(
    db: &Arc<Database>,
    capability_type: CapabilityType,
    source_id: &str,
    display_name: &str,
    metadata: serde_json::Value,
) -> Result<Capability, String> {
    let now = Utc::now().timestamp();
    let existing = db.get_capability_by_type_source(capability_type, source_id)?;
    let metadata = serde_json::from_value(metadata)
        .map_err(|e| format!("Failed to build capability metadata: {e}"))?;

    let capability = Capability {
        id: existing
            .as_ref()
            .map(|capability| capability.id.clone())
            .unwrap_or_else(|| format!("capability-{}", uuid::Uuid::new_v4())),
        capability_type,
        source_id: source_id.to_string(),
        display_name: display_name.to_string(),
        metadata,
        created_at: existing
            .as_ref()
            .map(|capability| capability.created_at)
            .unwrap_or(now),
        updated_at: now,
    };
    db.upsert_capability(&capability)?;
    db.get_capability_by_type_source(capability_type, source_id)?
        .ok_or_else(|| "Capability upsert did not return persisted row".to_string())
}

fn sync_app_binding(
    db: &Arc<Database>,
    capability_id: &str,
    app_type: AppType,
    enabled: bool,
    timestamp: i64,
) -> Result<(), String> {
    sync_app_binding_target_id(db, capability_id, app_type.as_str(), enabled, timestamp)
}

fn sync_app_binding_target_id(
    db: &Arc<Database>,
    capability_id: &str,
    app_id: &str,
    enabled: bool,
    timestamp: i64,
) -> Result<(), String> {
    let existing = db
        .list_capability_bindings_by_capability(capability_id)?
        .into_iter()
        .find(|binding| {
            binding.target_type == CapabilityBindingTargetType::App
                && binding.target_id == app_id
                && binding.binding_type == CapabilityBindingType::Enabled
        });

    let binding = CapabilityBinding {
        id: existing
            .as_ref()
            .map(|binding| binding.id.clone())
            .unwrap_or_else(|| format!("capability-binding-{}", uuid::Uuid::new_v4())),
        capability_id: capability_id.to_string(),
        target_type: CapabilityBindingTargetType::App,
        target_id: app_id.to_string(),
        binding_type: CapabilityBindingType::Enabled,
        enabled,
        priority: existing
            .as_ref()
            .map(|binding| binding.priority)
            .unwrap_or(0),
        config: existing.map(|binding| binding.config).unwrap_or_default(),
        created_at: timestamp,
        updated_at: timestamp,
    };
    db.upsert_capability_binding(&binding)
}

fn ensure_app_binding(
    db: &Arc<Database>,
    capability_id: &str,
    app_type: AppType,
    enabled: bool,
    timestamp: i64,
) -> Result<(), String> {
    let exists = db
        .list_capability_bindings_by_capability(capability_id)?
        .into_iter()
        .any(|binding| {
            binding.target_type == CapabilityBindingTargetType::App
                && binding.target_id == app_type.as_str()
                && binding.binding_type == CapabilityBindingType::Enabled
        });
    if exists {
        return Ok(());
    }

    sync_app_binding(db, capability_id, app_type, enabled, timestamp)
}

fn prompt_source_id(prompt_id: &str, app_type: &str) -> String {
    format!("{app_type}:{prompt_id}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::dao::mcp::McpServerRow;
    use crate::database::dao::prompts::PromptRow;
    use crate::database::dao::skills::InstalledSkillRow;
    use crate::database::Database;
    use crate::models::capability::{CapabilityBindingTargetType, CapabilityType};
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn sync_legacy_mcp_servers_creates_app_bindings_from_enabled_columns() {
        let db = Arc::new(Database::in_memory().expect("in-memory db should initialize"));
        db.save_mcp_server(&sample_mcp_server("server-1", true, false, true))
            .expect("mcp server save should pass");

        sync_legacy_capabilities(&db).expect("legacy capability sync should pass");

        let capability = db
            .get_capability_by_type_source(CapabilityType::McpServer, "server-1")
            .expect("capability get should pass")
            .expect("capability should exist");
        assert_eq!(capability.display_name, "server-1");

        assert_eq!(
            get_app_binding_enabled(&db, CapabilityType::McpServer, "server-1", AppType::Claude)
                .expect("claude binding should read"),
            Some(true)
        );
        assert_eq!(
            get_app_binding_enabled(&db, CapabilityType::McpServer, "server-1", AppType::Codex)
                .expect("codex binding should read"),
            Some(false)
        );
        assert_eq!(
            get_app_binding_enabled(&db, CapabilityType::McpServer, "server-1", AppType::Gemini)
                .expect("gemini binding should read"),
            Some(true)
        );
    }

    #[test]
    fn sync_legacy_capabilities_is_idempotent() {
        let db = Arc::new(Database::in_memory().expect("in-memory db should initialize"));
        db.save_mcp_server(&sample_mcp_server("server-1", true, false, false))
            .expect("mcp server save should pass");

        sync_legacy_capabilities(&db).expect("first sync should pass");
        sync_legacy_capabilities(&db).expect("second sync should pass");

        let capabilities = db
            .list_capabilities_by_type(CapabilityType::McpServer)
            .expect("capability list should pass");
        assert_eq!(capabilities.len(), 1);

        let app_bindings = db
            .list_capability_bindings_by_target(CapabilityBindingTargetType::App, "claude")
            .expect("target binding list should pass");
        assert_eq!(app_bindings.len(), 1);
    }

    #[test]
    fn apply_mcp_dynamic_bindings_preserves_legacy_when_no_binding_exists() {
        let db = Arc::new(Database::in_memory().expect("in-memory db should initialize"));
        let mut servers = vec![sample_mcp_server("server-1", true, false, false)];

        apply_mcp_dynamic_bindings(&db, &mut servers).expect("dynamic binding overlay should pass");

        assert!(servers[0].enabled_claude);
        assert!(!servers[0].enabled_codex);
        assert!(!servers[0].enabled_gemini);
    }

    #[test]
    fn apply_mcp_dynamic_bindings_overlays_existing_dynamic_binding() {
        let db = Arc::new(Database::in_memory().expect("in-memory db should initialize"));
        let server = sample_mcp_server("server-1", false, false, true);
        db.save_mcp_server(&server)
            .expect("mcp server save should pass");
        sync_mcp_server_legacy_bindings(&db, &server).expect("legacy sync should pass");

        let mut updated = server.clone();
        updated.enabled_codex = true;
        updated.enabled_gemini = false;
        sync_mcp_server_legacy_bindings(&db, &updated).expect("binding sync should pass");

        let mut servers = vec![sample_mcp_server("server-1", false, false, true)];
        apply_mcp_dynamic_bindings(&db, &mut servers).expect("dynamic binding overlay should pass");

        assert!(!servers[0].enabled_claude);
        assert!(servers[0].enabled_codex);
        assert!(!servers[0].enabled_gemini);
    }

    #[test]
    fn mcp_toggle_app_syncs_legacy_columns_and_dynamic_binding() {
        let db = Arc::new(Database::in_memory().expect("in-memory db should initialize"));
        db.save_mcp_server(&sample_mcp_server("server-1", false, false, false))
            .expect("mcp server save should pass");

        crate::services::mcp_service::McpService::toggle_app(&db, "server-1", "codex", true)
            .expect("mcp toggle should pass");

        let servers = db
            .get_all_mcp_servers()
            .expect("mcp server list should pass");
        assert!(servers["server-1"].enabled_codex);
        assert_eq!(
            get_app_binding_enabled(&db, CapabilityType::McpServer, "server-1", AppType::Codex)
                .expect("codex binding should read"),
            Some(true)
        );
    }

    #[test]
    fn sync_legacy_skills_and_prompts_creates_app_bindings() {
        let db = Arc::new(Database::in_memory().expect("in-memory db should initialize"));
        db.save_skill(&InstalledSkillRow {
            id: "skill-1".to_string(),
            name: "Skill 1".to_string(),
            description: None,
            directory: "skill-1".to_string(),
            repo_owner: None,
            repo_name: None,
            repo_branch: None,
            readme_url: None,
            enabled_claude: true,
            enabled_codex: false,
            enabled_gemini: true,
            installed_at: 100,
        })
        .expect("skill save should pass");
        db.save_prompt(&PromptRow {
            id: "prompt-1".to_string(),
            app_type: "codex".to_string(),
            name: "Prompt 1".to_string(),
            content: "prompt content".to_string(),
            description: None,
            enabled: true,
            created_at: 100,
            updated_at: 100,
        })
        .expect("prompt save should pass");

        sync_legacy_capabilities(&db).expect("legacy sync should pass");

        assert_eq!(
            get_app_binding_enabled(&db, CapabilityType::Skill, "skill-1", AppType::Claude)
                .expect("skill claude binding should read"),
            Some(true)
        );
        assert_eq!(
            get_app_binding_enabled(&db, CapabilityType::Skill, "skill-1", AppType::Codex)
                .expect("skill codex binding should read"),
            Some(false)
        );
        assert_eq!(
            get_app_binding_enabled(&db, CapabilityType::Skill, "skill-1", AppType::Gemini)
                .expect("skill gemini binding should read"),
            Some(true)
        );
        assert_eq!(
            get_app_binding_enabled(
                &db,
                CapabilityType::Prompt,
                "codex:prompt-1",
                AppType::Codex,
            )
            .expect("prompt codex binding should read"),
            Some(true)
        );
    }

    fn sample_mcp_server(
        id: &str,
        enabled_claude: bool,
        enabled_codex: bool,
        enabled_gemini: bool,
    ) -> McpServerRow {
        McpServerRow {
            id: id.to_string(),
            name: id.to_string(),
            server_config: json!({ "command": id }),
            description: None,
            tags: Vec::new(),
            enabled_claude,
            enabled_codex,
            enabled_gemini,
        }
    }
}
