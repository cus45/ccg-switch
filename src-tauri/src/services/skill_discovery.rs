//! Skills 仓库发现模块
//!
//! 通过 GitHub API 发现仓库中的技能，下载并解压 ZIP 包。

use crate::database::dao::skills::SkillRepo;
use serde::Deserialize;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// 可发现的技能（来自 GitHub 仓库）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DiscoverableSkill {
    /// 唯一标识: "owner/repo:directory"
    pub key: String,
    /// 显示名称（从 SKILL.md 解析）
    pub name: String,
    /// 描述
    pub description: String,
    /// 安装目录名（最后一段路径）
    pub directory: String,
    /// 仓库内完整相对路径（用于从 ZIP 中定位源目录）
    #[serde(rename = "repoPath")]
    pub repo_path: String,
    /// GitHub 文档 URL
    #[serde(rename = "readmeUrl")]
    pub readme_url: Option<String>,
    #[serde(rename = "repoOwner")]
    pub repo_owner: String,
    #[serde(rename = "repoName")]
    pub repo_name: String,
    #[serde(rename = "repoBranch")]
    pub repo_branch: String,
    /// 仓库 Star 数
    pub stars: Option<u32>,
}

/// SKILL.md front-matter 元数据
#[derive(Debug, Deserialize)]
struct SkillMetadata {
    name: Option<String>,
    description: Option<String>,
}

fn parse_skill_metadata(content: &str) -> SkillMetadata {
    // 简单解析 YAML front-matter (---\n...\n---)
    let mut name = None;
    let mut description = None;

    let lines: Vec<&str> = content.lines().collect();
    let mut in_front = false;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if i == 0 && trimmed == "---" {
            in_front = true;
            continue;
        }
        if in_front {
            if trimmed == "---" {
                break;
            }
            if let Some(rest) = trimmed.strip_prefix("name:") {
                name = Some(rest.trim().trim_matches('"').to_string());
            } else if let Some(rest) = trimmed.strip_prefix("description:") {
                description = Some(rest.trim().trim_matches('"').to_string());
            }
        }
    }

    SkillMetadata { name, description }
}

/// 递归扫描解压目录，查找含 SKILL.md 的子目录
fn scan_extracted_dir(
    current: &Path,
    base: &Path,
    repo: &SkillRepo,
    skills: &mut Vec<DiscoverableSkill>,
) {
    let skill_md = current.join("SKILL.md");
    if skill_md.exists() {
        let rel = if current == base {
            repo.name.clone()
        } else {
            current
                .strip_prefix(base)
                .unwrap_or(current)
                .to_string_lossy()
                .replace('\\', "/")
        };

        let install_name = Path::new(&rel)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| rel.clone());

        let content = fs::read_to_string(&skill_md).unwrap_or_default();
        let meta = parse_skill_metadata(&content);
        let doc_path = skill_md
            .strip_prefix(base)
            .unwrap_or(&skill_md)
            .to_string_lossy()
            .replace('\\', "/");

        skills.push(DiscoverableSkill {
            key: format!("{}/{}:{}", repo.owner, repo.name, rel),
            name: meta.name.unwrap_or_else(|| install_name.clone()),
            description: meta.description.unwrap_or_default(),
            directory: install_name,
            repo_path: rel.clone(),
            readme_url: Some(format!(
                "https://github.com/{}/{}/blob/{}/{}",
                repo.owner, repo.name, repo.branch, doc_path
            )),
            repo_owner: repo.owner.clone(),
            repo_name: repo.name.clone(),
            repo_branch: repo.branch.clone(),
            stars: None, // 在外层批量获取后赋值
        });
        return;
    }

    if let Ok(entries) = fs::read_dir(current) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                scan_extracted_dir(&path, base, repo, skills);
            }
        }
    }
}

/// 下载仓库 ZIP 并解压到临时目录，返回 (临时目录, 实际 branch)
///
/// 支持分支回退：依次尝试 配置分支 → main → master
async fn download_repo(repo: &SkillRepo) -> Result<(PathBuf, String), String> {
    // 构建候选分支列表（去重）
    let mut branches: Vec<&str> = Vec::new();
    if !repo.branch.is_empty() && !repo.branch.eq_ignore_ascii_case("HEAD") {
        branches.push(repo.branch.as_str());
    }
    if !branches.contains(&"main") {
        branches.push("main");
    }
    if !branches.contains(&"master") {
        branches.push("master");
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let temp_dir = std::env::temp_dir().join(format!(
        "cc-switch-skill-{}-{}",
        repo.owner,
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let mut last_error = None;
    for branch in &branches {
        let url = format!(
            "https://github.com/{}/{}/archive/refs/heads/{}.zip",
            repo.owner, repo.name, branch
        );

        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = Some(format!(
                    "下载仓库 {}/{} (分支 {}) 失败: {}",
                    repo.owner, repo.name, branch, e
                ));
                continue;
            }
        };

        if !resp.status().is_success() {
            last_error = Some(format!(
                "下载 {}/{} (分支 {}) 失败: HTTP {}",
                repo.owner,
                repo.name,
                branch,
                resp.status()
            ));
            continue;
        }

        let bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                last_error = Some(e.to_string());
                continue;
            }
        };

        let cursor = Cursor::new(bytes);
        let mut archive = match zip::ZipArchive::new(cursor) {
            Ok(a) => a,
            Err(e) => {
                last_error = Some(e.to_string());
                continue;
            }
        };

        // 解压 —— 剥除顶层目录 (owner-repo-branch/)
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let outpath = match file.enclosed_name() {
                Some(p) => p.to_owned(),
                None => continue,
            };

            // 剥除第一个路径组件
            let stripped: PathBuf = outpath.components().skip(1).collect();
            if stripped.as_os_str().is_empty() {
                continue;
            }
            let dest = temp_dir.join(&stripped);

            if file.is_dir() {
                fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut outfile = fs::File::create(&dest).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            }
        }

        if *branch != repo.branch {
            eprintln!(
                "仓库 {}/{} 分支回退: {} -> {}",
                repo.owner, repo.name, repo.branch, branch
            );
        }

        return Ok((temp_dir, branch.to_string()));
    }

    // 所有分支都失败
    let _ = fs::remove_dir_all(&temp_dir);
    Err(last_error.unwrap_or_else(|| format!("下载 {}/{} 所有分支均失败", repo.owner, repo.name)))
}

/// 获取仓库元数据（主要为了 Star 数）
async fn fetch_repo_stars(repo: &SkillRepo) -> Option<u32> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;

    let url = format!("https://api.github.com/repos/{}/{}", repo.owner, repo.name);
    let resp = client
        .get(&url)
        .header("User-Agent", "CCG-Switch-Skill-Discovery")
        .send()
        .await
        .ok()?;

    if resp.status().is_success() {
        let json: serde_json::Value = resp.json().await.ok()?;
        json.get("stargazers_count")
            .and_then(|v| v.as_u64())
            .map(|n| n as u32)
    } else {
        None
    }
}

/// 从单个仓库发现技能
pub async fn fetch_repo_skills(repo: &SkillRepo) -> Result<Vec<DiscoverableSkill>, String> {
    let (temp_dir, resolved_branch) = download_repo(repo).await?;
    let mut skills = Vec::new();
    let mut repo_with_branch = repo.clone();
    repo_with_branch.branch = resolved_branch;
    scan_extracted_dir(&temp_dir, &temp_dir, &repo_with_branch, &mut skills);
    let _ = fs::remove_dir_all(&temp_dir);

    // 抓取 GitHub Star 数并赋值
    if !skills.is_empty() {
        if let Some(stars) = fetch_repo_stars(repo).await {
            for skill in &mut skills {
                skill.stars = Some(stars);
            }
        }
    }

    Ok(skills)
}

/// 从所有启用的仓库发现技能（并行）
pub async fn discover_available(repos: Vec<SkillRepo>) -> Vec<DiscoverableSkill> {
    let enabled: Vec<SkillRepo> = repos.into_iter().filter(|r| r.enabled).collect();
    let tasks: Vec<_> = enabled.iter().map(fetch_repo_skills).collect();
    let results = futures::future::join_all(tasks).await;

    let mut all: Vec<DiscoverableSkill> = results.into_iter().flatten().flatten().collect();

    // 去重（按 key）
    let mut seen = std::collections::HashSet::new();
    all.retain(|s| seen.insert(s.key.clone()));
    all.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    all
}

/// 下载单个 skill 到 SSOT 目录
///
/// 从仓库 ZIP 中提取指定 directory 的内容到 ssot_dir/install_name
pub async fn download_skill_to_ssot(
    skill: &DiscoverableSkill,
    ssot_dir: &Path,
) -> Result<PathBuf, String> {
    let repo = SkillRepo {
        owner: skill.repo_owner.clone(),
        name: skill.repo_name.clone(),
        branch: skill.repo_branch.clone(),
        enabled: true,
    };

    let (temp_dir, _) = download_repo(&repo).await?;

    // 找到 skill 对应的子目录
    let skill_src = if skill.repo_path == repo.name {
        temp_dir.clone()
    } else {
        temp_dir.join(&skill.repo_path)
    };

    let install_name = Path::new(&skill.directory)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| skill.directory.clone());

    let dest = ssot_dir.join(&install_name);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }

    copy_dir(&skill_src, &dest)?;
    let _ = fs::remove_dir_all(&temp_dir);

    Ok(dest)
}

/// 递归复制目录
fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
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
