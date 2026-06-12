#![allow(dead_code)]

use crate::database::dao::mcp::McpServerRow;
use crate::database::Database;
use crate::models::app_type::AppType;
use crate::models::workspace::{
    CreateWorkspaceInput, Workspace, WorkspaceBinding, WorkspaceBindingType, WorkspaceTargetType,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCandidate {
    pub name: String,
    pub root_path: String,
    pub normalized_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceResolution {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<Workspace>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate: Option<WorkspaceCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveWorkspaceMcpServer {
    pub server_id: String,
    pub name: String,
    pub inherited_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub override_enabled: Option<bool>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexMcpProjectionServer {
    pub server_id: String,
    pub name: String,
    pub server_config: serde_json::Value,
}

pub fn create_workspace(
    db: &Arc<Database>,
    input: CreateWorkspaceInput,
) -> Result<Workspace, String> {
    let path = validate_workspace_directory(&input.root_path)?;
    let root_path = format_workspace_root_path(&path.to_string_lossy());
    let normalized_path = normalize_workspace_path(&root_path)?;
    if db
        .get_workspace_by_normalized_path(&normalized_path)?
        .is_some()
    {
        return Err("Workspace normalized_path already exists".to_string());
    }

    let git_root = detect_git_root(&path);
    let origin_url = git_root
        .as_deref()
        .and_then(|git_root| detect_origin_url(Path::new(git_root)));
    let now = current_timestamp();
    let name = input
        .name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| derive_workspace_name(&root_path));

    let workspace = Workspace {
        id: format!("workspace-{}", uuid::Uuid::new_v4()),
        name,
        root_path,
        normalized_path,
        git_root,
        origin_url,
        description: input.description,
        tags: input.tags.unwrap_or_default(),
        color: input.color,
        icon: input.icon,
        default_app_type: input.default_app_type,
        default_provider_id: input.default_provider_id,
        permission_policy: input.permission_policy,
        terminal_policy: input.terminal_policy,
        metadata: input.metadata.unwrap_or_default(),
        is_favorite: input.is_favorite.unwrap_or(false),
        created_at: now,
        updated_at: now,
        last_opened_at: None,
    };

    db.insert_workspace(&workspace)?;
    Ok(workspace)
}

pub fn import_project_as_workspace(
    db: &Arc<Database>,
    root_path: &str,
) -> Result<Workspace, String> {
    let path = validate_workspace_directory(root_path)?;
    let root_path = format_workspace_root_path(&path.to_string_lossy());
    let normalized_path = normalize_workspace_path(&root_path)?;
    if let Some(existing) = db.get_workspace_by_normalized_path(&normalized_path)? {
        return touch_workspace(db, &existing.id);
    }

    create_workspace(
        db,
        CreateWorkspaceInput {
            name: None,
            root_path,
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
}

pub fn resolve_workspace(
    db: &Arc<Database>,
    root_path: &str,
) -> Result<WorkspaceResolution, String> {
    let path = validate_workspace_directory(root_path)?;
    let root_path = format_workspace_root_path(&path.to_string_lossy());
    let normalized_path = normalize_workspace_path(&root_path)?;
    if let Some(workspace) = db.get_workspace_by_normalized_path(&normalized_path)? {
        return Ok(WorkspaceResolution {
            workspace: Some(workspace),
            candidate: None,
        });
    }

    let git_root = detect_git_root(&path);
    let origin_url = git_root
        .as_deref()
        .and_then(|git_root| detect_origin_url(Path::new(git_root)));

    Ok(WorkspaceResolution {
        workspace: None,
        candidate: Some(WorkspaceCandidate {
            name: derive_workspace_name(&root_path),
            root_path,
            normalized_path,
            git_root,
            origin_url,
        }),
    })
}

pub fn touch_workspace(db: &Arc<Database>, id: &str) -> Result<Workspace, String> {
    if !db.touch_workspace_last_opened_at(id, current_timestamp())? {
        return Err("Workspace not found".to_string());
    }
    db.get_workspace_by_id(id)?
        .ok_or_else(|| "Workspace not found".to_string())
}

pub fn build_effective_workspace_mcp_servers(
    app_type: AppType,
    servers: &[McpServerRow],
    bindings: &[WorkspaceBinding],
) -> Vec<EffectiveWorkspaceMcpServer> {
    servers
        .iter()
        .map(|server| {
            let inherited_enabled = mcp_server_enabled_for_app(server, app_type);
            let override_enabled = find_workspace_mcp_override(bindings, &server.id);
            EffectiveWorkspaceMcpServer {
                server_id: server.id.clone(),
                name: server.name.clone(),
                inherited_enabled,
                override_enabled,
                enabled: override_enabled.unwrap_or(inherited_enabled),
            }
        })
        .collect()
}

pub fn build_codex_mcp_projection(
    servers: &[McpServerRow],
    bindings: &[WorkspaceBinding],
) -> Vec<CodexMcpProjectionServer> {
    servers
        .iter()
        .filter(|server| {
            find_workspace_mcp_override(bindings, &server.id).unwrap_or(server.enabled_codex)
        })
        .map(|server| CodexMcpProjectionServer {
            server_id: server.id.clone(),
            name: server.name.clone(),
            server_config: server.server_config.clone(),
        })
        .collect()
}

pub fn normalize_workspace_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("workspace path cannot be empty".to_string());
    }

    let stripped = strip_windows_extended_path_prefix(trimmed);
    let replaced = stripped.replace('/', "\\");
    let collapsed = collapse_windows_separators(&replaced);
    let without_trailing = trim_trailing_separators(&collapsed);
    let normalized = normalize_case(&without_trailing);

    if normalized.is_empty() {
        Err("workspace path cannot be empty".to_string())
    } else {
        Ok(normalized)
    }
}

pub fn derive_workspace_name(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let replaced = trimmed.replace('/', "\\");
    let collapsed = collapse_windows_separators(&replaced);
    let without_trailing = trim_trailing_separators(&collapsed);

    without_trailing
        .rsplit('\\')
        .find(|segment| !segment.is_empty())
        .unwrap_or(without_trailing.as_str())
        .to_string()
}

pub fn detect_git_root(path: &Path) -> Option<String> {
    let mut current = if path.is_file() { path.parent()? } else { path };

    loop {
        if current.join(".git").exists() {
            return normalize_workspace_path(&current.to_string_lossy()).ok();
        }

        current = current.parent()?;
    }
}

pub fn detect_origin_url(git_root: &Path) -> Option<String> {
    let config_path = resolve_git_config_path(git_root)?;
    let content = fs::read_to_string(config_path).ok()?;
    extract_origin_url_from_git_config(&content)
}

fn validate_workspace_directory(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("workspace path cannot be empty".to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("workspace path must be absolute".to_string());
    }
    if !path.exists() {
        return Err("workspace path does not exist".to_string());
    }
    if !path.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    path.canonicalize()
        .map_err(|_| "workspace path cannot be normalized".to_string())
}

fn format_workspace_root_path(path: &str) -> String {
    let stripped = strip_windows_extended_path_prefix(path.trim());
    trim_trailing_separators(&collapse_windows_separators(&stripped.replace('/', "\\")))
}

fn current_timestamp() -> i64 {
    Utc::now().timestamp()
}

fn collapse_windows_separators(path: &str) -> String {
    let mut result = String::with_capacity(path.len());
    let mut chars = path.chars().peekable();
    let mut leading_separator_count = 0usize;

    while matches!(chars.peek(), Some('\\')) {
        chars.next();
        leading_separator_count += 1;
    }

    match leading_separator_count {
        0 => {}
        1 => result.push('\\'),
        _ => result.push_str("\\\\"),
    }

    let mut previous_was_separator = leading_separator_count > 0;
    for ch in chars {
        if ch == '\\' {
            if !previous_was_separator {
                result.push('\\');
            }
            previous_was_separator = true;
        } else {
            result.push(ch);
            previous_was_separator = false;
        }
    }

    result
}

fn strip_windows_extended_path_prefix(path: &str) -> String {
    if let Some(stripped) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{stripped}");
    }

    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

fn trim_trailing_separators(path: &str) -> String {
    let mut value = path.to_string();
    while value.ends_with('\\') && !is_windows_root(&value) && !is_unc_share_root(&value) {
        value.pop();
    }
    value
}

fn is_windows_root(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() == 3 && bytes[1] == b':' && bytes[2] == b'\\' && bytes[0].is_ascii_alphabetic()
}

fn is_unc_share_root(path: &str) -> bool {
    if !path.starts_with("\\\\") {
        return false;
    }

    let mut parts = path.trim_start_matches('\\').split('\\');
    matches!(
        (parts.next(), parts.next(), parts.next()),
        (Some(server), Some(share), None) if !server.is_empty() && !share.is_empty()
    )
}

fn normalize_case(path: &str) -> String {
    if looks_like_windows_path(path) {
        path.to_lowercase()
    } else {
        path.to_string()
    }
}

fn looks_like_windows_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with("\\\\")
        || (bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic())
}

fn resolve_git_config_path(git_root: &Path) -> Option<PathBuf> {
    let dot_git = git_root.join(".git");

    if dot_git.is_dir() {
        return Some(dot_git.join("config"));
    }

    if dot_git.is_file() {
        let content = fs::read_to_string(&dot_git).ok()?;
        let git_dir = parse_gitdir_file(&content, git_root)?;
        let config = git_dir.join("config");
        if config.exists() {
            return Some(config);
        }

        let common_dir = resolve_common_git_dir(&git_dir)?;
        return Some(common_dir.join("config"));
    }

    None
}

fn parse_gitdir_file(content: &str, git_root: &Path) -> Option<PathBuf> {
    let raw_path = content.trim().strip_prefix("gitdir:")?.trim();
    let path = PathBuf::from(raw_path);
    if path.is_absolute() {
        Some(path)
    } else {
        Some(git_root.join(path))
    }
}

fn resolve_common_git_dir(git_dir: &Path) -> Option<PathBuf> {
    let common_dir_path = git_dir.join("commondir");
    let content = fs::read_to_string(common_dir_path).ok()?;
    let path = PathBuf::from(content.trim());

    if path.is_absolute() {
        Some(path)
    } else {
        Some(git_dir.join(path))
    }
}

fn extract_origin_url_from_git_config(content: &str) -> Option<String> {
    let mut in_origin_section = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_origin_section = trimmed == r#"[remote "origin"]"# || trimmed == "[remote 'origin']";
            continue;
        }

        if in_origin_section {
            let (key, value) = trimmed.split_once('=')?;
            if key.trim() == "url" {
                let url = value.trim();
                if !url.is_empty() {
                    return sanitize_origin_url(url);
                }
            }
        }
    }

    None
}

fn sanitize_origin_url(raw_url: &str) -> Option<String> {
    let Ok(mut url) = url::Url::parse(raw_url) else {
        return None;
    };

    if !url.username().is_empty() || url.password().is_some() {
        let _ = url.set_username("");
        let _ = url.set_password(None);
    }

    url.set_query(None);
    url.set_fragment(None);

    Some(url.to_string())
}

fn mcp_server_enabled_for_app(server: &McpServerRow, app_type: AppType) -> bool {
    match app_type {
        AppType::Claude => server.enabled_claude,
        AppType::Codex => server.enabled_codex,
        AppType::Gemini => server.enabled_gemini,
        AppType::OpenCode | AppType::OpenClaw => false,
    }
}

fn find_workspace_mcp_override(bindings: &[WorkspaceBinding], server_id: &str) -> Option<bool> {
    bindings
        .iter()
        .find(|binding| {
            binding.target_type == WorkspaceTargetType::McpServer
                && binding.binding_type == WorkspaceBindingType::Override
                && binding.target_id == server_id
        })
        .map(|binding| binding.enabled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::dao::mcp::McpServerRow;
    use crate::database::Database;
    use crate::models::app_type::AppType;
    use crate::models::workspace::{
        CreateWorkspaceInput, JsonObject, WorkspaceBinding, WorkspaceBindingType,
        WorkspaceTargetType,
    };
    use serde_json::json;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn normalize_workspace_path_rejects_empty_input() {
        assert!(normalize_workspace_path("  ").is_err());
    }

    #[test]
    fn normalize_workspace_path_handles_drive_case_and_separators() {
        let normalized = normalize_workspace_path(r#"C:/GuoDevelop//CCG-Switch/"#).unwrap();
        assert_eq!(normalized, r#"c:\guodevelop\ccg-switch"#);
    }

    #[test]
    fn normalize_workspace_path_preserves_windows_drive_root() {
        let normalized = normalize_workspace_path("C:/").unwrap();
        assert_eq!(normalized, r#"c:\"#);
    }

    #[test]
    fn normalize_workspace_path_handles_unc_share_root() {
        let normalized = normalize_workspace_path(r#"\\Server//Share/"#).unwrap();
        assert_eq!(normalized, r#"\\server\share"#);
    }

    #[test]
    fn normalize_workspace_path_strips_windows_extended_prefix() {
        let normalized = normalize_workspace_path(r#"\\?\C:\GuoDevelop\CCG-Switch"#).unwrap();
        assert_eq!(normalized, r#"c:\guodevelop\ccg-switch"#);
    }

    #[test]
    fn derive_workspace_name_uses_last_path_segment() {
        assert_eq!(
            derive_workspace_name(r#"C:\guodevelop\ccg-switch\"#),
            "ccg-switch"
        );
    }

    #[test]
    fn derive_workspace_name_returns_root_for_drive_root() {
        assert_eq!(derive_workspace_name("C:/"), "C:");
    }

    #[test]
    fn detect_git_root_finds_parent_repository() {
        let root = create_temp_dir("git-root");
        let nested = root.join("src").join("pages");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir(root.join(".git")).unwrap();

        let detected = detect_git_root(&nested).unwrap();
        assert_eq!(
            detected,
            normalize_workspace_path(&root.to_string_lossy()).unwrap()
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detect_git_root_returns_none_outside_repository() {
        let root = create_temp_dir("no-git-root");
        fs::create_dir_all(root.join("src")).unwrap();

        assert!(detect_git_root(&root.join("src")).is_none());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detect_origin_url_reads_origin_section() {
        let root = create_temp_dir("origin-url");
        let git_dir = root.join(".git");
        fs::create_dir_all(&git_dir).unwrap();
        fs::write(
            git_dir.join("config"),
            r#"
[remote "upstream"]
    url = https://example.com/upstream.git
[remote "origin"]
    fetch = +refs/heads/*:refs/remotes/origin/*
    url = https://example.com/repo.git
"#,
        )
        .unwrap();

        assert_eq!(
            detect_origin_url(&root),
            Some("https://example.com/repo.git".to_string())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detect_origin_url_strips_embedded_credentials() {
        let root = create_temp_dir("credentialed-origin-url");
        let git_dir = root.join(".git");
        fs::create_dir_all(&git_dir).unwrap();
        fs::write(
            git_dir.join("config"),
            r#"
[remote "origin"]
    url = https://user:token@example.com/repo.git
"#,
        )
        .unwrap();

        assert_eq!(
            detect_origin_url(&root),
            Some("https://example.com/repo.git".to_string())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detect_origin_url_removes_query_and_fragment() {
        let root = create_temp_dir("query-token-origin-url");
        let git_dir = root.join(".git");
        fs::create_dir_all(&git_dir).unwrap();
        fs::write(
            git_dir.join("config"),
            r#"
[remote "origin"]
    url = https://example.com/repo.git?credential=secret&ref=main#token=secret
"#,
        )
        .unwrap();

        assert_eq!(
            detect_origin_url(&root),
            Some("https://example.com/repo.git".to_string())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detect_origin_url_drops_unparseable_remote_url() {
        let root = create_temp_dir("unparseable-origin-url");
        let git_dir = root.join(".git");
        fs::create_dir_all(&git_dir).unwrap();
        fs::write(
            git_dir.join("config"),
            r#"
[remote "origin"]
    url = not a url with token=secret
"#,
        )
        .unwrap();

        assert_eq!(detect_origin_url(&root), None);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detect_origin_url_returns_none_without_origin() {
        let root = create_temp_dir("no-origin-url");
        let git_dir = root.join(".git");
        fs::create_dir_all(&git_dir).unwrap();
        fs::write(
            git_dir.join("config"),
            r#"
[remote "upstream"]
    url = https://example.com/upstream.git
"#,
        )
        .unwrap();

        assert_eq!(detect_origin_url(&root), None);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_workspace_validates_directory_and_fills_derived_fields() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("create-workspace");
        let git_dir = root.join(".git");
        fs::create_dir_all(&git_dir).unwrap();
        fs::write(
            git_dir.join("config"),
            r#"
[remote "origin"]
    url = https://user:token@example.com/repo.git
"#,
        )
        .unwrap();

        let workspace = create_workspace(
            &db,
            CreateWorkspaceInput {
                name: None,
                root_path: root.to_string_lossy().to_string(),
                description: Some("Workspace description".to_string()),
                tags: Some(vec!["rust".to_string()]),
                color: Some("#2563eb".to_string()),
                icon: Some("folder".to_string()),
                default_app_type: Some(AppType::Codex),
                default_provider_id: Some("provider-1".to_string()),
                permission_policy: Some("workspace-write".to_string()),
                terminal_policy: Some("powershell".to_string()),
                metadata: Some(
                    serde_json::from_value(serde_json::json!({
                        "source": "test"
                    }))
                    .unwrap(),
                ),
                is_favorite: Some(true),
            },
        )
        .expect("workspace create should pass");

        assert!(workspace.id.starts_with("workspace-"));
        assert_eq!(workspace.name, derive_workspace_name(&workspace.root_path));
        assert_eq!(
            workspace.normalized_path,
            normalize_workspace_path(&root.to_string_lossy()).unwrap()
        );
        assert_eq!(
            workspace.git_root,
            Some(normalize_workspace_path(&root.to_string_lossy()).unwrap())
        );
        assert_eq!(
            workspace.origin_url,
            Some("https://example.com/repo.git".to_string())
        );
        assert_eq!(workspace.tags, vec!["rust".to_string()]);
        assert_eq!(workspace.default_app_type, Some(AppType::Codex));
        assert_eq!(workspace.created_at, workspace.updated_at);
        assert!(workspace.created_at <= current_timestamp());
        assert_eq!(workspace.last_opened_at, None);

        let persisted = db
            .get_workspace_by_id(&workspace.id)
            .unwrap()
            .expect("workspace should persist");
        assert_eq!(persisted, workspace);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_workspace_rejects_missing_path_and_files() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let relative_error = create_workspace(
            &db,
            CreateWorkspaceInput {
                name: None,
                root_path: ".".to_string(),
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
        .expect_err("relative path should fail");
        assert!(relative_error.contains("must be absolute"));

        let missing = std::env::temp_dir().join(format!(
            "ccg-switch-workspace-service-missing-{}",
            current_timestamp()
        ));
        let missing_error = create_workspace(
            &db,
            CreateWorkspaceInput {
                name: None,
                root_path: missing.to_string_lossy().to_string(),
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
        .expect_err("missing path should fail");
        assert!(missing_error.contains("does not exist"));

        let root = create_temp_dir("file-path");
        let file = root.join("workspace.txt");
        fs::write(&file, "not a directory").unwrap();
        let file_error = create_workspace(
            &db,
            CreateWorkspaceInput {
                name: None,
                root_path: file.to_string_lossy().to_string(),
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
        .expect_err("file path should fail");
        assert!(file_error.contains("must be a directory"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_workspace_uses_canonical_path_for_identity() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("canonical-identity");
        let child = root.join("child");
        fs::create_dir_all(&child).unwrap();

        let created = create_workspace(
            &db,
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
        .expect("workspace create should pass");

        let duplicate_error = create_workspace(
            &db,
            CreateWorkspaceInput {
                name: None,
                root_path: child.join("..").to_string_lossy().to_string(),
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
        .expect_err("canonical duplicate should fail");

        assert!(duplicate_error.contains("normalized_path already exists"));
        assert_eq!(db.list_workspaces().unwrap(), vec![created]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_project_as_workspace_creates_new_and_touches_existing() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("import-project");

        let created = import_project_as_workspace(&db, &root.to_string_lossy())
            .expect("new project import should create workspace");
        assert_eq!(created.last_opened_at, None);
        assert_eq!(db.list_workspaces().unwrap().len(), 1);

        let imported = import_project_as_workspace(&db, &root.to_string_lossy())
            .expect("existing project import should touch workspace");
        assert_eq!(imported.id, created.id);
        assert!(imported.last_opened_at.is_some());
        assert_eq!(db.list_workspaces().unwrap().len(), 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_workspace_returns_existing_or_candidate_without_creating() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let existing_root = create_temp_dir("resolve-existing");
        let candidate_root = create_temp_dir("resolve-candidate");
        let created = import_project_as_workspace(&db, &existing_root.to_string_lossy())
            .expect("workspace import should pass");

        let existing = resolve_workspace(&db, &existing_root.to_string_lossy())
            .expect("existing workspace should resolve");
        assert_eq!(existing.workspace, Some(created));
        assert_eq!(existing.candidate, None);

        let candidate = resolve_workspace(&db, &candidate_root.to_string_lossy())
            .expect("candidate workspace should resolve");
        assert!(candidate.workspace.is_none());
        let candidate = candidate.candidate.expect("candidate should exist");
        assert_eq!(candidate.name, derive_workspace_name(&candidate.root_path));
        assert_eq!(
            candidate.normalized_path,
            normalize_workspace_path(&candidate_root.to_string_lossy()).unwrap()
        );
        assert_eq!(db.list_workspaces().unwrap().len(), 1);

        let _ = fs::remove_dir_all(existing_root);
        let _ = fs::remove_dir_all(candidate_root);
    }

    #[test]
    fn touch_workspace_refreshes_last_opened_at() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("touch-workspace");
        let created = create_workspace(
            &db,
            CreateWorkspaceInput {
                name: Some("Touched".to_string()),
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
        .expect("workspace create should pass");

        let touched = touch_workspace(&db, &created.id).expect("workspace touch should pass");

        assert_eq!(touched.id, created.id);
        assert_eq!(touched.name, created.name);
        assert_eq!(touched.root_path, created.root_path);
        assert_eq!(touched.normalized_path, created.normalized_path);
        assert_eq!(touched.metadata, created.metadata);
        assert!(touched.last_opened_at.is_some());
        assert_eq!(
            db.get_workspace_by_id(&created.id)
                .unwrap()
                .and_then(|workspace| workspace.last_opened_at),
            touched.last_opened_at
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn build_effective_workspace_mcp_servers_merges_inherit_enable_and_disable() {
        let servers = vec![
            sample_mcp_server("server-inherit-enabled", true),
            sample_mcp_server("server-override-enabled", false),
            sample_mcp_server("server-override-disabled", true),
        ];
        let bindings = vec![
            sample_mcp_binding("binding-enable", "server-override-enabled", true),
            sample_mcp_binding("binding-disable", "server-override-disabled", false),
            WorkspaceBinding {
                id: "binding-ignored-provider".to_string(),
                workspace_id: "workspace-1".to_string(),
                target_type: WorkspaceTargetType::Provider,
                target_id: "server-inherit-enabled".to_string(),
                binding_type: WorkspaceBindingType::Override,
                enabled: false,
                priority: 0,
                config: JsonObject::new(),
                created_at: 100,
                updated_at: 100,
            },
        ];

        let effective = build_effective_workspace_mcp_servers(AppType::Codex, &servers, &bindings);

        assert_eq!(effective.len(), 3);
        assert_eq!(effective[0].server_id, "server-inherit-enabled");
        assert!(effective[0].inherited_enabled);
        assert_eq!(effective[0].override_enabled, None);
        assert!(effective[0].enabled);

        assert_eq!(effective[1].server_id, "server-override-enabled");
        assert!(!effective[1].inherited_enabled);
        assert_eq!(effective[1].override_enabled, Some(true));
        assert!(effective[1].enabled);

        assert_eq!(effective[2].server_id, "server-override-disabled");
        assert!(effective[2].inherited_enabled);
        assert_eq!(effective[2].override_enabled, Some(false));
        assert!(!effective[2].enabled);
    }

    #[test]
    fn build_codex_mcp_projection_filters_enabled_servers_and_preserves_config() {
        let servers = vec![
            sample_mcp_server_with_config(
                "server-inherit-enabled",
                true,
                json!({
                    "command": "node",
                    "args": ["server.js"],
                    "env": { "TOKEN": "secret" },
                    "headers": { "Authorization": "Bearer secret" }
                }),
            ),
            sample_mcp_server_with_config(
                "server-override-enabled",
                false,
                json!({ "command": "python", "args": ["server.py"] }),
            ),
            sample_mcp_server_with_config(
                "server-override-disabled",
                true,
                json!({ "command": "disabled" }),
            ),
        ];
        let bindings = vec![
            sample_mcp_binding("binding-enable", "server-override-enabled", true),
            sample_mcp_binding("binding-disable", "server-override-disabled", false),
        ];

        let projection = build_codex_mcp_projection(&servers, &bindings);

        let ids: Vec<String> = projection
            .iter()
            .map(|server| server.server_id.clone())
            .collect();
        assert_eq!(
            ids,
            vec![
                "server-inherit-enabled".to_string(),
                "server-override-enabled".to_string(),
            ]
        );
        assert_eq!(projection[0].name, "server-inherit-enabled");
        assert_eq!(projection[0].server_config["command"], "node");
        assert_eq!(projection[0].server_config["env"]["TOKEN"], "secret");
    }

    fn sample_mcp_server(id: &str, enabled_codex: bool) -> McpServerRow {
        sample_mcp_server_with_config(id, enabled_codex, json!({ "command": id }))
    }

    fn sample_mcp_server_with_config(
        id: &str,
        enabled_codex: bool,
        server_config: serde_json::Value,
    ) -> McpServerRow {
        McpServerRow {
            id: id.to_string(),
            name: id.to_string(),
            server_config,
            description: None,
            tags: Vec::new(),
            enabled_claude: false,
            enabled_codex,
            enabled_gemini: false,
        }
    }

    fn sample_mcp_binding(id: &str, target_id: &str, enabled: bool) -> WorkspaceBinding {
        WorkspaceBinding {
            id: id.to_string(),
            workspace_id: "workspace-1".to_string(),
            target_type: WorkspaceTargetType::McpServer,
            target_id: target_id.to_string(),
            binding_type: WorkspaceBindingType::Override,
            enabled,
            priority: 0,
            config: JsonObject::new(),
            created_at: 100,
            updated_at: 100,
        }
    }

    fn create_temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ccg-switch-workspace-service-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
