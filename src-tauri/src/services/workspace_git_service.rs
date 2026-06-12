use crate::models::workspace::Workspace;
use crate::services::workspace_service;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitStatus {
    pub workspace_id: String,
    pub root_path: String,
    pub is_git_repository: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub dirty: bool,
    pub changed_file_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_url: Option<String>,
}

pub fn get_workspace_git_status(workspace: &Workspace) -> Result<WorkspaceGitStatus, String> {
    let git_root = workspace
        .git_root
        .clone()
        .or_else(|| workspace_service::detect_git_root(&PathBuf::from(&workspace.root_path)));
    let Some(git_root) = git_root else {
        return Ok(empty_git_status(workspace));
    };

    let git_root_path = PathBuf::from(&git_root);
    if !git_root_path.join(".git").exists() {
        return Ok(empty_git_status(workspace));
    }

    let branch = read_current_branch(&git_root_path)?;
    let status_output = run_git(&git_root_path, &["status", "--porcelain"])?;
    let changed_file_count = status_output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();

    Ok(WorkspaceGitStatus {
        workspace_id: workspace.id.clone(),
        root_path: workspace.root_path.clone(),
        is_git_repository: true,
        git_root: Some(git_root),
        branch,
        dirty: changed_file_count > 0,
        changed_file_count,
        origin_url: workspace.origin_url.clone(),
    })
}

fn empty_git_status(workspace: &Workspace) -> WorkspaceGitStatus {
    WorkspaceGitStatus {
        workspace_id: workspace.id.clone(),
        root_path: workspace.root_path.clone(),
        is_git_repository: false,
        git_root: None,
        branch: None,
        dirty: false,
        changed_file_count: 0,
        origin_url: None,
    }
}

fn read_current_branch(git_root: &PathBuf) -> Result<Option<String>, String> {
    let branch = run_git(git_root, &["branch", "--show-current"])?;
    let branch = branch.trim();
    if branch.is_empty() {
        Ok(None)
    } else {
        Ok(Some(branch.to_string()))
    }
}

fn run_git(git_root: &PathBuf, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(git_root)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Git command failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::models::workspace::CreateWorkspaceInput;
    use crate::services::workspace_service;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn get_workspace_git_status_returns_empty_for_non_git_workspace() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("non-git");
        let workspace = create_workspace(&db, &root);

        let status = get_workspace_git_status(&workspace).expect("status should be readable");

        assert_eq!(status.workspace_id, workspace.id);
        assert_eq!(status.root_path, workspace.root_path);
        assert!(!status.is_git_repository);
        assert_eq!(status.git_root, None);
        assert_eq!(status.branch, None);
        assert!(!status.dirty);
        assert_eq!(status.changed_file_count, 0);
        assert_eq!(status.origin_url, None);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_workspace_git_status_reads_branch_origin_and_clean_state() {
        if !git_available() {
            return;
        }

        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("clean-git");
        init_git_repo(&root);
        run_git(&root, &["checkout", "-b", "feature/git-status"]);
        run_git(
            &root,
            &["remote", "add", "origin", "https://example.com/repo.git"],
        );
        let workspace = create_workspace(&db, &root);

        let status = get_workspace_git_status(&workspace).expect("status should be readable");

        assert!(status.is_git_repository);
        assert_eq!(status.git_root, workspace_service::detect_git_root(&root));
        assert_eq!(status.branch, Some("feature/git-status".to_string()));
        assert!(!status.dirty);
        assert_eq!(status.changed_file_count, 0);
        assert_eq!(
            status.origin_url,
            Some("https://example.com/repo.git".to_string())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_workspace_git_status_reports_dirty_changed_count() {
        if !git_available() {
            return;
        }

        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("dirty-git");
        init_git_repo(&root);
        fs::write(root.join("tracked.txt"), "base").unwrap();
        run_git(&root, &["add", "tracked.txt"]);
        run_git(&root, &["commit", "-m", "initial"]);
        fs::write(root.join("tracked.txt"), "changed").unwrap();
        fs::write(root.join("untracked.txt"), "new").unwrap();
        let workspace = create_workspace(&db, &root);

        let status = get_workspace_git_status(&workspace).expect("status should be readable");

        assert!(status.is_git_repository);
        assert!(status.dirty);
        assert_eq!(status.changed_file_count, 2);

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

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn init_git_repo(root: &Path) {
        run_git(root, &["init"]);
        run_git(root, &["config", "user.email", "codex@example.invalid"]);
        run_git(root, &["config", "user.name", "Codex Test"]);
    }

    fn run_git(root: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .expect("git command should run");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn create_temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ccg-switch-workspace-git-service-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
