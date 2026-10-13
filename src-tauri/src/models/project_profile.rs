use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 项目配置组合：将供应商、MCP、技能、Prompt 保存为一个项目配置，一键切换
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProfile {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub is_active: bool,
    /// 各应用活跃 Provider ID: app_type -> provider_id
    pub providers: HashMap<String, String>,
    /// 各应用启用的 MCP Server IDs: app_type -> [server_id]
    pub mcp_servers: HashMap<String, Vec<String>>,
    /// 各应用启用的 Skill IDs: app_type -> [skill_id]
    pub skills: HashMap<String, Vec<String>>,
    /// 各应用启用的 Prompt ID: app_type -> prompt_id
    pub prompts: HashMap<String, String>,
    pub created_at: i64,
    pub updated_at: i64,
}
