//! Claude Desktop 第三方（3P）配置：让 Desktop 的 Chat / Code 模式走自定义网关
//!
//! 思路对齐 cc-switch（`claude_desktop_config.rs`）：Desktop 的 3P 档读取
//! `Claude-3p/configLibrary` 里 `_meta.json.appliedId` 指向的配置条目。
//! 切换供应商 = 写入本应用自有的固定条目并设为生效；恢复 = 还原接管前的生效条目与部署模式。
//! 只改本应用负责的键，用户自己的条目与其它设置保持不变。任何文件解析失败都整体放弃写入。

use crate::models::provider::Provider;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// 本应用在配置库中的固定条目（不复用 cc-switch 的 ID，避免同机两个工具抢同一条目）
pub const PROFILE_ID: &str = "00000000-0000-4000-8000-00000000cc65";
pub const PROFILE_NAME: &str = "CCG Switch";

const CONFIG_FILE: &str = "claude_desktop_config.json";
const CONFIG_LIBRARY_DIR: &str = "configLibrary";
const META_FILE: &str = "_meta.json";
const BACKUP_FILE: &str = "claude_desktop_backup.json";

/// profile 中由本应用负责、恢复时清除的连接键
const PROFILE_CONNECTION_KEYS: &[&str] = &[
    "inferenceProvider",
    "inferenceGatewayBaseUrl",
    "inferenceGatewayApiKey",
    "inferenceGatewayAuthScheme",
    "inferenceModels",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopPaths {
    pub normal_config: PathBuf,
    pub threep_config: PathBuf,
    pub library_dir: PathBuf,
    pub profile: PathBuf,
    pub meta: PathBuf,
}

impl DesktopPaths {
    fn from_dirs(normal_dir: &Path, threep_dir: &Path) -> Self {
        let library_dir = threep_dir.join(CONFIG_LIBRARY_DIR);
        Self {
            normal_config: normal_dir.join(CONFIG_FILE),
            threep_config: threep_dir.join(CONFIG_FILE),
            profile: library_dir.join(format!("{PROFILE_ID}.json")),
            meta: library_dir.join(META_FILE),
            library_dir,
        }
    }

    /// Desktop 是否装过（任一配置目录存在）
    fn installed(&self) -> bool {
        self.normal_config.parent().is_some_and(Path::exists)
            || self.threep_config.parent().is_some_and(Path::exists)
    }
}

/// 首次接管前 Desktop 的状态，恢复时还原
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Backup {
    normal_deployment_mode: Option<String>,
    threep_deployment_mode: Option<String>,
    applied_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDesktopStatus {
    pub supported: bool,
    pub installed: bool,
    /// 本应用条目当前生效
    pub applied: bool,
    pub config_library_path: Option<String>,
    pub actual_base_url: Option<String>,
    pub has_backup: bool,
}

fn invalid(msg: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg)
}

// ── 路径 ──────────────────────────────────────────────

/// 候选的 (Claude, Claude-3p) 目录对，按优先级排列
fn candidate_dir_pairs() -> Vec<(PathBuf, PathBuf)> {
    let mut bases: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // MSIX（应用商店）安装会把 %APPDATA% 重定向到包目录
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            if let Ok(entries) = fs::read_dir(local.join("Packages")) {
                let mut pkgs: Vec<PathBuf> = entries
                    .filter_map(Result::ok)
                    .map(|e| e.path())
                    .filter(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .is_some_and(|n| n.starts_with("Claude_"))
                    })
                    .collect();
                pkgs.sort();
                bases.extend(pkgs.into_iter().map(|p| p.join("LocalCache").join("Roaming")));
            }
        }
        if let Some(roaming) = std::env::var_os("APPDATA").map(PathBuf::from) {
            bases.push(roaming);
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            bases.push(local);
        }
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = dirs::home_dir() {
        bases.push(home.join("Library").join("Application Support"));
    }

    #[cfg(target_os = "linux")]
    {
        let xdg = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute());
        if let Some(dir) = xdg.or_else(|| dirs::home_dir().map(|h| h.join(".config"))) {
            bases.push(dir);
        }
    }

    bases
        .into_iter()
        .map(|b| (b.join("Claude"), b.join("Claude-3p")))
        .collect()
}

/// 选第一个已存在 3P 目录的候选；没有则选第一个已存在官方目录的；都没有用首个候选
fn pick_paths(pairs: &[(PathBuf, PathBuf)]) -> Option<DesktopPaths> {
    pairs
        .iter()
        .find(|(_, threep)| threep.exists())
        .or_else(|| pairs.iter().find(|(normal, _)| normal.exists()))
        .or_else(|| pairs.first())
        .map(|(normal, threep)| DesktopPaths::from_dirs(normal, threep))
}

pub fn current_paths() -> io::Result<DesktopPaths> {
    pick_paths(&candidate_dir_pairs()).ok_or_else(|| {
        io::Error::new(io::ErrorKind::Unsupported, "当前平台暂不支持 Claude Desktop 3P 配置")
    })
}

fn backup_path() -> io::Result<PathBuf> {
    dirs::home_dir()
        .map(|h| h.join(".ccg-switch").join(BACKUP_FILE))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))
}

// ── JSON 读写 ──────────────────────────────────────────────

fn read_object(path: &Path) -> io::Result<Map<String, Value>> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let content = fs::read_to_string(path)?;
    if content.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str::<Value>(&content) {
        Ok(Value::Object(obj)) => Ok(obj),
        Ok(_) => Err(invalid(format!("{} 顶层不是对象", path.display()))),
        Err(e) => Err(invalid(format!("{} 解析失败（不会覆盖）: {e}", path.display()))),
    }
}

fn write_object(path: &Path, obj: &Map<String, Value>) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content =
        serde_json::to_string_pretty(&Value::Object(obj.clone())).map_err(|e| invalid(e.to_string()))?;
    let tmp = path.with_extension("json.ccg-tmp");
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path)
}

fn str_field(obj: &Map<String, Value>, key: &str) -> Option<String> {
    obj.get(key).and_then(Value::as_str).map(str::to_string)
}

// ── 校验 ──────────────────────────────────────────────

/// Desktop 只接受 claude-(sonnet|opus|haiku|fable)-* 形式的模型名，否则整组拒收（与 cc-switch 一致）
pub fn is_claude_safe_model_id(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    if normalized.contains("[1m]") {
        return false;
    }
    let Some(tail) = normalized
        .strip_prefix("anthropic/claude-")
        .or_else(|| normalized.strip_prefix("claude-"))
    else {
        return false;
    };
    ["sonnet-", "opus-", "haiku-", "fable-"]
        .iter()
        .any(|prefix| tail.strip_prefix(prefix).is_some_and(|rest| !rest.is_empty()))
}

fn non_empty(v: &Option<String>) -> Option<&str> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// 供应商 → (Base URL, Key, 模型列表)
fn gateway_settings(p: &Provider) -> io::Result<(String, String, Vec<String>)> {
    let base_url = non_empty(&p.url)
        .ok_or_else(|| invalid("Claude Desktop 供应商缺少 Base URL".into()))?
        .to_string();
    let api_key = p.api_key.trim();
    if api_key.is_empty() {
        return Err(invalid("Claude Desktop 供应商缺少 API Key".into()));
    }
    let mut models: Vec<String> = Vec::new();
    for m in [
        non_empty(&p.default_sonnet_model),
        non_empty(&p.default_opus_model),
        non_empty(&p.default_haiku_model),
    ]
    .into_iter()
    .flatten()
    {
        if !is_claude_safe_model_id(m) {
            return Err(invalid(format!(
                "Claude Desktop 模型必须使用 claude-sonnet-* / claude-opus-* / claude-haiku-* / claude-fable-* 名称: {m}"
            )));
        }
        if !models.iter().any(|x| x == m) {
            models.push(m.to_string());
        }
    }
    Ok((base_url, api_key.to_string(), models))
}

// ── 写入 / 恢复 ──────────────────────────────────────────────

fn apply_at(paths: &DesktopPaths, backup_file: &Path, p: &Provider) -> io::Result<()> {
    let (base_url, api_key, models) = gateway_settings(p)?;

    // 先全部读出来：任一文件解析失败就整体放弃
    let mut normal = read_object(&paths.normal_config)?;
    let mut threep = read_object(&paths.threep_config)?;
    let mut profile = read_object(&paths.profile)?;
    let mut meta = read_object(&paths.meta)?;
    if meta.get("entries").is_some_and(|e| !e.is_array()) {
        return Err(invalid(format!("{} 的 entries 不是数组", paths.meta.display())));
    }

    // 首次接管：记录接管前的状态（之后重复切换不覆盖备份）
    let applied_id = str_field(&meta, "appliedId");
    if applied_id.as_deref() != Some(PROFILE_ID) && !backup_file.exists() {
        let backup = Backup {
            normal_deployment_mode: str_field(&normal, "deploymentMode"),
            threep_deployment_mode: str_field(&threep, "deploymentMode"),
            applied_id,
        };
        if let Some(parent) = backup_file.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(
            backup_file,
            serde_json::to_string_pretty(&backup).map_err(|e| invalid(e.to_string()))?,
        )?;
    }

    normal.insert("deploymentMode".into(), json!("3p"));
    threep.insert("deploymentMode".into(), json!("3p"));

    profile.insert("inferenceProvider".into(), json!("gateway"));
    profile.insert("inferenceGatewayBaseUrl".into(), json!(base_url));
    profile.insert("inferenceGatewayApiKey".into(), json!(api_key));
    profile.insert("inferenceGatewayAuthScheme".into(), json!("bearer"));
    if models.is_empty() {
        profile.remove("inferenceModels");
    } else {
        profile.insert("inferenceModels".into(), json!(models));
    }
    // 策略键只在缺失时写入，用户在 Desktop 里改过的保持不动
    profile.entry("disableDeploymentModeChooser").or_insert(json!(true));
    profile.entry("coworkEgressAllowedHosts").or_insert(json!(["*"]));

    let entries = meta
        .entry("entries")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .expect("checked above");
    let is_ours = |e: &Value| e.get("id").and_then(Value::as_str) == Some(PROFILE_ID);
    match entries.iter_mut().find(|e| is_ours(e)) {
        Some(Value::Object(e)) => {
            e.insert("name".into(), json!(PROFILE_NAME));
        }
        _ => entries.push(json!({ "id": PROFILE_ID, "name": PROFILE_NAME })),
    }
    meta.insert("appliedId".into(), json!(PROFILE_ID));

    write_object(&paths.profile, &profile)?;
    write_object(&paths.meta, &meta)?;
    write_object(&paths.threep_config, &threep)?;
    write_object(&paths.normal_config, &normal)
}

fn restore_at(paths: &DesktopPaths, backup_file: &Path) -> io::Result<()> {
    let backup: Option<Backup> = fs::read_to_string(backup_file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());

    let mut normal = read_object(&paths.normal_config)?;
    let mut threep = read_object(&paths.threep_config)?;
    let mut meta = read_object(&paths.meta)?;
    let mut profile = if paths.profile.exists() {
        Some(read_object(&paths.profile)?)
    } else {
        None
    };

    // 摘掉自己的条目
    let remaining_first = match meta.get_mut("entries").and_then(Value::as_array_mut) {
        Some(entries) => {
            entries.retain(|e| e.get("id").and_then(Value::as_str) != Some(PROFILE_ID));
            entries
                .iter()
                .find_map(|e| e.get("id").and_then(Value::as_str))
                .map(str::to_string)
        }
        None => None,
    };

    if str_field(&meta, "appliedId").as_deref() == Some(PROFILE_ID) {
        // 优先还原接管前生效的条目（仍存在时），否则退到剩下的第一个
        let previous = backup
            .as_ref()
            .and_then(|b| b.applied_id.clone())
            .filter(|id| id != PROFILE_ID)
            .filter(|id| {
                meta.get("entries")
                    .and_then(Value::as_array)
                    .is_some_and(|es| es.iter().any(|e| e.get("id").and_then(Value::as_str) == Some(id)))
            });
        match previous.or(remaining_first) {
            Some(id) => {
                meta.insert("appliedId".into(), json!(id));
            }
            None => {
                meta.remove("appliedId");
            }
        }
    }

    // 部署模式：有备份按备份还原（原本没有该键则移除）；无备份按 cc-switch 切回官方 1p
    let restore_mode = |obj: &mut Map<String, Value>, saved: Option<&Option<String>>| match saved {
        Some(Some(mode)) => {
            obj.insert("deploymentMode".into(), json!(mode));
        }
        Some(None) => {
            obj.remove("deploymentMode");
        }
        None => {
            obj.insert("deploymentMode".into(), json!("1p"));
        }
    };
    restore_mode(&mut normal, backup.as_ref().map(|b| &b.normal_deployment_mode));
    restore_mode(&mut threep, backup.as_ref().map(|b| &b.threep_deployment_mode));

    // profile 只清连接键（Key 不留在磁盘上），其它用户设置保留；条目已从 _meta 摘掉，Desktop 不会列出它
    if let Some(profile) = profile.as_mut() {
        for key in PROFILE_CONNECTION_KEYS {
            profile.remove(*key);
        }
        write_object(&paths.profile, profile)?;
    }
    write_object(&paths.meta, &meta)?;
    write_object(&paths.threep_config, &threep)?;
    write_object(&paths.normal_config, &normal)?;

    if backup_file.exists() {
        fs::remove_file(backup_file)?;
    }
    Ok(())
}

fn status_at(paths: &DesktopPaths, backup_file: &Path) -> ClaudeDesktopStatus {
    let meta = read_object(&paths.meta).unwrap_or_default();
    let profile = read_object(&paths.profile).unwrap_or_default();
    let applied = str_field(&meta, "appliedId").as_deref() == Some(PROFILE_ID);
    ClaudeDesktopStatus {
        supported: true,
        installed: paths.installed(),
        applied,
        config_library_path: Some(paths.library_dir.to_string_lossy().to_string()),
        actual_base_url: if applied {
            str_field(&profile, "inferenceGatewayBaseUrl")
        } else {
            None
        },
        has_backup: backup_file.exists(),
    }
}

// ── 对外接口 ──────────────────────────────────────────────

pub fn apply_provider(p: &Provider) -> io::Result<()> {
    apply_at(&current_paths()?, &backup_path()?, p)
}

pub fn restore() -> io::Result<()> {
    restore_at(&current_paths()?, &backup_path()?)
}

pub fn get_status() -> ClaudeDesktopStatus {
    match (current_paths(), backup_path()) {
        (Ok(paths), Ok(backup)) => status_at(&paths, &backup),
        _ => ClaudeDesktopStatus {
            supported: false,
            installed: false,
            applied: false,
            config_library_path: None,
            actual_base_url: None,
            has_backup: false,
        },
    }
}

/// 预览：(标题, 新内容, 基线)，只展示 profile 文件（Key 打码）
pub fn preview_provider(p: &Provider) -> io::Result<Vec<(String, String, String)>> {
    let paths = current_paths()?;
    let current = read_object(&paths.profile)?;
    let mask = |mut obj: Map<String, Value>| {
        if obj.contains_key("inferenceGatewayApiKey") {
            obj.insert("inferenceGatewayApiKey".into(), json!("********"));
        }
        serde_json::to_string_pretty(&Value::Object(obj)).unwrap_or_default()
    };
    let baseline = mask(current.clone());
    let mut next = current;
    let (base_url, api_key, models) = gateway_settings(p)?;
    next.insert("inferenceProvider".into(), json!("gateway"));
    next.insert("inferenceGatewayBaseUrl".into(), json!(base_url));
    next.insert("inferenceGatewayApiKey".into(), json!(api_key));
    next.insert("inferenceGatewayAuthScheme".into(), json!("bearer"));
    if models.is_empty() {
        next.remove("inferenceModels");
    } else {
        next.insert("inferenceModels".into(), json!(models));
    }
    next.entry("disableDeploymentModeChooser").or_insert(json!(true));
    next.entry("coworkEgressAllowedHosts").or_insert(json!(["*"]));
    Ok(vec![(
        format!("Claude-3p/configLibrary/{PROFILE_ID}.json"),
        mask(next),
        baseline,
    )])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::app_type::AppType;

    fn provider() -> Provider {
        Provider {
            id: "d1".into(),
            name: "Relay".into(),
            app_type: AppType::ClaudeDesktop,
            api_key: "sk-desk".into(),
            url: Some("https://relay.example.com".into()),
            default_sonnet_model: Some("claude-sonnet-5".into()),
            default_opus_model: None,
            default_haiku_model: Some("claude-haiku-4-5".into()),
            default_reasoning_model: None,
            custom_params: None,
            settings_config: None,
            meta: None,
            icon: None,
            in_failover_queue: false,
            description: None,
            tags: None,
            is_active: true,
            created_at: chrono::Utc::now(),
            last_used: None,
            proxy_config: None,
        }
    }

    fn sandbox(name: &str) -> (PathBuf, DesktopPaths, PathBuf) {
        let root = std::env::temp_dir().join(format!("ccg-desktop-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let paths = DesktopPaths::from_dirs(&root.join("Claude"), &root.join("Claude-3p"));
        let backup = root.join("backup.json");
        (root, paths, backup)
    }

    fn read(path: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    /// 模拟本机实际情况：用户已在 3P 模式使用自己的 Default 条目
    fn seed_user_3p(paths: &DesktopPaths) {
        fs::create_dir_all(&paths.library_dir).unwrap();
        fs::create_dir_all(paths.normal_config.parent().unwrap()).unwrap();
        fs::write(&paths.normal_config, r#"{"preferences":{"x":1}}"#).unwrap();
        fs::write(&paths.threep_config, r#"{"deploymentMode":"3p","preferences":{"sidebarMode":"chat"}}"#).unwrap();
        fs::write(&paths.meta, r#"{"appliedId":"user-1","entries":[{"id":"user-1","name":"Default"}]}"#).unwrap();
        fs::write(paths.library_dir.join("user-1.json"), r#"{"inferenceProvider":"gateway"}"#).unwrap();
    }

    #[test]
    fn claude_safe_model_ids() {
        assert!(is_claude_safe_model_id("claude-sonnet-5"));
        assert!(is_claude_safe_model_id("anthropic/claude-opus-4-8"));
        assert!(is_claude_safe_model_id("claude-fable-5"));
        assert!(!is_claude_safe_model_id("claude-sonnet-"));
        assert!(!is_claude_safe_model_id("gpt-5"));
        assert!(!is_claude_safe_model_id("claude-sonnet-5[1m]"));
    }

    #[test]
    fn apply_writes_profile_and_keeps_user_entries() {
        let (_root, paths, backup) = sandbox("apply");
        seed_user_3p(&paths);

        apply_at(&paths, &backup, &provider()).unwrap();

        let profile = read(&paths.profile);
        assert_eq!(profile["inferenceProvider"], "gateway");
        assert_eq!(profile["inferenceGatewayBaseUrl"], "https://relay.example.com");
        assert_eq!(profile["inferenceGatewayApiKey"], "sk-desk");
        assert_eq!(profile["inferenceGatewayAuthScheme"], "bearer");
        assert_eq!(profile["inferenceModels"], json!(["claude-sonnet-5", "claude-haiku-4-5"]));
        assert_eq!(profile["disableDeploymentModeChooser"], true);

        let meta = read(&paths.meta);
        assert_eq!(meta["appliedId"], PROFILE_ID);
        assert_eq!(meta["entries"].as_array().unwrap().len(), 2, "用户条目保留");
        assert_eq!(read(&paths.normal_config)["deploymentMode"], "3p");
        assert_eq!(read(&paths.normal_config)["preferences"]["x"], 1, "其它键保留");
        assert_eq!(read(&paths.threep_config)["preferences"]["sidebarMode"], "chat");
        assert!(paths.library_dir.join("user-1.json").exists());

        let b: Backup = serde_json::from_str(&fs::read_to_string(&backup).unwrap()).unwrap();
        assert_eq!(b.applied_id.as_deref(), Some("user-1"));
        assert_eq!(b.threep_deployment_mode.as_deref(), Some("3p"));
        assert_eq!(b.normal_deployment_mode, None);
    }

    #[test]
    fn repeated_apply_keeps_first_backup_and_single_entry() {
        let (_root, paths, backup) = sandbox("repeat");
        seed_user_3p(&paths);
        apply_at(&paths, &backup, &provider()).unwrap();
        let mut p2 = provider();
        p2.url = Some("https://other.example.com".into());
        apply_at(&paths, &backup, &p2).unwrap();

        let meta = read(&paths.meta);
        assert_eq!(meta["entries"].as_array().unwrap().len(), 2);
        assert_eq!(read(&paths.profile)["inferenceGatewayBaseUrl"], "https://other.example.com");
        let b: Backup = serde_json::from_str(&fs::read_to_string(&backup).unwrap()).unwrap();
        assert_eq!(b.applied_id.as_deref(), Some("user-1"), "备份是首次接管前的状态");
    }

    #[test]
    fn restore_returns_to_user_setup() {
        let (_root, paths, backup) = sandbox("restore");
        seed_user_3p(&paths);
        apply_at(&paths, &backup, &provider()).unwrap();
        restore_at(&paths, &backup).unwrap();

        let meta = read(&paths.meta);
        assert_eq!(meta["appliedId"], "user-1");
        assert_eq!(meta["entries"], json!([{"id":"user-1","name":"Default"}]));
        assert_eq!(read(&paths.threep_config)["deploymentMode"], "3p");
        assert!(read(&paths.normal_config).get("deploymentMode").is_none(), "原本没有就移除");
        let profile = read(&paths.profile);
        assert!(profile.get("inferenceGatewayApiKey").is_none(), "Key 不留在磁盘上");
        assert_eq!(profile["disableDeploymentModeChooser"], true, "其它设置保留");
        assert!(!backup.exists());
    }

    #[test]
    fn restore_without_backup_falls_back_to_official() {
        let (_root, paths, backup) = sandbox("nobackup");
        apply_at(&paths, &backup, &provider()).unwrap();
        fs::remove_file(&backup).unwrap();
        restore_at(&paths, &backup).unwrap();
        assert_eq!(read(&paths.normal_config)["deploymentMode"], "1p");
        assert!(read(&paths.meta).get("appliedId").is_none());
    }

    #[test]
    fn invalid_json_or_model_aborts_without_writing() {
        let (_root, paths, backup) = sandbox("invalid");
        seed_user_3p(&paths);
        fs::write(&paths.meta, "{ broken").unwrap();
        assert!(apply_at(&paths, &backup, &provider()).is_err());
        assert!(!paths.profile.exists());
        assert_eq!(fs::read_to_string(&paths.meta).unwrap(), "{ broken");

        let (_root2, paths2, backup2) = sandbox("badmodel");
        let mut p = provider();
        p.default_opus_model = Some("gpt-5".into());
        assert!(apply_at(&paths2, &backup2, &p).is_err());
        assert!(!paths2.profile.exists());
    }

    #[test]
    fn pick_paths_prefers_existing_3p_dir() {
        let (root, _, _) = sandbox("pick");
        let a = (root.join("a/Claude"), root.join("a/Claude-3p"));
        let b = (root.join("b/Claude"), root.join("b/Claude-3p"));
        fs::create_dir_all(&b.1).unwrap();
        let picked = pick_paths(&[a.clone(), b.clone()]).unwrap();
        assert_eq!(picked.threep_config, b.1.join(CONFIG_FILE));
        let fallback = pick_paths(&[a.clone()]).unwrap();
        assert_eq!(fallback.threep_config, a.1.join(CONFIG_FILE));
    }
}
