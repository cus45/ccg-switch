use crate::models::local_environment::{LocalEnvironmentConfig, LocalEnvironmentUpdateInput};
use crate::models::workspace::Workspace;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct EnvironmentToml {
    #[serde(default)]
    setup_script: Option<String>,
    #[serde(default)]
    setup: Option<EnvironmentSetupToml>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct EnvironmentSetupToml {
    #[serde(default)]
    script: Option<String>,
}

pub fn read_local_environment(workspace: &Workspace) -> Result<LocalEnvironmentConfig, String> {
    let environment_path = environment_file_path(workspace)?;
    let path = environment_path.to_string_lossy().to_string();

    if !environment_path.exists() {
        return Ok(LocalEnvironmentConfig {
            workspace_id: workspace.id.clone(),
            path,
            exists: false,
            setup_script: None,
            raw_toml: String::new(),
            parse_error: None,
        });
    }

    let raw_toml = fs::read_to_string(&environment_path)
        .map_err(|e| format!("Failed to read environment.toml: {e}"))?;
    match parse_environment_toml(&raw_toml) {
        Ok(parsed) => Ok(LocalEnvironmentConfig {
            workspace_id: workspace.id.clone(),
            path,
            exists: true,
            setup_script: parsed
                .setup_script
                .or_else(|| parsed.setup.and_then(|setup| setup.script)),
            raw_toml,
            parse_error: None,
        }),
        Err(error) => Ok(LocalEnvironmentConfig {
            workspace_id: workspace.id.clone(),
            path,
            exists: true,
            setup_script: None,
            raw_toml,
            parse_error: Some(error),
        }),
    }
}

pub fn save_local_environment(
    workspace: &Workspace,
    input: LocalEnvironmentUpdateInput,
) -> Result<LocalEnvironmentConfig, String> {
    if input.workspace_id != workspace.id {
        return Err("Workspace id mismatch".to_string());
    }

    let environment_path = environment_file_path(workspace)?;
    let parent = environment_path
        .parent()
        .ok_or_else(|| "Invalid environment path".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create local environment directory: {e}"))?;

    let document = EnvironmentToml {
        setup_script: None,
        setup: Some(EnvironmentSetupToml {
            script: input.setup_script.and_then(non_empty_script),
        }),
    };
    let raw_toml = toml::to_string_pretty(&document)
        .map_err(|e| format!("Failed to serialize environment.toml: {e}"))?;
    fs::write(&environment_path, raw_toml)
        .map_err(|e| format!("Failed to write environment.toml: {e}"))?;

    read_local_environment(workspace)
}

fn parse_environment_toml(raw_toml: &str) -> Result<EnvironmentToml, String> {
    toml::from_str::<EnvironmentToml>(raw_toml)
        .map_err(|e| format!("Failed to parse environment.toml: {e}"))
}

fn environment_file_path(workspace: &Workspace) -> Result<PathBuf, String> {
    let root = PathBuf::from(&workspace.root_path);
    let environment_path = root.join(".codex").join("environment.toml");
    ensure_path_inside_workspace(&root, &environment_path)?;
    Ok(environment_path)
}

fn ensure_path_inside_workspace(root: &Path, path: &Path) -> Result<(), String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve workspace root: {e}"))?;
    let candidate = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| path.to_path_buf());
    let candidate = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|e| format!("Failed to resolve local environment path: {e}"))?
    } else {
        nearest_existing_parent(&candidate)?
            .canonicalize()
            .map_err(|e| format!("Failed to resolve local environment parent: {e}"))?
    };

    if candidate.starts_with(&root) {
        Ok(())
    } else {
        Err("Local environment path must stay inside workspace".to_string())
    }
}

fn nearest_existing_parent(path: &Path) -> Result<PathBuf, String> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if candidate.exists() {
            return Ok(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    Err("No existing parent found for local environment path".to_string())
}

fn non_empty_script(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::models::local_environment::LocalEnvironmentUpdateInput;
    use crate::models::workspace::CreateWorkspaceInput;
    use crate::services::workspace_service;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn read_local_environment_returns_empty_config_when_file_is_missing() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("missing");
        let workspace = create_workspace(&db, &root);

        let config = read_local_environment(&workspace).expect("environment should be readable");

        assert_eq!(config.workspace_id, workspace.id);
        assert_eq!(
            normalize_path(&config.path),
            normalize_path(&root.join(".codex").join("environment.toml"))
        );
        assert!(!config.exists);
        assert_eq!(config.setup_script, None);
        assert_eq!(config.raw_toml, "");
        assert_eq!(config.parse_error, None);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_local_environment_writes_setup_script_inside_workspace() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("save");
        let workspace = create_workspace(&db, &root);

        let config = save_local_environment(
            &workspace,
            LocalEnvironmentUpdateInput {
                workspace_id: workspace.id.clone(),
                setup_script: Some("npm install\ncargo check".to_string()),
            },
        )
        .expect("environment should be saved");

        let environment_path = root.join(".codex").join("environment.toml");
        assert_eq!(config.workspace_id, workspace.id);
        assert!(config.exists);
        assert_eq!(
            normalize_path(&config.path),
            normalize_path(&environment_path)
        );
        assert_eq!(
            config.setup_script,
            Some("npm install\ncargo check".to_string())
        );

        let raw = fs::read_to_string(environment_path).expect("environment file should exist");
        assert!(raw.contains("[setup]"));
        assert!(raw.contains("script"));
        assert!(raw.contains("npm install"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_local_environment_preserves_non_empty_setup_script_content() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("preserve-script");
        let workspace = create_workspace(&db, &root);
        let script = "\n  npm install\n  cargo check\n".to_string();

        let config = save_local_environment(
            &workspace,
            LocalEnvironmentUpdateInput {
                workspace_id: workspace.id.clone(),
                setup_script: Some(script.clone()),
            },
        )
        .expect("environment should be saved");

        assert_eq!(config.setup_script, Some(script));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_local_environment_returns_parse_error_without_overwriting_raw_file() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("parse-error");
        let workspace = create_workspace(&db, &root);
        let environment_path = root.join(".codex").join("environment.toml");
        fs::create_dir_all(environment_path.parent().unwrap()).unwrap();
        fs::write(&environment_path, "setup = [").unwrap();

        let config = read_local_environment(&workspace).expect("environment should be readable");

        assert!(config.exists);
        assert_eq!(config.raw_toml, "setup = [");
        assert!(config.parse_error.is_some());
        assert_eq!(config.setup_script, None);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_local_environment_rejects_workspace_id_mismatch() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("mismatch");
        let workspace = create_workspace(&db, &root);

        let error = save_local_environment(
            &workspace,
            LocalEnvironmentUpdateInput {
                workspace_id: "workspace-other".to_string(),
                setup_script: Some("npm install".to_string()),
            },
        )
        .expect_err("workspace mismatch should be rejected");

        assert!(error.contains("Workspace id mismatch"));
        assert!(!root.join(".codex").join("environment.toml").exists());

        let _ = fs::remove_dir_all(root);
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

    fn normalize_path(path: impl AsRef<Path>) -> String {
        path.as_ref()
            .to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    }

    fn create_temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ccg-switch-local-env-service-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
