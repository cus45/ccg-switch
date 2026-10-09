#![allow(dead_code)]
use crate::database::Database;
use crate::models::skill::{Skill, SkillApps, SkillSource};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;

fn get_user_skills_dir() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".claude").join("commands"))
}

fn get_skill_apps_path() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".ccg-switch").join("skill-apps.json"))
}

/// 从数据库加载 skill apps（v3+，失败时回退到 JSON）
fn load_skill_apps_from_db(db: &Arc<Database>) -> Result<HashMap<String, SkillApps>, String> {
    match db.get_app_config("skill_apps_legacy")? {
        Some(json) => {
            let apps: HashMap<String, SkillApps> =
                serde_json::from_str(&json).map_err(|e| format!("Parse skill apps failed: {e}"))?;
            Ok(apps)
        }
        None => {
            // 数据库为空时，从 JSON 文件回退加载
            if let Ok(apps) = load_skill_apps() {
                if !apps.is_empty() {
                    // 将 JSON 数据迁移到数据库
                    let config_json = serde_json::to_string(&apps)
                        .map_err(|e| format!("Serialize skill apps failed: {e}"))?;
                    let _ = db.set_app_config("skill_apps_legacy", &config_json);
                }
                return Ok(apps);
            }
            Ok(HashMap::new())
        }
    }
}

/// 保存 skill apps 到数据库（v3+）
fn save_skill_apps_to_db(
    db: &Arc<Database>,
    apps: &HashMap<String, SkillApps>,
) -> Result<(), String> {
    let config_json =
        serde_json::to_string(apps).map_err(|e| format!("Serialize skill apps failed: {e}"))?;
    db.set_app_config("skill_apps_legacy", &config_json)
}

fn load_skill_apps() -> Result<HashMap<String, SkillApps>, io::Error> {
    let path = get_skill_apps_path()?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = fs::read_to_string(&path)?;
    let apps: HashMap<String, SkillApps> = serde_json::from_str(&content)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    Ok(apps)
}

fn save_skill_apps(apps: &HashMap<String, SkillApps>) -> Result<(), io::Error> {
    let path = get_skill_apps_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(apps)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(&path, content)?;
    Ok(())
}

pub fn list_skills_from_db(
    db: &Arc<Database>,
    project_dir: Option<&str>,
) -> Result<Vec<Skill>, String> {
    let mut skills = Vec::new();

    // 扫描用户级技能
    let user_dir = get_user_skills_dir().map_err(|e| e.to_string())?;
    if user_dir.exists() {
        scan_skills_dir(&user_dir, SkillSource::User, &mut skills).map_err(|e| e.to_string())?;
    }

    // 扫描项目级技能
    if let Some(dir) = project_dir {
        let project_skills = PathBuf::from(dir).join(".claude").join("commands");
        if project_skills.exists() {
            scan_skills_dir(&project_skills, SkillSource::Project, &mut skills)
                .map_err(|e| e.to_string())?;
        }
    }

    // 从数据库加载 skill-apps 并合并 apps 字段
    let skill_apps = load_skill_apps_from_db(db).unwrap_or_default();
    for skill in &mut skills {
        if let Some(apps) = skill_apps.get(&skill.name) {
            skill.apps = apps.clone();
        }
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

pub fn list_skills(project_dir: Option<&str>) -> Result<Vec<Skill>, io::Error> {
    let mut skills = Vec::new();

    // 扫描用户级技能
    let user_dir = get_user_skills_dir()?;
    if user_dir.exists() {
        scan_skills_dir(&user_dir, SkillSource::User, &mut skills)?;
    }

    // 扫描项目级技能
    if let Some(dir) = project_dir {
        let project_skills = PathBuf::from(dir).join(".claude").join("commands");
        if project_skills.exists() {
            scan_skills_dir(&project_skills, SkillSource::Project, &mut skills)?;
        }
    }

    // 加载 skill-apps.json 并合并 apps 字段
    let skill_apps = load_skill_apps().unwrap_or_default();
    for skill in &mut skills {
        if let Some(apps) = skill_apps.get(&skill.name) {
            skill.apps = apps.clone();
        }
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

fn scan_skills_dir(
    dir: &PathBuf,
    source: SkillSource,
    skills: &mut Vec<Skill>,
) -> Result<(), io::Error> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "md") {
            let name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let content = fs::read_to_string(&path)?;
            skills.push(Skill {
                name,
                content,
                file_path: path.to_string_lossy().to_string(),
                source: source.clone(),
                apps: HashMap::new(),
            });
        }
    }
    Ok(())
}

pub fn get_skill(name: &str) -> Result<Skill, io::Error> {
    let path = get_user_skills_dir()?.join(format!("{}.md", name));
    if !path.exists() {
        return Err(io::Error::new(io::ErrorKind::NotFound, "Skill not found"));
    }
    let content = fs::read_to_string(&path)?;
    let skill_apps = load_skill_apps().unwrap_or_default();
    let apps = skill_apps.get(name).cloned().unwrap_or_default();
    Ok(Skill {
        name: name.to_string(),
        content,
        file_path: path.to_string_lossy().to_string(),
        source: SkillSource::User,
        apps,
    })
}

pub fn save_skill(name: &str, content: &str) -> Result<(), io::Error> {
    let dir = get_user_skills_dir()?;
    fs::create_dir_all(&dir)?;
    fs::write(dir.join(format!("{}.md", name)), content)?;
    Ok(())
}

pub fn delete_skill(name: &str) -> Result<(), io::Error> {
    let path = get_user_skills_dir()?.join(format!("{}.md", name));
    if path.exists() {
        fs::remove_file(&path)?;
    }
    // 同步清理 skill-apps.json 中的记录
    let mut skill_apps = load_skill_apps().unwrap_or_default();
    if skill_apps.remove(name).is_some() {
        let _ = save_skill_apps(&skill_apps);
    }
    Ok(())
}

/// 获取指定应用已启用的技能列表
/// - apps 字段为空（旧数据）→ 默认全部启用
/// - apps[app] = true → 启用
/// - apps[app] = false → 禁用
pub fn list_skills_for_app(project_dir: Option<&str>, app: &str) -> Result<Vec<Skill>, io::Error> {
    let all_skills = list_skills(project_dir)?;
    let filtered = all_skills
        .into_iter()
        .filter(|s| {
            if s.apps.is_empty() {
                true
            } else {
                *s.apps.get(app).unwrap_or(&true)
            }
        })
        .collect();
    Ok(filtered)
}

/// 更新 Skill 的 per-app 开关（数据库版本 v3+）
pub fn update_skill_apps_to_db(
    db: &Arc<Database>,
    name: &str,
    apps: SkillApps,
) -> Result<(), String> {
    let mut skill_apps = load_skill_apps_from_db(db).unwrap_or_default();
    skill_apps.insert(name.to_string(), apps);
    save_skill_apps_to_db(db, &skill_apps)
}

/// 更新 Skill 的 per-app 开关，存储到 ~/.ccg-switch/skill-apps.json（兼容旧版）
pub fn update_skill_apps(name: &str, apps: SkillApps) -> Result<(), io::Error> {
    let mut skill_apps = load_skill_apps().unwrap_or_default();
    skill_apps.insert(name.to_string(), apps);
    save_skill_apps(&skill_apps)
}
