use crate::database::Database;
use crate::models::app_type::AppType;
use crate::models::project_profile::ProjectProfile;
use crate::services::mcp_service::McpService;
use crate::services::prompt_service_v2::PromptServiceV2;
use crate::services::provider_service;
use crate::services::skill_service_v2::SkillServiceV2;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

pub struct ProjectProfileService;

impl ProjectProfileService {
    /// 获取所有项目配置
    pub fn get_profiles(db: &Arc<Database>) -> Result<Vec<ProjectProfile>, String> {
        db.get_all_project_profiles()
    }

    /// 获取单个项目配置
    #[allow(dead_code)]
    pub fn get_profile(db: &Arc<Database>, id: &str) -> Result<Option<ProjectProfile>, String> {
        db.get_project_profile_by_id(id)
    }

    /// 保存项目配置
    pub fn save_profile(db: &Arc<Database>, mut profile: ProjectProfile) -> Result<ProjectProfile, String> {
        if profile.id.trim().is_empty() {
            profile.id = Uuid::new_v4().to_string();
            profile.created_at = Utc::now().timestamp_millis();
        }
        profile.updated_at = Utc::now().timestamp_millis();
        db.save_project_profile(&profile)?;
        Ok(profile)
    }

    /// 删除项目配置
    pub fn delete_profile(db: &Arc<Database>, id: &str) -> Result<bool, String> {
        db.delete_project_profile(id)
    }

    /// 抓取当前系统状态，另存为新项目配置
    pub fn capture_current_profile(
        db: &Arc<Database>,
        name: String,
        description: Option<String>,
        icon: Option<String>,
    ) -> Result<ProjectProfile, String> {
        let now = Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();

        // 1. 抓取各应用的活跃 Provider
        let mut providers = HashMap::new();
        if let Ok(providers_list) = db.list_providers() {
            for p in providers_list {
                if p.is_active {
                    providers.insert(p.app_type.as_str().to_string(), p.id);
                }
            }
        }

        // 2. 抓取启用的 MCP 服务器
        let mut mcp_servers: HashMap<String, Vec<String>> = HashMap::new();
        if let Ok(mcp_map) = McpService::get_all(db) {
            for (server_id, server) in mcp_map {
                if server.enabled_claude {
                    mcp_servers.entry("claude".into()).or_default().push(server_id.clone());
                }
                if server.enabled_codex {
                    mcp_servers.entry("codex".into()).or_default().push(server_id.clone());
                }
                if server.enabled_gemini {
                    mcp_servers.entry("gemini".into()).or_default().push(server_id.clone());
                }
                if server.enabled_opencode {
                    mcp_servers.entry("opencode".into()).or_default().push(server_id.clone());
                }
            }
        }

        // 3. 抓取启用的技能
        let mut skills: HashMap<String, Vec<String>> = HashMap::new();
        if let Ok(skills_map) = db.get_all_installed_skills() {
            for (skill_id, skill) in skills_map {
                if skill.enabled_claude {
                    skills.entry("claude".into()).or_default().push(skill_id.clone());
                }
                if skill.enabled_codex {
                    skills.entry("codex".into()).or_default().push(skill_id.clone());
                }
                if skill.enabled_gemini {
                    skills.entry("gemini".into()).or_default().push(skill_id.clone());
                }
                if skill.enabled_opencode {
                    skills.entry("opencode".into()).or_default().push(skill_id.clone());
                }
            }
        }

        // 4. 抓取启用的 Prompt
        let mut prompts = HashMap::new();
        for app in ["claude", "codex", "gemini", "opencode"] {
            if let Ok(prompt_list) = PromptServiceV2::get_prompts(db, app) {
                if let Some(active) = prompt_list.iter().find(|p| p.enabled) {
                    prompts.insert(app.to_string(), active.id.clone());
                }
            }
        }

        let profile = ProjectProfile {
            id: id.clone(),
            name,
            description,
            icon,
            is_active: true,
            providers,
            mcp_servers,
            skills,
            prompts,
            created_at: now,
            updated_at: now,
        };

        // 保存并设为当前活跃
        db.save_project_profile(&profile)?;
        db.set_active_project_profile(&id)?;

        Ok(profile)
    }

    /// 一键应用项目配置
    pub fn apply_profile(db: &Arc<Database>, id: &str) -> Result<ProjectProfile, String> {
        let profile = db
            .get_project_profile_by_id(id)?
            .ok_or_else(|| format!("Project profile '{}' not found", id))?;

        // 1. 切换供应商
        for (app_str, provider_id) in &profile.providers {
            if let Ok(app) = app_str.parse::<AppType>() {
                if let Err(e) = provider_service::switch_provider_in_db(db, app, provider_id) {
                    tracing::warn!("[ProjectProfile] 切换 {} provider 失败: {}", app, e);
                }
            }
        }

        // 2. 同步 MCP 服务器启用状态
        if let Ok(mcp_map) = McpService::get_all(db) {
            for (server_id, mut server) in mcp_map {
                let en_claude = profile
                    .mcp_servers
                    .get("claude")
                    .map(|list| list.contains(&server_id))
                    .unwrap_or(false);
                let en_codex = profile
                    .mcp_servers
                    .get("codex")
                    .map(|list| list.contains(&server_id))
                    .unwrap_or(false);
                let en_gemini = profile
                    .mcp_servers
                    .get("gemini")
                    .map(|list| list.contains(&server_id))
                    .unwrap_or(false);
                let en_opencode = profile
                    .mcp_servers
                    .get("opencode")
                    .map(|list| list.contains(&server_id))
                    .unwrap_or(false);

                if server.enabled_claude != en_claude
                    || server.enabled_codex != en_codex
                    || server.enabled_gemini != en_gemini
                    || server.enabled_opencode != en_opencode
                {
                    server.enabled_claude = en_claude;
                    server.enabled_codex = en_codex;
                    server.enabled_gemini = en_gemini;
                    server.enabled_opencode = en_opencode;
                    if let Err(e) = McpService::upsert(db, server) {
                        tracing::warn!("[ProjectProfile] 更新 MCP 服务 {} 失败: {}", server_id, e);
                    }
                }
            }
        }

        // 3. 同步技能启用状态
        if let Ok(skills_map) = db.get_all_installed_skills() {
            for (skill_id, skill) in skills_map {
                for app in ["claude", "codex", "gemini", "opencode"] {
                    let should_enable = profile
                        .skills
                        .get(app)
                        .map(|list| list.contains(&skill_id))
                        .unwrap_or(false);
                    let current_enable = match app {
                        "claude" => skill.enabled_claude,
                        "codex" => skill.enabled_codex,
                        "gemini" => skill.enabled_gemini,
                        "opencode" => skill.enabled_opencode,
                        _ => false,
                    };
                    if should_enable != current_enable {
                        if let Err(e) = SkillServiceV2::toggle_app(db, &skill_id, app, should_enable) {
                            tracing::warn!("[ProjectProfile] 切换技能 {} app {} 失败: {}", skill_id, app, e);
                        }
                    }
                }
            }
        }

        // 4. 同步 Prompt 启用状态
        for app in ["claude", "codex", "gemini", "opencode"] {
            let target_prompt_id = profile.prompts.get(app);
            let current_prompts = PromptServiceV2::get_prompts(db, app).unwrap_or_default();
            let active_prompt = current_prompts.iter().find(|p| p.enabled);
            match (target_prompt_id, active_prompt) {
                (Some(target_id), Some(cur)) if cur.id == *target_id => {
                    // 已是活跃状态
                }
                (Some(target_id), _) => {
                    if let Err(e) = PromptServiceV2::enable_prompt(db, target_id, app) {
                        tracing::warn!("[ProjectProfile] 启用 prompt {} app {} 失败: {}", target_id, app, e);
                    }
                }
                (None, Some(cur)) => {
                    if let Err(e) = PromptServiceV2::disable_prompt(db, &cur.id, app) {
                        tracing::warn!("[ProjectProfile] 禁用 prompt {} app {} 失败: {}", cur.id, app, e);
                    }
                }
                (None, None) => {}
            }
        }

        // 5. 设置数据库中的活跃标记
        db.set_active_project_profile(id)?;

        let mut applied = profile;
        applied.is_active = true;
        Ok(applied)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_profile_crud_and_capture() {
        let db = Arc::new(Database::in_memory().unwrap());

        // 初始为空
        let profiles = ProjectProfileService::get_profiles(&db).unwrap();
        assert!(profiles.is_empty());

        // 抓取当前空/默认状态作为新项目
        let captured = ProjectProfileService::capture_current_profile(
            &db,
            "Default Workspace".into(),
            Some("My default setup".into()),
            None,
        )
        .unwrap();

        assert_eq!(captured.name, "Default Workspace");
        assert!(captured.is_active);

        let list = ProjectProfileService::get_profiles(&db).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, captured.id);

        // 应用该项目
        let applied = ProjectProfileService::apply_profile(&db, &captured.id).unwrap();
        assert!(applied.is_active);

        // 删除
        let deleted = ProjectProfileService::delete_profile(&db, &captured.id).unwrap();
        assert!(deleted);
        assert_eq!(ProjectProfileService::get_profiles(&db).unwrap().len(), 0);
    }
}
