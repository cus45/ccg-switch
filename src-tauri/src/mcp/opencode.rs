//! OpenCode MCP 同步：`~/.config/opencode/opencode.json` 的 `mcp` 节点
//!
//! OpenCode 的 MCP 格式与统一格式不同：
//! - stdio → `{type:"local", command:[cmd, ...args], environment, enabled}`
//! - http / sse → `{type:"remote", url, headers, enabled}`

use crate::services::opencode_config;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// OpenCode 已安装（配置目录存在）才同步，避免为没装的应用凭空建目录
fn should_sync() -> bool {
    opencode_config::config_dir()
        .map(|d| d.exists())
        .unwrap_or(false)
}

/// 统一格式 → OpenCode 格式
pub fn to_opencode(spec: &Value) -> Value {
    let obj = spec.as_object().cloned().unwrap_or_default();
    let transport = obj.get("type").and_then(Value::as_str).unwrap_or_else(|| {
        if obj.contains_key("command") {
            "stdio"
        } else {
            "http"
        }
    });

    let mut out = Map::new();
    if transport == "stdio" {
        let mut command = Vec::new();
        if let Some(cmd) = obj.get("command") {
            command.push(cmd.clone());
        }
        if let Some(args) = obj.get("args").and_then(Value::as_array) {
            command.extend(args.iter().cloned());
        }
        out.insert("type".into(), json!("local"));
        out.insert("command".into(), Value::Array(command));
        if let Some(env) = obj.get("env").filter(|v| v.as_object().is_some_and(|m| !m.is_empty())) {
            out.insert("environment".into(), env.clone());
        }
    } else {
        out.insert("type".into(), json!("remote"));
        if let Some(url) = obj.get("url") {
            out.insert("url".into(), url.clone());
        }
        if let Some(headers) = obj
            .get("headers")
            .filter(|v| v.as_object().is_some_and(|m| !m.is_empty()))
        {
            out.insert("headers".into(), headers.clone());
        }
    }
    out.insert("enabled".into(), json!(true));
    Value::Object(out)
}

/// OpenCode 格式 → 统一格式（导入用）
pub fn from_opencode(spec: &Value) -> Option<Value> {
    let obj = spec.as_object()?;
    match obj.get("type").and_then(Value::as_str) {
        Some("local") => {
            let parts = obj.get("command").and_then(Value::as_array)?;
            let (cmd, args) = parts.split_first()?;
            let mut out = Map::new();
            out.insert("type".into(), json!("stdio"));
            out.insert("command".into(), cmd.clone());
            if !args.is_empty() {
                out.insert("args".into(), Value::Array(args.to_vec()));
            }
            if let Some(env) = obj.get("environment") {
                out.insert("env".into(), env.clone());
            }
            Some(Value::Object(out))
        }
        Some("remote") => {
            let mut out = Map::new();
            out.insert("type".into(), json!("http"));
            out.insert("url".into(), obj.get("url")?.clone());
            if let Some(headers) = obj.get("headers") {
                out.insert("headers".into(), headers.clone());
            }
            Some(Value::Object(out))
        }
        _ => None,
    }
}

pub fn sync_server_to_opencode(id: &str, server_spec: &Value) -> Result<(), String> {
    if !should_sync() {
        return Ok(());
    }
    let path = opencode_config::config_path().map_err(|e| e.to_string())?;
    opencode_config::update_at(&path, |root| {
        opencode_config::child_object(root, "mcp").insert(id.to_string(), to_opencode(server_spec));
    })
    .map_err(|e| e.to_string())
}

pub fn remove_server_from_opencode(id: &str) -> Result<(), String> {
    if !should_sync() {
        return Ok(());
    }
    let path = opencode_config::config_path().map_err(|e| e.to_string())?;
    if !path.exists() {
        return Ok(());
    }
    opencode_config::update_at(&path, |root| {
        if let Some(mcp) = root.get_mut("mcp").and_then(Value::as_object_mut) {
            mcp.remove(id);
        }
    })
    .map_err(|e| e.to_string())
}

/// 读取 OpenCode 现有 MCP（已转成统一格式），供导入使用
pub fn read_opencode_mcp_servers() -> HashMap<String, Value> {
    let Ok(path) = opencode_config::config_path() else {
        return HashMap::new();
    };
    let Ok(config) = opencode_config::read_config_at(&path) else {
        return HashMap::new();
    };
    config
        .get("mcp")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| from_opencode(v).map(|s| (k.clone(), s)))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stdio_roundtrip() {
        let spec = json!({"type":"stdio","command":"npx","args":["-y","@x/mcp"],"env":{"K":"V"}});
        let oc = to_opencode(&spec);
        assert_eq!(oc, json!({"type":"local","command":["npx","-y","@x/mcp"],"environment":{"K":"V"},"enabled":true}));
        assert_eq!(from_opencode(&oc).unwrap(), spec);
    }

    #[test]
    fn remote_conversion() {
        let spec = json!({"type":"sse","url":"https://m.example.com/sse","headers":{}});
        assert_eq!(
            to_opencode(&spec),
            json!({"type":"remote","url":"https://m.example.com/sse","enabled":true}),
            "空 headers 不写入"
        );
        let back = from_opencode(&json!({"type":"remote","url":"https://m","headers":{"A":"b"}})).unwrap();
        assert_eq!(back, json!({"type":"http","url":"https://m","headers":{"A":"b"}}));
    }

    #[test]
    fn missing_type_is_inferred() {
        assert_eq!(to_opencode(&json!({"command":"node"}))["type"], "local");
        assert!(from_opencode(&json!({"command":["x"]})).is_none(), "OpenCode 侧无 type 不导入");
    }
}
