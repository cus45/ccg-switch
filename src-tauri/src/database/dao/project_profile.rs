use crate::models::project_profile::ProjectProfile;
use rusqlite::{params, Connection};
use std::collections::HashMap;

pub fn get_all(conn: &Connection) -> Result<Vec<ProjectProfile>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, icon, is_active,
                    providers_json, mcp_servers_json, skills_json, prompts_json,
                    created_at, updated_at
             FROM project_profiles
             ORDER BY updated_at DESC",
        )
        .map_err(|e| format!("Failed to prepare get_all project_profiles: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let description: Option<String> = row.get(2)?;
            let icon: Option<String> = row.get(3)?;
            let is_active: bool = row.get(4)?;
            let providers_str: String = row.get(5)?;
            let mcp_servers_str: String = row.get(6)?;
            let skills_str: String = row.get(7)?;
            let prompts_str: String = row.get(8)?;
            let created_at: i64 = row.get(9)?;
            let updated_at: i64 = row.get(10)?;

            let providers: HashMap<String, String> =
                serde_json::from_str(&providers_str).unwrap_or_default();
            let mcp_servers: HashMap<String, Vec<String>> =
                serde_json::from_str(&mcp_servers_str).unwrap_or_default();
            let skills: HashMap<String, Vec<String>> =
                serde_json::from_str(&skills_str).unwrap_or_default();
            let prompts: HashMap<String, String> =
                serde_json::from_str(&prompts_str).unwrap_or_default();

            Ok(ProjectProfile {
                id,
                name,
                description,
                icon,
                is_active,
                providers,
                mcp_servers,
                skills,
                prompts,
                created_at,
                updated_at,
            })
        })
        .map_err(|e| format!("Failed to query project_profiles: {e}"))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Failed to read project_profile row: {e}"))?);
    }
    Ok(result)
}

pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<ProjectProfile>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, icon, is_active,
                    providers_json, mcp_servers_json, skills_json, prompts_json,
                    created_at, updated_at
             FROM project_profiles
             WHERE id = ?1",
        )
        .map_err(|e| format!("Failed to prepare get_by_id project_profiles: {e}"))?;

    let mut rows = stmt
        .query_map([id], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let description: Option<String> = row.get(2)?;
            let icon: Option<String> = row.get(3)?;
            let is_active: bool = row.get(4)?;
            let providers_str: String = row.get(5)?;
            let mcp_servers_str: String = row.get(6)?;
            let skills_str: String = row.get(7)?;
            let prompts_str: String = row.get(8)?;
            let created_at: i64 = row.get(9)?;
            let updated_at: i64 = row.get(10)?;

            let providers: HashMap<String, String> =
                serde_json::from_str(&providers_str).unwrap_or_default();
            let mcp_servers: HashMap<String, Vec<String>> =
                serde_json::from_str(&mcp_servers_str).unwrap_or_default();
            let skills: HashMap<String, Vec<String>> =
                serde_json::from_str(&skills_str).unwrap_or_default();
            let prompts: HashMap<String, String> =
                serde_json::from_str(&prompts_str).unwrap_or_default();

            Ok(ProjectProfile {
                id,
                name,
                description,
                icon,
                is_active,
                providers,
                mcp_servers,
                skills,
                prompts,
                created_at,
                updated_at,
            })
        })
        .map_err(|e| format!("Failed to query project_profile by id: {e}"))?;

    if let Some(row) = rows.next() {
        row.map(Some)
            .map_err(|e| format!("Failed to read project_profile: {e}"))
    } else {
        Ok(None)
    }
}

pub fn upsert(conn: &Connection, profile: &ProjectProfile) -> Result<(), String> {
    let providers_json = serde_json::to_string(&profile.providers)
        .map_err(|e| format!("Failed to serialize providers: {e}"))?;
    let mcp_servers_json = serde_json::to_string(&profile.mcp_servers)
        .map_err(|e| format!("Failed to serialize mcp_servers: {e}"))?;
    let skills_json = serde_json::to_string(&profile.skills)
        .map_err(|e| format!("Failed to serialize skills: {e}"))?;
    let prompts_json = serde_json::to_string(&profile.prompts)
        .map_err(|e| format!("Failed to serialize prompts: {e}"))?;

    conn.execute(
        "INSERT INTO project_profiles (
            id, name, description, icon, is_active,
            providers_json, mcp_servers_json, skills_json, prompts_json,
            created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            icon = excluded.icon,
            is_active = excluded.is_active,
            providers_json = excluded.providers_json,
            mcp_servers_json = excluded.mcp_servers_json,
            skills_json = excluded.skills_json,
            prompts_json = excluded.prompts_json,
            updated_at = excluded.updated_at",
        params![
            profile.id,
            profile.name,
            profile.description,
            profile.icon,
            profile.is_active,
            providers_json,
            mcp_servers_json,
            skills_json,
            prompts_json,
            profile.created_at,
            profile.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to upsert project_profile: {e}"))?;

    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<bool, String> {
    let affected = conn
        .execute("DELETE FROM project_profiles WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete project_profile: {e}"))?;
    Ok(affected > 0)
}

pub fn set_active(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute_batch(
        &format!(
            "UPDATE project_profiles SET is_active = CASE WHEN id = '{id}' THEN 1 ELSE 0 END;"
        ),
    )
    .map_err(|e| format!("Failed to set active project_profile: {e}"))?;
    Ok(())
}

#[allow(dead_code)]
pub fn get_active(conn: &Connection) -> Result<Option<ProjectProfile>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, icon, is_active,
                    providers_json, mcp_servers_json, skills_json, prompts_json,
                    created_at, updated_at
             FROM project_profiles
             WHERE is_active = 1
             LIMIT 1",
        )
        .map_err(|e| format!("Failed to prepare get_active: {e}"))?;

    let mut rows = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let description: Option<String> = row.get(2)?;
            let icon: Option<String> = row.get(3)?;
            let is_active: bool = row.get(4)?;
            let providers_str: String = row.get(5)?;
            let mcp_servers_str: String = row.get(6)?;
            let skills_str: String = row.get(7)?;
            let prompts_str: String = row.get(8)?;
            let created_at: i64 = row.get(9)?;
            let updated_at: i64 = row.get(10)?;

            let providers: HashMap<String, String> =
                serde_json::from_str(&providers_str).unwrap_or_default();
            let mcp_servers: HashMap<String, Vec<String>> =
                serde_json::from_str(&mcp_servers_str).unwrap_or_default();
            let skills: HashMap<String, Vec<String>> =
                serde_json::from_str(&skills_str).unwrap_or_default();
            let prompts: HashMap<String, String> =
                serde_json::from_str(&prompts_str).unwrap_or_default();

            Ok(ProjectProfile {
                id,
                name,
                description,
                icon,
                is_active,
                providers,
                mcp_servers,
                skills,
                prompts,
                created_at,
                updated_at,
            })
        })
        .map_err(|e| format!("Failed to query active project_profile: {e}"))?;

    if let Some(row) = rows.next() {
        row.map(Some)
            .map_err(|e| format!("Failed to read active project_profile: {e}"))
    } else {
        Ok(None)
    }
}

use crate::database::{lock_conn, Database};

impl Database {
    pub fn get_all_project_profiles(&self) -> Result<Vec<ProjectProfile>, String> {
        let conn = lock_conn!(self.conn);
        get_all(&conn)
    }

    pub fn get_project_profile_by_id(&self, id: &str) -> Result<Option<ProjectProfile>, String> {
        let conn = lock_conn!(self.conn);
        get_by_id(&conn, id)
    }

    pub fn save_project_profile(&self, profile: &ProjectProfile) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        upsert(&conn, profile)
    }

    pub fn delete_project_profile(&self, id: &str) -> Result<bool, String> {
        let conn = lock_conn!(self.conn);
        delete(&conn, id)
    }

    pub fn set_active_project_profile(&self, id: &str) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        set_active(&conn, id)
    }

    #[allow(dead_code)]
    pub fn get_active_project_profile(&self) -> Result<Option<ProjectProfile>, String> {
        let conn = lock_conn!(self.conn);
        get_active(&conn)
    }
}

