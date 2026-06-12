use crate::models::workspace::Workspace;
use crate::models::worktree::WorkspaceWorktree;
use crate::services::workspace_service;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::process::Command;

pub fn list_workspace_worktrees(workspace: &Workspace) -> Result<Vec<WorkspaceWorktree>, String> {
    let git_root = workspace
        .git_root
        .clone()
        .or_else(|| workspace_service::detect_git_root(&PathBuf::from(&workspace.root_path)));
    let Some(git_root) = git_root else {
        return Ok(Vec::new());
    };

    let git_root_path = PathBuf::from(&git_root);
    if !git_root_path.join(".git").exists() {
        return Ok(Vec::new());
    }

    let output = run_git(&git_root_path, &["worktree", "list", "--porcelain"])?;
    Ok(parse_worktree_list(&workspace.id, &output))
}

fn parse_worktree_list(workspace_id: &str, output: &str) -> Vec<WorkspaceWorktree> {
    let mut worktrees = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;

    for line in output.lines().chain(std::iter::once("")) {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            if let Some(path) = current_path.take() {
                worktrees.push(build_worktree(workspace_id, path, current_branch.take()));
            }
            continue;
        }

        if let Some(path) = trimmed.strip_prefix("worktree ") {
            if let Some(previous_path) = current_path.replace(path.to_string()) {
                worktrees.push(build_worktree(
                    workspace_id,
                    previous_path,
                    current_branch.take(),
                ));
            }
            continue;
        }

        if let Some(branch) = trimmed.strip_prefix("branch ") {
            current_branch = branch
                .strip_prefix("refs/heads/")
                .or(Some(branch))
                .map(|value| value.to_string());
        }
    }

    worktrees
}

fn build_worktree(workspace_id: &str, path: String, branch: Option<String>) -> WorkspaceWorktree {
    WorkspaceWorktree {
        id: format!(
            "worktree-{:016x}",
            stable_hash(&format!("{workspace_id}:{path}"))
        ),
        workspace_id: workspace_id.to_string(),
        path,
        branch,
        owner_thread_id: None,
        created_at: 0,
        last_used_at: None,
    }
}

fn stable_hash(value: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
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
    fn list_workspace_worktrees_returns_empty_for_non_git_workspace() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("non-git");
        let workspace = create_workspace(&db, &root);

        let worktrees = list_workspace_worktrees(&workspace).expect("worktrees should be readable");

        assert!(worktrees.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_workspace_worktrees_includes_main_worktree() {
        if !git_available() {
            return;
        }

        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("main-worktree");
        init_git_repo(&root);
        commit_file(&root, "README.md", "base");
        let workspace = create_workspace(&db, &root);

        let worktrees = list_workspace_worktrees(&workspace).expect("worktrees should be readable");

        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].workspace_id, workspace.id);
        assert_eq!(
            normalize_path(&worktrees[0].path),
            normalize_path(&root.to_string_lossy())
        );
        assert_eq!(worktrees[0].branch, Some("main".to_string()));
        assert_eq!(worktrees[0].owner_thread_id, None);
        assert_eq!(worktrees[0].created_at, 0);
        assert_eq!(worktrees[0].last_used_at, None);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_workspace_worktrees_parses_additional_worktree_branch() {
        if !git_available() {
            return;
        }

        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        let root = create_temp_dir("with-linked-worktree");
        let linked = sibling_temp_dir(&root, "linked");
        init_git_repo(&root);
        commit_file(&root, "README.md", "base");
        run_git(
            &root,
            &[
                "worktree",
                "add",
                linked.to_str().unwrap(),
                "-b",
                "feature/worktree",
            ],
        );
        let workspace = create_workspace(&db, &root);

        let worktrees = list_workspace_worktrees(&workspace).expect("worktrees should be readable");

        assert_eq!(worktrees.len(), 2);
        let linked_worktree = worktrees
            .iter()
            .find(|worktree| {
                normalize_path(&worktree.path) == normalize_path(&linked.to_string_lossy())
            })
            .expect("linked worktree should be listed");
        assert_eq!(linked_worktree.branch, Some("feature/worktree".to_string()));
        assert!(linked_worktree.id.starts_with("worktree-"));

        let _ = fs::remove_dir_all(linked);
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
        run_git(root, &["checkout", "-b", "main"]);
        run_git(root, &["config", "user.email", "codex@example.invalid"]);
        run_git(root, &["config", "user.name", "Codex Test"]);
    }

    fn commit_file(root: &Path, file_name: &str, content: &str) {
        fs::write(root.join(file_name), content).unwrap();
        run_git(root, &["add", file_name]);
        run_git(root, &["commit", "-m", "initial"]);
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

    fn normalize_path(path: &str) -> String {
        path.replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    }

    fn create_temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ccg-switch-worktree-service-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn sibling_temp_dir(root: &Path, name: &str) -> PathBuf {
        root.parent().unwrap().join(format!(
            "{}-{name}",
            root.file_name().unwrap().to_string_lossy()
        ))
    }
}
