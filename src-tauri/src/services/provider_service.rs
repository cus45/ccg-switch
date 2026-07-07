#![allow(dead_code)]
use crate::database::Database;
use crate::models::app_type::AppType;
use crate::models::provider::Provider;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;

// ── 路径函数 ──────────────────────────────────────────────

fn get_data_dir() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".ccg-switch"))
}

fn get_claude_settings_path() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".claude").join("settings.json"))
}

// ── 数据库读写（v3+）──────────────────────────────────────────────

/// 获取指定应用的物理配置文件原始内容（读取供前端展示）
pub fn get_provider_config_files(app: AppType) -> Result<Vec<(String, String)>, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;

    // 配置表：每个应用对应的文件列表
    const CLAUDE_FILES: &[(&str, &str)] = &[(".claude/settings.json", "{}")];
    const CODEX_FILES: &[(&str, &str)] = &[(".codex/auth.json", "{}"), (".codex/config.toml", "")];
    const GEMINI_FILES: &[(&str, &str)] = &[(".gemini/.env", "")];

    let file_configs = match app {
        AppType::Claude => CLAUDE_FILES,
        AppType::Codex => CODEX_FILES,
        AppType::Gemini => GEMINI_FILES,
        _ => &[],
    };

    Ok(file_configs
        .iter()
        .map(|(path, default)| {
            let full_path = home.join(path.trim_start_matches('.'));
            let content = read_file_content(&full_path, default);
            (path.to_string(), content)
        })
        .collect())
}

/// 列出指定应用的 providers（从数据库读取）
pub fn list_providers_from_db(db: &Arc<Database>, app: AppType) -> Result<Vec<Provider>, String> {
    let all = db.list_providers()?;
    Ok(all.into_iter().filter(|p| p.app_type == app).collect())
}

/// 列出所有应用的 providers（从数据库读取）
pub fn list_all_providers_from_db(db: &Arc<Database>) -> Result<Vec<Provider>, String> {
    db.list_providers()
}

/// 获取单个 provider（从数据库读取）
pub fn get_provider_from_db(db: &Arc<Database>, id: &str) -> Result<Provider, String> {
    db.get_provider(id)?
        .ok_or_else(|| format!("Provider {} not found", id))
}

/// 添加 provider（写入数据库）
pub fn add_provider_to_db(db: &Arc<Database>, provider: Provider) -> Result<(), String> {
    db.upsert_provider(&provider)
}

/// 更新 provider（更新数据库并同步 active provider 到应用配置）
pub fn update_provider_in_db(
    db: &Arc<Database>,
    id: &str,
    updated: Provider,
) -> Result<(), String> {
    // 先获取原有记录，保留 is_active 和 created_at
    let existing = db
        .get_provider(id)?
        .ok_or_else(|| format!("Provider {} not found", id))?;

    let mut provider = updated;
    provider.is_active = existing.is_active;
    provider.created_at = existing.created_at;

    db.upsert_provider(&provider)?;

    // 如果是 active provider，立即同步到应用配置
    if provider.is_active {
        sync_provider_to_app_config(&provider).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 删除 provider（从数据库删除）
pub fn delete_provider_from_db(db: &Arc<Database>, id: &str) -> Result<(), String> {
    db.delete_provider(id)?;
    Ok(())
}

/// 切换 provider（更新数据库并同步到应用配置）
pub fn switch_provider_in_db(
    db: &Arc<Database>,
    app: AppType,
    provider_id: &str,
) -> Result<(), String> {
    use chrono::Utc;

    // 1. 获取所有 providers
    let mut all = db.list_providers()?;

    // 2. 同一应用内只有一个活跃
    for p in all.iter_mut() {
        if p.app_type == app {
            p.is_active = p.id == provider_id;
            if p.is_active {
                p.last_used = Some(Utc::now());
            }
        }
    }

    // 3. 批量更新数据库
    for p in all {
        db.upsert_provider(&p)?;
    }

    // 4. 同步到应用配置
    let active = db
        .get_provider(provider_id)?
        .ok_or_else(|| format!("Provider {} not found", provider_id))?;
    sync_provider_to_app_config(&active).map_err(|e| e.to_string())?;

    Ok(())
}

/// 移动 provider 位置（更新数据库顺序）
pub fn move_provider_in_db(
    db: &Arc<Database>,
    provider_id: &str,
    target_index: usize,
) -> Result<(), String> {
    let mut all = db.list_providers()?;
    let current = all
        .iter()
        .position(|p| p.id == provider_id)
        .ok_or_else(|| format!("Provider {} not found", provider_id))?;
    if current == target_index {
        return Ok(());
    }
    let provider = all.remove(current);
    let insert_at = target_index.min(all.len());
    all.insert(insert_at, provider);

    // 按新顺序持久化 sort_order（0..n）
    let ordered_ids: Vec<String> = all.into_iter().map(|p| p.id).collect();
    db.update_provider_sort_orders(&ordered_ids)
}

/// 列出指定应用的 providers（兼容旧版，使用 DB）
pub fn list_providers(_app: AppType) -> Result<Vec<Provider>, String> {
    // 从全局状态获取 DB（需要调用方通过 State 注入）
    // TODO: 此函数保留兼容，新代码请使用 list_providers_from_db
    Ok(vec![])
}

/// 列出所有应用的 providers（兼容旧版，使用 DB）
pub fn list_all_providers() -> Result<Vec<Provider>, String> {
    // TODO: 此函数保留兼容，新代码请使用 list_all_providers_from_db
    Ok(vec![])
}

/// 获取单个 provider（兼容旧版，使用 DB）
pub fn get_provider(_id: &str) -> Result<Provider, String> {
    // TODO: 此函数保留兼容
    Err(format!("Provider not found"))
}

/// 添加 provider（兼容旧版，使用 DB）
pub fn add_provider(_provider: Provider) -> Result<(), String> {
    // TODO: 此函数保留兼容
    Ok(())
}

/// 更新 provider（兼容旧版，使用 DB）
pub fn update_provider(_id: &str, _updated: Provider) -> Result<(), String> {
    // TODO: 此函数保留兼容
    Ok(())
}

/// 删除 provider（兼容旧版，使用 DB）
pub fn delete_provider(_id: &str) -> Result<(), String> {
    // TODO: 此函数保留兼容
    Ok(())
}

/// 切换 provider（兼容旧版，使用 DB）
pub fn switch_provider(_app: AppType, _provider_id: &str) -> Result<(), String> {
    // TODO: 此函数保留兼容
    Ok(())
}

/// 移动 provider 位置（兼容旧版，使用 DB）
pub fn move_provider(_provider_id: &str, _target_index: usize) -> Result<(), String> {
    // TODO: 此函数保留兼容
    Ok(())
}

// ── 配置预览和同步函数（保持不变）─────────────────────────────────

// ── settingsConfig 中需要映射为 env 变量的字段 ─────────────

/// settingsConfig 中某些字段不是 settings.json 顶层配置，
/// 而是需要映射为 env 环境变量。
/// 本函数从 settings 中提取这些字段，写入 env 并从顶层移除。
fn remap_settings_to_env(settings: &mut serde_json::Value) {
    // 提取所有需要映射到 env 的布尔字段
    let teammates_enabled = settings
        .get("teammatesMode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let disable_traffic = settings
        .get("disableNonessentialTraffic")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let disable_attribution = settings
        .get("disableAttributionHeader")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let disable_installation_checks = settings
        .get("disableInstallationChecks")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let enable_tool_search = settings
        .get("enableToolSearch")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let disable_telemetry = settings
        .get("disableTelemetry")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let disable_bug_command = settings
        .get("disableBugCommand")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let disable_autoupdater = settings
        .get("disableAutoupdater")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let disable_error_reporting = settings
        .get("disableErrorReporting")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let max_output = settings
        .get("maxOutputTokens")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    // 从顶层移除（不属于 settings.json 原生字段）
    if let Some(obj) = settings.as_object_mut() {
        obj.remove("teammatesMode");
        obj.remove("disableNonessentialTraffic");
        obj.remove("disableAttributionHeader");
        obj.remove("disableInstallationChecks");
        obj.remove("enableToolSearch");
        obj.remove("disableTelemetry");
        obj.remove("disableBugCommand");
        obj.remove("disableAutoupdater");
        obj.remove("disableErrorReporting");
        obj.remove("maxOutputTokens");
        obj.remove("hideSignature"); // 已废弃，清理残留
    }

    // 写入 env
    if let Some(env) = settings.get_mut("env").and_then(|e| e.as_object_mut()) {
        // teammatesMode → CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
        if teammates_enabled {
            env.insert(
                "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS".to_string(),
                serde_json::Value::String("1".to_string()),
            );
        } else {
            env.remove("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS");
        }
        // disableNonessentialTraffic → CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
        if disable_traffic {
            env.insert(
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".to_string(),
                serde_json::Value::String("1".to_string()),
            );
        } else {
            env.remove("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC");
        }
        // disableAttributionHeader → CLAUDE_CODE_ATTRIBUTION_HEADER
        if disable_attribution {
            env.insert(
                "CLAUDE_CODE_ATTRIBUTION_HEADER".to_string(),
                serde_json::Value::String("0".to_string()),
            );
        } else {
            env.remove("CLAUDE_CODE_ATTRIBUTION_HEADER");
        }
        // disableInstallationChecks → DISABLE_INSTALLATION_CHECKS
        if disable_installation_checks {
            env.insert(
                "DISABLE_INSTALLATION_CHECKS".to_string(),
                serde_json::Value::String("1".to_string()),
            );
        } else {
            env.remove("DISABLE_INSTALLATION_CHECKS");
        }
        // enableToolSearch → ENABLE_TOOL_SEARCH
        if enable_tool_search {
            env.insert(
                "ENABLE_TOOL_SEARCH".to_string(),
                serde_json::Value::String("1".to_string()),
            );
        } else {
            env.remove("ENABLE_TOOL_SEARCH");
        }
        // disableTelemetry → DISABLE_TELEMETRY
        if disable_telemetry {
            env.insert(
                "DISABLE_TELEMETRY".to_string(),
                serde_json::Value::String("1".to_string()),
            );
        } else {
            env.remove("DISABLE_TELEMETRY");
        }
        // disableBugCommand → DISABLE_BUG_COMMAND
        if disable_bug_command {
            env.insert(
                "DISABLE_BUG_COMMAND".to_string(),
                serde_json::Value::String("1".to_string()),
            );
        } else {
            env.remove("DISABLE_BUG_COMMAND");
        }
        // disableAutoupdater → DISABLE_AUTOUPDATER
        if disable_autoupdater {
            env.insert(
                "DISABLE_AUTOUPDATER".to_string(),
                serde_json::Value::String("1".to_string()),
            );
        } else {
            env.remove("DISABLE_AUTOUPDATER");
        }
        // disableErrorReporting → DISABLE_ERROR_REPORTING
        if disable_error_reporting {
            env.insert(
                "DISABLE_ERROR_REPORTING".to_string(),
                serde_json::Value::String("1".to_string()),
            );
        } else {
            env.remove("DISABLE_ERROR_REPORTING");
        }
        // maxOutputTokens → CLAUDE_CODE_MAX_OUTPUT_TOKENS（用户自定义值）
        if !max_output.is_empty() {
            env.insert(
                "CLAUDE_CODE_MAX_OUTPUT_TOKENS".to_string(),
                serde_json::Value::String(max_output.clone()),
            );
        } else {
            env.remove("CLAUDE_CODE_MAX_OUTPUT_TOKENS");
        }
    }
}

// ── 读取当前 Claude settings.json 中的 checkbox 状态 ──────────

/// 从当前 settings.json 中读取所有 checkbox 对应的配置状态，
/// 用于编辑 Provider 时正确初始化复选框。
pub fn get_claude_settings_state() -> Result<serde_json::Value, io::Error> {
    let settings_path = get_claude_settings_path()?;
    let settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?
    } else {
        serde_json::json!({})
    };

    let env = settings.get("env").and_then(|e| e.as_object());

    Ok(serde_json::json!({
        "alwaysThinkingEnabled": settings.get("alwaysThinkingEnabled")
            .and_then(|v| v.as_bool()).unwrap_or(false),
        "teammatesMode": env.and_then(|e| e.get("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"))
            .and_then(|v| v.as_str()) == Some("1"),
        "disableNonessentialTraffic": env.and_then(|e| e.get("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"))
            .and_then(|v| v.as_str()) == Some("1"),
        "disableAttributionHeader": env.and_then(|e| e.get("CLAUDE_CODE_ATTRIBUTION_HEADER"))
            .and_then(|v| v.as_str()) == Some("0"),
        "disableInstallationChecks": env.and_then(|e| e.get("DISABLE_INSTALLATION_CHECKS"))
            .and_then(|v| v.as_str()) == Some("1"),
        "enableToolSearch": env.and_then(|e| e.get("ENABLE_TOOL_SEARCH"))
            .and_then(|v| v.as_str()) == Some("1"),
        "disableTelemetry": env.and_then(|e| e.get("DISABLE_TELEMETRY"))
            .and_then(|v| v.as_str()) == Some("1"),
        "disableBugCommand": env.and_then(|e| e.get("DISABLE_BUG_COMMAND"))
            .and_then(|v| v.as_str()) == Some("1"),
        "disableAutoupdater": env.and_then(|e| e.get("DISABLE_AUTOUPDATER"))
            .and_then(|v| v.as_str()) == Some("1"),
        "disableErrorReporting": env.and_then(|e| e.get("DISABLE_ERROR_REPORTING"))
            .and_then(|v| v.as_str()) == Some("1"),
        "maxOutputTokens": env.and_then(|e| e.get("CLAUDE_CODE_MAX_OUTPUT_TOKENS"))
            .and_then(|v| v.as_str()).unwrap_or(""),
    }))
}

// ── 配置预览辅助函数 ──────────────────────────────────────────────

/// 读取文件内容，失败时返回默认值
fn read_file_content(path: &std::path::Path, default: &str) -> String {
    if path.exists() {
        fs::read_to_string(path).unwrap_or_else(|_| default.to_string())
    } else {
        default.to_string()
    }
}

/// 构建 JSON 文件预览（带基线）
fn build_json_preview(
    path: &std::path::Path,
    preview: &serde_json::Value,
) -> Result<(String, String, String), io::Error> {
    let baseline: serde_json::Value = if path.exists() {
        let content = fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string());
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    Ok((
        path.to_string_lossy().to_string(),
        serde_json::to_string_pretty(preview)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?,
        serde_json::to_string_pretty(&baseline)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?,
    ))
}

/// 构建 TOML 配置预览（带基线）
fn build_toml_preview(
    path: &std::path::Path,
    build_doc: impl FnOnce(&toml::Value) -> toml::Value,
) -> Result<(String, String, String), io::Error> {
    let existing = read_file_content(path, "");

    let baseline: toml::Value = if existing.is_empty() {
        toml::Value::Table(toml::Table::new())
    } else {
        toml::from_str(&existing)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?
    };

    let baseline_str = if existing.is_empty() {
        String::new()
    } else {
        toml::to_string_pretty(&baseline)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?
    };

    let doc = build_doc(&baseline);
    let toml_str = toml::to_string_pretty(&doc)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;

    Ok((path.to_string_lossy().to_string(), toml_str, baseline_str))
}

/// 构建 env 文件预览（带基线）
fn build_env_preview(
    path: &std::path::Path,
    build_lines: impl FnOnce() -> Vec<String>,
) -> Result<(String, String, String), io::Error> {
    let baseline = read_file_content(path, "");
    let content = build_lines().join("\n");

    Ok((path.to_string_lossy().to_string(), content, baseline))
}

// ── 配置同步辅助函数 ──────────────────────────────────────────────

/// 合并 provider 的 API Key 和可选字段到 env 对象
fn merge_provider_to_env(
    env: &mut serde_json::Map<String, serde_json::Value>,
    api_key: &str,
    optional_fields: &[(&str, &Option<String>)],
) {
    env.insert(
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        serde_json::Value::String(api_key.to_string()),
    );

    for (key, value) in optional_fields {
        match value {
            Some(v) => env.insert(key.to_string(), serde_json::Value::String(v.clone())),
            None => env.remove(*key),
        };
    }
}

/// 写入 Codex 的 TOML 配置
fn write_codex_toml_config(
    config_path: &std::path::Path,
    base_url: &str,
    model: &str,
) -> Result<(), io::Error> {
    let existing = read_file_content(config_path, "");

    let mut doc: toml::Value = if existing.is_empty() {
        toml::Value::Table(toml::Table::new())
    } else {
        toml::from_str(&existing)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?
    };

    if let toml::Value::Table(ref mut t) = doc {
        t.insert(
            "model_provider".into(),
            toml::Value::String("newapi".into()),
        );
        t.insert("model".into(), toml::Value::String(model.into()));

        let mp = t
            .entry("model_providers")
            .or_insert(toml::Value::Table(toml::Table::new()));
        if let toml::Value::Table(ref mut mp_table) = mp {
            let newapi = mp_table
                .entry("newapi")
                .or_insert(toml::Value::Table(toml::Table::new()));
            if let toml::Value::Table(ref mut newapi_table) = newapi {
                newapi_table.insert("base_url".into(), toml::Value::String(base_url.to_string()));
                newapi_table
                    .entry("name")
                    .or_insert(toml::Value::String("Custom".into()));
                newapi_table
                    .entry("wire_api")
                    .or_insert(toml::Value::String("responses".into()));
                newapi_table
                    .entry("requires_openai_auth")
                    .or_insert(toml::Value::Boolean(true));
            }
        }
    }

    let toml_str = toml::to_string_pretty(&doc)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
    fs::write(config_path, toml_str.as_bytes())
}

/// 写入 Gemini 的 env 配置
fn write_gemini_env(
    env_path: &std::path::Path,
    url: Option<&str>,
    api_key: &str,
    model: Option<&str>,
) -> Result<(), io::Error> {
    let mut env_lines = Vec::new();

    if let Some(u) = url {
        let trimmed = u.trim();
        if !trimmed.is_empty() {
            env_lines.push(format!("GOOGLE_GEMINI_BASE_URL={}", trimmed));
        }
    }
    if !api_key.is_empty() {
        env_lines.push(format!("GEMINI_API_KEY={}", api_key.trim()));
    }
    if let Some(m) = model {
        let trimmed = m.trim();
        if !trimmed.is_empty() {
            env_lines.push(format!("GEMINI_MODEL={}", trimmed));
        }
    }

    fs::write(env_path, env_lines.join("\n").as_bytes())
}

/// 预览 provider 切换后的完整配置文件内容（不写入磁盘）
/// 返回 Vec<(文件标题，预览内容，基线内容)>，基线是同一序列化器处理的原始文件，确保 diff 只反映真实差异
pub fn preview_provider_sync(
    provider: &Provider,
) -> Result<Vec<(String, String, String)>, io::Error> {
    match provider.app_type {
        AppType::Claude => preview_claude_settings(provider),
        AppType::Codex => preview_codex_config(provider),
        AppType::Gemini => preview_gemini_config(provider),
        _ => preview_generic_settings(provider),
    }
}

/// 预览 Claude settings.json 合并结果
fn preview_claude_settings(
    provider: &Provider,
) -> Result<Vec<(String, String, String)>, io::Error> {
    let settings_path = get_claude_settings_path()?;
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?
    } else {
        serde_json::json!({})
    };

    let baseline = serde_json::to_string_pretty(&settings)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

    // 合并 settingsConfig 顶层字段
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
    let env = settings["env"]
        .as_object_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "env is not an object"))?;

    // 合并 provider 配置
    let optional_fields = [
        ("ANTHROPIC_BASE_URL", &provider.url),
        (
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            &provider.default_sonnet_model,
        ),
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", &provider.default_opus_model),
        (
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            &provider.default_haiku_model,
        ),
        (
            "ANTHROPIC_REASONING_MODEL",
            &provider.default_reasoning_model,
        ),
    ];
    merge_provider_to_env(env, &provider.api_key, &optional_fields);

    // 合并自定义参数
    if let Some(ref params) = provider.custom_params {
        for (key, value) in params {
            env.insert(key.clone(), value.clone());
        }
    }

    // 映射特殊字段到 env
    remap_settings_to_env(&mut settings);

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    Ok(vec![(
        ".claude/settings.json".to_string(),
        content,
        baseline,
    )])
}

/// 预览 Codex 配置合并结果
fn preview_codex_config(provider: &Provider) -> Result<Vec<(String, String, String)>, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    let codex_dir = home.join(".codex");

    // auth.json
    let auth_path = codex_dir.join("auth.json");
    let auth_preview = serde_json::json!({ "OPENAI_API_KEY": provider.api_key });
    let (auth_title, auth_content, auth_baseline) = build_json_preview(&auth_path, &auth_preview)?;

    let mut files = vec![(auth_title, auth_content, auth_baseline)];

    // config.toml
    if let Some(ref url) = provider.url {
        let base_url = normalize_codex_base_url(url);
        let model = provider
            .default_sonnet_model
            .as_deref()
            .unwrap_or("o4-mini");
        let config_path = codex_dir.join("config.toml");

        let (config_title, config_content, config_baseline) =
            build_toml_preview(&config_path, |baseline_doc| {
                let mut doc = baseline_doc.clone();
                if let toml::Value::Table(ref mut t) = doc {
                    t.insert(
                        "model_provider".into(),
                        toml::Value::String("newapi".into()),
                    );
                    t.insert("model".into(), toml::Value::String(model.into()));

                    let mp = t
                        .entry("model_providers")
                        .or_insert(toml::Value::Table(toml::Table::new()));
                    if let toml::Value::Table(ref mut mp_table) = mp {
                        let newapi = mp_table
                            .entry("newapi")
                            .or_insert(toml::Value::Table(toml::Table::new()));
                        if let toml::Value::Table(ref mut newapi_table) = newapi {
                            newapi_table.insert("base_url".into(), toml::Value::String(base_url));
                            newapi_table
                                .entry("name")
                                .or_insert(toml::Value::String("Custom".into()));
                            newapi_table
                                .entry("wire_api")
                                .or_insert(toml::Value::String("responses".into()));
                            newapi_table
                                .entry("requires_openai_auth")
                                .or_insert(toml::Value::Boolean(true));
                        }
                    }
                }
                doc
            })?;
        files.push((config_title, config_content, config_baseline));
    }

    Ok(files)
}

/// 预览 Gemini 配置合并结果
fn preview_gemini_config(provider: &Provider) -> Result<Vec<(String, String, String)>, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    let env_path = home.join(".gemini").join(".env");

    let url = provider.url.as_ref().map(|s| s.as_str());
    let model = provider.default_sonnet_model.as_ref().map(|s| s.as_str());

    build_env_preview(&env_path, || {
        let mut lines = Vec::new();
        if let Some(u) = url {
            if !u.trim().is_empty() {
                lines.push(format!("GOOGLE_GEMINI_BASE_URL={}", u.trim()));
            }
        }
        if !provider.api_key.is_empty() {
            lines.push(format!("GEMINI_API_KEY={}", provider.api_key.trim()));
        }
        if let Some(m) = model {
            if !m.trim().is_empty() {
                lines.push(format!("GEMINI_MODEL={}", m.trim()));
            }
        }
        lines
    })
    .map(|(title, content, baseline)| vec![(title, content, baseline)])
}

/// 预览通用应用配置合并结果
fn preview_generic_settings(
    provider: &Provider,
) -> Result<Vec<(String, String, String)>, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    let config_dir = home.join(format!(".{}", provider.app_type.as_str()));
    let config_path = config_dir.join(provider.app_type.config_file_name());

    let mut settings: serde_json::Value = if config_path.exists() {
        let content = fs::read_to_string(&config_path)?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let baseline = serde_json::to_string_pretty(&settings)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

    if settings.get("env").is_none() {
        settings["env"] = serde_json::json!({});
    }

    let prefix = provider.app_type.env_prefix();
    let env = settings["env"]
        .as_object_mut()
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

    let title = format!(
        ".{}/{}",
        provider.app_type.as_str(),
        provider.app_type.config_file_name()
    );
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    Ok(vec![(title, content, baseline)])
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
        serde_json::from_str(&content).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?
    } else {
        serde_json::json!({})
    };

    // 合并 settingsConfig 顶层字段
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
    let env = settings["env"]
        .as_object_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "env is not an object"))?;

    // 合并 provider 配置
    let optional_fields = [
        ("ANTHROPIC_BASE_URL", &provider.url),
        (
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            &provider.default_sonnet_model,
        ),
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", &provider.default_opus_model),
        (
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            &provider.default_haiku_model,
        ),
        (
            "ANTHROPIC_REASONING_MODEL",
            &provider.default_reasoning_model,
        ),
    ];
    merge_provider_to_env(env, &provider.api_key, &optional_fields);

    // 合并自定义参数
    if let Some(ref params) = provider.custom_params {
        for (key, value) in params {
            env.insert(key.clone(), value.clone());
        }
    }

    // 映射特殊字段到 env
    remap_settings_to_env(&mut settings);

    crate::services::storage::json_store::write_json(&settings_path, &settings)
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
    let env = settings["env"]
        .as_object_mut()
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

    crate::services::storage::json_store::write_json(&config_path, &settings)
}

fn normalize_codex_base_url(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

fn sync_to_codex_config(provider: &Provider) -> Result<(), io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    let codex_dir = home.join(".codex");
    fs::create_dir_all(&codex_dir)?;

    // auth.json
    let auth_path = codex_dir.join("auth.json");
    let auth = serde_json::json!({ "OPENAI_API_KEY": provider.api_key });
    crate::services::storage::json_store::write_json(&auth_path, &auth)?;

    // config.toml
    if let Some(ref url) = provider.url {
        let base_url = normalize_codex_base_url(url);
        let model = provider
            .default_sonnet_model
            .as_deref()
            .unwrap_or("o4-mini");
        let config_path = codex_dir.join("config.toml");
        write_codex_toml_config(&config_path, &base_url, model)?;
    }

    Ok(())
}

fn sync_to_gemini_config(provider: &Provider) -> Result<(), io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    let gemini_dir = home.join(".gemini");
    fs::create_dir_all(&gemini_dir)?;

    // .env
    let env_path = gemini_dir.join(".env");
    let url = provider.url.as_ref().map(|s| s.as_str());
    let model = provider.default_sonnet_model.as_ref().map(|s| s.as_str());
    write_gemini_env(&env_path, url, &provider.api_key, model)?;

    // settings.json
    let settings_path = gemini_dir.join("settings.json");
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    settings["security"]["auth"]["selectedType"] = serde_json::json!("gemini-api-key");
    crate::services::storage::json_store::write_json(&settings_path, &settings)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn test_provider(id: &str, name: &str) -> Provider {
        Provider {
            id: id.to_string(),
            name: name.to_string(),
            app_type: AppType::Claude,
            api_key: "sk-test".to_string(),
            url: None,
            default_sonnet_model: None,
            default_opus_model: None,
            default_haiku_model: None,
            default_reasoning_model: None,
            custom_params: None,
            settings_config: None,
            meta: None,
            icon: None,
            in_failover_queue: false,
            description: None,
            tags: None,
            is_active: false,
            created_at: Utc::now(),
            last_used: None,
            proxy_config: None,
        }
    }

    fn ids(providers: &[Provider]) -> Vec<&str> {
        providers.iter().map(|p| p.id.as_str()).collect()
    }

    #[test]
    fn move_provider_persists_new_order() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        for (id, name) in [("p1", "Alpha"), ("p2", "Beta"), ("p3", "Gamma")] {
            db.upsert_provider(&test_provider(id, name))
                .expect("seed provider");
        }

        move_provider_in_db(&db, "p3", 0).expect("move provider");

        let providers = db.list_providers().expect("list providers");
        assert_eq!(ids(&providers), vec!["p3", "p1", "p2"]);
    }

    #[test]
    fn upsert_keeps_position_on_update_and_appends_new() {
        let db = Arc::new(Database::in_memory().expect("init in-memory db"));
        for (id, name) in [("p1", "Alpha"), ("p2", "Beta")] {
            db.upsert_provider(&test_provider(id, name))
                .expect("seed provider");
        }
        move_provider_in_db(&db, "p2", 0).expect("move provider");

        // 更新已有 provider（即使改名）不应改变其拖拽后的位置
        db.upsert_provider(&test_provider("p1", "Zulu"))
            .expect("update provider");
        // 新增 provider 应排到队尾（即使名称字典序最小）
        db.upsert_provider(&test_provider("p3", "AAA"))
            .expect("add provider");

        let providers = db.list_providers().expect("list providers");
        assert_eq!(ids(&providers), vec!["p2", "p1", "p3"]);
    }
}
