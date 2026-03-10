mod commands;
mod database;
mod mcp;
mod models;
mod proxy;
mod services;
mod store;
mod tray;
mod utils;

use tauri::Manager;
use commands::provider_commands;
use commands::proxy_commands;
use commands::utility_commands;
use commands::advanced_commands;
use commands::mcp_commands;
use commands::skill_commands;
use commands::prompt_commands;

use models::config::Config;
use models::prompt::PromptPreset;
use models::skill::{Skill, SkillApps};
use models::subagent::Subagent;
use models::token::ApiToken;
use services::dashboard_service::{DashboardStats, HistoryEntry, ProjectInfo, ProjectTokenStat, SessionInfo, SessionMessage};
use services::stats_service::StatsCache;
use services::{config_service, dashboard_service, migration_service, prompt_service, skill_service, stats_service, subagent_service, token_service, universal_provider_service};
use services::universal_provider_service::UniversalProviderConfig;
use services::tool_version_service::ToolVersion;

// 配置管理命令
#[tauri::command]
fn get_config() -> Result<Config, String> {
    config_service::load_config().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(config: Config) -> Result<(), String> {
    config_service::save_config(&config).map_err(|e| e.to_string())
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

#[tauri::command]
fn update_skill_apps(name: String, apps: SkillApps) -> Result<(), String> {
    skill_service::update_skill_apps(&name, apps).map_err(|e| e.to_string())
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

#[tauri::command]
fn refresh_stats_cache() -> Result<StatsCache, String> {
    stats_service::refresh_stats_cache().map_err(|e| e.to_string())
}

// 工作区会话列表命令
#[tauri::command]
fn get_project_sessions(project_path: String) -> Result<Vec<SessionInfo>, String> {
    dashboard_service::get_project_sessions(&project_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_session_messages(file_path: String) -> Result<Vec<SessionMessage>, String> {
    dashboard_service::get_session_messages(&file_path).map_err(|e| e.to_string())
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

// 在终端中恢复会话
#[tauri::command]
async fn launch_resume_session(command: String, cwd: Option<String>) -> Result<bool, String> {
    use std::process::Command;

    if command.trim().is_empty() {
        return Err("Resume command is empty".to_string());
    }

    let config = config_service::load_config().unwrap_or_default();
    let terminal = config.preferred_terminal;

    let work_dir = cwd.as_deref().unwrap_or(".");

    match terminal.as_str() {
        "cmd" => {
            Command::new("cmd")
                .args(["/c", "start", "cmd", "/k", &command])
                .current_dir(work_dir)
                .spawn()
                .map_err(|e| format!("Failed to launch cmd: {e}"))?;
        }
        "powershell" => {
            Command::new("cmd")
                .args(["/c", "start", "powershell", "-NoExit", "-Command",
                       &format!("Set-Location '{}'; {}", work_dir.replace('\'', "''"), command)])
                .spawn()
                .map_err(|e| format!("Failed to launch PowerShell: {e}"))?;
        }
        "wt" => {
            // Windows Terminal
            Command::new("wt")
                .args(["new-tab", "-d", work_dir, "cmd", "/k", &command])
                .spawn()
                .map_err(|e| format!("Failed to launch Windows Terminal: {e}"))?;
        }
        other => {
            return Err(format!("Unsupported terminal: {}. Supported: cmd, powershell, wt", other));
        }
    }

    Ok(true)
}

// 打开外部链接
#[tauri::command]
async fn open_external(app: tauri::AppHandle, url: String) -> Result<bool, String> {
    use tauri_plugin_opener::OpenerExt;
    let url = if url.starts_with("http://") || url.starts_with("https://") {
        url
    } else {
        format!("https://{url}")
    };
    app.opener()
        .open_url(&url, None::<String>)
        .map_err(|e| format!("打开链接失败: {e}"))?;
    Ok(true)
}

// 用系统默认编辑器打开配置文件
#[tauri::command]
async fn open_config_file(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    use tauri_plugin_opener::OpenerExt;
    let full_path = if path.starts_with("~/") || path.starts_with("~\\") {
        let home = dirs::home_dir().ok_or("Home directory not found".to_string())?;
        home.join(&path[2..])
    } else {
        std::path::PathBuf::from(&path)
    };

    if !full_path.exists() {
        // 确保父目录存在
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败: {e}"))?;
        }
        // 创建空文件
        std::fs::write(&full_path, if path.ends_with(".json") { "{}" } else { "" })
            .map_err(|e| format!("创建文件失败: {e}"))?;
    }

    app.opener()
        .open_path(full_path.to_string_lossy().as_ref(), None::<String>)
        .map_err(|e| format!("打开文件失败: {e}"))?;
    Ok(true)
}

// Universal Provider 命令
#[tauri::command]
fn apply_universal_provider(config: UniversalProviderConfig) -> Result<Vec<String>, String> {
    universal_provider_service::apply_universal_provider(config).map_err(|e| e.to_string())
}

// 工具版本检测
#[tauri::command]
async fn get_tool_versions(tools: Option<Vec<String>>) -> Result<Vec<ToolVersion>, String> {
    Ok(services::tool_version_service::get_tool_versions(tools).await)
}

// 检查更新
#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<services::updater_service::UpdateInfo, String> {
    let version = app.package_info().version.to_string();
    services::updater_service::check_update(&version).await
}

// 下载更新安装包
#[tauri::command]
async fn download_update(app: tauri::AppHandle, url: String) -> Result<String, String> {
    services::updater_service::download_update(&app, &url).await
}

// 安装更新并退出
#[tauri::command]
async fn install_update(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
    services::updater_service::install_update(&file_path)?;
    // 退出当前应用，让安装程序接管
    app.exit(0);
    Ok(())
}

// Prompt 同步命令
#[tauri::command]
fn sync_prompt_to_app(name: String, app: String) -> Result<(), String> {
    prompt_service::sync_prompt_to_app(&name, &app).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_prompt_sync_status(name: String) -> Result<Vec<String>, String> {
    prompt_service::get_prompt_sync_status(&name).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            list_prompts,
            get_prompt,
            save_prompt,
            delete_prompt,
            list_skills,
            get_skill,
            save_skill,
            delete_skill,
            update_skill_apps,
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
            refresh_stats_cache,
            get_project_sessions,
            get_session_messages,
            open_in_terminal,
            launch_resume_session,
            open_external,
            open_config_file,
            // Provider 命令
            provider_commands::get_providers,
            provider_commands::get_all_providers,
            provider_commands::add_provider,
            provider_commands::update_provider,
            provider_commands::delete_provider,
            provider_commands::switch_provider,
            provider_commands::move_provider,
            provider_commands::get_provider_config_files,
            provider_commands::preview_provider_sync,
            provider_commands::get_claude_settings_state,
            provider_commands::check_provider_health,
            // Proxy 命令
            proxy_commands::get_proxy_config,
            proxy_commands::save_proxy_config,
            proxy_commands::start_proxy,
            proxy_commands::stop_proxy,
            proxy_commands::get_proxy_status,
            // Universal Provider
            apply_universal_provider,
            // Prompt 同步
            sync_prompt_to_app,
            get_prompt_sync_status,
            // 工具版本 & 更新
            get_tool_versions,
            check_for_updates,
            download_update,
            install_update,
            // Utility 命令
            utility_commands::export_config,
            utility_commands::import_config,
            utility_commands::export_providers_config,
            utility_commands::import_providers_config,
            utility_commands::test_endpoint_speed,
            utility_commands::check_stream_connectivity,
            utility_commands::get_global_proxy,
            utility_commands::set_global_proxy,
            utility_commands::check_env,
            utility_commands::fetch_models,
            // Advanced 命令
            advanced_commands::get_webdav_config,
            advanced_commands::save_webdav_config,
            advanced_commands::get_auto_launch_status,
            advanced_commands::set_auto_launch,
            advanced_commands::get_usage_summaries,
            // MCP v2 (数据库版)
            mcp_commands::get_mcp_servers,
            mcp_commands::upsert_mcp_server,
            mcp_commands::delete_mcp_server_v2,
            mcp_commands::toggle_mcp_app,
            mcp_commands::import_mcp_from_apps,
            // Skills v2 (数据库版)
            skill_commands::get_installed_skills,
            skill_commands::install_skill,
            skill_commands::uninstall_skill,
            skill_commands::toggle_skill_app,
            skill_commands::discover_skills,
            skill_commands::get_skill_repos,
            skill_commands::save_skill_repo,
            skill_commands::delete_skill_repo,
            skill_commands::scan_and_import_skills,
            // Prompts v2 (数据库版)
            prompt_commands::get_prompts_v2,
            prompt_commands::upsert_prompt_v2,
            prompt_commands::delete_prompt_v2,
            prompt_commands::enable_prompt_v2,
            prompt_commands::disable_prompt_v2,
            prompt_commands::import_prompt_from_file,
            prompt_commands::get_prompt_live_content,
        ])
        .setup(|app| {
            // 执行数据目录迁移 (.claude-switch → .ccg-switch)
            if let Err(e) = migration_service::check_and_run_migration() {
                eprintln!("Migration warning: {e}");
            }

            // 初始化数据库
            let db = database::Database::init()
                .expect("Failed to initialize database");
            let state = store::AppState::new(std::sync::Arc::new(db));
            app.manage(state);

            let _ = tray::setup_tray(app);
            Ok(())
        })
        .on_window_event(|window, event| {
            // 点击 X 按钮时隐藏窗口到托盘，而不是退出进程
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
