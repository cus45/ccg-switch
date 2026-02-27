use std::fs;
use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WebDavConfig {
    #[serde(rename = "enabled")]
    pub enabled: bool,
    #[serde(rename = "serverUrl")]
    pub server_url: Option<String>,
    #[serde(rename = "username")]
    pub username: Option<String>,
    #[serde(rename = "password")]
    pub password: Option<String>,
    #[serde(rename = "remotePath")]
    pub remote_path: Option<String>,
    #[serde(rename = "lastSyncAt")]
    pub last_sync_at: Option<String>,
}

/// 获取 WebDAV 配置文件路径：`~/.claude-switch/webdav.json`
fn get_webdav_config_path() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "Home not found")
    })?;
    Ok(home.join(".claude-switch").join("webdav.json"))
}

/// 读取 WebDAV 配置，文件不存在时返回默认值
pub fn get_webdav_config() -> Result<WebDavConfig, io::Error> {
    let path = get_webdav_config_path()?;
    if !path.exists() {
        return Ok(WebDavConfig::default());
    }
    let content = fs::read_to_string(&path)?;
    serde_json::from_str(&content)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

/// 保存 WebDAV 配置到文件
pub fn save_webdav_config(config: &WebDavConfig) -> Result<(), io::Error> {
    let path = get_webdav_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(&path, content)
}
