use rusqlite::Connection;

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS mcp_servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            server_config TEXT NOT NULL,
            description TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            enabled_claude BOOLEAN NOT NULL DEFAULT 0,
            enabled_codex BOOLEAN NOT NULL DEFAULT 0,
            enabled_gemini BOOLEAN NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS skills (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            directory TEXT NOT NULL,
            repo_owner TEXT,
            repo_name TEXT,
            repo_branch TEXT DEFAULT 'main',
            readme_url TEXT,
            enabled_claude BOOLEAN NOT NULL DEFAULT 0,
            enabled_codex BOOLEAN NOT NULL DEFAULT 0,
            enabled_gemini BOOLEAN NOT NULL DEFAULT 0,
            installed_at INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS skill_repos (
            owner TEXT NOT NULL,
            name TEXT NOT NULL,
            branch TEXT NOT NULL DEFAULT 'main',
            enabled BOOLEAN NOT NULL DEFAULT 1,
            PRIMARY KEY (owner, name)
        );

        CREATE TABLE IF NOT EXISTS prompts (
            id TEXT NOT NULL,
            app_type TEXT NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            description TEXT,
            enabled INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (id, app_type)
        );

        -- 应用配置表（key-value 存储）
        CREATE TABLE IF NOT EXISTS app_configs (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        -- Provider 表
        CREATE TABLE IF NOT EXISTS providers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            app_type TEXT NOT NULL,
            api_key TEXT NOT NULL,
            url TEXT,
            default_sonnet_model TEXT,
            default_opus_model TEXT,
            default_haiku_model TEXT,
            default_reasoning_model TEXT,
            custom_params TEXT,
            settings_config TEXT,
            meta TEXT,
            icon TEXT,
            in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
            description TEXT,
            tags TEXT,
            is_active BOOLEAN NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            last_used INTEGER,
            proxy_config TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        -- 全局代理配置表（单行表）
        CREATE TABLE IF NOT EXISTS global_proxies (
            id TEXT PRIMARY KEY,
            enabled BOOLEAN NOT NULL DEFAULT 0,
            http_proxy TEXT,
            https_proxy TEXT,
            socks5_proxy TEXT,
            no_proxy TEXT,
            updated_at INTEGER NOT NULL
        );

        -- 代理配置表（每个应用独立配置）
        CREATE TABLE IF NOT EXISTS proxy_config (
            app_type TEXT PRIMARY KEY,
            enabled BOOLEAN NOT NULL DEFAULT 0,
            auto_failover_enabled BOOLEAN NOT NULL DEFAULT 0,
            max_retries INTEGER NOT NULL DEFAULT 3,
            streaming_first_byte_timeout INTEGER NOT NULL DEFAULT 60,
            streaming_idle_timeout INTEGER NOT NULL DEFAULT 120,
            non_streaming_timeout INTEGER NOT NULL DEFAULT 600,
            circuit_failure_threshold INTEGER NOT NULL DEFAULT 5,
            circuit_success_threshold INTEGER NOT NULL DEFAULT 2,
            circuit_timeout_seconds INTEGER NOT NULL DEFAULT 60,
            circuit_error_rate_threshold REAL NOT NULL DEFAULT 0.6,
            circuit_min_requests INTEGER NOT NULL DEFAULT 10
        );

        -- 故障转移队列表
        CREATE TABLE IF NOT EXISTS failover_queue (
            app_type TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (app_type, provider_id)
        );

        -- Provider 健康状态表
        CREATE TABLE IF NOT EXISTS provider_health (
            provider_id TEXT NOT NULL,
            app_type TEXT NOT NULL,
            is_healthy BOOLEAN NOT NULL DEFAULT 1,
            consecutive_failures INTEGER NOT NULL DEFAULT 0,
            last_success_at TEXT,
            last_failure_at TEXT,
            last_error TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (provider_id, app_type)
        );
        ",
    )
    .map_err(|e| format!("Failed to create tables: {e}"))
}

/// 幂等迁移：老库补齐新增列
pub fn migrate(conn: &Connection) -> Result<(), String> {
    let has_sort_order: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('providers') WHERE name = 'sort_order'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to inspect providers schema: {e}"))?;

    if !has_sort_order {
        // 按迁移前的展示顺序（名称升序）初始化，避免升级后列表顺序跳变
        conn.execute_batch(
            "ALTER TABLE providers ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
             UPDATE providers SET sort_order = (
                 SELECT COUNT(*) FROM providers p2
                 WHERE p2.name < providers.name
                    OR (p2.name = providers.name AND p2.id < providers.id)
             );",
        )
        .map_err(|e| format!("Failed to add providers.sort_order: {e}"))?;
    }

    Ok(())
}
