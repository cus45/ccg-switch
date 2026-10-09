#![allow(dead_code)]
use crate::database::dao::prompts::PromptRow;
use crate::database::Database;
use std::path::PathBuf;
use std::sync::Arc;

pub struct PromptServiceV2;

/// 支持的应用类型常量
const PROMPT_APPS: &[&str] = &["claude", "codex", "gemini", "opencode"];

impl PromptServiceV2 {
    /// 获取 live 文件路径
    fn get_live_file_path(app_type: &str) -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or_else(|| "Home directory not found".to_string())?;
        match app_type {
            "claude" => Ok(home.join(".claude").join("CLAUDE.md")),
            "codex" => Ok(home.join(".codex").join("AGENTS.md")),
            "gemini" => Ok(home.join(".gemini").join("GEMINI.md")),
            // 与 cc-switch 一致：OpenCode 全局规则文件
            "opencode" => Ok(home.join(".config").join("opencode").join("AGENTS.md")),
            _ => Err(format!("Unknown app_type: {}", app_type)),
        }
    }

    /// 原子写文件
    fn atomic_write(path: &std::path::Path, content: &str) -> Result<(), String> {
        use std::io::Write;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {e}"))?;
        }
        let tmp = path.with_extension("tmp");
        let mut f =
            std::fs::File::create(&tmp).map_err(|e| format!("Failed to create temp file: {e}"))?;
        f.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write temp file: {e}"))?;
        f.flush().map_err(|e| format!("Failed to flush: {e}"))?;
        drop(f);
        std::fs::rename(&tmp, path).map_err(|e| format!("Failed to rename temp file: {e}"))
    }

    /// 获取指定应用的所有 prompts
    pub fn get_prompts(db: &Arc<Database>, app_type: &str) -> Result<Vec<PromptRow>, String> {
        db.get_prompts_by_app(app_type)
    }

    /// 新增或更新 prompt
    pub fn upsert_prompt(db: &Arc<Database>, mut prompt: PromptRow) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp();
        if prompt.created_at == 0 {
            prompt.created_at = now;
        }
        prompt.updated_at = now;
        db.save_prompt(&prompt)?;

        // 如果此 prompt 已启用，同步到 live 文件
        if prompt.enabled {
            let path = Self::get_live_file_path(&prompt.app_type)?;
            Self::atomic_write(&path, &prompt.content)?;
        }
        Ok(())
    }

    /// 删除 prompt（仅允许删除未启用的）
    pub fn delete_prompt(db: &Arc<Database>, id: &str, app_type: &str) -> Result<(), String> {
        let prompts = db.get_prompts_by_app(app_type)?;
        if let Some(p) = prompts.iter().find(|p| p.id == id) {
            if p.enabled {
                return Err("Cannot delete an enabled prompt. Disable it first.".to_string());
            }
        }
        db.delete_prompt_row(id, app_type)?;
        Ok(())
    }

    /// 启用 prompt（核心流程：回填 + disable_all + enable + 写 live 文件）
    pub fn enable_prompt(db: &Arc<Database>, id: &str, app_type: &str) -> Result<(), String> {
        let live_path = Self::get_live_file_path(app_type)?;
        Self::enable_prompt_at(db, id, app_type, &live_path)
    }

    fn enable_prompt_at(
        db: &Arc<Database>,
        id: &str,
        app_type: &str,
        live_path: &std::path::Path,
    ) -> Result<(), String> {
        // 1. 读取 live 文件当前内容
        let live_content = if live_path.exists() {
            std::fs::read_to_string(&live_path).unwrap_or_default()
        } else {
            String::new()
        };

        // 2. 查找当前 enabled prompt，将 live 内容回填（保护手动编辑）
        let prompts = db.get_prompts_by_app(app_type)?;
        if let Some(current_enabled) = prompts.iter().find(|p| p.enabled) {
            if current_enabled.id != id && !live_content.is_empty() {
                let mut updated = current_enabled.clone();
                updated.content = live_content.clone();
                updated.updated_at = chrono::Utc::now().timestamp();
                db.save_prompt(&updated)?;
            }
        } else if !live_content.trim().is_empty()
            && !prompts.iter().any(|p| p.content.trim() == live_content.trim())
        {
            // 没有已启用的预设时，live 文件是用户手写的内容：覆盖前先存成一条预设，
            // 避免首次启用预设时丢失（与 cc-switch 一致）
            let now = chrono::Local::now();
            let backup = PromptRow {
                id: uuid::Uuid::new_v4().to_string(),
                app_type: app_type.to_string(),
                name: format!("原有内容（自动备份 {}）", now.format("%Y-%m-%d %H:%M")),
                content: live_content.clone(),
                description: Some(format!("启用预设前从 {} 自动保存", live_path.display())),
                enabled: false,
                created_at: now.timestamp(),
                updated_at: now.timestamp(),
            };
            db.save_prompt(&backup)?;
        }

        // 3. 禁用所有
        db.disable_all_prompts(app_type)?;

        // 4. 启用目标
        db.set_prompt_enabled(id, app_type, true)?;

        // 5. 读取目标 prompt content，写入 live 文件
        let target = db
            .get_prompts_by_app(app_type)?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| format!("Prompt '{}' not found", id))?;

        Self::atomic_write(&live_path, &target.content)?;

        Ok(())
    }

    /// 禁用 prompt
    pub fn disable_prompt(db: &Arc<Database>, id: &str, app_type: &str) -> Result<(), String> {
        // 先回填 live 文件内容
        let live_path = Self::get_live_file_path(app_type)?;
        if live_path.exists() {
            let live_content = std::fs::read_to_string(&live_path).unwrap_or_default();
            if !live_content.is_empty() {
                let prompts = db.get_prompts_by_app(app_type)?;
                if let Some(current) = prompts.iter().find(|p| p.id == id && p.enabled) {
                    let mut updated = current.clone();
                    updated.content = live_content;
                    updated.updated_at = chrono::Utc::now().timestamp();
                    db.save_prompt(&updated)?;
                }
            }
        }
        db.set_prompt_enabled(id, app_type, false)?;
        Ok(())
    }

    /// 从 live 文件导入为新 prompt
    pub fn import_from_file(db: &Arc<Database>, app_type: &str) -> Result<String, String> {
        let live_path = Self::get_live_file_path(app_type)?;
        if !live_path.exists() {
            return Err(format!("Live file not found: {}", live_path.display()));
        }
        let content = std::fs::read_to_string(&live_path)
            .map_err(|e| format!("Failed to read live file: {e}"))?;

        let now = chrono::Utc::now().timestamp();
        let id = uuid::Uuid::new_v4().to_string();
        let file_name = live_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("imported");

        let prompt = PromptRow {
            id: id.clone(),
            app_type: app_type.to_string(),
            name: format!("Imported from {}", file_name),
            content,
            description: None,
            enabled: false,
            created_at: now,
            updated_at: now,
        };
        db.save_prompt(&prompt)?;
        Ok(id)
    }

    /// 读取 live 文件内容
    pub fn get_live_content(app_type: &str) -> Result<Option<String>, String> {
        let live_path = Self::get_live_file_path(app_type)?;
        if !live_path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(&live_path)
            .map_err(|e| format!("Failed to read live file: {e}"))?;
        Ok(Some(content))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prompt(id: &str, content: &str, enabled: bool) -> PromptRow {
        PromptRow {
            id: id.into(),
            app_type: "claude".into(),
            name: id.into(),
            content: content.into(),
            description: None,
            enabled,
            created_at: 1,
            updated_at: 1,
        }
    }

    fn live_file(name: &str, content: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ccg-prompt-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("CLAUDE.md");
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn first_enable_saves_hand_written_file_as_prompt() {
        let db = Arc::new(Database::in_memory().unwrap());
        db.save_prompt(&prompt("p1", "preset body", false)).unwrap();
        let path = live_file("first", "my own rules");

        PromptServiceV2::enable_prompt_at(&db, "p1", "claude", &path).unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "preset body");
        let prompts = db.get_prompts_by_app("claude").unwrap();
        let saved = prompts.iter().find(|p| p.id != "p1").expect("原有内容应被存为预设");
        assert_eq!(saved.content, "my own rules");
        assert!(!saved.enabled);
    }

    #[test]
    fn no_duplicate_backup_when_content_already_in_library() {
        let db = Arc::new(Database::in_memory().unwrap());
        db.save_prompt(&prompt("p1", "preset body", false)).unwrap();
        db.save_prompt(&prompt("p2", "same rules", false)).unwrap();
        let path = live_file("dup", "same rules
");

        PromptServiceV2::enable_prompt_at(&db, "p1", "claude", &path).unwrap();

        assert_eq!(db.get_prompts_by_app("claude").unwrap().len(), 2);
    }
}
