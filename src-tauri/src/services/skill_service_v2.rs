#![allow(dead_code)]
//! Skills 数据库版服务层 (v2)
//!
//! SSOT 目录: ~/.ccg-switch/skills/<directory>/
//! 应用目录: ~/.claude/skills/ / ~/.codex/skills/ / ~/.gemini/skills/

use crate::database::dao::skills::{InstalledSkillRow, SkillRepo};
use crate::database::Database;
use crate::services::capability_service;
use crate::services::skill_discovery::{
    discover_available, download_skill_to_ssot, DiscoverableSkill,
};
use crate::utils::base64;
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

/// SKILL.md frontmatter 结构
#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    name: String,
    description: Option<String>,
}

/// 导出所用数据结构
#[derive(Debug, Serialize, Deserialize)]
pub struct SkillExportData {
    pub name: String,
    pub description: Option<String>,
    pub directory: String,
    pub content: String,
}

// ========== 路径管理 ==========

fn get_ssot_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法获取 HOME 目录")?;
    let dir = home.join(".ccg-switch").join("skills");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn get_app_skills_dir(app: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法获取 HOME 目录")?;
    let dir = match app {
        "claude" => home.join(".claude").join("skills"),
        "codex" => home.join(".codex").join("skills"),
        "gemini" => home.join(".gemini").join("skills"),
        _ => return Err(format!("不支持的 app: {}", app)),
    };
    Ok(dir)
}

// ========== 文件同步 ==========

/// 将 SSOT skill 目录复制到应用目录
fn sync_to_app_dir(directory: &str, app: &str) -> Result<(), String> {
    let ssot_dir = get_ssot_dir()?;
    let src = ssot_dir.join(directory);
    if !src.exists() {
        return Ok(());
    }

    let app_dir = get_app_skills_dir(app)?;
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    let dst = app_dir.join(directory);

    // 删除旧的再复制
    if dst.exists() {
        if dst.is_dir() {
            fs::remove_dir_all(&dst).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(&dst).map_err(|e| e.to_string())?;
        }
    }

    copy_dir(&src, &dst)
}

/// 从应用目录删除 skill
fn remove_from_app_dir(directory: &str, app: &str) {
    if let Ok(app_dir) = get_app_skills_dir(app) {
        let path = app_dir.join(directory);
        if path.exists() {
            if path.is_dir() {
                let _ = fs::remove_dir_all(&path);
            } else {
                let _ = fs::remove_file(&path);
            }
        }
    }
}

fn copy_dir(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let dest = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteUpdateData {
    pub has_update: bool,
    pub remote_content: String,
    pub local_content: String,
}

// ========== SkillServiceV2 ==========

pub struct SkillServiceV2;

impl SkillServiceV2 {
    /// 获取所有已安装的 Skills
    pub fn get_all_installed(db: &Arc<Database>) -> Result<Vec<InstalledSkillRow>, String> {
        let map = db.get_all_installed_skills()?;
        let mut skills: Vec<InstalledSkillRow> = map.into_values().collect();
        skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(skills)
    }

    /// 安装 Skill
    ///
    /// 1. 下载到 SSOT 目录
    /// 2. 保存到数据库（默认启用 claude）
    /// 3. 同步到已启用的应用目录
    pub async fn install(
        db: &Arc<Database>,
        skill: &DiscoverableSkill,
        current_app: &str,
    ) -> Result<InstalledSkillRow, String> {
        // 检查是否已安装
        let existing = db.get_all_installed_skills()?;
        for row in existing.values() {
            if row.directory.eq_ignore_ascii_case(&skill.directory) {
                return Err(format!("技能 '{}' 已安装，无需重复安装", skill.directory));
            }
        }

        let ssot_dir = get_ssot_dir()?;
        download_skill_to_ssot(skill, &ssot_dir)
            .await
            .map_err(|e| format!("下载技能失败: {}", e))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let row = InstalledSkillRow {
            id: uuid::Uuid::new_v4().to_string(),
            name: skill.name.clone(),
            description: Some(skill.description.clone()),
            directory: skill.directory.clone(),
            repo_owner: Some(skill.repo_owner.clone()),
            repo_name: Some(skill.repo_name.clone()),
            repo_branch: Some(skill.repo_branch.clone()),
            readme_url: skill.readme_url.clone(),
            enabled_claude: current_app == "claude",
            enabled_codex: current_app == "codex",
            enabled_gemini: current_app == "gemini",
            installed_at: now,
        };

        db.save_skill(&row)?;
        capability_service::sync_skill_legacy_bindings(db, &row)?;

        // 同步到启用的应用目录
        for app in ["claude", "codex", "gemini"] {
            if Self::app_enabled(&row, app) {
                let _ = sync_to_app_dir(&row.directory, app);
            }
        }

        Ok(row)
    }

    /// 导出技能（读取 SKILL.md，返回 `ccg-skill://` Base64）
    pub fn export_skill(db: &Arc<Database>, id: &str) -> Result<String, String> {
        let skills = db.get_all_installed_skills()?;
        let row = skills
            .get(id)
            .ok_or_else(|| format!("Skill not found: {}", id))?;

        let ssot_dir = get_ssot_dir()?;
        let file_path = ssot_dir.join(&row.directory).join("SKILL.md");
        let content =
            fs::read_to_string(&file_path).map_err(|e| format!("无法读取技能文件: {}", e))?;

        let export_data = SkillExportData {
            name: row.name.clone(),
            description: row.description.clone(),
            directory: row.directory.clone(),
            content,
        };

        // JSON -> Base64
        let json_str =
            serde_json::to_string(&export_data).map_err(|e| format!("序列化失败: {}", e))?;

        // 加入自定义前缀
        let encoded = base64::encode(json_str.as_bytes());
        Ok(format!("ccg-skill://{}", encoded))
    }

    /// 导入通过 Base64 分享的技能
    pub fn import_skill(db: &Arc<Database>, payload: &str) -> Result<InstalledSkillRow, String> {
        // 1. 去除前缀
        let b64 = payload
            .strip_prefix("ccg-skill://")
            .unwrap_or(payload)
            .trim();

        // 2. 解码与反序列化
        let decoded = base64::decode(b64).map_err(|e| format!("Base64 解码失败: {}", e))?;
        let json_str = String::from_utf8(decoded).map_err(|e| format!("UTF-8 解码失败: {}", e))?;
        let data: SkillExportData =
            serde_json::from_str(&json_str).map_err(|e| format!("解析技能数据失败: {}", e))?;

        // 3. 检查冲突：目录已存在或同名技能已在数据库中，直接拒绝导入
        let ssot_dir = get_ssot_dir()?;
        let target_dir = data.directory.clone();

        // 检查 SSOT 目录重复
        if ssot_dir.join(&target_dir).exists() {
            return Err(format!(
                "技能「{}」已存在（目录 {} 重复），跳过导入",
                data.name, target_dir
            ));
        }
        // 检查数据库中同名重复
        let existing = db.get_all_installed_skills()?;
        let name_lower = data.name.to_lowercase();
        if existing.values().any(|s| {
            s.name.to_lowercase() == name_lower
                || s.directory.to_lowercase() == target_dir.to_lowercase()
        }) {
            return Err(format!("技能「{}」已经安装，无需重复导入", data.name));
        }

        // 4. 写文件
        let skill_dir = ssot_dir.join(&target_dir);
        fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
        fs::write(skill_dir.join("SKILL.md"), &data.content).map_err(|e| e.to_string())?;

        // 5. 写入数据库
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let row = InstalledSkillRow {
            id: uuid::Uuid::new_v4().to_string(),
            name: data.name,
            description: data.description,
            directory: target_dir,
            repo_owner: None,
            repo_name: None,
            repo_branch: None,
            readme_url: None,
            enabled_claude: true, // 默认在 Claude 中启用
            enabled_codex: false,
            enabled_gemini: false,
            installed_at: now,
        };

        db.save_skill(&row)?;
        capability_service::sync_skill_legacy_bindings(db, &row)?;

        // 同步到 Claude 目录
        let _ = sync_to_app_dir(&row.directory, "claude");

        Ok(row)
    }

    /// 卸载 Skill
    pub fn uninstall(db: &Arc<Database>, id: &str) -> Result<(), String> {
        let skills = db
            .get_all_installed_skills()
            .map_err(|e| format!("读取技能列表失败: {}", e))?;
        if let Some(row) = skills.get(id) {
            // 删除 SSOT 目录
            let ssot_dir = get_ssot_dir()?;
            let ssot_path = ssot_dir.join(&row.directory);
            if ssot_path.exists() {
                if ssot_path.is_dir() {
                    fs::remove_dir_all(&ssot_path).map_err(|e| format!("删除目录失败: {}", e))?;
                } else {
                    fs::remove_file(&ssot_path).map_err(|e| e.to_string())?;
                }
            }
            // 从应用目录删除
            for app in ["claude", "codex", "gemini"] {
                remove_from_app_dir(&row.directory, app);
            }
        }
        db.delete_skill(id)?;
        if let Some(capability) =
            db.get_capability_by_type_source(crate::models::capability::CapabilityType::Skill, id)?
        {
            let _ = db.delete_capability_by_id(&capability.id);
        }
        Ok(())
    }

    /// 切换 Skill 的应用启用状态
    pub fn toggle_app(
        db: &Arc<Database>,
        id: &str,
        app: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let mut skills = db
            .get_all_installed_skills()
            .map_err(|e| format!("读取技能列表失败: {}", e))?;
        let row = skills
            .get_mut(id)
            .ok_or_else(|| format!("技能 ID '{}' 不存在", id))?;

        match app {
            "claude" => row.enabled_claude = enabled,
            "codex" => row.enabled_codex = enabled,
            "gemini" => row.enabled_gemini = enabled,
            _ => return Err(format!("不支持的 app: {}", app)),
        }

        db.save_skill(row)?;
        capability_service::sync_skill_legacy_bindings(db, row)?;

        if enabled {
            sync_to_app_dir(&row.directory, app)?;
        } else {
            remove_from_app_dir(&row.directory, app);
        }

        Ok(())
    }

    fn app_enabled(row: &InstalledSkillRow, app: &str) -> bool {
        match app {
            "claude" => row.enabled_claude,
            "codex" => row.enabled_codex,
            "gemini" => row.enabled_gemini,
            _ => false,
        }
    }

    // ========== 仓库管理 ==========

    pub fn get_repos(db: &Arc<Database>) -> Result<Vec<SkillRepo>, String> {
        db.get_skill_repos()
    }

    pub fn save_repo(db: &Arc<Database>, repo: SkillRepo) -> Result<(), String> {
        db.save_skill_repo(&repo)
    }

    pub fn delete_repo(db: &Arc<Database>, owner: &str, name: &str) -> Result<(), String> {
        db.delete_skill_repo(owner, name)
    }

    // ========== 发现功能 ==========

    pub async fn discover(db: &Arc<Database>) -> Result<Vec<DiscoverableSkill>, String> {
        let repos = db.get_skill_repos()?;
        let skills = discover_available(repos).await;
        Ok(skills)
    }

    // ========== 扫描导入 ==========

    /// 扫描所有 skill 目录并导入到数据库
    ///
    /// 扫描源（与 cc-switch 一致）：
    /// 1. ~/.claude/skills/
    /// 2. ~/.codex/skills/
    /// 3. ~/.gemini/skills/
    /// 4. ~/.agents/skills/ (Claude Code 原生安装位置)
    /// 5. ~/.ccg-switch/skills/ (SSOT 目录)
    ///
    /// 返回 (导入数量, 跳过数量, 导入的 skill 名称列表)
    pub fn scan_and_import(db: &Arc<Database>) -> Result<(usize, usize, Vec<String>), String> {
        // 获取数据库中已有的 directory 列表
        let existing = db.get_all_installed_skills()?;
        let existing_dirs: std::collections::HashSet<String> = existing
            .values()
            .map(|r| r.directory.to_lowercase())
            .collect();

        let mut imported = 0;
        let mut skipped = 0;
        let mut imported_names: Vec<String> = vec![];
        // 已处理的 directory（防止同一 skill 在多个目录中被重复导入）
        let mut seen_dirs: std::collections::HashSet<String> = std::collections::HashSet::new();

        // 收集所有扫描源：(目录路径, 来源标签, 启用的应用列表)
        let mut scan_sources: Vec<(PathBuf, String, Vec<&str>)> = Vec::new();

        // 1-3. 三个应用目录
        for (app_name, apps) in [
            ("claude", vec!["claude"]),
            ("codex", vec!["codex"]),
            ("gemini", vec!["gemini"]),
        ] {
            if let Ok(dir) = get_app_skills_dir(app_name) {
                scan_sources.push((dir, app_name.to_string(), apps));
            }
        }

        // 4. ~/.agents/skills/ (Claude Code 原生安装位置)
        if let Some(home) = dirs::home_dir() {
            let agents_dir = home.join(".agents").join("skills");
            if agents_dir.exists() {
                scan_sources.push((agents_dir, "agents".to_string(), vec!["claude"]));
            }
        }

        // 5. SSOT 目录 ~/.ccg-switch/skills/
        if let Ok(ssot) = get_ssot_dir() {
            scan_sources.push((ssot, "ssot".to_string(), vec![]));
        }

        let ssot_dir = get_ssot_dir().ok();

        for (scan_dir, _label, default_apps) in &scan_sources {
            if !scan_dir.exists() {
                continue;
            }

            let entries = match fs::read_dir(scan_dir) {
                Ok(e) => e,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let path = entry.path();

                // 只处理目录
                if !path.is_dir() {
                    continue;
                }

                let directory = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                // 跳过隐藏目录
                if directory.starts_with('.') {
                    continue;
                }

                // 跳过已在数据库中的
                if existing_dirs.contains(&directory.to_lowercase()) {
                    skipped += 1;
                    continue;
                }

                // 跳过已在本次扫描中处理过的
                if seen_dirs.contains(&directory.to_lowercase()) {
                    continue;
                }
                seen_dirs.insert(directory.to_lowercase());

                // 查找 SKILL.md 文件
                let skill_md = path.join("SKILL.md");
                let (name, description) = if skill_md.exists() {
                    match parse_skill_frontmatter(&skill_md) {
                        Ok(Some((n, d))) => (n, Some(d)),
                        _ => (directory.clone(), None),
                    }
                } else {
                    (directory.clone(), None)
                };

                // 将 skill 复制到 SSOT 目录（如果不在 SSOT 中）
                if let Some(ref ssot) = ssot_dir {
                    let ssot_path = ssot.join(&directory);
                    if !ssot_path.exists() && path != ssot_path {
                        let _ = copy_dir(&path, &ssot_path);
                    }
                }

                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);

                let row = InstalledSkillRow {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    description,
                    directory: directory.clone(),
                    repo_owner: None,
                    repo_name: None,
                    repo_branch: None,
                    readme_url: None,
                    enabled_claude: default_apps.contains(&"claude"),
                    enabled_codex: default_apps.contains(&"codex"),
                    enabled_gemini: default_apps.contains(&"gemini"),
                    installed_at: now,
                };

                db.save_skill(&row)?;
                capability_service::sync_skill_legacy_bindings(db, &row)?;
                imported += 1;
                imported_names.push(row.name);
            }
        }

        Ok((imported, skipped, imported_names))
    }

    // ========== 更新机制 ==========

    /// 检查指定技能是否有远程更新
    pub async fn check_update(db: &Arc<Database>, id: &str) -> Result<RemoteUpdateData, String> {
        let skills = db.get_all_installed_skills()?;
        let row = skills
            .get(id)
            .ok_or_else(|| format!("Skill not found: {}", id))?;

        // 只有来源于仓库的技能才能更新
        let owner = row.repo_owner.as_ref().ok_or("该技能不是来自远程仓库")?;
        let name = row.repo_name.as_ref().ok_or("该技能不是来自远程仓库")?;
        let branch = row.repo_branch.as_ref().ok_or("丢失分支信息")?;
        let directory = &row.directory;

        // 构造 Raw URL: https://raw.githubusercontent.com/{owner}/{name}/{branch}/skills/{directory}/SKILL.md
        let raw_url = format!(
            "https://raw.githubusercontent.com/{}/{}/{}/skills/{}/SKILL.md",
            owner, name, branch, directory
        );

        let client = Client::new();
        let resp = client
            .get(&raw_url)
            .send()
            .await
            .map_err(|e| format!("请求远程文件失败: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!(
                "从 GitHub 抓取文件失败，HTTP 状态: {}",
                resp.status()
            ));
        }

        let remote_content: String = resp
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {}", e))?;

        // 读取本地内容
        let ssot_dir = get_ssot_dir()?;
        let local_file = ssot_dir.join(directory).join("SKILL.md");
        let local_content = if local_file.exists() {
            fs::read_to_string(&local_file).unwrap_or_default()
        } else {
            String::new()
        };

        // TODO: 如果只比对正文，可以忽略 YAML 变动等细节；目前简单全量比对
        let has_update = remote_content != local_content;

        Ok(RemoteUpdateData {
            has_update,
            remote_content,
            local_content,
        })
    }

    /// 应用远程更新并同步目录
    pub fn apply_update(db: &Arc<Database>, id: &str, new_content: &str) -> Result<(), String> {
        let skills = db.get_all_installed_skills()?;
        let row = skills
            .get(id)
            .ok_or_else(|| format!("Skill not found: {}", id))?;

        let ssot_dir = get_ssot_dir()?;
        let local_file = ssot_dir.join(&row.directory).join("SKILL.md");

        fs::write(&local_file, new_content).map_err(|e| format!("无法覆盖本地技能文件: {}", e))?;

        // 将新的内容同步到已启用的应用 (如 Claude / Codex) 所在的目录
        if row.enabled_claude {
            let _ = sync_to_app_dir(&row.directory, "claude");
        }
        if row.enabled_codex {
            let _ = sync_to_app_dir(&row.directory, "codex");
        }
        if row.enabled_gemini {
            let _ = sync_to_app_dir(&row.directory, "gemini");
        }

        Ok(())
    }
}

/// 解析 SKILL.md 的 YAML frontmatter
fn parse_skill_frontmatter(path: &PathBuf) -> Result<Option<(String, String)>, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

    // 使用正则提取 frontmatter
    let re = Regex::new(r"^---\s*\n([\s\S]*?)\n---").map_err(|e| e.to_string())?;

    if let Some(caps) = re.captures(&content) {
        let yaml_str = caps.get(1).map(|m| m.as_str()).unwrap_or("");

        // 解析 YAML
        if let Ok(frontmatter) = serde_yaml::from_str::<SkillFrontmatter>(yaml_str) {
            return Ok(Some((
                frontmatter.name,
                frontmatter.description.unwrap_or_default(),
            )));
        }
    }

    Ok(None)
}
