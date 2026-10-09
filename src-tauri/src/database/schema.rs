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

        -- 代理请求日志表（用量统计的唯一数据源）
        -- 成本字段用 TEXT 存 Decimal 字符串表示，避免 f64 长期累加的精度漂移；
        -- 聚合查询时才 CAST(... AS REAL)
        CREATE TABLE IF NOT EXISTS proxy_request_logs (
            request_id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            app_type TEXT NOT NULL,
            model TEXT NOT NULL,
            request_model TEXT,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cache_read_tokens INTEGER NOT NULL DEFAULT 0,
            cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
            input_cost_usd TEXT NOT NULL DEFAULT '0',
            output_cost_usd TEXT NOT NULL DEFAULT '0',
            cache_read_cost_usd TEXT NOT NULL DEFAULT '0',
            cache_creation_cost_usd TEXT NOT NULL DEFAULT '0',
            total_cost_usd TEXT NOT NULL DEFAULT '0',
            latency_ms INTEGER NOT NULL,
            first_token_ms INTEGER,
            duration_ms INTEGER,
            status_code INTEGER NOT NULL,
            error_message TEXT,
            session_id TEXT,
            provider_type TEXT,
            is_streaming INTEGER NOT NULL DEFAULT 0,
            cost_multiplier TEXT NOT NULL DEFAULT '1.0',
            created_at INTEGER NOT NULL,
            -- 数据来源：proxy = 代理记账，session_log / codex_session = 会话文件解析
            data_source TEXT,
            -- 思考强度（low / medium / high / xhigh / max …），原样保存客户端给的值；未知为 NULL
            reasoning_effort TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_request_logs_provider
            ON proxy_request_logs(provider_id, app_type);
        CREATE INDEX IF NOT EXISTS idx_request_logs_created_at
            ON proxy_request_logs(created_at);
        CREATE INDEX IF NOT EXISTS idx_request_logs_model
            ON proxy_request_logs(model);
        CREATE INDEX IF NOT EXISTS idx_request_logs_session
            ON proxy_request_logs(session_id);
        CREATE INDEX IF NOT EXISTS idx_request_logs_status
            ON proxy_request_logs(status_code);
        -- 注：idx_request_logs_source 依赖 data_source 列，而该列对旧库
        -- 要靠 migrate() 补齐，因此索引统一在 migrate() 里建 ——
        -- 放进这段会导致旧库升级时「表已存在被跳过、索引却引用不存在的列」而启动失败。

        -- 会话文件扫描进度（增量采集）
        -- 按文件记录已消费到的字节偏移与当时的 size / mtime：下次扫描两者都没变就整文件跳过、
        -- 不打开；变了只从 offset 续读新追加的行。会话 JSONL 是追加写的，这个假设成立；
        -- 文件被截断（size < offset）时从头重扫，重复行靠 request_id 主键 INSERT OR IGNORE 兜底。
        CREATE TABLE IF NOT EXISTS session_scan_files (
            path TEXT PRIMARY KEY,
            size INTEGER NOT NULL,
            mtime_ms INTEGER NOT NULL,
            offset INTEGER NOT NULL DEFAULT 0,
            -- Codex 的思考强度写在每轮开头的 turn_context 里，后续用量行沿用；
            -- 增量续读从中途偏移开始，必须记住上次读到的强度
            last_effort TEXT,
            -- Codex 的模型名同样写在 turn_context 里（token_usage_record 不带 model），
            -- 增量续读时沿用，否则续读到的用量行 model 为空、成本记 0
            last_model TEXT
        );

        -- 模型定价表（USD per 1M tokens，同样用 TEXT 存 Decimal）
        CREATE TABLE IF NOT EXISTS model_pricing (
            model_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            input_cost_per_million TEXT NOT NULL DEFAULT '0',
            output_cost_per_million TEXT NOT NULL DEFAULT '0',
            cache_read_cost_per_million TEXT NOT NULL DEFAULT '0',
            cache_creation_cost_per_million TEXT NOT NULL DEFAULT '0'
        );
        ",
    )
    .map_err(|e| format!("Failed to create tables: {e}"))?;

    seed_model_pricing(conn)
}

/// 预置模型定价（USD per 1M tokens）
///
/// 幂等：`INSERT OR IGNORE`，每次启动增量追加新模型，已有行不覆盖用户编辑。
///
/// 精确 model_id 与前缀键混排 —— `find_model_pricing_row` 先精确匹配、再最长前缀兜底。
/// 同代不同档价差很大（Opus 4 是 15/75，Opus 4.5 起降到 5/25），
/// 只靠前缀会把 4.5/4.6 按 4 的价算，贵 3 倍，所以当代模型必须写全 id。
pub(crate) fn seed_model_pricing(conn: &Connection) -> Result<(), String> {
    // (model_id, display_name, input, output, cache_read, cache_creation)
    // Claude 的 cache_read 约为 input 的 0.1 倍、cache_creation 约 1.25 倍；
    // OpenAI / Gemini 不单独计缓存写入，cache_creation 记 0。
    let pricing_data = [
        // ---- Claude 4.6 / 4.5：精确 id ----
        (
            "claude-opus-4-6-20260206",
            "Claude Opus 4.6",
            "5",
            "25",
            "0.50",
            "6.25",
        ),
        (
            "claude-opus-4-5-20251101",
            "Claude Opus 4.5",
            "5",
            "25",
            "0.50",
            "6.25",
        ),
        (
            "claude-sonnet-4-5-20250929",
            "Claude Sonnet 4.5",
            "3",
            "15",
            "0.30",
            "3.75",
        ),
        (
            "claude-haiku-4-5-20251001",
            "Claude Haiku 4.5",
            "1",
            "5",
            "0.10",
            "1.25",
        ),
        // ---- Claude 4 / 3.5：精确 id ----
        (
            "claude-opus-4-20250514",
            "Claude Opus 4",
            "15",
            "75",
            "1.50",
            "18.75",
        ),
        (
            "claude-opus-4-1-20250805",
            "Claude Opus 4.1",
            "15",
            "75",
            "1.50",
            "18.75",
        ),
        (
            "claude-sonnet-4-20250514",
            "Claude Sonnet 4",
            "3",
            "15",
            "0.30",
            "3.75",
        ),
        (
            "claude-3-5-sonnet-20241022",
            "Claude 3.5 Sonnet",
            "3",
            "15",
            "0.30",
            "3.75",
        ),
        (
            "claude-3-5-haiku-20241022",
            "Claude 3.5 Haiku",
            "0.80",
            "4",
            "0.08",
            "1",
        ),
        // ---- 前缀兜底：未来快照日期 / 未列出的变体 ----
        // 沿用 proxy/usage/calculator.rs 的 builtin_pricing 键
        (
            "claude-opus-4",
            "Claude Opus 4.x",
            "15",
            "75",
            "1.50",
            "18.75",
        ),
        (
            "claude-sonnet-4",
            "Claude Sonnet 4.x",
            "3",
            "15",
            "0.30",
            "3.75",
        ),
        (
            "claude-haiku-4",
            "Claude Haiku 4.x",
            "1",
            "5",
            "0.10",
            "1.25",
        ),
        (
            "claude-3-opus",
            "Claude 3 Opus",
            "15",
            "75",
            "1.50",
            "18.75",
        ),
        (
            "claude-3-sonnet",
            "Claude 3 Sonnet",
            "3",
            "15",
            "0.30",
            "3.75",
        ),
        (
            "claude-3-haiku",
            "Claude 3 Haiku",
            "0.25",
            "1.25",
            "0.03",
            "0.30",
        ),
        // ---- OpenAI ----
        ("gpt-5.2", "GPT-5.2", "1.75", "14", "0.175", "0"),
        ("gpt-5.2-codex", "GPT-5.2 Codex", "1.75", "14", "0.175", "0"),
        ("gpt-5.3-codex", "GPT-5.3 Codex", "1.75", "14", "0.175", "0"),
        ("gpt-5.1", "GPT-5.1", "1.25", "10", "0.125", "0"),
        ("gpt-5.1-codex", "GPT-5.1 Codex", "1.25", "10", "0.125", "0"),
        ("gpt-5", "GPT-5", "1.25", "10", "0.125", "0"),
        ("gpt-5-codex", "GPT-5 Codex", "1.25", "10", "0.125", "0"),
        ("gpt-4o", "GPT-4o", "2.5", "10", "1.25", "0"),
        ("gpt-4o-mini", "GPT-4o mini", "0.15", "0.6", "0.075", "0"),
        // ---- Gemini ----
        (
            "gemini-3-pro-preview",
            "Gemini 3 Pro Preview",
            "2",
            "12",
            "0.2",
            "0",
        ),
        (
            "gemini-3-flash-preview",
            "Gemini 3 Flash Preview",
            "0.5",
            "3",
            "0.05",
            "0",
        ),
        ("gemini-2.5-pro", "Gemini 2.5 Pro", "1.25", "10", "0.125", "0"),
        (
            "gemini-2.5-flash",
            "Gemini 2.5 Flash",
            "0.3",
            "2.5",
            "0.03",
            "0",
        ),
        (
            "gemini-1.5-pro",
            "Gemini 1.5 Pro",
            "1.25",
            "5",
            "0.125",
            "0",
        ),
        (
            "gemini-1.5-flash",
            "Gemini 1.5 Flash",
            "0.075",
            "0.30",
            "0.0075",
            "0",
        ),

        // ---- GPT-5.x effort 变体 ----
        // Codex 的 reasoning effort 会把模型名变成 `gpt-5.2-low` 这类后缀。
        // 虽然前缀兜底能命中 `gpt-5.2`，但显式列出可保证变体独立演进时不会被
        // 上游改价牵连 —— 也让「模型统计」表里出现的是用户真实请求的模型名。
        ("gpt-5.2-low", "GPT-5.2 (low)", "1.75", "14", "0.175", "0"),
        ("gpt-5.2-medium", "GPT-5.2 (medium)", "1.75", "14", "0.175", "0"),
        ("gpt-5.2-high", "GPT-5.2 (high)", "1.75", "14", "0.175", "0"),
        ("gpt-5.2-xhigh", "GPT-5.2 (xhigh)", "1.75", "14", "0.175", "0"),
        ("gpt-5.2-codex-low", "GPT-5.2 Codex (low)", "1.75", "14", "0.175", "0"),
        (
            "gpt-5.2-codex-medium",
            "GPT-5.2 Codex (medium)",
            "1.75",
            "14",
            "0.175",
            "0",
        ),
        (
            "gpt-5.2-codex-high",
            "GPT-5.2 Codex (high)",
            "1.75",
            "14",
            "0.175",
            "0",
        ),
        (
            "gpt-5.2-codex-xhigh",
            "GPT-5.2 Codex (xhigh)",
            "1.75",
            "14",
            "0.175",
            "0",
        ),
        ("gpt-5.1-minimal", "GPT-5.1 (minimal)", "1.25", "10", "0.125", "0"),
        ("gpt-5.1-low", "GPT-5.1 (low)", "1.25", "10", "0.125", "0"),
        ("gpt-5.1-medium", "GPT-5.1 (medium)", "1.25", "10", "0.125", "0"),
        ("gpt-5.1-high", "GPT-5.1 (high)", "1.25", "10", "0.125", "0"),
        ("gpt-5-minimal", "GPT-5 (minimal)", "1.25", "10", "0.125", "0"),
        ("gpt-5-low", "GPT-5 (low)", "1.25", "10", "0.125", "0"),
        ("gpt-5-medium", "GPT-5 (medium)", "1.25", "10", "0.125", "0"),
        ("gpt-5-high", "GPT-5 (high)", "1.25", "10", "0.125", "0"),
        ("gpt-5-codex-low", "GPT-5 Codex (low)", "1.25", "10", "0.125", "0"),

        // ---- 国内模型 ----
        // 中转站上国内模型占比很高，缺这一段会让它们全部落0 成本，
        // 汇总卡直接失真。定价取各家公开报价的常见档位，允许用户在
        // 「模型定价」面板按实际协议自行调整。
        ("deepseek-v3", "DeepSeek V3", "0.27", "1.10", "0.07", "0"),
        ("deepseek-r1", "DeepSeek R1", "0.55", "2.19", "0.14", "0"),
        ("kimi-k2-0905", "Kimi K2", "0.60", "2.50", "0.15", "0"),
        ("kimi-k2-turbo", "Kimi K2 Turbo", "0.80", "1.00", "0", "0"),
        ("glm-4.7", "GLM-4.7", "0.60", "2.20", "0.11", "0"),
        ("glm-4.6", "GLM-4.6", "0.60", "2.20", "0.11", "0"),
        ("qwen3-max", "Qwen3 Max", "1.20", "6.00", "0.30", "0"),
        ("qwen3-coder", "Qwen3 Coder", "0.30", "1.20", "0.075", "0"),

        // ---- 2026 新模型（与参考项目 cc-switch 定价表对齐，成本不再落 0）----
        ("claude-fable-5", "Claude Fable 5", "10", "50", "1.00", "12.50"),
        ("claude-fable-5-1", "Claude Fable 5.1", "10", "50", "0.25", "12.50"),
        ("claude-mythos-5", "Claude Mythos 5", "10", "50", "1.00", "12.50"),
        ("claude-mythos-5-1", "Claude Mythos 5.1", "10", "50", "0.25", "12.50"),
        ("claude-opus-4-6", "Claude Opus 4.6", "5", "25", "0.50", "6.25"),
        ("claude-opus-4-7", "Claude Opus 4.7", "5", "25", "0.50", "6.25"),
        ("claude-opus-4-8", "Claude Opus 4.8", "5", "25", "0.50", "6.25"),
        ("claude-opus-5", "Claude Opus 5", "5", "25", "0.50", "6.25"),
        ("claude-opus-5-5", "Claude Opus 5.5", "4", "20", "0.20", "5"),
        ("claude-sonnet-4-6", "Claude Sonnet 4.6", "3", "15", "0.30", "3.75"),
        ("claude-sonnet-4-6-20260217", "Claude Sonnet 4.6", "3", "15", "0.30", "3.75"),
        ("claude-sonnet-5", "Claude Sonnet 5", "2", "10", "0.20", "2.50"),
        ("codestral-2508", "Codestral", "0.30", "0.90", "0.03", "0"),
        ("codex-mini", "Codex Mini", "0.75", "3", "0.025", "0"),
        ("command-a", "Cohere Command A", "2.50", "10", "0", "0"),
        ("command-r", "Cohere Command R", "0.15", "0.60", "0", "0"),
        ("command-r-plus", "Cohere Command R+", "2.50", "10", "0", "0"),
        ("deepseek-chat", "DeepSeek Chat", "0.44", "1.32", "0.014", "0"),
        ("deepseek-flash", "DeepSeek V4.1 Flash", "0.3", "1.2", "0.006", "0"),
        ("deepseek-reasoner", "DeepSeek Reasoner", "0.44", "1.32", "0.014", "0"),
        ("deepseek-v3.1", "DeepSeek V3.1", "0.55", "1.67", "0.055", "0"),
        ("deepseek-v3.2", "DeepSeek V3.2", "0.28", "0.42", "0.028", "0"),
        ("deepseek-v4-flash", "DeepSeek V4 Flash", "0.3", "1.2", "0.006", "0"),
        ("deepseek-v4-flash-0731", "DeepSeek V4 Flash", "0.3", "1.2", "0.006", "0"),
        ("deepseek-v4-flash-vision-exp", "DeepSeek V4 Flash Vision Exp", "0.3", "1.2", "0.006", "0"),
        ("deepseek-v4-pro", "DeepSeek V4 Pro", "1.32", "3.96", "0.044", "0"),
        ("devstral-2-2512", "Devstral 2", "0.40", "2", "0.04", "0"),
        ("devstral-medium", "Devstral Medium", "0.40", "2", "0.04", "0"),
        ("devstral-small-1.1", "Devstral Small 1.1", "0.07", "0.28", "0.01", "0"),
        ("devstral-small-2-2512", "Devstral Small 2", "0.10", "0.30", "0.01", "0"),
        ("doubao-seed-2-0-code", "Doubao Seed 2.0 Code", "0.47", "2.37", "0.09", "0"),
        ("doubao-seed-2-0-code-preview-latest", "Doubao Seed 2.0 Code Preview", "0.47", "2.37", "0.09", "0"),
        ("doubao-seed-2-0-lite", "Doubao Seed 2.0 Lite", "0.08", "0.50", "0.017", "0"),
        ("doubao-seed-2-0-mini", "Doubao Seed 2.0 Mini", "0.03", "0.31", "0.0056", "0"),
        ("doubao-seed-2-0-pro", "Doubao Seed 2.0 Pro", "0.47", "2.37", "0.09", "0"),
        ("doubao-seed-2-1-pro", "Doubao Seed 2.1 Pro", "0.84", "4.2", "0.17", "0"),
        ("doubao-seed-2-1-turbo", "Doubao Seed 2.1 Turbo", "0.42", "2.1", "0.08", "0"),
        ("doubao-seed-code", "Doubao Seed Code", "0.17", "1.11", "0.02", "0"),
        ("gemini-2.0-flash", "Gemini 2.0 Flash", "0.10", "0.40", "0.025", "0"),
        ("gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite", "0.10", "0.40", "0.01", "0"),
        ("gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite", "0.25", "1.50", "0.025", "0"),
        ("gemini-3.1-flash-lite-preview", "Gemini 3.1 Flash Lite Preview", "0.25", "1.50", "0.025", "0"),
        ("gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", "2", "12", "0.20", "0"),
        ("gemini-3.5-flash", "Gemini 3.5 Flash", "1.50", "9.00", "0.15", "0"),
        ("gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite", "0.30", "2.50", "0.03", "0"),
        ("gemini-3.6-flash", "Gemini 3.6 Flash", "0.75", "3.75", "0.075", "0"),
        ("gemini-3.7-flash", "Gemini 3.7 Flash", "0.75", "3.75", "0.075", "0"),
        ("gemini-3.8-flash", "Gemini 3.8 Flash", "0.75", "3.75", "0.075", "0"),
        ("glm-5", "GLM-5", "1", "3.2", "0.2", "0"),
        ("glm-5-turbo", "GLM-5-Turbo", "1.2", "4", "0.24", "0"),
        ("glm-5.1", "GLM-5.1", "1.4", "4.4", "0.26", "0"),
        ("glm-5.2", "GLM-5.2", "1.4", "4.4", "0.26", "0"),
        ("glm-5.3", "GLM-5.3", "1.4", "4.4", "0.26", "0"),
        ("glm-5.3-flash", "GLM-5.3-Flash", "0.15", "0.50", "0.03", "0"),
        ("glm-5.3-flashx", "GLM-5.3-FlashX", "0.37", "1.25", "0.075", "0"),
        ("glm-5v-turbo", "GLM-5V-Turbo", "1.2", "4", "0.24", "0"),
        ("gpt-4.1", "GPT-4.1", "2", "8", "0.50", "0"),
        ("gpt-4.1-mini", "GPT-4.1 Mini", "0.40", "1.60", "0.10", "0"),
        ("gpt-4.1-nano", "GPT-4.1 Nano", "0.10", "0.40", "0.025", "0"),
        ("gpt-5-codex-high", "GPT-5 Codex", "1.25", "10", "0.125", "0"),
        ("gpt-5-codex-medium", "GPT-5 Codex", "1.25", "10", "0.125", "0"),
        ("gpt-5-codex-mini", "GPT-5 Codex", "1.25", "10", "0.125", "0"),
        ("gpt-5-codex-mini-high", "GPT-5 Codex", "1.25", "10", "0.125", "0"),
        ("gpt-5-codex-mini-medium", "GPT-5 Codex", "1.25", "10", "0.125", "0"),
        ("gpt-5-mini", "GPT-5 Mini", "0.25", "2", "0.025", "0"),
        ("gpt-5-nano", "GPT-5 Nano", "0.05", "0.40", "0.005", "0"),
        ("gpt-5.1-codex-max", "GPT-5.1 Codex", "1.25", "10", "0.125", "0"),
        ("gpt-5.1-codex-max-high", "GPT-5.1 Codex", "1.25", "10", "0.125", "0"),
        ("gpt-5.1-codex-max-xhigh", "GPT-5.1 Codex", "1.25", "10", "0.125", "0"),
        ("gpt-5.1-codex-mini", "GPT-5.1 Codex", "1.25", "10", "0.125", "0"),
        ("gpt-5.2-pro", "GPT-5.2 Pro", "21", "168", "0", "0"),
        ("gpt-5.3-codex-high", "GPT-5.3 Codex", "1.75", "14", "0.175", "0"),
        ("gpt-5.3-codex-low", "GPT-5.3 Codex", "1.75", "14", "0.175", "0"),
        ("gpt-5.3-codex-medium", "GPT-5.3 Codex", "1.75", "14", "0.175", "0"),
        ("gpt-5.3-codex-spark", "GPT-5.3 Codex Spark", "1.75", "14", "0.175", "0"),
        ("gpt-5.3-codex-xhigh", "GPT-5.3 Codex", "1.75", "14", "0.175", "0"),
        ("gpt-5.4", "GPT-5.4", "2.50", "15", "0.25", "0"),
        ("gpt-5.4-mini", "GPT-5.4 Mini", "0.75", "4.50", "0.075", "0"),
        ("gpt-5.4-nano", "GPT-5.4 Nano", "0.20", "1.25", "0.02", "0"),
        ("gpt-5.4-pro", "GPT-5.4 Pro", "30", "180", "0", "0"),
        ("gpt-5.5", "GPT-5.5", "5", "30", "0.50", "0"),
        ("gpt-5.5-high", "GPT-5.5", "5", "30", "0.50", "0"),
        ("gpt-5.5-low", "GPT-5.5", "5", "30", "0.50", "0"),
        ("gpt-5.5-medium", "GPT-5.5", "5", "30", "0.50", "0"),
        ("gpt-5.5-minimal", "GPT-5.5", "5", "30", "0.50", "0"),
        ("gpt-5.5-pro", "GPT-5.5 Pro", "30", "180", "0", "0"),
        ("gpt-5.5-xhigh", "GPT-5.5", "5", "30", "0.50", "0"),
        ("gpt-5.6", "GPT-5.6 Sol", "4", "20", "0.40", "5"),
        ("gpt-5.6-cyber", "GPT-5.6 Cyber", "12.50", "75", "1.25", "15.625"),
        ("gpt-5.6-high", "GPT-5.6 Sol", "4", "20", "0.40", "5"),
        ("gpt-5.6-low", "GPT-5.6 Sol", "4", "20", "0.40", "5"),
        ("gpt-5.6-luna", "GPT-5.6 Luna", "0.20", "1.20", "0.02", "0.25"),
        ("gpt-5.6-medium", "GPT-5.6 Sol", "4", "20", "0.40", "5"),
        ("gpt-5.6-minimal", "GPT-5.6 Sol", "4", "20", "0.40", "5"),
        ("gpt-5.6-sol", "GPT-5.6 Sol", "4", "20", "0.40", "5"),
        ("gpt-5.6-terra", "GPT-5.6 Terra", "2", "12", "0.20", "2.50"),
        ("gpt-5.6-xhigh", "GPT-5.6 Sol", "4", "20", "0.40", "5"),
        ("gpt-6-astra", "GPT-6 Astra", "10", "50", "1", "12.5"),
        ("gpt-6-luna", "GPT-6 Luna", "0.10", "0.50", "0.01", "0.125"),
        ("gpt-6-sol", "GPT-6 Sol", "2", "10", "0.20", "2.50"),
        ("gpt-6.1-sol", "GPT-6.1 Sol", "2", "10", "0.10", "2.50"),
        ("grok-3", "Grok 3", "3", "15", "0.75", "0"),
        ("grok-3-mini", "Grok 3 Mini", "0.25", "0.50", "0.075", "0"),
        ("grok-4", "Grok 4", "3", "15", "0.75", "0"),
        ("grok-4-1-fast-non-reasoning", "Grok 4.1 Fast", "0.20", "0.50", "0.05", "0"),
        ("grok-4-1-fast-reasoning", "Grok 4.1 Fast Reasoning", "0.20", "0.50", "0.05", "0"),
        ("grok-4.20-0309-non-reasoning", "Grok 4.20", "1.25", "2.50", "0.20", "0"),
        ("grok-4.20-0309-reasoning", "Grok 4.20 Reasoning", "1.25", "2.50", "0.20", "0"),
        ("grok-4.3", "Grok 4.3", "1.25", "2.50", "0.20", "0"),
        ("grok-4.5", "Grok 4.5", "2", "6", "0.30", "0"),
        ("grok-4.5-build", "Grok 4.5 Build", "2", "6", "0.30", "0"),
        ("grok-4.6", "Grok 4.6", "2", "6", "0.50", "0"),
        ("grok-4.7", "Grok 4.7", "2", "6", "0.50", "0"),
        ("grok-build-0.1", "Grok Build 0.1", "1", "2", "0.20", "0"),
        ("grok-code-fast-1", "Grok Build 0.1 (Code Fast Alias)", "1", "2", "0.20", "0"),
        ("hunyuan-hy3", "Hunyuan Hy3", "0.14", "0.56", "0.035", "0"),
        ("hy3", "Hunyuan Hy3", "0.14", "0.56", "0.035", "0"),
        ("hy4-preview", "Hunyuan Hy4 Preview", "0.84", "2.52", "0.042", "0"),
        ("k3", "Kimi K3", "3.00", "15.00", "0.30", "0"),
        ("kimi-k2-thinking", "Kimi K2 Thinking", "0.55", "2.20", "0.10", "0"),
        ("kimi-k2.5", "Kimi K2.5", "0.60", "3.00", "0.10", "0"),
        ("kimi-k2.6", "Kimi K2.6", "0.95", "4.00", "0.16", "0"),
        ("kimi-k2.7-code", "Kimi K2.7 Code", "0.95", "4.00", "0.19", "0"),
        ("kimi-k2.7-code-highspeed", "Kimi K2.7 Code HighSpeed", "1.90", "8.00", "0.38", "0"),
        ("kimi-k3", "Kimi K3", "3.00", "15.00", "0.30", "0"),
        ("magistral-medium", "Magistral Medium", "2", "5", "0", "0"),
        ("magistral-small", "Magistral Small", "0.50", "1.50", "0", "0"),
        ("mimo-v2-flash", "MiMo V2 Flash", "0.09", "0.29", "0.009", "0"),
        ("mimo-v2-pro", "MiMo V2 Pro", "0.435", "0.87", "0.0036", "0"),
        ("mimo-v2.5", "MiMo V2.5", "0.14", "0.28", "0.0028", "0"),
        ("mimo-v2.5-pro", "MiMo V2.5 Pro", "0.435", "0.87", "0.0036", "0"),
        ("mimo-v2.6-flash", "MiMo V2.6 Flash", "0.14", "0.28", "0.0028", "0"),
        ("mimo-v2.6-pro", "MiMo V2.6 Pro", "0.435", "0.87", "0.0036", "0"),
        ("mimo-v2.6-pro-ultraspeed", "MiMo V2.6 Pro UltraSpeed", "4.35", "8.7", "0.036", "0"),
        ("minimax-m2", "MiniMax M2", "0.30", "1.20", "0.03", "0.375"),
        ("minimax-m2.1", "MiniMax M2.1", "0.30", "1.20", "0.03", "0.375"),
        ("minimax-m2.1-lightning", "MiniMax M2.1 Lightning", "0.27", "2.33", "0.03", "0"),
        ("minimax-m2.5", "MiniMax M2.5", "0.30", "1.20", "0.03", "0.375"),
        ("minimax-m2.5-lightning", "MiniMax M2.5 Lightning", "0.30", "2.40", "0.03", "0"),
        ("minimax-m2.7", "MiniMax M2.7", "0.30", "1.20", "0.06", "0.375"),
        ("minimax-m2.7-highspeed", "MiniMax M2.7 Highspeed", "0.60", "2.40", "0.06", "0.375"),
        ("minimax-m3", "MiniMax M3", "0.30", "1.20", "0.06", "0"),
        ("mistral-large-3-2512", "Mistral Large 3", "0.50", "1.50", "0.05", "0"),
        ("mistral-medium-3.1", "Mistral Medium 3.1", "0.40", "2", "0.04", "0"),
        ("mistral-medium-3.5", "Mistral Medium 3.5", "1.50", "7.50", "0", "0"),
        ("mistral-small-3.2-24b", "Mistral Small 3.2", "0.075", "0.20", "0.01", "0"),
        ("mistral-small-4", "Mistral Small 4", "0.10", "0.30", "0.01", "0"),
        ("o1", "OpenAI o1", "15", "60", "7.50", "0"),
        ("o1-mini", "OpenAI o1-mini", "0.55", "2.20", "0.55", "0"),
        ("o3", "OpenAI o3", "2", "8", "0.50", "0"),
        ("o3-mini", "OpenAI o3-mini", "1.10", "4.40", "0.55", "0"),
        ("o3-pro", "OpenAI o3-pro", "20", "80", "0", "0"),
        ("o4-mini", "OpenAI o4-mini", "1.10", "4.40", "0.275", "0"),
        ("qwen3-235b-a22b", "Qwen3 235B-A22B", "0.70", "8.40", "0", "0"),
        ("qwen3-32b", "Qwen3 32B", "0.16", "0.64", "0", "0"),
        ("qwen3-coder-480b", "Qwen3 Coder 480B", "0.65", "3.25", "0", "0"),
        ("qwen3-coder-480b-a35b-instruct", "Qwen3 Coder 480B-A35B Instruct", "0.65", "3.25", "0", "0"),
        ("qwen3-coder-flash", "Qwen3 Coder Flash", "0.195", "0.975", "0.039", "0"),
        ("qwen3-coder-next", "Qwen3 Coder Next", "0.12", "0.75", "0", "0"),
        ("qwen3-coder-plus", "Qwen3 Coder Plus", "0.65", "3.25", "0.13", "0"),
        ("qwen3.5-plus", "Qwen3.5 Plus", "0.26", "1.56", "0.052", "0"),
        ("qwen3.6-flash", "Qwen3.6 Flash", "0.1875", "1.125", "0.0375", "0"),
        ("qwen3.6-plus", "Qwen3.6 Plus", "0.325", "1.95", "0.065", "0"),
        ("qwen3.7-max", "Qwen3.7 Max", "2.50", "7.50", "0.25", "0"),
        ("qwen3.7-plus", "Qwen3.7 Plus", "0.40", "1.60", "0.08", "0"),
        ("qwen3.8-2.4t-a95b", "Qwen3.8 2.4T A95B", "2", "6", "0.25", "2.50"),
        ("qwen3.8-27b", "Qwen3.8 27B", "0.50", "3", "0.10", "0.625"),
        ("qwen3.8-flash", "Qwen3.8 Flash", "0.15", "0.47", "0.016", "0.20"),
        ("qwen3.8-max", "Qwen3.8 Max", "2", "6", "0.25", "2.50"),
        ("qwq-32b", "QwQ 32B", "0.20", "0.60", "0", "0"),
        ("qwq-plus", "QwQ Plus", "0.80", "2.40", "0", "0"),
        ("step-3.5-flash", "Step 3.5 Flash", "0.10", "0.30", "0.02", "0"),
        ("step-3.5-flash-2603", "Step 3.5 Flash 2603", "0.10", "0.30", "0.02", "0"),
        ("step-3.7-flash", "Step 3.7 Flash", "0.19", "1.13", "0.04", "0"),
        ("step-5-preview", "Step 5 Preview", "0.98", "2.80", "0.05", "0"),
    ];

    for (model_id, display_name, input, output, cache_read, cache_creation) in pricing_data {
        conn.execute(
            "INSERT OR IGNORE INTO model_pricing (
                model_id, display_name, input_cost_per_million, output_cost_per_million,
                cache_read_cost_per_million, cache_creation_cost_per_million
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                model_id,
                display_name,
                input,
                output,
                cache_read,
                cache_creation
            ],
        )
        .map_err(|e| format!("Failed to seed model_pricing for {model_id}: {e}"))?;
    }

    Ok(())
}

/// 幂等迁移：老库补齐新增列
/// 表是否存在
fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to inspect sqlite_master: {e}"))
}

/// 表里是否已有某列
fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    conn.query_row(
        &format!("SELECT COUNT(*) > 0 FROM pragma_table_info('{table}') WHERE name = ?1"),
        [column],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to inspect {table} schema: {e}"))
}

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

    // proxy_request_logs.data_source —— 区分「代理记账」与「会话文件解析」
    //
    // 早期版本的表没有这一列，来源信息混在 provider_id 里（`_session`）。
    // 补列后新增的写入会带上明确来源，历史行保持 NULL 表示来自代理。
    let has_data_source: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('proxy_request_logs') WHERE name = 'data_source'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to inspect proxy_request_logs schema: {e}"))?;

    if !has_data_source {
        conn.execute_batch("ALTER TABLE proxy_request_logs ADD COLUMN data_source TEXT;")
            .map_err(|e| format!("Failed to add proxy_request_logs.data_source: {e}"))?;
    }

    // 迁移不假设表一定存在：生产路径先 create_tables 再 migrate，但只跑迁移的旧库测试没有这张表
    let has_scan_table = table_exists(conn, "session_scan_files")?;

    // session_scan_files.last_effort —— Codex 增量续读时沿用的思考强度
    if has_scan_table && !column_exists(conn, "session_scan_files", "last_effort")? {
        conn.execute_batch("ALTER TABLE session_scan_files ADD COLUMN last_effort TEXT;")
            .map_err(|e| format!("Failed to add session_scan_files.last_effort: {e}"))?;
    }

    // session_scan_files.last_model —— Codex 增量续读时沿用的模型名
    //
    // 补列后清空扫描进度：让 Codex 会话文件重扫一遍，把历史行（model 为空）回填上模型名，
    // 否则旧库里的 codex_session 行永远 model 为空、成本记 0。
    if has_scan_table && !column_exists(conn, "session_scan_files", "last_model")? {
        conn.execute_batch("ALTER TABLE session_scan_files ADD COLUMN last_model TEXT;")
            .map_err(|e| format!("Failed to add session_scan_files.last_model: {e}"))?;
        conn.execute_batch("DELETE FROM session_scan_files;")
            .map_err(|e| format!("Failed to reset session scan state for last_model: {e}"))?;
    }

    // proxy_request_logs.reasoning_effort —— 思考强度
    //
    // 补列后清空扫描进度：会话文件全部重扫一遍，把已入库历史行的思考强度回填上
    // （插入按主键忽略重复，只回填 NULL 的 reasoning_effort，不会重复记账）。
    if !column_exists(conn, "proxy_request_logs", "reasoning_effort")? {
        conn.execute_batch("ALTER TABLE proxy_request_logs ADD COLUMN reasoning_effort TEXT;")
            .map_err(|e| format!("Failed to add proxy_request_logs.reasoning_effort: {e}"))?;
        if has_scan_table {
            conn.execute_batch("DELETE FROM session_scan_files;")
                .map_err(|e| format!("Failed to reset session scan state: {e}"))?;
        }
    }

    // 会话日志的耗时估算（latency_ms）也是后加的：旧库里的会话行 latency_ms 仍为 0。
    // 扫描是增量的（游标已在文件末尾，不会重读旧行），必须清一次扫描进度让它重扫回填。
    //
    // 用迁移版本号（PRAGMA user_version）做一次性标记：其他迁移靠「列是否存在」判断，
    // 这个改动没有对应新列可依赖；若靠数据特征（如 latency_ms = 0 的会话行数）判断，
    // 会在本就估不出耗时的行上反复触发全量重扫。
    const SESSION_TIMING_RESCAN_VERSION: i64 = 1;
    let migration_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| format!("Failed to read user_version: {e}"))?;
    if migration_version < SESSION_TIMING_RESCAN_VERSION {
        if has_scan_table {
            conn.execute_batch("DELETE FROM session_scan_files;")
                .map_err(|e| format!("Failed to reset session scan state for latency: {e}"))?;
        }
        conn.execute_batch(&format!("PRAGMA user_version = {SESSION_TIMING_RESCAN_VERSION};"))
            .map_err(|e| format!("Failed to set user_version: {e}"))?;
    }

    // 索引放在迁移里建（而不是 create_tables）：
    // 旧库的 CREATE TABLE IF NOT EXISTS 会整段跳过，
    // 若索引写在建表批次里就会引用到尚未补齐的列，导致启动直接失败。
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_request_logs_source
            ON proxy_request_logs(data_source);",
    )
    .map_err(|e| format!("Failed to create idx_request_logs_source: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 回归测试：旧库升级不能崩。
    ///
    /// 曾经的 bug：`data_source` 列要靠 migrate 补齐，但索引写在
    /// `create_tables` 批次里 —— 旧库走 `CREATE TABLE IF NOT EXISTS` 时
    /// 建表整段被跳过，索引却引用了尚不存在的列，导致应用启动即panic。
    #[test]
    fn migrate_upgrades_legacy_table_without_data_source() {
        let conn = Connection::open_in_memory().unwrap();

        // 复刻旧版表结构：没有 data_source 列
        conn.execute_batch(&format!(
            "CREATE TABLE proxy_request_logs ({cols}
             );
             CREATE TABLE providers (
                id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL
             );",
            cols = REAL_LEGACY_COLUMNS
        ))
        .unwrap();

        migrate(&conn).expect("旧库升级不应失败");

        let cols: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('proxy_request_logs') WHERE name = 'data_source'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cols, 1, "data_source 列应被补齐");

        // 索引也必须存在 —— 验证它真的被创建了
        let idx: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_request_logs_source'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx, 1, "data_source 索引应被创建");
    }

    /// 旧库没有思考强度列：迁移补齐两列，并清空扫描进度以触发重扫回填
    #[test]
    fn migrate_adds_reasoning_effort_and_resets_scan_state() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        migrate(&conn).unwrap();
        // 退回到「没有这三列」的旧结构
        conn.execute_batch(
            "ALTER TABLE proxy_request_logs DROP COLUMN reasoning_effort;
             ALTER TABLE session_scan_files DROP COLUMN last_effort;
             ALTER TABLE session_scan_files DROP COLUMN last_model;
             INSERT INTO session_scan_files (path, size, mtime_ms, offset) VALUES ('a', 1, 1, 1);",
        )
        .unwrap();

        migrate(&conn).unwrap();

        assert!(column_exists(&conn, "proxy_request_logs", "reasoning_effort").unwrap());
        assert!(column_exists(&conn, "session_scan_files", "last_effort").unwrap());
        assert!(column_exists(&conn, "session_scan_files", "last_model").unwrap());
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM session_scan_files", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "补列后应清空扫描进度，让会话文件重扫回填");

        // 再跑一次：列已存在，不应再清空
        conn.execute_batch(
            "INSERT INTO session_scan_files (path, size, mtime_ms, offset) VALUES ('b', 1, 1, 1);",
        )
        .unwrap();
        migrate(&conn).unwrap();
        let kept: i64 = conn
            .query_row("SELECT COUNT(*) FROM session_scan_files", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kept, 1, "迁移幂等：列已存在时不能再清扫描进度");
    }

    /// 会话日志耗时（latency_ms）回填：首次迁移清一次扫描进度触发重扫，之后不再清
    #[test]
    fn migrate_resets_scan_state_once_for_session_timing() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        // 模拟旧库：文件都扫过（有扫描进度），迁移版本号还是 0
        conn.execute_batch(
            "INSERT INTO session_scan_files (path, size, mtime_ms, offset) VALUES ('a', 1, 1, 1);",
        )
        .unwrap();

        migrate(&conn).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM session_scan_files", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "首次迁移应清空扫描进度，让会话文件重扫回填耗时");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 1, "迁移版本号应被标记");

        // 重扫后又写回进度：再迁移不应再清（一次性）
        conn.execute_batch(
            "INSERT INTO session_scan_files (path, size, mtime_ms, offset) VALUES ('b', 1, 1, 1);",
        )
        .unwrap();
        migrate(&conn).unwrap();
        let kept: i64 = conn
            .query_row("SELECT COUNT(*) FROM session_scan_files", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kept, 1, "迁移只应清一次扫描进度");
    }

    /// 全新库：建表已含 data_source，迁移必须幂等不报错
    #[test]
    fn migrate_is_idempotent_on_fresh_schema() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).expect("建表失败");
        migrate(&conn).expect("首次迁移失败");
        migrate(&conn).expect("重复迁移应无副作用");
    }

    /// 索引不能留在 create_tables 里 —— 否则旧库升级时引用不到列
    #[test]
    fn create_tables_does_not_reference_data_source_index() {
        let conn = Connection::open_in_memory().unwrap();
        // 复刻真实旧表：只有 data_source 缺失，其余列齐全
        conn.execute_batch(&format!(
            "CREATE TABLE proxy_request_logs ({cols}-- 没有 data_source
             );
             CREATE TABLE providers (
                id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL
             );",
            cols = REAL_LEGACY_COLUMNS
        ))
        .unwrap();

        create_tables(&conn).expect("旧库上跑 create_tables 不应失败");
    }

    /// 旧版 `proxy_request_logs` 的真实列定义（缺 data_source）
    const REAL_LEGACY_COLUMNS: &str = "
                request_id TEXT PRIMARY KEY,
                provider_id TEXT NOT NULL,
                app_type TEXT NOT NULL,
                model TEXT NOT NULL,
                request_model TEXT,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                cache_read_tokens INTEGER NOT NULL DEFAULT 0,
                cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
                input_cost_usd TEXT NOT NULL DEFAULT '0',
                output_cost_usd TEXT NOT NULL DEFAULT '0',
                cache_read_cost_usd TEXT NOT NULL DEFAULT '0',
                cache_creation_cost_usd TEXT NOT NULL DEFAULT '0',
                total_cost_usd TEXT NOT NULL DEFAULT '0',
                latency_ms INTEGER NOT NULL,
                first_token_ms INTEGER,
                duration_ms INTEGER,
                status_code INTEGER NOT NULL,
                error_message TEXT,
                session_id TEXT,
                provider_type TEXT,
                is_streaming INTEGER NOT NULL DEFAULT 0,
                cost_multiplier TEXT NOT NULL DEFAULT '1.0',
                created_at INTEGER NOT NULL
    ";
}
