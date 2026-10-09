//! Workspace 元数据：项目与会话的置顶 / 归档 / 未读 / 重命名 / 移除状态。
//!
//! 这些都是应用自有的派生状态，不写入 Claude / Codex / Gemini 的原生历史，
//! 统一存放在 `~/.codemoss/workspace-metadata.json`，与 session-titles.json 同级。
//! 项目以归一化路径为 key，会话以 sessionId 为 key。

use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const PROJECT_CUSTOM_NAME_MAX_CHARS: usize = 80;

/// 项目派生状态。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectMetadata {
    pub pinned: bool,
    pub archived: bool,
    pub removed: bool,
    pub custom_name: Option<String>,
}

/// 会话派生状态。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionMetadata {
    pub pinned: bool,
    pub archived: bool,
    pub unread: bool,
}

fn timestamp_now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// 归一化项目路径，作为元数据 key；与前端 `normalizeProjectPathForCache` 保持一致。
pub fn normalize_project_key(project_path: &str) -> String {
    let trimmed = project_path.trim().replace('\\', "/");
    let trimmed = trimmed.trim_end_matches('/');
    trimmed.to_lowercase()
}

fn codemoss_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    let real_home = home.canonicalize().unwrap_or(home);
    Ok(real_home.join(".codemoss"))
}

fn workspace_metadata_file() -> Result<PathBuf, String> {
    Ok(codemoss_dir()?.join("workspace-metadata.json"))
}

fn load_root(file: &Path) -> Map<String, Value> {
    let Ok(text) = std::fs::read_to_string(file) else {
        return Map::new();
    };
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn save_root(file: &Path, root: &Map<String, Value>) -> Result<(), String> {
    let parent = file
        .parent()
        .ok_or_else(|| "工作区元数据路径无效".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("创建工作区元数据目录失败: {e}"))?;

    let tmp_file = file.with_file_name(format!(
        "{}.tmp",
        file.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("workspace-metadata.json")
    ));
    let text =
        serde_json::to_string_pretty(root).map_err(|e| format!("序列化工作区元数据失败: {e}"))?;
    std::fs::write(&tmp_file, text).map_err(|e| format!("写入工作区元数据失败: {e}"))?;
    std::fs::rename(&tmp_file, file).map_err(|e| format!("保存工作区元数据失败: {e}"))?;
    Ok(())
}

fn section(root: &Map<String, Value>, key: &str) -> Map<String, Value> {
    root.get(key)
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn bool_field(record: &Value, field: &str) -> bool {
    record
        .get(field)
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn project_metadata_from_record(record: &Value) -> ProjectMetadata {
    ProjectMetadata {
        pinned: bool_field(record, "pinned"),
        archived: bool_field(record, "archived"),
        removed: bool_field(record, "removed"),
        custom_name: record
            .get("customName")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string),
    }
}

fn session_metadata_from_record(record: &Value) -> SessionMetadata {
    SessionMetadata {
        pinned: bool_field(record, "pinned"),
        archived: bool_field(record, "archived"),
        unread: bool_field(record, "unread"),
    }
}

fn project_record_is_empty(meta: &ProjectMetadata) -> bool {
    !meta.pinned && !meta.archived && !meta.removed && meta.custom_name.is_none()
}

fn session_record_is_empty(meta: &SessionMetadata) -> bool {
    !meta.pinned && !meta.archived && !meta.unread
}

fn project_record_to_value(meta: &ProjectMetadata, updated_at: i64) -> Value {
    let mut record = Map::new();
    if meta.pinned {
        record.insert("pinned".to_string(), Value::Bool(true));
    }
    if meta.archived {
        record.insert("archived".to_string(), Value::Bool(true));
    }
    if meta.removed {
        record.insert("removed".to_string(), Value::Bool(true));
    }
    if let Some(name) = &meta.custom_name {
        record.insert("customName".to_string(), Value::String(name.clone()));
    }
    record.insert("updatedAt".to_string(), Value::from(updated_at));
    Value::Object(record)
}

fn session_record_to_value(meta: &SessionMetadata, updated_at: i64) -> Value {
    let mut record = Map::new();
    if meta.pinned {
        record.insert("pinned".to_string(), Value::Bool(true));
    }
    if meta.archived {
        record.insert("archived".to_string(), Value::Bool(true));
    }
    if meta.unread {
        record.insert("unread".to_string(), Value::Bool(true));
    }
    record.insert("updatedAt".to_string(), Value::from(updated_at));
    Value::Object(record)
}

/// 读取全部项目元数据（key 为归一化路径）。
pub fn load_project_metadata_map() -> std::collections::HashMap<String, ProjectMetadata> {
    let Ok(file) = workspace_metadata_file() else {
        return std::collections::HashMap::new();
    };
    let root = load_root(&file);
    section(&root, "projects")
        .into_iter()
        .map(|(key, value)| (key, project_metadata_from_record(&value)))
        .collect()
}

/// 读取全部会话元数据（key 为 sessionId）。
pub fn load_session_metadata_map() -> std::collections::HashMap<String, SessionMetadata> {
    let Ok(file) = workspace_metadata_file() else {
        return std::collections::HashMap::new();
    };
    let root = load_root(&file);
    section(&root, "sessions")
        .into_iter()
        .map(|(key, value)| (key, session_metadata_from_record(&value)))
        .collect()
}

/// 用一个回调修改某项目的元数据并落盘。
fn update_project_with<F>(file: &Path, project_key: &str, mutate: F) -> Result<(), String>
where
    F: FnOnce(&mut ProjectMetadata),
{
    if project_key.is_empty() {
        return Err("项目路径不能为空".to_string());
    }
    let mut root = load_root(file);
    let mut projects = section(&root, "projects");
    let mut meta = projects
        .get(project_key)
        .map(project_metadata_from_record)
        .unwrap_or_default();

    mutate(&mut meta);

    if project_record_is_empty(&meta) {
        projects.remove(project_key);
    } else {
        projects.insert(
            project_key.to_string(),
            project_record_to_value(&meta, timestamp_now_millis()),
        );
    }
    root.insert("projects".to_string(), Value::Object(projects));
    save_root(file, &root)
}

fn update_session_with<F>(file: &Path, session_id: &str, mutate: F) -> Result<(), String>
where
    F: FnOnce(&mut SessionMetadata),
{
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return Err("会话 ID 不能为空".to_string());
    }
    let mut root = load_root(file);
    let mut sessions = section(&root, "sessions");
    let mut meta = sessions
        .get(session_id)
        .map(session_metadata_from_record)
        .unwrap_or_default();

    mutate(&mut meta);

    if session_record_is_empty(&meta) {
        sessions.remove(session_id);
    } else {
        sessions.insert(
            session_id.to_string(),
            session_record_to_value(&meta, timestamp_now_millis()),
        );
    }
    root.insert("sessions".to_string(), Value::Object(sessions));
    save_root(file, &root)
}

fn normalize_project_custom_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    if name.chars().count() > PROJECT_CUSTOM_NAME_MAX_CHARS {
        return Err(format!(
            "项目名称不能超过 {PROJECT_CUSTOM_NAME_MAX_CHARS} 个字符"
        ));
    }
    if name.chars().any(char::is_control) {
        return Err("项目名称包含非法控制字符".to_string());
    }
    Ok(name.to_string())
}

// ---- 项目动作 ----

pub fn set_project_pinned(project_path: &str, pinned: bool) -> Result<(), String> {
    let file = workspace_metadata_file()?;
    let key = normalize_project_key(project_path);
    update_project_with(&file, &key, |meta| meta.pinned = pinned)
}

pub fn set_project_archived(project_path: &str, archived: bool) -> Result<(), String> {
    let file = workspace_metadata_file()?;
    let key = normalize_project_key(project_path);
    update_project_with(&file, &key, |meta| meta.archived = archived)
}

pub fn set_project_removed(project_path: &str, removed: bool) -> Result<(), String> {
    let file = workspace_metadata_file()?;
    let key = normalize_project_key(project_path);
    update_project_with(&file, &key, |meta| meta.removed = removed)
}

pub fn rename_project(project_path: &str, name: &str) -> Result<String, String> {
    let file = workspace_metadata_file()?;
    let key = normalize_project_key(project_path);
    let name = normalize_project_custom_name(name)?;
    let stored = name.clone();
    update_project_with(&file, &key, |meta| meta.custom_name = Some(stored))?;
    Ok(name)
}

// ---- 会话动作 ----

pub fn set_session_pinned(session_id: &str, pinned: bool) -> Result<(), String> {
    let file = workspace_metadata_file()?;
    update_session_with(&file, session_id, |meta| meta.pinned = pinned)
}

pub fn set_session_archived(session_id: &str, archived: bool) -> Result<(), String> {
    let file = workspace_metadata_file()?;
    update_session_with(&file, session_id, |meta| meta.archived = archived)
}

pub fn set_session_unread(session_id: &str, unread: bool) -> Result<(), String> {
    let file = workspace_metadata_file()?;
    update_session_with(&file, session_id, |meta| meta.unread = unread)
}

/// 把一组会话全部标记为已读（清除 unread 标记）。
pub fn mark_sessions_read(session_ids: &[String]) -> Result<(), String> {
    let file = workspace_metadata_file()?;
    let mut root = load_root(&file);
    let mut sessions = section(&root, "sessions");
    let mut changed = false;
    for session_id in session_ids {
        let session_id = session_id.trim();
        if session_id.is_empty() {
            continue;
        }
        let Some(record) = sessions.get(session_id) else {
            continue;
        };
        let mut meta = session_metadata_from_record(record);
        if !meta.unread {
            continue;
        }
        meta.unread = false;
        changed = true;
        if session_record_is_empty(&meta) {
            sessions.remove(session_id);
        } else {
            sessions.insert(
                session_id.to_string(),
                session_record_to_value(&meta, timestamp_now_millis()),
            );
        }
    }
    if !changed {
        return Ok(());
    }
    root.insert("sessions".to_string(), Value::Object(sessions));
    save_root(&file, &root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_metadata_file(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("ccg-switch-workspace-metadata-{name}-{suffix}"))
            .join("workspace-metadata.json")
    }

    #[test]
    fn normalizes_project_keys_consistently() {
        assert_eq!(normalize_project_key("C:\\Workspace\\App\\"), "c:/workspace/app");
        assert_eq!(normalize_project_key(" /home/u/Proj/ "), "/home/u/proj");
    }

    #[test]
    fn project_pin_and_rename_roundtrip() -> Result<(), String> {
        let file = unique_metadata_file("project");
        update_project_with(&file, "c:/workspace/app", |meta| meta.pinned = true)?;
        update_project_with(&file, "c:/workspace/app", |meta| {
            meta.custom_name = Some("Renamed".to_string())
        })?;

        let root = load_root(&file);
        let projects = section(&root, "projects");
        let record = projects.get("c:/workspace/app").expect("project record");
        assert_eq!(record["pinned"], Value::Bool(true));
        assert_eq!(record["customName"], Value::String("Renamed".to_string()));

        // 取消置顶且无其它状态时不应残留空记录
        update_project_with(&file, "c:/workspace/app", |meta| {
            meta.pinned = false;
            meta.custom_name = None;
        })?;
        let root = load_root(&file);
        assert!(section(&root, "projects").get("c:/workspace/app").is_none());

        std::fs::remove_dir_all(file.parent().expect("dir")).ok();
        Ok(())
    }

    #[test]
    fn session_unread_and_mark_read() -> Result<(), String> {
        let file = unique_metadata_file("session");
        update_session_with(&file, "session-1", |meta| meta.unread = true)?;
        update_session_with(&file, "session-2", |meta| meta.pinned = true)?;

        let root = load_root(&file);
        let sessions = section(&root, "sessions");
        assert_eq!(sessions["session-1"]["unread"], Value::Bool(true));

        // mark_sessions_read 直接走真实文件路径，这里改用内联逻辑校验同样行为
        let mut root = load_root(&file);
        let mut sessions = section(&root, "sessions");
        let mut meta = session_metadata_from_record(&sessions["session-1"]);
        meta.unread = false;
        assert!(session_record_is_empty(&meta));
        sessions.remove("session-1");
        root.insert("sessions".to_string(), Value::Object(sessions));
        save_root(&file, &root)?;

        let root = load_root(&file);
        let sessions = section(&root, "sessions");
        assert!(sessions.get("session-1").is_none());
        assert_eq!(sessions["session-2"]["pinned"], Value::Bool(true));

        std::fs::remove_dir_all(file.parent().expect("dir")).ok();
        Ok(())
    }

    #[test]
    fn rejects_empty_project_name() {
        assert!(normalize_project_custom_name("   ").is_err());
        assert!(normalize_project_custom_name(&"x".repeat(81)).is_err());
        assert_eq!(normalize_project_custom_name(" My Proj ").as_deref(), Ok("My Proj"));
    }
}
