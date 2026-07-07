use chrono::Local;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::database::{lock_conn, Database};

/// 读取指定 schema（main / backup_src）下某表的列名列表；表不存在时返回空
fn table_columns(
    conn: &rusqlite::Connection,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT name FROM {schema}.pragma_table_info('{table}')"
        ))
        .map_err(|e| format!("Failed to inspect table '{table}': {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to read columns of '{table}': {e}"))?;
    let mut cols = Vec::new();
    for row in rows {
        cols.push(row.map_err(|e| format!("Failed to read column name: {e}"))?);
    }
    Ok(cols)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub filename: String,
    pub size_bytes: u64,
    pub created_at: String, // ISO 8601 格式
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    pub interval_hours: u32,
    pub retain_count: u32,
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            interval_hours: 24, // 默认每 24 小时
            retain_count: 10,   // 默认保留 10 个
        }
    }
}

impl Database {
    /// 获取备份目录路径，不存在则创建
    pub fn get_backups_dir() -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or_else(|| "Home directory not found".to_string())?;
        let dir = home.join(".ccg-switch").join("backups");
        if !dir.exists() {
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("Failed to create backups directory: {e}"))?;
        }
        Ok(dir)
    }

    /// 校验备份文件名，拒绝路径遍历和非 .db 后缀
    pub fn validate_backup_filename(name: &str) -> Result<(), String> {
        if name.contains("..") || name.contains('/') || name.contains('\\') {
            return Err(
                "Invalid backup filename: path traversal characters not allowed".to_string(),
            );
        }
        if !name.ends_with(".db") {
            return Err("Invalid backup filename: must end with .db".to_string());
        }
        if name.is_empty() || name == ".db" {
            return Err("Invalid backup filename: name is too short".to_string());
        }
        Ok(())
    }

    /// 创建数据库备份（使用 VACUUM INTO 做一致性快照）
    pub fn create_db_backup(&self) -> Result<BackupEntry, String> {
        self.create_db_backup_with_prefix("db_backup")
    }

    /// 使用指定前缀创建备份
    fn create_db_backup_with_prefix(&self, prefix: &str) -> Result<BackupEntry, String> {
        let dir = Self::get_backups_dir()?;
        let now = Local::now();
        let filename = format!("{}_{}.db", prefix, now.format("%Y%m%d_%H%M%S"));
        let backup_path = dir.join(&filename);

        let conn = lock_conn!(self.conn);

        // 使用 VACUUM INTO 创建一致性快照（SQLite 3.27+，rusqlite 0.31 bundled 满足）
        let path_str = backup_path
            .to_str()
            .ok_or_else(|| "Backup path contains invalid UTF-8".to_string())?;
        conn.execute_batch(&format!("VACUUM INTO '{}';", path_str.replace('\'', "''")))
            .map_err(|e| format!("Backup failed (VACUUM INTO): {e}"))?;

        let metadata = std::fs::metadata(&backup_path)
            .map_err(|e| format!("Failed to read backup metadata: {e}"))?;

        Ok(BackupEntry {
            filename,
            size_bytes: metadata.len(),
            created_at: now.to_rfc3339(),
        })
    }

    /// 列出所有备份文件，按创建时间降序
    pub fn list_db_backups() -> Result<Vec<BackupEntry>, String> {
        let dir = Self::get_backups_dir()?;
        let mut entries = Vec::new();

        let read_dir = std::fs::read_dir(&dir)
            .map_err(|e| format!("Failed to read backups directory: {e}"))?;

        for entry in read_dir {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.ends_with(".db") {
                        let metadata = std::fs::metadata(&path)
                            .map_err(|e| format!("Failed to read file metadata: {e}"))?;
                        let modified = metadata
                            .modified()
                            .map_err(|e| format!("Failed to read modification time: {e}"))?;
                        let datetime: chrono::DateTime<Local> = modified.into();

                        entries.push(BackupEntry {
                            filename: name.to_string(),
                            size_bytes: metadata.len(),
                            created_at: datetime.to_rfc3339(),
                        });
                    }
                }
            }
        }

        // 按创建时间降序排列（最新在前）
        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(entries)
    }

    /// 从备份恢复数据库，恢复前先创建安全备份
    pub fn restore_db_backup(&self, filename: &str) -> Result<String, String> {
        Self::validate_backup_filename(filename)?;

        let dir = Self::get_backups_dir()?;
        let backup_path = dir.join(filename);
        if !backup_path.exists() {
            return Err(format!("Backup file not found: {filename}"));
        }

        // 恢复前先创建安全备份
        let safety_backup = self.create_db_backup_with_prefix("pre_restore")?;

        // 从备份文件恢复：打开备份数据库，VACUUM INTO 临时文件，然后覆盖当前数据库
        // 由于当前连接持有锁，使用 SQL 方式将备份数据导入
        let conn = lock_conn!(self.conn);

        let backup_path_str = backup_path
            .to_str()
            .ok_or_else(|| "Backup path contains invalid UTF-8".to_string())?;

        // 使用 ATTACH + 逐表恢复的方式
        // 先 ATTACH 备份数据库
        conn.execute_batch(&format!(
            "ATTACH DATABASE '{}' AS backup_src;",
            backup_path_str.replace('\'', "''")
        ))
        .map_err(|e| format!("Failed to attach backup database: {e}"))?;

        // 获取备份数据库中所有用户表
        let table_names: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM backup_src.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
                .map_err(|e| format!("Failed to query backup tables: {e}"))?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| format!("Failed to read backup table names: {e}"))?;
            let mut names = Vec::new();
            for row in rows {
                names.push(row.map_err(|e| format!("Failed to read table name: {e}"))?);
            }
            names
        };

        // 逐表恢复：删除当前表数据，从备份复制
        // 按两侧共有列的交集复制，兼容备份文件与当前库的 schema 列差异（如老备份缺新增列）
        for table in &table_names {
            // 安全检查：表名不应包含特殊字符
            if table.contains('\'') || table.contains('"') || table.contains(';') {
                continue;
            }
            let main_cols = table_columns(&conn, "main", table)?;
            let backup_cols: std::collections::HashSet<String> =
                table_columns(&conn, "backup_src", table)?.into_iter().collect();
            let common: Vec<String> = main_cols
                .into_iter()
                .filter(|c| backup_cols.contains(c))
                .collect();
            if common.is_empty() {
                continue;
            }
            let col_list = common
                .iter()
                .map(|c| format!("\"{c}\""))
                .collect::<Vec<_>>()
                .join(", ");
            conn.execute_batch(&format!(
                "DELETE FROM main.\"{table}\"; INSERT INTO main.\"{table}\" ({col_list}) SELECT {col_list} FROM backup_src.\"{table}\";"
            ))
            .map_err(|e| format!("Failed to restore table '{table}': {e}"))?;
        }

        // 分离备份数据库
        conn.execute_batch("DETACH DATABASE backup_src;")
            .map_err(|e| format!("Failed to detach backup database: {e}"))?;

        Ok(safety_backup.filename)
    }

    /// 删除指定备份文件
    pub fn delete_db_backup(filename: &str) -> Result<(), String> {
        Self::validate_backup_filename(filename)?;
        let dir = Self::get_backups_dir()?;
        let path = dir.join(filename);
        if !path.exists() {
            return Err(format!("Backup file not found: {filename}"));
        }
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete backup file: {e}"))?;
        Ok(())
    }

    /// 重命名备份文件
    pub fn rename_db_backup(old_name: &str, new_name: &str) -> Result<(), String> {
        Self::validate_backup_filename(old_name)?;
        Self::validate_backup_filename(new_name)?;
        let dir = Self::get_backups_dir()?;
        let old_path = dir.join(old_name);
        let new_path = dir.join(new_name);
        if !old_path.exists() {
            return Err(format!("Backup file not found: {old_name}"));
        }
        if new_path.exists() {
            return Err(format!("Target filename already exists: {new_name}"));
        }
        std::fs::rename(&old_path, &new_path)
            .map_err(|e| format!("Failed to rename backup file: {e}"))?;
        Ok(())
    }

    /// 获取备份设置
    pub fn get_backup_settings(&self) -> Result<BackupSettings, String> {
        match self.get_app_config("backup_settings")? {
            Some(json_str) => serde_json::from_str(&json_str)
                .map_err(|e| format!("Failed to parse backup settings: {e}")),
            None => Ok(BackupSettings::default()),
        }
    }

    /// 保存备份设置
    pub fn save_backup_settings(&self, settings: &BackupSettings) -> Result<(), String> {
        let json_str = serde_json::to_string(settings)
            .map_err(|e| format!("Failed to serialize backup settings: {e}"))?;
        self.set_app_config("backup_settings", &json_str)
    }

    /// 定期备份检查：如果距上次备份超过设定间隔则执行备份
    pub fn periodic_backup_if_needed(&self) -> Result<bool, String> {
        let settings = self.get_backup_settings()?;
        let last_run = self.get_app_config("backup_last_run")?;

        let should_backup = match last_run {
            Some(timestamp_str) => {
                let last_ts: i64 = timestamp_str
                    .parse()
                    .map_err(|e| format!("Failed to parse backup_last_run: {e}"))?;
                let last_time = chrono::DateTime::from_timestamp(last_ts, 0)
                    .ok_or_else(|| "Invalid backup_last_run timestamp".to_string())?;
                let elapsed = chrono::Utc::now().signed_duration_since(last_time);
                elapsed.num_hours() >= settings.interval_hours as i64
            }
            None => true, // 从未备份过
        };

        if should_backup {
            self.create_db_backup()?;
            let now_ts = chrono::Utc::now().timestamp().to_string();
            self.set_app_config("backup_last_run", &now_ts)?;

            let dir = Self::get_backups_dir()?;
            Self::cleanup_db_backups(&dir, settings.retain_count as usize)?;

            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// 清理旧备份，保留最新的 retain 个
    fn cleanup_db_backups(dir: &Path, retain: usize) -> Result<(), String> {
        let read_dir =
            std::fs::read_dir(dir).map_err(|e| format!("Failed to read backups directory: {e}"))?;

        let mut files: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
        for entry in read_dir {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.ends_with(".db") {
                        let modified = std::fs::metadata(&path)
                            .and_then(|m| m.modified())
                            .map_err(|e| format!("Failed to read file metadata: {e}"))?;
                        files.push((path, modified));
                    }
                }
            }
        }

        // 按修改时间降序排列（最新在前）
        files.sort_by(|a, b| b.1.cmp(&a.1));

        // 删除超出 retain 数量的最旧文件
        for (path, _) in files.iter().skip(retain) {
            std::fs::remove_file(path).map_err(|e| format!("Failed to delete old backup: {e}"))?;
        }

        Ok(())
    }
}
