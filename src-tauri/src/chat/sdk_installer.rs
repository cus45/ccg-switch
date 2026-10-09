//! On-demand SDK installer (Rust port of jetbrains-cc-gui's DependencyManager).
//!
//! The Claude/Codex SDKs are not bundled. They are installed on demand into the
//! deps directory using the system `npm`, into a layout sdk-loader.js expects:
//!   `<deps>/<sdkId>/node_modules/<npmPackage>`
//!
//! Install strategy (mirrors DependencyManager.installSdkSync):
//!   1. ensure `<deps>/<sdkId>/` exists with a minimal package.json
//!   2. run `npm install --include=optional --prefix <sdkDir> <pkg@ver> [deps...]`
//!   3. stream npm output back to the caller via a log callback

use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::resources;

const MAX_AVAILABLE_VERSIONS: usize = 20;
const REGISTRY_TIMEOUT_SECS: u64 = 5;
const SDK_UNINSTALL_RETRY_COUNT: usize = 5;
const SDK_UNINSTALL_RETRY_DELAY_MS: u64 = 200;

/// A known installable SDK.
#[derive(Debug, Clone, Copy)]
pub struct SdkDefinition {
    /// Directory id under the deps dir, e.g. "claude-sdk".
    pub id: &'static str,
    /// Human-readable name.
    pub display_name: &'static str,
    /// Primary npm package.
    pub npm_package: &'static str,
    /// Version range/spec to install.
    pub version: &'static str,
    /// Extra packages installed alongside the primary one.
    pub dependencies: &'static [&'static str],
}

pub const CLAUDE_SDK: SdkDefinition = SdkDefinition {
    id: "claude-sdk",
    display_name: "Claude Code SDK",
    npm_package: "@anthropic-ai/claude-agent-sdk",
    version: "^0.2.58",
    dependencies: &["@anthropic-ai/sdk", "@anthropic-ai/bedrock-sdk"],
};

pub const CODEX_SDK: SdkDefinition = SdkDefinition {
    id: "codex-sdk",
    display_name: "Codex SDK",
    npm_package: "@openai/codex-sdk",
    version: "latest",
    dependencies: &[],
};

/// Resolve an SDK definition by id.
pub fn sdk_by_id(id: &str) -> Option<SdkDefinition> {
    match id {
        "claude-sdk" => Some(CLAUDE_SDK),
        "codex-sdk" => Some(CODEX_SDK),
        _ => None,
    }
}

/// Installation status of one SDK.
#[derive(Debug, Clone, Serialize)]
pub struct SdkStatus {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub installed: bool,
    pub path: String,
    #[serde(rename = "currentVersion")]
    pub current_version: Option<String>,
    #[serde(rename = "defaultVersion")]
    pub default_version: String,
    #[serde(rename = "latestVersion")]
    pub latest_version: Option<String>,
    #[serde(rename = "availableVersions")]
    pub available_versions: Vec<String>,
}

impl SdkDefinition {
    /// The package install dir: `<deps>/<id>/node_modules/<scope>/<name>`.
    fn package_dir(&self, deps_dir: &Path) -> PathBuf {
        let mut p = resources::sdk_dir(deps_dir, self.id).join("node_modules");
        for part in self.npm_package.split('/') {
            p = p.join(part);
        }
        p
    }

    /// Whether this SDK is currently installed.
    pub fn is_installed(&self, deps_dir: &Path) -> bool {
        self.package_dir(deps_dir).exists()
    }

    /// The full npm package spec, e.g. "@anthropic-ai/claude-agent-sdk@^0.2.58".
    fn package_spec(&self, explicit_version: Option<&str>) -> Result<String, String> {
        let version = match explicit_version {
            Some(version) => {
                validate_explicit_version(version)?;
                version
            }
            None => self.version,
        };
        Ok(format!("{}@{}", self.npm_package, version))
    }

    async fn status(&self, deps_dir: &Path) -> SdkStatus {
        let registry = fetch_registry_versions(*self).await.ok();
        self.status_from_registry(deps_dir, registry)
    }

    fn status_from_registry(
        &self,
        deps_dir: &Path,
        registry: Option<RegistryVersionInfo>,
    ) -> SdkStatus {
        let current_version = installed_package_version(deps_dir, *self);
        let latest_version = registry
            .as_ref()
            .and_then(|info| info.latest_version.clone());
        let available_versions = merge_available_versions(
            registry
                .map(|info| info.available_versions)
                .unwrap_or_default(),
            current_version.as_deref(),
            self.version,
        );

        SdkStatus {
            id: self.id.to_string(),
            display_name: self.display_name.to_string(),
            installed: self.is_installed(deps_dir),
            path: self.package_dir(deps_dir).to_string_lossy().to_string(),
            current_version,
            default_version: self.version.to_string(),
            latest_version,
            available_versions,
        }
    }
}

/// Status of all known SDKs.
pub async fn all_status(deps_dir: &Path) -> Vec<SdkStatus> {
    let (claude, codex) = tokio::join!(CLAUDE_SDK.status(deps_dir), CODEX_SDK.status(deps_dir));
    vec![claude, codex]
}

/// Build the npm install command, handling the Windows `.cmd` shell routing.
fn build_npm_command(
    npm: &Path,
    sdk_dir: &Path,
    sdk: SdkDefinition,
    package_spec: &str,
) -> Command {
    // Common npm args, in order.
    #[cfg(windows)]
    {
        // Route through cmd.exe so npm.cmd (a batch file) can be executed.
        let mut cmd = Command::new("cmd");
        cmd.arg("/C")
            .arg(npm)
            .arg("install")
            .arg("--include=optional")
            .arg("--prefix")
            .arg(sdk_dir)
            .arg(package_spec);
        for dep in sdk.dependencies {
            cmd.arg(dep);
        }
        cmd
    }

    #[cfg(not(windows))]
    {
        let mut cmd = Command::new(npm);
        cmd.arg("install")
            .arg("--include=optional")
            .arg("--prefix")
            .arg(sdk_dir)
            .arg(package_spec);
        for dep in sdk.dependencies {
            cmd.arg(dep);
        }
        cmd
    }
}

/// Install an SDK. Streams npm output line-by-line through `on_log`.
///
/// `node_path` is used to locate npm. The install is written under
/// `<deps_dir>/<sdkId>/`.
pub async fn install_sdk<F>(
    sdk: SdkDefinition,
    node_path: &Path,
    deps_dir: &Path,
    version: Option<&str>,
    on_log: F,
) -> Result<(), String>
where
    F: Fn(String) + Send + Sync,
{
    let package_spec = sdk.package_spec(version)?;
    on_log(format!(
        "开始安装 {} ({})...",
        sdk.display_name, package_spec
    ));

    let npm = resources::detect_npm(node_path)?;
    on_log(format!("使用 npm: {}", npm.display()));

    // Create SDK dir with a minimal package.json (npm --prefix needs a target).
    let sdk_dir = resources::sdk_dir(deps_dir, sdk.id);

    // Path-safety: ensure sdk_dir stays within deps_dir (prevent traversal).
    let norm_sdk = sdk_dir.canonicalize().unwrap_or_else(|_| sdk_dir.clone());
    let norm_deps = deps_dir
        .canonicalize()
        .unwrap_or_else(|_| deps_dir.to_path_buf());
    // Compare before creation: sdk_dir may not exist yet, so check the lexical prefix.
    if !sdk_dir.starts_with(deps_dir) && !norm_sdk.starts_with(&norm_deps) {
        return Err("安全错误：SDK 目录超出依赖目录范围".to_string());
    }

    std::fs::create_dir_all(&sdk_dir)
        .map_err(|e| format!("创建目录失败 {}: {e}", sdk_dir.display()))?;

    let package_json = sdk_dir.join("package.json");
    std::fs::write(
        &package_json,
        format!(
            "{{\n  \"name\": \"{}-container\",\n  \"version\": \"1.0.0\",\n  \"private\": true\n}}\n",
            sdk.id
        ),
    )
    .map_err(|e| format!("写入 package.json 失败: {e}"))?;
    on_log("已创建 package.json".to_string());

    // Build: npm install --include=optional --prefix <sdkDir> <pkg> [deps...]
    //
    // On Windows `npm` is `npm.cmd`, a batch file. CreateProcessW cannot execute
    // .cmd directly, so route it through `cmd.exe /C`. On Unix, invoke npm
    // directly.
    let mut cmd = build_npm_command(&npm, &sdk_dir, sdk, &package_spec);
    let path_env = resources::node_execution_path_env(
        node_path,
        Some(&npm),
        std::env::var_os("PATH").as_deref(),
    );
    cmd.current_dir(&sdk_dir)
        .env("PATH", path_env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW avoids a console flash for the spawned cmd.exe.
        cmd.creation_flags(0x0800_0000);
    }

    on_log("正在执行 npm install...".to_string());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 npm 失败: {e}. 请确认已安装 Node.js / npm"))?;

    // Stream stdout + stderr.
    if let Some(stdout) = child.stdout.take() {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            on_log(line);
        }
    }
    if let Some(stderr) = child.stderr.take() {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            on_log(line);
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("等待 npm 进程失败: {e}"))?;

    if !status.success() {
        return Err(format!(
            "npm install 失败（退出码 {}）",
            status.code().unwrap_or(-1)
        ));
    }

    if !sdk.is_installed(deps_dir) {
        return Err("安装完成但未找到 SDK 包，请检查日志".to_string());
    }

    on_log(format!("{} 安装完成 ✓", sdk.display_name));
    Ok(())
}

/// Uninstall an SDK by removing its install directory.
pub fn uninstall_sdk(sdk: SdkDefinition, deps_dir: &Path) -> Result<(), String> {
    let dir = resources::sdk_dir(deps_dir, sdk.id);
    if dir.exists() {
        remove_sdk_dir_with_retries(&dir)?;
    }
    Ok(())
}

fn remove_sdk_dir_with_retries(dir: &Path) -> Result<(), String> {
    let mut last_error = None;
    for attempt in 0..=SDK_UNINSTALL_RETRY_COUNT {
        let _ = clear_readonly_attributes(dir);
        match std::fs::remove_dir_all(dir) {
            Ok(()) => return Ok(()),
            Err(_) if !dir.exists() => return Ok(()),
            Err(error) => {
                last_error = Some(error);
                if attempt < SDK_UNINSTALL_RETRY_COUNT {
                    std::thread::sleep(Duration::from_millis(SDK_UNINSTALL_RETRY_DELAY_MS));
                }
            }
        }
    }

    let reason = last_error
        .map(|error| error.to_string())
        .unwrap_or_else(|| "unknown error".to_string());
    Err(format!(
        "删除 {} 失败: {reason}。请确认没有终端、杀毒软件或 ai-bridge/node 进程正在占用该 SDK 目录，然后重试。",
        dir.display()
    ))
}

/// 删除 SDK 目录前清掉只读属性（Windows 上只读文件无法删除）。
/// 紧接着整个目录就会被删除，Unix 上短暂放宽权限无影响。
#[allow(clippy::permissions_set_readonly_false)]
fn clear_readonly_attributes(path: &Path) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }

    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.is_dir() {
        for entry in std::fs::read_dir(path)? {
            clear_readonly_attributes(&entry?.path())?;
        }
    }

    let mut permissions = metadata.permissions();
    if permissions.readonly() {
        permissions.set_readonly(false);
        std::fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RegistryVersionInfo {
    latest_version: Option<String>,
    available_versions: Vec<String>,
}

fn installed_package_version(deps_dir: &Path, sdk: SdkDefinition) -> Option<String> {
    let package_json = sdk.package_dir(deps_dir).join("package.json");
    let content = std::fs::read_to_string(package_json).ok()?;
    let value: Value = serde_json::from_str(&content).ok()?;
    value
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(ToOwned::to_owned)
}

fn validate_explicit_version(version: &str) -> Result<(), String> {
    if is_safe_explicit_version(version) {
        Ok(())
    } else {
        Err(format!("无效 SDK 版本: {version}"))
    }
}

fn is_safe_explicit_version(version: &str) -> bool {
    if version.is_empty() || version.trim() != version {
        return false;
    }

    let mut part_count = 0;
    for part in version.split('.') {
        part_count += 1;
        if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return false;
        }
    }

    part_count == 3
}

fn parse_registry_versions(metadata: &str) -> Result<RegistryVersionInfo, String> {
    let value: Value =
        serde_json::from_str(metadata).map_err(|e| format!("解析 npm registry 元数据失败: {e}"))?;
    let latest_version = value
        .get("dist-tags")
        .and_then(|tags| tags.get("latest"))
        .and_then(Value::as_str)
        .filter(|version| is_safe_explicit_version(version))
        .map(ToOwned::to_owned);

    let mut available_versions: Vec<String> = value
        .get("versions")
        .and_then(Value::as_object)
        .map(|versions| {
            versions
                .keys()
                .filter(|version| is_safe_explicit_version(version))
                .cloned()
                .collect()
        })
        .unwrap_or_default();

    if let Some(latest) = latest_version.as_deref() {
        push_unique_version(&mut available_versions, latest);
    }
    let available_versions = normalize_versions(available_versions, None);

    Ok(RegistryVersionInfo {
        latest_version,
        available_versions,
    })
}

async fn fetch_registry_versions(sdk: SdkDefinition) -> Result<RegistryVersionInfo, String> {
    let encoded_package =
        url::form_urlencoded::byte_serialize(sdk.npm_package.as_bytes()).collect::<String>();
    let registry_url = format!("https://registry.npmjs.org/{encoded_package}");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REGISTRY_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("创建 npm registry 客户端失败: {e}"))?;
    let response = client
        .get(registry_url)
        .send()
        .await
        .map_err(|e| format!("查询 npm registry 失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("查询 npm registry 返回失败状态: {e}"))?;
    let metadata = response
        .text()
        .await
        .map_err(|e| format!("读取 npm registry 响应失败: {e}"))?;
    parse_registry_versions(&metadata)
}

fn merge_available_versions(
    mut versions: Vec<String>,
    current_version: Option<&str>,
    default_version: &str,
) -> Vec<String> {
    if let Some(current) = current_version {
        if is_safe_explicit_version(current) {
            push_unique_version(&mut versions, current);
        }
    }
    if is_safe_explicit_version(default_version) {
        push_unique_version(&mut versions, default_version);
    }

    normalize_versions(versions, current_version)
}

fn push_unique_version(versions: &mut Vec<String>, version: &str) {
    if !versions.iter().any(|candidate| candidate == version) {
        versions.push(version.to_string());
    }
}

fn normalize_versions(mut versions: Vec<String>, must_include: Option<&str>) -> Vec<String> {
    versions.retain(|version| is_safe_explicit_version(version));
    versions.sort_by(compare_versions_desc);
    versions.dedup();

    if versions.len() <= MAX_AVAILABLE_VERSIONS {
        return versions;
    }

    let must_include = must_include.filter(|version| is_safe_explicit_version(version));
    let mut limited: Vec<String> = versions
        .iter()
        .take(MAX_AVAILABLE_VERSIONS)
        .cloned()
        .collect();
    if let Some(required) = must_include {
        if !limited.iter().any(|version| version == required)
            && versions.iter().any(|version| version == required)
        {
            limited.pop();
            limited.push(required.to_string());
            limited.sort_by(compare_versions_desc);
            limited.dedup();
        }
    }
    limited
}

fn compare_versions_desc(a: &String, b: &String) -> Ordering {
    parse_version_numbers(b)
        .cmp(&parse_version_numbers(a))
        .then_with(|| b.cmp(a))
}

fn parse_version_numbers(version: &str) -> [u64; 3] {
    let mut values = [0_u64; 3];
    for (index, part) in version.split('.').take(3).enumerate() {
        values[index] = part.parse::<u64>().unwrap_or(0);
    }
    values
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("ccg-switch-{name}-{nanos}"))
    }

    #[test]
    fn reads_installed_package_version_from_primary_package_json() {
        let deps_dir = unique_test_dir("sdk-version");
        let package_dir = CLAUDE_SDK.package_dir(&deps_dir);
        std::fs::create_dir_all(&package_dir).expect("create package dir");
        std::fs::write(
            package_dir.join("package.json"),
            r#"{"name":"@anthropic-ai/claude-agent-sdk","version":"0.2.71"}"#,
        )
        .expect("write package json");

        let version = installed_package_version(&deps_dir, CLAUDE_SDK);

        assert_eq!(version.as_deref(), Some("0.2.71"));
        let _ = std::fs::remove_dir_all(deps_dir);
    }

    #[test]
    fn parses_registry_versions_as_latest_and_recent_stable_versions() {
        let metadata = r#"{
            "dist-tags": { "latest": "1.4.0" },
            "versions": {
                "1.0.0": {},
                "1.3.0-beta.1": {},
                "1.2.0": {},
                "1.4.0": {},
                "0.9.9": {}
            }
        }"#;

        let info = parse_registry_versions(metadata).expect("parse registry metadata");

        assert_eq!(info.latest_version.as_deref(), Some("1.4.0"));
        assert_eq!(
            info.available_versions,
            vec!["1.4.0", "1.2.0", "1.0.0", "0.9.9"]
        );
    }

    #[test]
    fn rejects_unsafe_explicit_versions() {
        for version in [
            "latest",
            "^1.2.3",
            "~1.2.3",
            ">=1.2.3",
            "file:../sdk",
            "git+https://example.com/repo",
            "1.2.3 && calc",
            "1.2",
            "1.2.3-beta.1",
        ] {
            assert!(
                validate_explicit_version(version).is_err(),
                "expected {version} to be rejected",
            );
        }

        assert!(validate_explicit_version("1.2.3").is_ok());
    }

    #[test]
    fn builds_explicit_package_spec_for_selected_version() {
        assert_eq!(
            CLAUDE_SDK.package_spec(Some("0.2.71")).expect("valid spec"),
            "@anthropic-ai/claude-agent-sdk@0.2.71",
        );
    }

    #[test]
    fn status_falls_back_to_local_versions_when_registry_is_missing() {
        let deps_dir = unique_test_dir("sdk-status");
        let package_dir = CLAUDE_SDK.package_dir(&deps_dir);
        std::fs::create_dir_all(&package_dir).expect("create package dir");
        std::fs::write(
            package_dir.join("package.json"),
            r#"{"name":"@anthropic-ai/claude-agent-sdk","version":"0.2.71"}"#,
        )
        .expect("write package json");

        let status = CLAUDE_SDK.status_from_registry(&deps_dir, None);

        assert!(status.installed);
        assert_eq!(status.current_version.as_deref(), Some("0.2.71"));
        assert_eq!(status.default_version, "^0.2.58");
        assert_eq!(status.latest_version, None);
        assert_eq!(status.available_versions, vec!["0.2.71"]);
        let _ = std::fs::remove_dir_all(deps_dir);
    }

    #[test]
    fn uninstall_removes_sdk_directory_with_readonly_files() {
        let deps_dir = unique_test_dir("sdk-uninstall-readonly");
        let package_dir = CLAUDE_SDK.package_dir(&deps_dir);
        std::fs::create_dir_all(&package_dir).expect("create package dir");
        let readonly_file = package_dir.join("readonly.js");
        std::fs::write(&readonly_file, "module.exports = {};").expect("write readonly file");
        let mut permissions = std::fs::metadata(&readonly_file)
            .expect("read readonly file metadata")
            .permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&readonly_file, permissions).expect("mark file readonly");

        uninstall_sdk(CLAUDE_SDK, &deps_dir).expect("uninstall should clear readonly files");

        assert!(!resources::sdk_dir(&deps_dir, CLAUDE_SDK.id).exists());
        let _ = std::fs::remove_dir_all(deps_dir);
    }
}
