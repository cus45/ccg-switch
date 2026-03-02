use crate::models::app_type::AppType;
use crate::models::provider::{Provider, ProvidersConfig};
use crate::services::storage::json_store;
use std::fs;
use std::io;
use std::path::PathBuf;
use chrono::Utc;

// ── 路径函数 ──────────────────────────────────────────────

fn get_data_dir() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".claude-switch"))
}

fn get_providers_path() -> Result<PathBuf, io::Error> {
    Ok(get_data_dir()?.join("providers.json"))
}

fn get_claude_settings_path() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".claude").join("settings.json"))
}

// ── 内部读写 ──────────────────────────────────────────────

fn load_providers() -> Result<Vec<Provider>, io::Error> {
    let path = get_providers_path()?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let config: ProvidersConfig = json_store::read_json(&path)?;
    Ok(config.providers)
}

fn save_providers(providers: &[Provider]) -> Result<(), io::Error> {
    let path = get_providers_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let config = ProvidersConfig { providers: providers.to_vec() };
    json_store::write_json(&path, &config)
}

// ── 公开 API ──────────────────────────────────────────────

/// 列出指定应用的 providers
pub fn list_providers(app: AppType) -> Result<Vec<Provider>, io::Error> {
    let all = load_providers()?;
    Ok(all.into_iter().filter(|p| p.app_type == app).collect())
}

/// 列出所有应用的 providers
pub fn list_all_providers() -> Result<Vec<Provider>, io::Error> {
    load_providers()
}

/// 获取单个 provider
pub fn get_provider(id: &str) -> Result<Provider, io::Error> {
    let all = load_providers()?;
    all.into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Provider not found"))
}

/// 添加 provider
pub fn add_provider(provider: Provider) -> Result<(), io::Error> {
    let mut all = load_providers()?;
    all.push(provider);
    save_providers(&all)
}

/// 更新 provider（保留 id, is_active, created_at）
pub fn update_provider(id: &str, updated: Provider) -> Result<(), io::Error> {
    let mut all = load_providers()?;
    let p = all.iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Provider not found"))?;

    p.name = updated.name;
    p.app_type = updated.app_type;
    p.api_key = updated.api_key;
    p.url = updated.url;
    p.default_sonnet_model = updated.default_sonnet_model;
    p.default_opus_model = updated.default_opus_model;
    p.default_haiku_model = updated.default_haiku_model;
    p.custom_params = updated.custom_params;
    p.settings_config = updated.settings_config;
    p.meta = updated.meta;
    p.icon = updated.icon;
    p.in_failover_queue = updated.in_failover_queue;
    p.description = updated.description;

    save_providers(&all)
}

/// 删除 provider
pub fn delete_provider(id: &str) -> Result<(), io::Error> {
    let mut all = load_providers()?;
    all.retain(|p| p.id != id);
    save_providers(&all)
}

/// 切换 provider（设为活跃并写入对应应用配置）
pub fn switch_provider(app: AppType, provider_id: &str) -> Result<(), io::Error> {
    let mut all = load_providers()?;

    // 同一应用内只有一个活跃
    for p in all.iter_mut() {
        if p.app_type == app {
            p.is_active = p.id == provider_id;
            if p.is_active {
                p.last_used = Some(Utc::now());
            }
        }
    }
    save_providers(&all)?;

    // 找到激活的 provider 并同步到应用配置
    let active = all.iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Provider not found"))?;
    sync_provider_to_app_config(active)
}

/// 移动 provider 位置
pub fn move_provider(provider_id: &str, target_index: usize) -> Result<(), io::Error> {
    let mut all = load_providers()?;
    let current = all.iter().position(|p| p.id == provider_id)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Provider not found"))?;
    if current == target_index {
        return Ok(());
    }
    let provider = all.remove(current);
    let insert_at = target_index.min(all.len());
    all.insert(insert_at, provider);
    save_providers(&all)
}

// ── 配置同步 ──────────────────────────────────────────────

/// 将 provider 配置同步到对应应用的配置文件
fn sync_provider_to_app_config(provider: &Provider) -> Result<(), io::Error> {
    match provider.app_type {
        AppType::Claude => sync_to_claude_settings(provider),
        AppType::Codex => sync_to_codex_config(provider),
        AppType::Gemini => sync_to_gemini_config(provider),
        _ => sync_to_generic_settings(provider),
    }
}

/// 同步到 Claude ~/.claude/settings.json
fn sync_to_claude_settings(provider: &Provider) -> Result<(), io::Error> {
    let settings_path = get_claude_settings_path()?;
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?
    } else {
        serde_json::json!({})
    };

    // 如果有 settingsConfig，合并顶层字段
    if let Some(ref sc) = provider.settings_config {
        if let Some(obj) = sc.as_object() {
            for (k, v) in obj {
                settings[k] = v.clone();
            }
        }
    }

    // 确保 env 对象存在
    if settings.get("env").is_none() {
        settings["env"] = serde_json::json!({});
    }
    let env = settings["env"].as_object_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "env is not an object"))?;

    // 写入 API Key
    env.insert(
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        serde_json::Value::String(provider.api_key.clone()),
    );

    // 可选字段：有值写入，无值删除
    let optional_fields = [
        ("ANTHROPIC_BASE_URL", &provider.url),
        ("ANTHROPIC_DEFAULT_SONNET_MODEL", &provider.default_sonnet_model),
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", &provider.default_opus_model),
        ("ANTHROPIC_DEFAULT_HAIKU_MODEL", &provider.default_haiku_model),
    ];
    for (key, value) in optional_fields {
        match value {
            Some(v) => { env.insert(key.to_string(), serde_json::Value::String(v.clone())); }
            None => { env.remove(key); }
        }
    }

    // 合并自定义参数
    if let Some(ref params) = provider.custom_params {
        for (key, value) in params {
            env.insert(key.clone(), value.clone());
        }
    }

    json_store::write_json(&settings_path, &settings)
}

/// 通用应用配置同步（非 Claude 应用）
fn sync_to_generic_settings(provider: &Provider) -> Result<(), io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    let config_dir = home.join(format!(".{}", provider.app_type.as_str()));
    fs::create_dir_all(&config_dir)?;
    let config_path = config_dir.join(provider.app_type.config_file_name());

    let mut settings: serde_json::Value = if config_path.exists() {
        let content = fs::read_to_string(&config_path)?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if settings.get("env").is_none() {
        settings["env"] = serde_json::json!({});
    }

    let prefix = provider.app_type.env_prefix();
    let env = settings["env"].as_object_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "env is not an object"))?;

    env.insert(
        format!("{}_AUTH_TOKEN", prefix),
        serde_json::Value::String(provider.api_key.clone()),
    );

    if let Some(ref url) = provider.url {
        env.insert(
            format!("{}_BASE_URL", prefix),
            serde_json::Value::String(url.clone()),
        );
    } else {
        env.remove(&format!("{}_BASE_URL", prefix));
    }

    json_store::write_json(&config_path, &settings)
}

fn normalize_codex_base_url(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

fn sync_to_codex_config(provider: &Provider) -> Result<(), io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    let codex_dir = home.join(".codex");
    fs::create_dir_all(&codex_dir)?;

    let auth_path = codex_dir.join("auth.json");
    let auth = serde_json::json!({ "OPENAI_API_KEY": provider.api_key });
    json_store::write_json(&auth_path, &auth)?;

    if let Some(ref url) = provider.url {
        let base_url = normalize_codex_base_url(url);
        let model = provider.default_sonnet_model.as_deref().unwrap_or("o4-mini");
        let config_path = codex_dir.join("config.toml");

        let existing = if config_path.exists() {
            fs::read_to_string(&config_path).unwrap_or_default()
        } else {
            String::new()
        };

        let mut doc: toml::Value = if existing.is_empty() {
            toml::Value::Table(toml::Table::new())
        } else {
            toml::from_str(&existing)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?
        };

        if let toml::Value::Table(ref mut t) = doc {
            t.insert("model_provider".into(), toml::Value::String("newapi".into()));
            t.insert("model".into(), toml::Value::String(model.into()));

            let mp = t.entry("model_providers")
                .or_insert(toml::Value::Table(toml::Table::new()));
            if let toml::Value::Table(ref mut mp_table) = mp {
                let newapi = mp_table.entry("newapi")
                    .or_insert(toml::Value::Table(toml::Table::new()));
                if let toml::Value::Table(ref mut newapi_table) = newapi {
                    newapi_table.insert("base_url".into(), toml::Value::String(base_url));
                    newapi_table.entry("name")
                        .or_insert(toml::Value::String("Custom".into()));
                    newapi_table.entry("wire_api")
                        .or_insert(toml::Value::String("responses".into()));
                    newapi_table.entry("requires_openai_auth")
                        .or_insert(toml::Value::Boolean(true));
                }
            }
        }

        let toml_str = toml::to_string_pretty(&doc)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        fs::write(&config_path, toml_str.as_bytes())?;
    }

    Ok(())
}

fn sync_to_gemini_config(provider: &Provider) -> Result<(), io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    let gemini_dir = home.join(".gemini");
    fs::create_dir_all(&gemini_dir)?;

    let mut env_lines: Vec<String> = Vec::new();
    if let Some(ref url) = provider.url {
        if !url.trim().is_empty() {
            env_lines.push(format!("GOOGLE_GEMINI_BASE_URL={}", url.trim()));
        }
    }
    if !provider.api_key.is_empty() {
        env_lines.push(format!("GEMINI_API_KEY={}", provider.api_key.trim()));
    }
    if let Some(ref model) = provider.default_sonnet_model {
        if !model.trim().is_empty() {
            env_lines.push(format!("GEMINI_MODEL={}", model.trim()));
        }
    }
    let env_content = env_lines.join("\n");
    let env_path = gemini_dir.join(".env");
    fs::write(&env_path, env_content.as_bytes())?;

    let settings_path = gemini_dir.join("settings.json");
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    settings["security"]["auth"]["selectedType"] = serde_json::json!("gemini-api-key");
    json_store::write_json(&settings_path, &settings)?;

    Ok(())
}