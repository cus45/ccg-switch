use crate::models::prompt::PromptPreset;
use std::fs;
use std::io;
use std::path::PathBuf;

fn get_prompts_dir() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".ccg-switch").join("prompts"))
}

/// 获取指定应用 prompts 目录路径
/// Claude: ~/.claude/prompts/
/// 其他应用: ~/.{app}/prompts/
fn get_app_prompts_dir(app: &str) -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    let dir = match app {
        "claude" => home.join(".claude").join("prompts"),
        _ => home.join(format!(".{}", app)).join("prompts"),
    };
    Ok(dir)
}

pub fn list_prompts() -> Result<Vec<PromptPreset>, io::Error> {
    let prompts_dir = get_prompts_dir()?;
    if !prompts_dir.exists() {
        fs::create_dir_all(&prompts_dir)?;
        return Ok(vec![]);
    }

    let mut prompts = Vec::new();
    for entry in fs::read_dir(&prompts_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "md") {
            let name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let content = fs::read_to_string(&path)?;
            prompts.push(PromptPreset {
                name,
                content,
                file_path: path.to_string_lossy().to_string(),
            });
        }
    }
    prompts.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(prompts)
}

pub fn get_prompt(name: &str) -> Result<PromptPreset, io::Error> {
    let path = get_prompts_dir()?.join(format!("{}.md", name));
    if !path.exists() {
        return Err(io::Error::new(io::ErrorKind::NotFound, "Prompt not found"));
    }
    let content = fs::read_to_string(&path)?;
    Ok(PromptPreset {
        name: name.to_string(),
        content,
        file_path: path.to_string_lossy().to_string(),
    })
}

pub fn save_prompt(name: &str, content: &str) -> Result<(), io::Error> {
    let prompts_dir = get_prompts_dir()?;
    fs::create_dir_all(&prompts_dir)?;
    let path = prompts_dir.join(format!("{}.md", name));
    fs::write(&path, content)?;
    Ok(())
}

pub fn delete_prompt(name: &str) -> Result<(), io::Error> {
    let path = get_prompts_dir()?.join(format!("{}.md", name));
    if path.exists() {
        fs::remove_file(&path)?;
    }
    Ok(())
}

/// 将 prompt 同步到指定应用目录
/// Claude: ~/.claude/prompts/{name}.md
/// 其他应用: ~/.{app}/prompts/{name}.md
pub fn sync_prompt_to_app(name: &str, app: &str) -> Result<(), io::Error> {
    // 读取 prompt 内容
    let source_path = get_prompts_dir()?.join(format!("{}.md", name));
    if !source_path.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("Prompt '{}' not found", name),
        ));
    }
    let content = fs::read_to_string(&source_path)?;

    // 写入到目标应用目录
    let app_dir = get_app_prompts_dir(app)?;
    fs::create_dir_all(&app_dir)?;
    let target_path = app_dir.join(format!("{}.md", name));
    fs::write(&target_path, &content)?;
    Ok(())
}

/// 获取 prompt 已同步到哪些应用
/// 检查各应用 prompts 目录是否存在同名文件
/// 返回已同步的应用 id 列表
pub fn get_prompt_sync_status(name: &str) -> Result<Vec<String>, io::Error> {
    let all_apps = ["claude", "codex", "gemini", "opencode", "openclaw"];
    let mut synced: Vec<String> = Vec::new();

    for app in &all_apps {
        if let Ok(app_dir) = get_app_prompts_dir(app) {
            let target = app_dir.join(format!("{}.md", name));
            if target.exists() {
                synced.push(app.to_string());
            }
        }
    }

    Ok(synced)
}
