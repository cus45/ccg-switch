//! Live 配置接管引擎
//!
//! 启动代理时把各 CLI 的配置文件改写为指向本地代理（原始内容备份进数据库），
//! 停止代理或异常恢复时原样还原。真实 API Key 只保存在数据库中，由代理按请求注入。
//!
//! 备份存储：`app_configs` 表，key = `proxy_live_backup_<app>`，
//! value = JSON `{ "files": { "<绝对路径>": "<原始内容>" | null } }`（null 表示文件原本不存在）。

use crate::database::Database;
use crate::models::app_type::AppType;
use crate::models::provider::Provider;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;

/// 写入 Live 配置的 Token 占位符（代理会注入真实 Token，同时避免 CLI 提示缺少 key）
pub const PROXY_TOKEN_PLACEHOLDER: &str = "ccg-proxy-managed";

const BACKUP_KEY_PREFIX: &str = "proxy_live_backup_";

/// 接管模式下需要从 Claude Live 配置移除的模型覆盖字段。
///
/// 代理模式下切换供应商不会重写 Live 配置，保留这些字段会让 Claude Code
/// 继续用旧供应商的模型名发起请求；模型映射改由代理按 provider 实时完成。
const CLAUDE_MODEL_OVERRIDE_KEYS: [&str; 6] = [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_REASONING_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
];

/// 代理支持接管的应用
pub const TAKEOVER_APPS: [AppType; 3] = [AppType::Claude, AppType::Codex, AppType::Gemini];

fn backup_key(app: AppType) -> String {
    format!("{}{}", BACKUP_KEY_PREFIX, app.as_str())
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Home directory not found".to_string())
}

/// 计算客户端可连接的代理地址（监听 0.0.0.0/:: 时客户端需用回环地址）
pub fn build_connect_origin(host: &str, port: u16) -> String {
    let connect_host = match host {
        "0.0.0.0" | "" => "127.0.0.1".to_string(),
        "::" => "::1".to_string(),
        other => other.to_string(),
    };
    let host_for_url = if connect_host.contains(':') && !connect_host.starts_with('[') {
        format!("[{}]", connect_host)
    } else {
        connect_host
    };
    format!("http://{}:{}", host_for_url, port)
}

/// 判断 URL 是否指向本机代理（用于残留检测与 token 校验防护）
pub fn is_local_proxy_url(url: &str) -> bool {
    let url = url.trim();
    let Some(rest) = url.strip_prefix("http://") else {
        return false;
    };
    rest.starts_with("127.0.0.1")
        || rest.starts_with("localhost")
        || rest.starts_with("0.0.0.0")
        || rest.starts_with("[::1]")
        || rest.starts_with("[::]")
}

/// 指定应用的 Live 配置文件列表
fn live_files(app: AppType) -> Result<Vec<PathBuf>, String> {
    let home = home_dir()?;
    Ok(match app {
        AppType::Claude => vec![home.join(".claude").join("settings.json")],
        AppType::Codex => vec![
            home.join(".codex").join("auth.json"),
            home.join(".codex").join("config.toml"),
        ],
        AppType::Gemini => vec![home.join(".gemini").join(".env")],
        _ => vec![],
    })
}

// ── 备份 / 状态 ──────────────────────────────────────────────

/// 是否存在指定应用的接管备份
pub fn has_backup(db: &Arc<Database>, app: AppType) -> bool {
    matches!(db.get_app_config(&backup_key(app)), Ok(Some(_)))
}

/// 当前已接管的应用列表
pub fn taken_over_apps(db: &Arc<Database>) -> Vec<String> {
    TAKEOVER_APPS
        .iter()
        .filter(|app| has_backup(db, **app))
        .map(|app| app.as_str().to_string())
        .collect()
}

/// 是否有任意应用处于接管状态
pub fn is_takeover_active(db: &Arc<Database>) -> bool {
    !taken_over_apps(db).is_empty()
}

/// 备份应用的 Live 文件（幂等：已有备份时保留旧备份，防止二次接管覆盖原始内容）
fn backup_app(db: &Arc<Database>, app: AppType) -> Result<(), String> {
    let key = backup_key(app);
    if db.get_app_config(&key)?.is_some() {
        return Ok(());
    }

    let mut files: BTreeMap<String, Option<String>> = BTreeMap::new();
    for path in live_files(app)? {
        let content = if path.exists() {
            Some(fs::read_to_string(&path).map_err(|e| {
                format!("读取 {} 失败: {}", path.display(), e)
            })?)
        } else {
            None
        };
        files.insert(path.to_string_lossy().to_string(), content);
    }

    let payload = serde_json::to_string(&json!({ "files": files }))
        .map_err(|e| format!("序列化备份失败: {e}"))?;
    db.set_app_config(&key, &payload)
}

// ── 接管 ──────────────────────────────────────────────

/// 对所有配置了活跃 provider 的应用执行接管，返回接管的应用名列表
pub fn takeover_all(db: &Arc<Database>, host: &str, port: u16) -> Result<Vec<String>, String> {
    let origin = build_connect_origin(host, port);
    let mut taken = Vec::new();

    for app in TAKEOVER_APPS {
        let providers = db.list_providers_by_app(app.as_str())?;
        let Some(active) = providers.iter().find(|p| p.is_active) else {
            continue;
        };

        backup_app(db, app)?;
        if let Err(e) = write_proxied_config(app, &origin, active) {
            // 写入失败：立即还原该应用，避免半接管状态
            let restore_result = restore_app(db, app);
            return Err(format!(
                "接管 {} 失败: {e}{}",
                app.as_str(),
                match restore_result {
                    Ok(_) => "（已还原原始配置）".to_string(),
                    Err(re) => format!("（还原失败: {re}，备份保留，重启应用可自动恢复）"),
                }
            ));
        }

        tracing::info!("[Takeover] {} Live 配置已指向 {}", app.as_str(), origin);
        taken.push(app.as_str().to_string());
    }

    Ok(taken)
}

/// 将应用的 Live 配置改写为指向本地代理
fn write_proxied_config(app: AppType, origin: &str, active: &Provider) -> Result<(), String> {
    match app {
        AppType::Claude => write_claude_proxied(origin),
        AppType::Codex => write_codex_proxied(origin, active),
        AppType::Gemini => write_gemini_proxied(origin, active),
        _ => Ok(()),
    }
}

fn write_claude_proxied(origin: &str) -> Result<(), String> {
    let path = home_dir()?.join(".claude").join("settings.json");
    write_claude_proxied_at(&path, origin)
}

/// 回环地址的 NO_PROXY 豁免条目
///
/// 用户机器常见 HTTP_PROXY/HTTPS_PROXY 环境代理（如 Clash）；Claude Code 等
/// CLI 会遵循这些变量，把发往 `http://127.0.0.1:<port>` 的请求交给外部代理，
/// 导致"本机连不上自己的代理、别的机器反而能用"。接管时必须写入 NO_PROXY 豁免。
const NO_PROXY_LOOPBACK_ENTRIES: [&str; 3] = ["localhost", "127.0.0.1", "::1"];

/// 合并 NO_PROXY 值：保留已有条目，补齐回环豁免，忽略大小写去重
fn merge_no_proxy(existing_values: &[Option<&str>]) -> String {
    let mut merged: Vec<String> = Vec::new();
    let mut seen: Vec<String> = Vec::new();

    let mut push = |entry: &str| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            return;
        }
        let key = trimmed.to_ascii_lowercase();
        if !seen.contains(&key) {
            seen.push(key);
            merged.push(trimmed.to_string());
        }
    };

    for value in existing_values.iter().flatten() {
        for entry in value.split(',') {
            push(entry);
        }
    }
    for entry in NO_PROXY_LOOPBACK_ENTRIES {
        push(entry);
    }

    merged.join(",")
}

fn write_claude_proxied_at(path: &PathBuf, origin: &str) -> Result<(), String> {
    let mut settings: Value = if path.exists() {
        let content =
            fs::read_to_string(path).map_err(|e| format!("读取 settings.json 失败: {e}"))?;
        serde_json::from_str(&content).map_err(|e| format!("解析 settings.json 失败: {e}"))?
    } else {
        json!({})
    };

    if !settings.is_object() {
        return Err("settings.json 根节点不是 JSON 对象".to_string());
    }

    if settings.get("env").and_then(|v| v.as_object()).is_none() {
        settings["env"] = json!({});
    }
    let env = settings["env"]
        .as_object_mut()
        .ok_or_else(|| "env 不是 JSON 对象".to_string())?;

    env.insert("ANTHROPIC_BASE_URL".to_string(), json!(origin));
    env.insert(
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        json!(PROXY_TOKEN_PLACEHOLDER),
    );
    if env.contains_key("ANTHROPIC_API_KEY") {
        env.insert(
            "ANTHROPIC_API_KEY".to_string(),
            json!(PROXY_TOKEN_PLACEHOLDER),
        );
    }
    for key in CLAUDE_MODEL_OVERRIDE_KEYS {
        env.remove(key);
    }

    // 写入 NO_PROXY 豁免回环地址：合并 env 块与系统环境中已有的值，避免覆盖用户配置。
    // 若 env 块里已有小写 no_proxy，同步更新它（部分工具只读小写变量）。
    let settings_no_proxy = env
        .get("NO_PROXY")
        .and_then(|v| v.as_str())
        .map(String::from);
    let settings_no_proxy_lower = env
        .get("no_proxy")
        .and_then(|v| v.as_str())
        .map(String::from);
    let system_no_proxy = std::env::var("NO_PROXY").ok();
    let system_no_proxy_lower = std::env::var("no_proxy").ok();

    let merged = merge_no_proxy(&[
        settings_no_proxy.as_deref(),
        settings_no_proxy_lower.as_deref(),
        system_no_proxy.as_deref(),
        system_no_proxy_lower.as_deref(),
    ]);
    if env.contains_key("no_proxy") {
        env.insert("no_proxy".to_string(), json!(&merged));
    }
    env.insert("NO_PROXY".to_string(), json!(&merged));

    crate::services::storage::json_store::write_json(path, &settings)
        .map_err(|e| format!("写入 settings.json 失败: {e}"))
}

fn write_codex_proxied(origin: &str, active: &Provider) -> Result<(), String> {
    let codex_dir = home_dir()?.join(".codex");
    fs::create_dir_all(&codex_dir).map_err(|e| format!("创建 .codex 目录失败: {e}"))?;

    // auth.json：合并写入占位符，保留其他字段
    let auth_path = codex_dir.join("auth.json");
    let mut auth: Value = if auth_path.exists() {
        fs::read_to_string(&auth_path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_else(|| json!({}))
    } else {
        json!({})
    };
    if !auth.is_object() {
        auth = json!({});
    }
    auth["OPENAI_API_KEY"] = json!(PROXY_TOKEN_PLACEHOLDER);
    crate::services::storage::json_store::write_json(&auth_path, &auth)
        .map_err(|e| format!("写入 auth.json 失败: {e}"))?;

    // config.toml：base_url 指向代理（Codex 约定 base_url 带 /v1）
    let model = active.default_sonnet_model.as_deref().unwrap_or("o4-mini");
    let config_path = codex_dir.join("config.toml");
    crate::services::provider_service::write_codex_toml_config(
        &config_path,
        &format!("{}/v1", origin),
        model,
    )
    .map_err(|e| format!("写入 config.toml 失败: {e}"))
}

fn write_gemini_proxied(origin: &str, active: &Provider) -> Result<(), String> {
    let gemini_dir = home_dir()?.join(".gemini");
    fs::create_dir_all(&gemini_dir).map_err(|e| format!("创建 .gemini 目录失败: {e}"))?;

    let mut lines = vec![
        format!("GOOGLE_GEMINI_BASE_URL={}", origin),
        format!("GEMINI_API_KEY={}", PROXY_TOKEN_PLACEHOLDER),
    ];
    if let Some(model) = active
        .default_sonnet_model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
    {
        lines.push(format!("GEMINI_MODEL={}", model));
    }
    // 防止本机 HTTP_PROXY 环境代理劫持回环地址
    lines.push(format!(
        "NO_PROXY={}",
        merge_no_proxy(&[std::env::var("NO_PROXY").ok().as_deref()])
    ));

    let env_path = gemini_dir.join(".env");
    fs::write(&env_path, lines.join("\n").as_bytes())
        .map_err(|e| format!("写入 .env 失败: {e}"))
}

// ── 恢复 ──────────────────────────────────────────────

/// 恢复所有已接管应用的原始配置，返回恢复的应用名列表
pub fn restore_all(db: &Arc<Database>) -> Result<Vec<String>, String> {
    let mut restored = Vec::new();
    let mut errors = Vec::new();

    for app in TAKEOVER_APPS {
        if !has_backup(db, app) {
            continue;
        }
        match restore_app(db, app) {
            Ok(()) => restored.push(app.as_str().to_string()),
            Err(e) => errors.push(format!("{}: {}", app.as_str(), e)),
        }
    }

    if errors.is_empty() {
        Ok(restored)
    } else {
        Err(errors.join("；"))
    }
}

/// 恢复单个应用的原始配置并删除备份
fn restore_app(db: &Arc<Database>, app: AppType) -> Result<(), String> {
    let key = backup_key(app);
    let Some(payload) = db.get_app_config(&key)? else {
        return Ok(());
    };

    let backup: Value =
        serde_json::from_str(&payload).map_err(|e| format!("解析备份失败: {e}"))?;
    let files = backup
        .get("files")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "备份格式错误：缺少 files".to_string())?;

    for (path_str, content) in files {
        let path = PathBuf::from(path_str);
        match content.as_str() {
            Some(original) => {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("创建目录 {} 失败: {}", parent.display(), e))?;
                }
                write_atomic(&path, original)
                    .map_err(|e| format!("恢复 {} 失败: {}", path.display(), e))?;
            }
            None => {
                // 原本不存在的文件：删除接管时创建的副本
                if path.exists() {
                    fs::remove_file(&path)
                        .map_err(|e| format!("删除 {} 失败: {}", path.display(), e))?;
                }
            }
        }
    }

    db.delete_app_config(&key)?;
    tracing::info!("[Takeover] {} Live 配置已恢复", app.as_str());
    Ok(())
}

fn write_atomic(path: &PathBuf, content: &str) -> Result<(), io::Error> {
    let tmp = path.with_extension("ccg-restore.tmp");
    fs::write(&tmp, content)?;
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(_) => {
            // Windows 上 rename 覆盖已存在文件可能失败，回退为直接写入
            let result = fs::write(path, content);
            let _ = fs::remove_file(&tmp);
            result
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_origin_maps_wildcard_hosts() {
        assert_eq!(build_connect_origin("0.0.0.0", 8080), "http://127.0.0.1:8080");
        assert_eq!(build_connect_origin("::", 9000), "http://[::1]:9000");
        assert_eq!(
            build_connect_origin("192.168.1.5", 8080),
            "http://192.168.1.5:8080"
        );
    }

    #[test]
    fn local_proxy_url_detection() {
        assert!(is_local_proxy_url("http://127.0.0.1:8080"));
        assert!(is_local_proxy_url("http://localhost:9876"));
        assert!(is_local_proxy_url("http://[::1]:8080"));
        assert!(!is_local_proxy_url("https://api.anthropic.com"));
        assert!(!is_local_proxy_url("http://api.example.com"));
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ccg-takeover-test-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn claude_proxied_write_replaces_auth_and_strips_model_overrides() {
        let dir = temp_dir("claude-write");
        let path = dir.join("settings.json");
        fs::write(
            &path,
            serde_json::to_string_pretty(&json!({
                "permissions": { "allow": ["Bash"] },
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "sk-real-secret",
                    "ANTHROPIC_BASE_URL": "https://relay.example.com",
                    "ANTHROPIC_DEFAULT_SONNET_MODEL": "old-sonnet",
                    "ANTHROPIC_MODEL": "old-model",
                    "OTHER_VAR": "keep-me"
                }
            }))
            .unwrap(),
        )
        .unwrap();

        write_claude_proxied_at(&path, "http://127.0.0.1:8080").unwrap();

        let settings: Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let env = settings.get("env").unwrap();

        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").unwrap(),
            "http://127.0.0.1:8080"
        );
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").unwrap(),
            PROXY_TOKEN_PLACEHOLDER
        );
        assert!(env.get("ANTHROPIC_DEFAULT_SONNET_MODEL").is_none());
        assert!(env.get("ANTHROPIC_MODEL").is_none());
        assert_eq!(env.get("OTHER_VAR").unwrap(), "keep-me");
        // 非 env 字段原样保留
        assert!(settings.get("permissions").is_some());

        // 回环豁免：防止本机 HTTP_PROXY 环境代理劫持发往 127.0.0.1 的请求
        let no_proxy = env.get("NO_PROXY").unwrap().as_str().unwrap();
        assert!(no_proxy.contains("localhost"), "NO_PROXY={no_proxy}");
        assert!(no_proxy.contains("127.0.0.1"), "NO_PROXY={no_proxy}");
        assert!(no_proxy.contains("::1"), "NO_PROXY={no_proxy}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_proxy_merge_preserves_existing_entries() {
        let merged = merge_no_proxy(&[Some("corp.example.com, 127.0.0.1"), None]);
        let entries: Vec<&str> = merged.split(',').collect();
        assert_eq!(
            entries,
            vec!["corp.example.com", "127.0.0.1", "localhost", "::1"]
        );

        // 空输入 → 仅回环条目
        assert_eq!(merge_no_proxy(&[None]), "localhost,127.0.0.1,::1");
    }

    #[test]
    fn claude_proxied_write_merges_existing_no_proxy() {
        let dir = temp_dir("claude-noproxy");
        let path = dir.join("settings.json");
        fs::write(
            &path,
            serde_json::to_string(&json!({
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "sk-x",
                    "NO_PROXY": "internal.corp"
                }
            }))
            .unwrap(),
        )
        .unwrap();

        write_claude_proxied_at(&path, "http://127.0.0.1:9000").unwrap();

        let settings: Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let no_proxy = settings["env"]["NO_PROXY"].as_str().unwrap();
        assert!(no_proxy.starts_with("internal.corp"), "NO_PROXY={no_proxy}");
        assert!(no_proxy.contains("127.0.0.1"), "NO_PROXY={no_proxy}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_replays_backup_and_deletes_created_files() {
        let dir = temp_dir("restore");
        let file_a = dir.join("settings.json");
        let file_b = dir.join("config.toml");

        // 接管后的现场：A 被改写，B 是接管新建的文件（原本不存在）
        fs::write(&file_a, "proxied-content").unwrap();
        fs::write(&file_b, "junk-created-by-takeover").unwrap();

        let db = Arc::new(Database::in_memory().expect("init db"));
        let backup = json!({
            "files": {
                file_a.to_string_lossy(): "original-content",
                file_b.to_string_lossy(): null,
            }
        });
        db.set_app_config(
            &backup_key(AppType::Claude),
            &serde_json::to_string(&backup).unwrap(),
        )
        .unwrap();

        assert!(is_takeover_active(&db));
        let restored = restore_all(&db).unwrap();
        assert_eq!(restored, vec!["claude".to_string()]);

        assert_eq!(fs::read_to_string(&file_a).unwrap(), "original-content");
        assert!(!file_b.exists(), "接管期间新建的文件应被删除");
        assert!(!is_takeover_active(&db), "恢复后备份应被清除");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_is_idempotent_keeps_first_snapshot() {
        let db = Arc::new(Database::in_memory().expect("init db"));
        let key = backup_key(AppType::Claude);

        db.set_app_config(&key, r#"{"files":{}}"#).unwrap();
        // 已有备份时再次备份不覆盖（防止二次接管把代理配置当成原始配置备份）
        backup_app(&db, AppType::Claude).unwrap();

        assert_eq!(
            db.get_app_config(&key).unwrap().as_deref(),
            Some(r#"{"files":{}}"#)
        );
    }
}
