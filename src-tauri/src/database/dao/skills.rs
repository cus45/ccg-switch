#![allow(dead_code)]
use crate::database::{lock_conn, Database};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkillRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub directory: String,
    pub repo_owner: Option<String>,
    pub repo_name: Option<String>,
    pub repo_branch: Option<String>,
    pub readme_url: Option<String>,
    pub enabled_claude: bool,
    pub enabled_codex: bool,
    pub enabled_gemini: bool,
    pub installed_at: i64,
    /// 旧版本导出的数据没有该字段
    #[serde(default)]
    pub enabled_opencode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRepo {
    pub owner: String,
    pub name: String,
    pub branch: String,
    pub enabled: bool,
}

impl Database {
    // ========== InstalledSkill ==========

    pub fn get_all_installed_skills(&self) -> Result<IndexMap<String, InstalledSkillRow>, String> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id, name, description, directory, repo_owner, repo_name, repo_branch, readme_url, enabled_claude, enabled_codex, enabled_gemini, installed_at, enabled_opencode FROM skills ORDER BY name ASC")
            .map_err(|e| format!("Failed to prepare query: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(InstalledSkillRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    directory: row.get(3)?,
                    repo_owner: row.get(4)?,
                    repo_name: row.get(5)?,
                    repo_branch: row.get(6)?,
                    readme_url: row.get(7)?,
                    enabled_claude: row.get(8)?,
                    enabled_codex: row.get(9)?,
                    enabled_gemini: row.get(10)?,
                    installed_at: row.get(11)?,
                    enabled_opencode: row.get(12)?,
                })
            })
            .map_err(|e| format!("Failed to query skills: {e}"))?;

        let mut map = IndexMap::new();
        for row in rows {
            let skill = row.map_err(|e| format!("Failed to read row: {e}"))?;
            map.insert(skill.id.clone(), skill);
        }
        Ok(map)
    }

    pub fn save_skill(&self, skill: &InstalledSkillRow) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO skills (id, name, description, directory, repo_owner, repo_name, repo_branch, readme_url, enabled_claude, enabled_codex, enabled_gemini, installed_at, enabled_opencode) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                skill.id,
                skill.name,
                skill.description,
                skill.directory,
                skill.repo_owner,
                skill.repo_name,
                skill.repo_branch,
                skill.readme_url,
                skill.enabled_claude,
                skill.enabled_codex,
                skill.enabled_gemini,
                skill.installed_at,
                skill.enabled_opencode,
            ],
        )
        .map_err(|e| format!("Failed to save skill: {e}"))?;
        Ok(())
    }

    pub fn delete_skill(&self, id: &str) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute("DELETE FROM skills WHERE id = ?1", rusqlite::params![id])
            .map_err(|e| format!("Failed to delete skill: {e}"))?;
        Ok(affected > 0)
    }

    pub fn update_skill_apps(
        &self,
        id: &str,
        enabled_claude: bool,
        enabled_codex: bool,
        enabled_gemini: bool,
    ) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills SET enabled_claude = ?1, enabled_codex = ?2, enabled_gemini = ?3 WHERE id = ?4",
                rusqlite::params![enabled_claude, enabled_codex, enabled_gemini, id],
            )
            .map_err(|e| format!("Failed to update skill apps: {e}"))?;
        Ok(affected > 0)
    }

    // ========== SkillRepos ==========

    pub fn get_skill_repos(&self) -> Result<Vec<SkillRepo>, String> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT owner, name, branch, enabled FROM skill_repos ORDER BY owner ASC, name ASC",
            )
            .map_err(|e| format!("Failed to prepare query: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(SkillRepo {
                    owner: row.get(0)?,
                    name: row.get(1)?,
                    branch: row.get(2)?,
                    enabled: row.get(3)?,
                })
            })
            .map_err(|e| format!("Failed to query skill_repos: {e}"))?;

        let mut repos = Vec::new();
        for row in rows {
            repos.push(row.map_err(|e| format!("Failed to read row: {e}"))?);
        }
        Ok(repos)
    }

    pub fn save_skill_repo(&self, repo: &SkillRepo) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO skill_repos (owner, name, branch, enabled) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![repo.owner, repo.name, repo.branch, repo.enabled],
        )
        .map_err(|e| format!("Failed to save skill_repo: {e}"))?;
        Ok(())
    }

    pub fn delete_skill_repo(&self, owner: &str, name: &str) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM skill_repos WHERE owner = ?1 AND name = ?2",
            rusqlite::params![owner, name],
        )
        .map_err(|e| format!("Failed to delete skill_repo: {e}"))?;
        Ok(())
    }
}
