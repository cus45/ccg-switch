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

        -- 工作空间表
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            root_path TEXT NOT NULL,
            normalized_path TEXT NOT NULL UNIQUE,
            git_root TEXT,
            origin_url TEXT,
            description TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            color TEXT,
            icon TEXT,
            default_app_type TEXT,
            default_provider_id TEXT,
            permission_policy TEXT,
            terminal_policy TEXT,
            metadata TEXT NOT NULL DEFAULT '{}',
            is_favorite BOOLEAN NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_opened_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_workspaces_last_opened_at
            ON workspaces(last_opened_at);

        -- 工作空间能力绑定表
        CREATE TABLE IF NOT EXISTS workspace_bindings (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            binding_type TEXT NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT 1,
            priority INTEGER NOT NULL DEFAULT 0,
            config TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(workspace_id, target_type, target_id, binding_type),
            FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_workspace_bindings_workspace_id
            ON workspace_bindings(workspace_id);

        -- Workspace automation 配置表（只存配置，不负责执行）
        CREATE TABLE IF NOT EXISTS workspace_automations (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            title TEXT NOT NULL,
            prompt TEXT NOT NULL,
            schedule TEXT NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT 0,
            memory_path TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_workspace_automations_workspace_id
            ON workspace_automations(workspace_id);

        CREATE INDEX IF NOT EXISTS idx_workspace_automations_enabled
            ON workspace_automations(enabled);

        -- 动态能力注册表：兼容 MCP / skill / prompt / automation 等能力来源
        CREATE TABLE IF NOT EXISTS capabilities (
            id TEXT PRIMARY KEY,
            capability_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(capability_type, source_id)
        );

        CREATE INDEX IF NOT EXISTS idx_capabilities_type_source
            ON capabilities(capability_type, source_id);

        -- 动态能力绑定表：target 可扩展为 app / workspace / provider / model_adapter
        CREATE TABLE IF NOT EXISTS capability_bindings (
            id TEXT PRIMARY KEY,
            capability_id TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            binding_type TEXT NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT 1,
            priority INTEGER NOT NULL DEFAULT 0,
            config TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(capability_id, target_type, target_id, binding_type),
            FOREIGN KEY(capability_id) REFERENCES capabilities(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_capability_bindings_capability_id
            ON capability_bindings(capability_id);

        CREATE INDEX IF NOT EXISTS idx_capability_bindings_target
            ON capability_bindings(target_type, target_id);

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
            proxy_config TEXT
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
