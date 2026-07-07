use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub mod backup;
pub mod dao;
mod schema;

pub struct Database {
    pub(crate) conn: Mutex<Connection>,
}

macro_rules! lock_conn {
    ($mutex:expr) => {
        $mutex
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?
    };
}
pub(crate) use lock_conn;

impl Database {
    /// 生产环境初始化，数据库在 ~/.ccg-switch/ccg-switch.db
    pub fn init() -> Result<Self, String> {
        let db_path = Self::get_db_path()?;
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create db directory: {e}"))?;
        }

        let conn =
            Connection::open(&db_path).map_err(|e| format!("Failed to open database: {e}"))?;

        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| format!("Failed to enable foreign keys: {e}"))?;

        let db = Self {
            conn: Mutex::new(conn),
        };

        db.create_tables()?;
        db.init_default_skill_repos()?;

        Ok(db)
    }

    fn get_db_path() -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or_else(|| "Home directory not found".to_string())?;
        Ok(home.join(".ccg-switch").join("ccg-switch.db"))
    }

    fn create_tables(&self) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        schema::create_tables(&conn)?;
        schema::migrate(&conn)
    }

    #[cfg(test)]
    pub(crate) fn in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("Failed to open in-memory database: {e}"))?;

        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| format!("Failed to enable foreign keys: {e}"))?;

        let db = Self {
            conn: Mutex::new(conn),
        };

        db.create_tables()?;
        db.init_default_skill_repos()?;

        Ok(db)
    }

    /// 首次启动时插入默认 skill 仓库，并修正已知仓库的分支名
    fn init_default_skill_repos(&self) -> Result<(), String> {
        let conn = lock_conn!(self.conn);

        let defaults = [
            ("anthropics", "skills", "main"),
            ("ComposioHQ", "awesome-claude-skills", "master"),
            ("cexll", "myclaude", "master"),
            ("JimLiu", "baoyu-skills", "main"),
        ];

        for (owner, name, branch) in &defaults {
            // 检查是否已存在
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM skill_repos WHERE owner = ?1 AND name = ?2",
                    rusqlite::params![owner, name],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if !exists {
                // 不存在则插入
                conn.execute(
                    "INSERT INTO skill_repos (owner, name, branch, enabled) VALUES (?1, ?2, ?3, 1)",
                    rusqlite::params![owner, name, branch],
                )
                .map_err(|e| format!("Failed to insert default skill repo: {e}"))?;
            } else {
                // 已存在则更新分支名（修正历史错误，如 main -> master）
                conn.execute(
                    "UPDATE skill_repos SET branch = ?3 WHERE owner = ?1 AND name = ?2",
                    rusqlite::params![owner, name, branch],
                )
                .map_err(|e| format!("Failed to update skill repo branch: {e}"))?;
            }
        }

        Ok(())
    }
}
