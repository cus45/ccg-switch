use std::fs;
use std::io;
use std::path::PathBuf;
use chrono::Utc;

fn get_data_dir() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".claude-switch"))
}

/// 导出所有配置为单个 JSON
pub fn export_all_config() -> Result<serde_json::Value, io::Error> {
    let data_dir = get_data_dir()?;
    let mut export = serde_json::json!({
        "version": "1.0",
        "exportedAt": Utc::now().to_rfc3339(),
        "data": {}
    });

    let files = ["config.json", "providers.json", "mcp-servers.json", "skills.json"];
    let data = export["data"].as_object_mut().unwrap();

    for file in files {
        let path = data_dir.join(file);
        if path.exists() {
            let content = fs::read_to_string(&path)?;
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                data.insert(file.replace(".json", "").replace("-", "_"), val);
            }
        }
    }

    Ok(export)
}

/// 从导出的 JSON 恢复配置
pub fn import_config(data: serde_json::Value) -> Result<Vec<String>, io::Error> {
    let data_dir = get_data_dir()?;
    fs::create_dir_all(&data_dir)?;
    let mut imported = vec![];

    // 先备份
    let backup_dir = data_dir.join("backups").join(Utc::now().format("%Y%m%d_%H%M%S").to_string());
    fs::create_dir_all(&backup_dir)?;

    let mapping = [
        ("config", "config.json"),
        ("providers", "providers.json"),
        ("mcp_servers", "mcp-servers.json"),
        ("skills", "skills.json"),
    ];

    for (key, file) in mapping {
        let path = data_dir.join(file);
        // 备份现有文件
        if path.exists() {
            let _ = fs::copy(&path, backup_dir.join(file));
        }
        // 写入导入数据
        if let Some(val) = data.get("data").and_then(|d| d.get(key)) {
            let content = serde_json::to_string_pretty(val)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
            fs::write(&path, content)?;
            imported.push(file.to_string());
        }
    }

    Ok(imported)
}

/// 仅导出 providers 配置
pub fn export_providers_config() -> Result<serde_json::Value, io::Error> {
    let data_dir = get_data_dir()?;
    let mut export = serde_json::json!({
        "version": "1.0",
        "type": "providers",
        "exportedAt": Utc::now().to_rfc3339(),
        "data": {}
    });

    let path = data_dir.join("providers.json");
    if path.exists() {
        let content = fs::read_to_string(&path)?;
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
            export["data"]["providers"] = val;
        }
    }

    Ok(export)
}

/// 仅导入 providers 配置
pub fn import_providers_config(data: serde_json::Value) -> Result<Vec<String>, io::Error> {
    let data_dir = get_data_dir()?;
    fs::create_dir_all(&data_dir)?;
    let mut imported = vec![];

    // 备份
    let backup_dir = data_dir.join("backups").join(Utc::now().format("%Y%m%d_%H%M%S").to_string());
    fs::create_dir_all(&backup_dir)?;

    let file = "providers.json";
    let path = data_dir.join(file);

    // 备份现有文件
    if path.exists() {
        let _ = fs::copy(&path, backup_dir.join(file));
    }

    // 写入导入数据
    if let Some(val) = data.get("data").and_then(|d| d.get("providers")) {
        let content = serde_json::to_string_pretty(val)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        fs::write(&path, content)?;
        imported.push(file.to_string());
    }

    Ok(imported)
}
