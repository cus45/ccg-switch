use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::RwLock;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolVersion {
    pub name: String,
    pub version: Option<String>,
    pub latest_version: Option<String>,
    pub error: Option<String>,
}

const VALID_TOOLS: [&str; 4] = ["claude", "codex", "gemini", "opencode"];

/// 预编译的版本号正则
static VERSION_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\d+\.\d+\.\d+(-[\w.]+)?").expect("Invalid version regex"));

/// 缓存：(结果, 缓存时间)
static CACHE: Lazy<Arc<RwLock<Option<(Vec<ToolVersion>, std::time::Instant)>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

/// 缓存有效期：5分钟
const CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(300);

fn extract_version(raw: &str) -> String {
    VERSION_RE
        .find(raw)
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| raw.to_string())
}

// ── 磁盘缓存 ──

fn cache_file_path() -> PathBuf {
    let config_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".ccg-switch");
    let _ = std::fs::create_dir_all(&config_dir);
    config_dir.join("tool_versions_cache.json")
}

fn load_persisted_cache() -> Option<Vec<ToolVersion>> {
    let path = cache_file_path();
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_persisted_cache(data: &[ToolVersion]) {
    if let Ok(json) = serde_json::to_string_pretty(data) {
        let path = cache_file_path();
        let _ = std::fs::write(&path, json);
    }
}

// ── 工具筛选辅助 ──

fn filter_by_tools(all: Vec<ToolVersion>, tools: &Option<Vec<String>>) -> Vec<ToolVersion> {
    if let Some(ref names) = tools {
        let set: std::collections::HashSet<&str> = names.iter().map(|s| s.as_str()).collect();
        all.into_iter()
            .filter(|t| set.contains(t.name.as_str()))
            .collect()
    } else {
        all
    }
}

// ── 后台真实检测（所有工具） ──

async fn do_real_detection_all() -> Vec<ToolVersion> {
    let all_tools: Vec<String> = VALID_TOOLS.iter().map(|s| s.to_string()).collect();
    let futures: Vec<_> = all_tools
        .into_iter()
        .map(|tool| async move { get_single_tool_version(&tool).await })
        .collect();
    futures::future::join_all(futures).await
}

/// 获取多个工具的本地版本和远程最新版本
/// 采用 stale-while-revalidate 模式：优先返回缓存，后台异步刷新并通过事件推送更新
pub async fn get_tool_versions(
    tools: Option<Vec<String>>,
    force: bool,
    app_handle: Option<tauri::AppHandle>,
) -> Vec<ToolVersion> {
    // 1. 非强制刷新时检查内存缓存
    if !force {
        let cache = CACHE.read().await;
        if let Some((ref cached, ref cached_at)) = *cache {
            if cached_at.elapsed() < CACHE_TTL {
                return filter_by_tools(cached.clone(), &tools);
            }
        }
    }

    // 2. 内存缓存 miss — 尝试磁盘缓存（非 force 时）
    if !force {
        if let Some(persisted) = load_persisted_cache() {
            // 立即返回磁盘缓存数据，后台异步刷新
            let app_clone = app_handle.clone();
            tokio::spawn(async move {
                let fresh = do_real_detection_all().await;
                // 更新内存缓存
                let mut cache = CACHE.write().await;
                *cache = Some((fresh.clone(), std::time::Instant::now()));
                // 保存磁盘缓存
                save_persisted_cache(&fresh);
                // 通过 Tauri 事件推送更新
                if let Some(app) = app_clone {
                    let _ = app.emit("tool-versions-updated", &fresh);
                }
            });
            return filter_by_tools(persisted, &tools);
        }
    }

    // 3. 无任何缓存或 force=true — 后台执行真实检测，立即返回空
    let app_clone = app_handle.clone();
    tokio::spawn(async move {
        let fresh = do_real_detection_all().await;
        // 更新内存缓存
        let mut cache = CACHE.write().await;
        *cache = Some((fresh.clone(), std::time::Instant::now()));
        // 保存磁盘缓存
        save_persisted_cache(&fresh);
        // 通过 Tauri 事件推送更新
        if let Some(app) = app_clone {
            let _ = app.emit("tool-versions-updated", &fresh);
        }
    });
    vec![]
}

async fn get_single_tool_version(tool: &str) -> ToolVersion {
    let tool_name = tool.to_string();

    // 1. 用 spawn_blocking 非阻塞获取本地版本
    let tool_for_local = tool_name.clone();
    let (local_version, local_error) = tokio::task::spawn_blocking(move || {
        try_get_version(&tool_for_local)
    })
    .await
    .unwrap_or((None, Some("检测超时".to_string())));

    // 2. 获取远程最新版本
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let latest_version = match tool_name.as_str() {
        "claude" => fetch_npm_latest(&client, "@anthropic-ai/claude-code").await,
        "codex" => fetch_npm_latest(&client, "@openai/codex").await,
        "gemini" => fetch_npm_latest(&client, "@google/gemini-cli").await,
        "opencode" => fetch_github_latest(&client, "anomalyco/opencode").await,
        _ => None,
    };

    ToolVersion {
        name: tool_name,
        version: local_version,
        latest_version,
        error: local_error,
    }
}

fn try_get_version(tool: &str) -> (Option<String>, Option<String>) {
    use std::process::Command;

    #[cfg(target_os = "windows")]
    let output = Command::new("cmd")
        .args(["/C", &format!("{tool} --version")])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("sh")
        .arg("-c")
        .arg(format!("{tool} --version"))
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if out.status.success() {
                let raw = if stdout.is_empty() { &stderr } else { &stdout };
                if raw.is_empty() {
                    (None, Some("未安装".to_string()))
                } else {
                    (Some(extract_version(raw)), None)
                }
            } else {
                (None, Some("未安装".to_string()))
            }
        }
        Err(_) => (None, Some("未安装".to_string())),
    }
}

async fn fetch_npm_latest(client: &reqwest::Client, package: &str) -> Option<String> {
    let url = format!("https://registry.npmjs.org/{package}");
    let resp = client.get(&url).send().await.ok()?;
    let json = resp.json::<serde_json::Value>().await.ok()?;
    json.get("dist-tags")
        .and_then(|tags| tags.get("latest"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

async fn fetch_github_latest(client: &reqwest::Client, repo: &str) -> Option<String> {
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let resp = client
        .get(&url)
        .header("User-Agent", "ccg-switch")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .ok()?;
    let json = resp.json::<serde_json::Value>().await.ok()?;
    json.get("tag_name")
        .and_then(|v| v.as_str())
        .map(|s| s.strip_prefix('v').unwrap_or(s).to_string())
}
