use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAutomation {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub prompt: String,
    pub schedule: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateWorkspaceAutomationInput {
    pub workspace_id: String,
    pub title: String,
    pub prompt: String,
    pub schedule: String,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub memory_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateWorkspaceAutomationInput {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub memory_path: Option<Option<String>>,
}
