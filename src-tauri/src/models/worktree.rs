use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWorktree {
    pub id: String,
    pub workspace_id: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_thread_id: Option<String>,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::WorkspaceWorktree;
    use serde_json::json;

    #[test]
    fn serializes_workspace_worktree_fields_as_camel_case() {
        let worktree = WorkspaceWorktree {
            id: "worktree-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            path: r"C:\repo\feature".to_string(),
            branch: Some("feature/a".to_string()),
            owner_thread_id: Some("thread-1".to_string()),
            created_at: 100,
            last_used_at: Some(200),
        };

        let value = serde_json::to_value(worktree).unwrap();

        assert_eq!(
            value,
            json!({
                "id": "worktree-1",
                "workspaceId": "workspace-1",
                "path": r"C:\repo\feature",
                "branch": "feature/a",
                "ownerThreadId": "thread-1",
                "createdAt": 100,
                "lastUsedAt": 200
            })
        );
    }

    #[test]
    fn omits_optional_workspace_worktree_fields_when_absent() {
        let worktree = WorkspaceWorktree {
            id: "worktree-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            path: r"C:\repo".to_string(),
            branch: None,
            owner_thread_id: None,
            created_at: 100,
            last_used_at: None,
        };

        let value = serde_json::to_value(worktree).unwrap();

        assert!(value.get("branch").is_none());
        assert!(value.get("ownerThreadId").is_none());
        assert!(value.get("lastUsedAt").is_none());
    }
}
