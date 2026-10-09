//! OpenCode 配置读写：`~/.config/opencode/opencode.json`
//!
//! OpenCode 是累加（additive）模式：多个供应商并存于 `provider` 对象下，
//! 切换只写入 / 更新本应用负责的条目与顶层 `model`，用户手写的其它字段原样保留。
//! 文件解析失败（例如带注释的 JSONC）时报错，绝不覆盖用户文件。

use crate::models::provider::Provider;
use serde_json::{json, Map, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const SCHEMA_URL: &str = "https://opencode.ai/config.json";
const DEFAULT_NPM: &str = "@ai-sdk/openai-compatible";

fn invalid(msg: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg)
}

/// OpenCode 官方在各平台都使用 ~/.config/opencode（Windows 也是 %USERPROFILE%\.config\opencode）
pub fn config_dir() -> io::Result<PathBuf> {
    dirs::home_dir()
        .map(|h| h.join(".config").join("opencode"))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))
}

pub fn config_path() -> io::Result<PathBuf> {
    Ok(config_dir()?.join("opencode.json"))
}

pub fn read_config_at(path: &Path) -> io::Result<Value> {
    if !path.exists() {
        // 只有 opencode.jsonc 时不能另起一份 opencode.json，两份会被 OpenCode 合并，行为难以预期
        if path.with_extension("jsonc").exists() {
            return Err(invalid(format!(
                "检测到 {}，暂不支持写入 JSONC 配置",
                path.with_extension("jsonc").display()
            )));
        }
        return Ok(json!({ "$schema": SCHEMA_URL }));
    }
    let content = fs::read_to_string(path)?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|e| invalid(format!("{} 解析失败（不会覆盖该文件）: {e}", path.display())))?;
    if !value.is_object() {
        return Err(invalid(format!("{} 顶层不是对象", path.display())));
    }
    Ok(value)
}

/// 原子写：先写临时文件再 rename
pub fn write_config_at(path: &Path, value: &Value) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(value).map_err(|e| invalid(e.to_string()))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path)
}

/// 读 → 修改 → 写
pub fn update_at(path: &Path, f: impl FnOnce(&mut Map<String, Value>)) -> io::Result<()> {
    let mut value = read_config_at(path)?;
    if let Some(obj) = value.as_object_mut() {
        f(obj);
    }
    write_config_at(path, &value)
}

/// 取某个对象型子节点（不存在则创建；不是对象则重置为对象）
pub fn child_object<'a>(root: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    let entry = root.entry(key.to_string()).or_insert_with(|| json!({}));
    if !entry.is_object() {
        *entry = json!({});
    }
    entry.as_object_mut().expect("object")
}

// ── 供应商 ──────────────────────────────────────────────

fn non_empty(v: &Option<String>) -> Option<&str> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// 供应商的模型列表：sonnet / opus / haiku / reasoning 去重
fn provider_models(p: &Provider) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    for m in [
        non_empty(&p.default_sonnet_model),
        non_empty(&p.default_opus_model),
        non_empty(&p.default_haiku_model),
        non_empty(&p.default_reasoning_model),
    ]
    .into_iter()
    .flatten()
    {
        if !out.contains(&m) {
            out.push(m);
        }
    }
    out
}

/// 从 settings_config 中取出供应商片段
///
/// 兼容两种形状：完整配置 `{provider: {<id>: {...}}}`，或直接是片段 `{npm, options, models}`。
fn fragment_from_settings(sc: &Value, id: &str) -> Option<Map<String, Value>> {
    let obj = sc.as_object()?;
    if let Some(providers) = obj.get("provider").and_then(Value::as_object) {
        let picked = providers
            .get(id)
            .or_else(|| (providers.len() == 1).then(|| providers.values().next()).flatten())?;
        return picked.as_object().cloned();
    }
    if obj.contains_key("options") || obj.contains_key("npm") || obj.contains_key("models") {
        return Some(obj.clone());
    }
    None
}

/// 生成写入 `provider.<id>` 的片段；Base URL / Key / 名称以 provider 字段为准
pub fn build_provider_fragment(p: &Provider) -> Value {
    let mut frag = p
        .settings_config
        .as_ref()
        .and_then(|sc| fragment_from_settings(sc, &p.id))
        .unwrap_or_default();

    if !frag.contains_key("npm") {
        let npm = p
            .meta
            .as_ref()
            .and_then(|m| m.get("npm"))
            .map(String::as_str)
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(DEFAULT_NPM);
        frag.insert("npm".into(), json!(npm));
    }
    frag.insert("name".into(), json!(p.name));

    let options = child_object(&mut frag, "options");
    if let Some(url) = non_empty(&p.url) {
        options.insert("baseURL".into(), json!(url));
    }
    if !p.api_key.trim().is_empty() {
        options.insert("apiKey".into(), json!(p.api_key.trim()));
    }

    let models = child_object(&mut frag, "models");
    for m in provider_models(p) {
        models.entry(m.to_string()).or_insert_with(|| json!({ "name": m }));
    }

    Value::Object(frag)
}

/// 把供应商写入配置根对象：`provider.<id>`、`model`、`small_model`
pub fn apply_provider(root: &mut Map<String, Value>, p: &Provider) {
    let frag = build_provider_fragment(p);
    let first_model = frag
        .get("models")
        .and_then(Value::as_object)
        .and_then(|m| m.keys().next().cloned());
    child_object(root, "provider").insert(p.id.clone(), frag);

    if let Some(main) = non_empty(&p.default_sonnet_model).map(str::to_string).or(first_model) {
        root.insert("model".into(), json!(format!("{}/{}", p.id, main)));
    }
    match non_empty(&p.default_haiku_model) {
        Some(small) => {
            root.insert("small_model".into(), json!(format!("{}/{}", p.id, small)));
        }
        None => {
            // 上一个供应商留下的 small_model 指向别家，切走后会失效
            let stale = root
                .get("small_model")
                .and_then(Value::as_str)
                .map(|s| !s.starts_with(&format!("{}/", p.id)))
                .unwrap_or(false);
            if stale {
                root.remove("small_model");
            }
        }
    }
}

/// 删除供应商条目；如果 model / small_model 指向它也一并移除
pub fn remove_provider(root: &mut Map<String, Value>, id: &str) {
    if let Some(providers) = root.get_mut("provider").and_then(Value::as_object_mut) {
        providers.remove(id);
    }
    let prefix = format!("{id}/");
    for key in ["model", "small_model"] {
        if root.get(key).and_then(Value::as_str).is_some_and(|m| m.starts_with(&prefix)) {
            root.remove(key);
        }
    }
}

pub fn sync_provider(p: &Provider) -> io::Result<()> {
    update_at(&config_path()?, |root| apply_provider(root, p))
}

pub fn remove_provider_from_config(id: &str) -> io::Result<()> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(());
    }
    update_at(&path, |root| remove_provider(root, id))
}

/// 预览：(标题, 新内容, 基线)
pub fn preview_provider(p: &Provider) -> io::Result<Vec<(String, String, String)>> {
    let path = config_path()?;
    let current = read_config_at(&path)?;
    let baseline = serde_json::to_string_pretty(&current).map_err(|e| invalid(e.to_string()))?;
    let mut next = current;
    if let Some(root) = next.as_object_mut() {
        apply_provider(root, p);
    }
    let content = serde_json::to_string_pretty(&next).map_err(|e| invalid(e.to_string()))?;
    Ok(vec![("~/.config/opencode/opencode.json".to_string(), content, baseline)])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::app_type::AppType;

    fn provider(id: &str) -> Provider {
        Provider {
            id: id.into(),
            name: "Relay".into(),
            app_type: AppType::OpenCode,
            api_key: "sk-1".into(),
            url: Some("https://relay.example.com/v1".into()),
            default_sonnet_model: Some("gpt-5".into()),
            default_opus_model: None,
            default_haiku_model: Some("gpt-5-mini".into()),
            default_reasoning_model: Some("gpt-5".into()),
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

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccg-opencode-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("opencode.json")
    }

    #[test]
    fn apply_keeps_user_fields_and_other_providers() {
        let path = temp_path("keep");
        fs::write(
            &path,
            r#"{"$schema":"https://opencode.ai/config.json","theme":"dark","provider":{"mine":{"npm":"x"}},"autoupdate":false}"#,
        )
        .unwrap();

        update_at(&path, |root| apply_provider(root, &provider("p1"))).unwrap();
        let v = read_config_at(&path).unwrap();

        assert_eq!(v["theme"], "dark");
        assert_eq!(v["autoupdate"], false);
        assert_eq!(v["provider"]["mine"]["npm"], "x");
        let p1 = &v["provider"]["p1"];
        assert_eq!(p1["npm"], DEFAULT_NPM);
        assert_eq!(p1["name"], "Relay");
        assert_eq!(p1["options"]["baseURL"], "https://relay.example.com/v1");
        assert_eq!(p1["options"]["apiKey"], "sk-1");
        assert_eq!(p1["models"].as_object().unwrap().len(), 2, "去重后 gpt-5 / gpt-5-mini");
        assert_eq!(v["model"], "p1/gpt-5");
        assert_eq!(v["small_model"], "p1/gpt-5-mini");

        // key 顺序保持：用户原有字段在前
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(keys[0], "$schema");
        assert_eq!(keys[1], "theme");
    }

    #[test]
    fn invalid_json_is_not_overwritten() {
        let path = temp_path("bad");
        fs::write(&path, "{ // comment\n \"a\": 1 }").unwrap();
        assert!(update_at(&path, |root| apply_provider(root, &provider("p1"))).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ // comment\n \"a\": 1 }");
    }

    #[test]
    fn remove_clears_dangling_model() {
        let mut root = Map::new();
        apply_provider(&mut root, &provider("p1"));
        remove_provider(&mut root, "p1");
        assert!(root["provider"].as_object().unwrap().is_empty());
        assert!(root.get("model").is_none());
        assert!(root.get("small_model").is_none());
    }

    #[test]
    fn settings_config_fragment_is_used_and_overlaid() {
        let mut p = provider("p1");
        p.settings_config = Some(json!({
            "provider": { "p1": { "npm": "@ai-sdk/anthropic", "options": { "timeout": 1000, "apiKey": "old" } } }
        }));
        let frag = build_provider_fragment(&p);
        assert_eq!(frag["npm"], "@ai-sdk/anthropic");
        assert_eq!(frag["options"]["timeout"], 1000);
        assert_eq!(frag["options"]["apiKey"], "sk-1", "Key 以 provider 字段为准");
    }

    #[test]
    fn switching_drops_foreign_small_model() {
        let mut root = Map::new();
        apply_provider(&mut root, &provider("p1"));
        let mut p2 = provider("p2");
        p2.default_haiku_model = None;
        apply_provider(&mut root, &p2);
        assert_eq!(root["model"], "p2/gpt-5");
        assert!(root.get("small_model").is_none());
        assert!(root["provider"].get("p1").is_some(), "累加模式不删除其它供应商");
    }
}
