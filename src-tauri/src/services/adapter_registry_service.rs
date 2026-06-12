use crate::models::adapter::{AdapterRegistry, AppIntegration, ModelAdapter};

pub fn get_adapter_registry() -> AdapterRegistry {
    AdapterRegistry {
        app_integrations: app_integrations(),
        model_adapters: model_adapters(),
    }
}

pub fn app_integrations() -> Vec<AppIntegration> {
    vec![
        AppIntegration {
            app_id: "claude".to_string(),
            display_name: "Claude Code".to_string(),
            visible: true,
            config_files: vec!["~/.claude/settings.json".to_string()],
            session_locations: vec!["~/.claude/projects".to_string()],
            resume_command_template: Some("claude --resume {sessionId}".to_string()),
            mcp_sync_supported: true,
            enabled: true,
        },
        AppIntegration {
            app_id: "codex".to_string(),
            display_name: "Codex".to_string(),
            visible: true,
            config_files: vec![
                "~/.codex/auth.json".to_string(),
                "~/.codex/config.toml".to_string(),
            ],
            session_locations: vec!["~/.codex/sessions".to_string()],
            resume_command_template: Some("codex resume {sessionId}".to_string()),
            mcp_sync_supported: true,
            enabled: true,
        },
        AppIntegration {
            app_id: "gemini".to_string(),
            display_name: "Gemini CLI".to_string(),
            visible: true,
            config_files: vec![
                "~/.gemini/.env".to_string(),
                "~/.gemini/settings.json".to_string(),
                "~/.gemini/projects.json".to_string(),
            ],
            session_locations: vec!["~/.gemini/tmp".to_string()],
            resume_command_template: Some("gemini --resume {sessionId}".to_string()),
            mcp_sync_supported: true,
            enabled: true,
        },
    ]
}

pub fn model_adapters() -> Vec<ModelAdapter> {
    vec![
        ModelAdapter {
            adapter_id: "claude".to_string(),
            display_name: "Claude".to_string(),
            protocol: "anthropic".to_string(),
            supported_transports: vec!["http".to_string()],
            auth_schemes: vec!["api_key".to_string()],
            capabilities: common_capabilities(),
        },
        ModelAdapter {
            adapter_id: "codex".to_string(),
            display_name: "Codex".to_string(),
            protocol: "openai-compatible".to_string(),
            supported_transports: vec!["http".to_string()],
            auth_schemes: vec!["api_key".to_string()],
            capabilities: common_capabilities(),
        },
        ModelAdapter {
            adapter_id: "gemini".to_string(),
            display_name: "Gemini".to_string(),
            protocol: "gemini".to_string(),
            supported_transports: vec!["http".to_string()],
            auth_schemes: vec!["api_key".to_string()],
            capabilities: common_capabilities(),
        },
    ]
}

fn common_capabilities() -> Vec<String> {
    vec![
        "chat".to_string(),
        "streaming".to_string(),
        "tool_calling".to_string(),
        "mcp".to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_contains_core_apps() {
        let registry = get_adapter_registry();

        assert_eq!(registry.app_integrations.len(), 3);
        assert_eq!(registry.model_adapters.len(), 3);
        assert_eq!(registry.app_integrations[0].app_id, "claude");
        assert_eq!(registry.app_integrations[1].app_id, "codex");
        assert_eq!(registry.app_integrations[2].app_id, "gemini");
    }

    #[test]
    fn registry_keeps_session_resume_templates() {
        let registry = get_adapter_registry();

        let templates: Vec<_> = registry
            .app_integrations
            .iter()
            .map(|app| app.resume_command_template.as_deref())
            .collect();

        assert_eq!(
            templates,
            vec![
                Some("claude --resume {sessionId}"),
                Some("codex resume {sessionId}"),
                Some("gemini --resume {sessionId}"),
            ]
        );
    }
}
