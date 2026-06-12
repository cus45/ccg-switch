use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppIntegration {
    pub app_id: String,
    pub display_name: String,
    pub visible: bool,
    pub config_files: Vec<String>,
    pub session_locations: Vec<String>,
    pub resume_command_template: Option<String>,
    pub mcp_sync_supported: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelAdapter {
    pub adapter_id: String,
    pub display_name: String,
    pub protocol: String,
    pub supported_transports: Vec<String>,
    pub auth_schemes: Vec<String>,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdapterRegistry {
    pub app_integrations: Vec<AppIntegration>,
    pub model_adapters: Vec<ModelAdapter>,
}
