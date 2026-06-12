use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub type JsonObject = Map<String, Value>;

fn default_json_object() -> JsonObject {
    JsonObject::new()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityType {
    McpServer,
    Skill,
    Prompt,
    Automation,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityBindingTargetType {
    App,
    Workspace,
    Provider,
    ModelAdapter,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityBindingType {
    Default,
    Enabled,
    Override,
    Sync,
    Favorite,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Capability {
    pub id: String,
    pub capability_type: CapabilityType,
    pub source_id: String,
    pub display_name: String,
    #[serde(default = "default_json_object")]
    pub metadata: JsonObject,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityBinding {
    pub id: String,
    pub capability_id: String,
    pub target_type: CapabilityBindingTargetType,
    pub target_id: String,
    pub binding_type: CapabilityBindingType,
    pub enabled: bool,
    pub priority: i32,
    #[serde(default = "default_json_object")]
    pub config: JsonObject,
    pub created_at: i64,
    pub updated_at: i64,
}

#[cfg(test)]
mod tests {
    use super::{
        Capability, CapabilityBinding, CapabilityBindingTargetType, CapabilityBindingType,
        CapabilityType,
    };
    use serde_json::json;

    #[test]
    fn serializes_capability_fields_as_camel_case_and_snake_case_values() {
        let capability = Capability {
            id: "capability-1".to_string(),
            capability_type: CapabilityType::McpServer,
            source_id: "server-1".to_string(),
            display_name: "Server 1".to_string(),
            metadata: serde_json::from_value(json!({})).unwrap(),
            created_at: 100,
            updated_at: 100,
        };

        let value = serde_json::to_value(capability).expect("capability should serialize");

        assert_eq!(value["capabilityType"], "mcp_server");
        assert!(value.get("sourceId").is_some());
        assert!(value.get("displayName").is_some());
        assert!(value.get("createdAt").is_some());
    }

    #[test]
    fn capability_binding_defaults_config_to_empty_object() {
        let binding = serde_json::from_value::<CapabilityBinding>(json!({
            "id": "binding-1",
            "capabilityId": "capability-1",
            "targetType": "app",
            "targetId": "codex",
            "bindingType": "enabled",
            "enabled": true,
            "priority": 0,
            "createdAt": 100,
            "updatedAt": 100
        }))
        .expect("binding should deserialize");

        assert_eq!(binding.config, serde_json::from_value(json!({})).unwrap());
        assert_eq!(binding.target_type, CapabilityBindingTargetType::App);
        assert_eq!(binding.binding_type, CapabilityBindingType::Enabled);
    }
}
