mod models;
mod services;
mod utils;

use models::config::Config;
use models::mcp::McpServer;
use models::prompt::PromptPreset;
use models::skill::Skill;
use models::subagent::Subagent;
use models::token::ApiToken;
use services::dashboard_service::{DashboardStats, HistoryEntry, ProjectInfo, ProjectTokenStat, SessionInfo};
use services::stats_service::StatsCache;
use services::{config_service, dashboard_service, mcp_service, prompt_service, skill_service, stats_service, subagent_service, token_service};

// 配置管理命令
#[tauri::command]
fn get_config() -> Result<Config, String> {
    config_service::load_config().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(config: Config) -> Result<(), String> {
    config_service::save_config(&config).map_err(|e| e.to_string())
}

// MCP 服务器管理命令
#[tauri::command]
fn list_mcp_servers(project_dir: Option<String>) -> Result<Vec<McpServer>, String> {
    mcp_service::list_mcp_servers(project_dir.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_mcp_server(server: McpServer, is_global: bool) -> Result<(), String> {
    mcp_service::add_mcp_server(server, is_global).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_mcp_server(server_name: String, is_global: bool) -> Result<(), String> {
    mcp_service::delete_mcp_server(&server_name, is_global).map_err(|e| e.to_string())
}

// Prompt 预设管理命令
#[tauri::command]
fn list_prompts() -> Result<Vec<PromptPreset>, String> {
    prompt_service::list_prompts().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_prompt(name: String) -> Result<PromptPreset, String> {
    prompt_service::get_prompt(&name).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_prompt(name: String, content: String) -> Result<(), String> {
    prompt_service::save_prompt(&name, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_prompt(name: String) -> Result<(), String> {
    prompt_service::delete_prompt(&name).map_err(|e| e.to_string())
}

// Skill 技能管理命令
#[tauri::command]
fn list_skills(project_dir: Option<String>) -> Result<Vec<Skill>, String> {
    skill_service::list_skills(project_dir.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_skill(name: String) -> Result<Skill, String> {
    skill_service::get_skill(&name).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_skill(name: String, content: String) -> Result<(), String> {
    skill_service::save_skill(&name, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_skill(name: String) -> Result<(), String> {
    skill_service::delete_skill(&name).map_err(|e| e.to_string())
}

// Subagent 子代理管理命令
#[tauri::command]
fn list_subagents() -> Result<Vec<Subagent>, String> {
    subagent_service::list_subagents().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_subagent(name: String) -> Result<Subagent, String> {
    subagent_service::get_subagent(&name).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_subagent(name: String, content: String) -> Result<(), String> {
    subagent_service::save_subagent(&name, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_subagent(name: String) -> Result<(), String> {
    subagent_service::delete_subagent(&name).map_err(|e| e.to_string())
}

// Token 管理命令
#[tauri::command]
fn get_tokens() -> Result<Vec<ApiToken>, String> {
    token_service::list_tokens().map_err(|e| e.to_string())
}

// Dashboard 数据命令
#[tauri::command]
fn get_dashboard_stats() -> Result<DashboardStats, String> {
    dashboard_service::get_stats().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_dashboard_projects() -> Result<Vec<ProjectInfo>, String> {
    dashboard_service::list_projects().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_activity_history() -> Result<Vec<HistoryEntry>, String> {
    dashboard_service::get_activity_history().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_project_token_stats() -> Result<Vec<ProjectTokenStat>, String> {
    dashboard_service::get_project_token_stats().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_api_token(token: ApiToken) -> Result<(), String> {
    token_service::add_token(token).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_api_token(token_id: String, token: ApiToken) -> Result<(), String> {
    token_service::update_token(&token_id, token).map_err(|e| e.to_string())
}

#[tauri::command]
fn switch_api_token(token_id: String) -> Result<(), String> {
    token_service::switch_token(&token_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_api_token(token_id: String) -> Result<(), String> {
    token_service::delete_token(&token_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn move_api_token(token_id: String, target_index: usize) -> Result<(), String> {
    token_service::move_token(&token_id, target_index).map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_available_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    token_service::fetch_models(base_url, api_key).await
}

// Stats Cache 命令
#[tauri::command]
fn get_stats_cache_data() -> Result<StatsCache, String> {
    stats_service::get_stats_cache().map_err(|e| e.to_string())
}

// 工作区会话列表命令
#[tauri::command]
fn get_project_sessions(project_path: String) -> Result<Vec<SessionInfo>, String> {
    dashboard_service::get_project_sessions(&project_path).map_err(|e| e.to_string())
}

// 在终端中打开目录
#[tauri::command]
async fn open_in_terminal(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let shell = app.shell();
    #[cfg(target_os = "windows")]
    {
        shell
            .command("cmd")
            .args(["/c", "start", "cmd", "/k", &format!("cd /d {}", path)])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        shell
            .command("open")
            .args(["-a", "Terminal", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        shell
            .command("xterm")
            .args(["-e", &format!("cd {} && bash", path)])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            list_mcp_servers,
            add_mcp_server,
            delete_mcp_server,
            list_prompts,
            get_prompt,
            save_prompt,
            delete_prompt,
            list_skills,
            get_skill,
            save_skill,
            delete_skill,
            list_subagents,
            get_subagent,
            save_subagent,
            delete_subagent,
            get_tokens,
            add_api_token,
            update_api_token,
            switch_api_token,
            delete_api_token,
            move_api_token,
            fetch_available_models,
            get_dashboard_stats,
            get_dashboard_projects,
            get_activity_history,
            get_project_token_stats,
            get_stats_cache_data,
            get_project_sessions,
            open_in_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
