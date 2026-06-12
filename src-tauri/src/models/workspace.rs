use super::app_type::AppType;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};

pub type JsonObject = Map<String, Value>;

fn default_json_object() -> JsonObject {
    JsonObject::new()
}

fn deserialize_optional_json_object<'de, D>(deserializer: D) -> Result<Option<JsonObject>, D::Error>
where
    D: Deserializer<'de>,
{
    match Value::deserialize(deserializer)? {
        Value::Object(map) => Ok(Some(map)),
        Value::Null => Err(serde::de::Error::custom(
            "expected JSON object for optional object field, found null",
        )),
        value => Err(serde::de::Error::custom(format!(
            "expected JSON object for optional object field, found {}",
            json_type_name(&value)
        ))),
    }
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateField<T> {
    Unset,
    Clear,
    Set(T),
}

impl<T> Default for UpdateField<T> {
    fn default() -> Self {
        Self::Unset
    }
}

impl<T> UpdateField<T> {
    pub fn is_unset(&self) -> bool {
        matches!(self, Self::Unset)
    }
}

impl<T> Serialize for UpdateField<T>
where
    T: Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            UpdateField::Unset | UpdateField::Clear => serializer.serialize_none(),
            UpdateField::Set(value) => value.serialize(serializer),
        }
    }
}

impl<'de, T> Deserialize<'de> for UpdateField<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Option::<T>::deserialize(deserializer).map(|value| match value {
            Some(value) => UpdateField::Set(value),
            None => UpdateField::Clear,
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceTargetType {
    App,
    ModelAdapter,
    Provider,
    McpServer,
    Skill,
    Prompt,
    Automation,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceBindingType {
    Default,
    Enabled,
    Override,
    Sync,
    Favorite,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub normalized_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_app_type: Option<AppType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_policy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_policy: Option<String>,
    #[serde(default = "default_json_object")]
    pub metadata: JsonObject,
    #[serde(default)]
    pub is_favorite: bool,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateWorkspaceInput {
    pub name: Option<String>,
    pub root_path: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub default_app_type: Option<AppType>,
    pub default_provider_id: Option<String>,
    pub permission_policy: Option<String>,
    pub terminal_policy: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_json_object")]
    pub metadata: Option<JsonObject>,
    pub is_favorite: Option<bool>,
}

pub type WorkspaceInput = CreateWorkspaceInput;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateWorkspaceInput {
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "UpdateField::is_unset")]
    pub description: UpdateField<String>,
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "UpdateField::is_unset")]
    pub color: UpdateField<String>,
    #[serde(default, skip_serializing_if = "UpdateField::is_unset")]
    pub icon: UpdateField<String>,
    #[serde(default, skip_serializing_if = "UpdateField::is_unset")]
    pub default_app_type: UpdateField<AppType>,
    #[serde(default, skip_serializing_if = "UpdateField::is_unset")]
    pub default_provider_id: UpdateField<String>,
    #[serde(default, skip_serializing_if = "UpdateField::is_unset")]
    pub permission_policy: UpdateField<String>,
    #[serde(default, skip_serializing_if = "UpdateField::is_unset")]
    pub terminal_policy: UpdateField<String>,
    #[serde(default, deserialize_with = "deserialize_optional_json_object")]
    pub metadata: Option<JsonObject>,
    pub is_favorite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBinding {
    pub id: String,
    pub workspace_id: String,
    pub target_type: WorkspaceTargetType,
    pub target_id: String,
    pub binding_type: WorkspaceBindingType,
    pub enabled: bool,
    pub priority: i32,
    #[serde(default = "default_json_object")]
    pub config: JsonObject,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceBindingInput {
    pub workspace_id: String,
    pub target_type: WorkspaceTargetType,
    pub target_id: String,
    pub binding_type: WorkspaceBindingType,
    pub enabled: Option<bool>,
    pub priority: Option<i32>,
    #[serde(default, deserialize_with = "deserialize_optional_json_object")]
    pub config: Option<JsonObject>,
}

#[cfg(test)]
mod tests {
    use super::{
        CreateWorkspaceInput, UpdateField, UpdateWorkspaceInput, Workspace, WorkspaceBinding,
        WorkspaceBindingInput, WorkspaceBindingType, WorkspaceTargetType,
    };
    use crate::models::app_type::AppType;
    use serde_json::json;

    #[test]
    fn serializes_workspace_fields_as_camel_case() {
        let workspace = Workspace {
            id: "workspace-1".to_string(),
            name: "ccg-switch".to_string(),
            root_path: "C:\\guodevelop\\ccg-switch".to_string(),
            normalized_path: "c:\\guodevelop\\ccg-switch".to_string(),
            git_root: Some("C:\\guodevelop\\ccg-switch".to_string()),
            origin_url: Some("https://example.com/repo.git".to_string()),
            description: None,
            tags: vec!["rust".to_string()],
            color: Some("#059669".to_string()),
            icon: None,
            default_app_type: Some(AppType::Codex),
            default_provider_id: Some("provider-1".to_string()),
            permission_policy: Some("workspace-write".to_string()),
            terminal_policy: Some("powershell".to_string()),
            metadata: serde_json::from_value(json!({ "source": "test" })).unwrap(),
            is_favorite: true,
            created_at: 1_775_000_000,
            updated_at: 1_775_000_001,
            last_opened_at: Some(1_775_000_002),
        };
        let value = serde_json::to_value(workspace).expect("workspace should serialize");

        assert!(value.get("rootPath").is_some());
        assert!(value.get("normalizedPath").is_some());
        assert!(value.get("defaultAppType").is_some());
        assert!(value.get("createdAt").is_some());
    }

    #[test]
    fn create_workspace_input_rejects_derived_fields() {
        let result = serde_json::from_value::<CreateWorkspaceInput>(json!({
            "rootPath": "C:\\guodevelop\\ccg-switch",
            "normalizedPath": "c:\\guodevelop\\ccg-switch",
            "createdAt": 1_775_000_000
        }));

        assert!(result.is_err());
    }

    #[test]
    fn workspace_defaults_metadata_to_empty_object() {
        let workspace = serde_json::from_value::<Workspace>(json!({
            "id": "workspace-1",
            "name": "ccg-switch",
            "rootPath": "C:\\guodevelop\\ccg-switch",
            "normalizedPath": "c:\\guodevelop\\ccg-switch",
            "createdAt": 1_775_000_000,
            "updatedAt": 1_775_000_001
        }))
        .expect("workspace should deserialize");

        assert_eq!(
            workspace.metadata,
            serde_json::from_value(json!({})).unwrap()
        );
    }

    #[test]
    fn create_workspace_input_requires_root_path() {
        let result = serde_json::from_value::<CreateWorkspaceInput>(json!({
            "name": "ccg-switch"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn update_workspace_input_distinguishes_missing_null_and_value() {
        let input = serde_json::from_value::<UpdateWorkspaceInput>(json!({
            "description": null,
            "color": "#059669"
        }))
        .expect("update input should deserialize");

        assert!(matches!(input.description, UpdateField::Clear));
        assert!(matches!(
            input.color,
            UpdateField::Set(ref color) if color == "#059669"
        ));
        assert!(matches!(input.default_provider_id, UpdateField::Unset));
    }

    #[test]
    fn workspace_rejects_non_object_metadata() {
        let result = serde_json::from_value::<Workspace>(json!({
            "id": "workspace-1",
            "name": "ccg-switch",
            "rootPath": "C:\\guodevelop\\ccg-switch",
            "normalizedPath": "c:\\guodevelop\\ccg-switch",
            "metadata": [],
            "createdAt": 1_775_000_000,
            "updatedAt": 1_775_000_001
        }));

        assert!(result.is_err());
    }

    #[test]
    fn create_workspace_input_rejects_null_metadata() {
        let result = serde_json::from_value::<CreateWorkspaceInput>(json!({
            "rootPath": "C:\\guodevelop\\ccg-switch",
            "metadata": null
        }));

        assert!(result.is_err());
    }

    #[test]
    fn create_workspace_input_rejects_non_object_metadata() {
        let result = serde_json::from_value::<CreateWorkspaceInput>(json!({
            "rootPath": "C:\\guodevelop\\ccg-switch",
            "metadata": []
        }));

        assert!(result.is_err());
    }

    #[test]
    fn update_workspace_input_rejects_null_metadata() {
        let result = serde_json::from_value::<UpdateWorkspaceInput>(json!({
            "metadata": null
        }));

        assert!(result.is_err());
    }

    #[test]
    fn update_workspace_input_rejects_scalar_metadata() {
        let result = serde_json::from_value::<UpdateWorkspaceInput>(json!({
            "metadata": "invalid"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn serializes_workspace_binding_fields_as_camel_case() {
        let binding = WorkspaceBinding {
            id: "binding-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            target_type: WorkspaceTargetType::Provider,
            target_id: "provider-1".to_string(),
            binding_type: WorkspaceBindingType::Default,
            enabled: true,
            priority: 10,
            config: serde_json::from_value(json!({ "mode": "inherit" })).unwrap(),
            created_at: 1_775_000_000,
            updated_at: 1_775_000_001,
        };
        let value = serde_json::to_value(binding).expect("binding should serialize");

        assert!(value.get("workspaceId").is_some());
        assert!(value.get("targetType").is_some());
        assert!(value.get("bindingType").is_some());
        assert!(value.get("createdAt").is_some());
    }

    #[test]
    fn workspace_binding_defaults_config_to_empty_object() {
        let binding = serde_json::from_value::<WorkspaceBinding>(json!({
            "id": "binding-1",
            "workspaceId": "workspace-1",
            "targetType": "provider",
            "targetId": "provider-1",
            "bindingType": "default",
            "enabled": true,
            "priority": 10,
            "createdAt": 1_775_000_000,
            "updatedAt": 1_775_000_001
        }))
        .expect("binding should deserialize");

        assert_eq!(binding.config, serde_json::from_value(json!({})).unwrap());
    }

    #[test]
    fn workspace_binding_input_rejects_null_config() {
        let result = serde_json::from_value::<WorkspaceBindingInput>(json!({
            "workspaceId": "workspace-1",
            "targetType": "provider",
            "targetId": "provider-1",
            "bindingType": "default",
            "config": null
        }));

        assert!(result.is_err());
    }

    #[test]
    fn workspace_binding_input_rejects_non_object_config() {
        let result = serde_json::from_value::<WorkspaceBindingInput>(json!({
            "workspaceId": "workspace-1",
            "targetType": "provider",
            "targetId": "provider-1",
            "bindingType": "default",
            "config": false
        }));

        assert!(result.is_err());
    }

    #[test]
    fn workspace_binding_rejects_unknown_target_type() {
        let result = serde_json::from_value::<WorkspaceBinding>(json!({
            "id": "binding-1",
            "workspaceId": "workspace-1",
            "targetType": "modelAdapter",
            "targetId": "provider-1",
            "bindingType": "default",
            "enabled": true,
            "priority": 10,
            "createdAt": 1_775_000_000,
            "updatedAt": 1_775_000_001
        }));

        assert!(result.is_err());
    }
}
