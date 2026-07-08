use crate::database::Database;
use crate::models::proxy::ProxyConfig;
use crate::proxy::server;
use crate::proxy::types::ProxyState;
use crate::services::proxy_takeover;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;

fn get_proxy_config_path() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".ccg-switch").join("proxy_config.json"))
}

/// 从数据库加载代理配置（v3+，失败时回退到 JSON）
pub fn load_proxy_config_from_db(db: &Arc<Database>) -> Result<ProxyConfig, String> {
    match db.get_app_config("proxy_server_config")? {
        Some(json) => {
            let config: ProxyConfig =
                serde_json::from_str(&json).map_err(|e| format!("Parse config failed: {e}"))?;
            Ok(config)
        }
        None => {
            // 数据库为空时，从 JSON 文件回退加载
            if let Ok(config) = load_proxy_config() {
                // 将 JSON 数据迁移到数据库
                let config_json = serde_json::to_string(&config)
                    .map_err(|e| format!("Serialize config failed: {e}"))?;
                let _ = db.set_app_config("proxy_server_config", &config_json);
                return Ok(config);
            }
            Ok(ProxyConfig::default())
        }
    }
}

/// 保存代理配置到数据库（v3+）
pub fn save_proxy_config_to_db(db: &Arc<Database>, config: &ProxyConfig) -> Result<(), String> {
    let config_json =
        serde_json::to_string(config).map_err(|e| format!("Serialize config failed: {e}"))?;
    db.set_app_config("proxy_server_config", &config_json)
}

/// 读取代理配置，文件不存在时返回默认值（兼容旧版）
pub fn load_proxy_config() -> Result<ProxyConfig, io::Error> {
    let path = get_proxy_config_path()?;
    if !path.exists() {
        return Ok(ProxyConfig::default());
    }
    let content = fs::read_to_string(&path)?;
    serde_json::from_str(&content).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

/// 保存代理配置到文件（保留兼容）
#[allow(dead_code)]
pub fn save_proxy_config(config: &ProxyConfig) -> Result<(), io::Error> {
    let path = get_proxy_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(&path, content)
}

/// 启动代理服务器；若开启接管模式，同时把各 CLI 的 Live 配置指向本地代理
pub async fn start_proxy(db: &Arc<Database>, config: ProxyConfig) -> Result<ProxyState, String> {
    let mut state = server::start(&config.host, config.port, db.clone()).await?;

    if config.takeover_mode {
        match proxy_takeover::takeover_all(db, &config.host, config.port) {
            Ok(apps) if apps.is_empty() => {
                tracing::warn!(
                    "[Proxy] 接管模式已开启，但没有任何应用配置了活跃 provider，跳过接管"
                );
            }
            Ok(apps) => {
                tracing::info!("[Proxy] 已接管应用: {}", apps.join(", "));
            }
            Err(e) => {
                // 接管失败：回滚（停服 + 还原已接管的应用），避免半接管状态
                let _ = server::stop().await;
                if let Err(re) = proxy_takeover::restore_all(db) {
                    tracing::error!("[Proxy] 接管失败后还原 Live 配置失败: {re}");
                }
                return Err(e);
            }
        }
    }

    state.taken_over_apps = proxy_takeover::taken_over_apps(db);
    state.takeover_active = !state.taken_over_apps.is_empty();
    Ok(state)
}

/// 停止代理服务器并恢复被接管的 Live 配置
pub async fn stop_proxy(db: &Arc<Database>) -> Result<(), String> {
    // 即使服务器未运行也继续执行恢复，处理异常残留
    let stop_result = server::stop().await;

    let restored = proxy_takeover::restore_all(db)?;
    resync_active_providers(db, &restored);

    stop_result
}

/// 恢复后重新同步各应用的活跃 provider 到 Live 配置。
///
/// 代理运行期间用户可能热切换过供应商（接管模式下不写 Live），
/// 备份还原的是接管前的旧配置；这里按数据库当前选择重写一次，保证一致。
fn resync_active_providers(db: &Arc<Database>, apps: &[String]) {
    for app_str in apps {
        let Ok(app) = crate::models::app_type::AppType::from_str(app_str) else {
            continue;
        };
        let Ok(providers) = db.list_providers_by_app(app_str) else {
            continue;
        };
        if let Some(active) = providers.iter().find(|p| p.is_active) {
            if let Err(e) =
                crate::services::provider_service::sync_provider_to_app_config(active)
            {
                tracing::warn!(
                    "[Proxy] 恢复后同步 {} 活跃 provider 失败（保留备份内容）: {}",
                    app.as_str(),
                    e
                );
            }
        }
    }
}

/// 应用启动时的崩溃恢复：检测到接管残留（上次未正常停止代理）时还原 Live 配置
pub fn recover_takeover_on_startup(db: &Arc<Database>) {
    if !proxy_takeover::is_takeover_active(db) {
        return;
    }

    tracing::warn!("[Proxy] 检测到接管残留（上次可能异常退出），正在恢复 Live 配置");
    match proxy_takeover::restore_all(db) {
        Ok(restored) => {
            resync_active_providers(db, &restored);
            tracing::info!("[Proxy] Live 配置已恢复: {}", restored.join(", "));
        }
        Err(e) => {
            tracing::error!("[Proxy] 恢复 Live 配置失败（备份保留）: {e}");
        }
    }
}

/// 获取代理服务器状态（附带接管信息）
pub fn get_proxy_status(db: &Arc<Database>) -> Result<ProxyState, String> {
    let mut state = server::get_state();
    state.taken_over_apps = proxy_takeover::taken_over_apps(db);
    state.takeover_active = !state.taken_over_apps.is_empty();
    Ok(state)
}

/// 应用退出时的清理：停止代理并恢复 Live 配置（未运行且无接管时为 no-op）
pub async fn shutdown_on_exit(db: &Arc<Database>) {
    let running = server::is_running().await;
    let takeover_active = proxy_takeover::is_takeover_active(db);
    if !running && !takeover_active {
        return;
    }

    if running {
        let _ = server::stop().await;
    }

    match proxy_takeover::restore_all(db) {
        Ok(restored) => {
            resync_active_providers(db, &restored);
            if !restored.is_empty() {
                tracing::info!("[Proxy] 退出前已恢复 Live 配置: {}", restored.join(", "));
            }
        }
        Err(e) => tracing::error!("[Proxy] 退出前恢复 Live 配置失败（备份保留）: {e}"),
    }
}
