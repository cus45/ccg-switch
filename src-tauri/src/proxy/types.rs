#![allow(dead_code)]
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Existing type: ProxyState (kept for backward compatibility)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyState {
    pub running: bool,
    pub port: u16,
    pub host: String,
    #[serde(rename = "requestCount")]
    pub request_count: u64,
    /// 是否处于 Live 接管状态（已改写 CLI 配置指向本地代理）
    #[serde(rename = "takeoverActive", default)]
    pub takeover_active: bool,
    /// 已接管的应用列表（claude / codex / gemini）
    #[serde(rename = "takenOverApps", default)]
    pub taken_over_apps: Vec<String>,
}

impl Default for ProxyState {
    fn default() -> Self {
        Self {
            running: false,
            port: 9876,
            host: "0.0.0.0".to_string(),
            request_count: 0,
            takeover_active: false,
            taken_over_apps: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// ProxyServerConfig (proxy server internal config)
//
// Named "ProxyServerConfig" to avoid collision with models/proxy.rs ProxyConfig
// which is used for the frontend API.
// ---------------------------------------------------------------------------

/// 代理服务器配置（内部使用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyServerConfig {
    /// 监听地址
    pub listen_address: String,
    /// 监听端口
    pub listen_port: u16,
    /// 最大重试次数
    pub max_retries: u8,
    /// 请求超时时间（秒）- 已废弃，保留兼容
    pub request_timeout: u64,
    /// 是否启用日志
    pub enable_logging: bool,
    /// 是否正在接管 Live 配置
    #[serde(default)]
    pub live_takeover_active: bool,
    /// 流式首字超时（秒）- 等待首个数据块的最大时间，范围 1-120 秒，默认 60 秒
    #[serde(default = "default_streaming_first_byte_timeout")]
    pub streaming_first_byte_timeout: u64,
    /// 流式静默超时（秒）- 两个数据块之间的最大间隔，范围 60-600 秒，填 0 禁用
    #[serde(default = "default_streaming_idle_timeout")]
    pub streaming_idle_timeout: u64,
    /// 非流式总超时（秒）- 非流式请求的总超时时间，范围 60-1200 秒，默认 600 秒
    #[serde(default = "default_non_streaming_timeout")]
    pub non_streaming_timeout: u64,
}

fn default_streaming_first_byte_timeout() -> u64 {
    60
}

fn default_streaming_idle_timeout() -> u64 {
    120
}

fn default_non_streaming_timeout() -> u64 {
    600
}

impl Default for ProxyServerConfig {
    fn default() -> Self {
        Self {
            listen_address: "0.0.0.0".to_string(),
            listen_port: 9876,
            max_retries: 3,
            request_timeout: 600,
            enable_logging: true,
            live_takeover_active: false,
            streaming_first_byte_timeout: 60,
            streaming_idle_timeout: 120,
            non_streaming_timeout: 600,
        }
    }
}

// ---------------------------------------------------------------------------
// ProxyStatus
// ---------------------------------------------------------------------------

/// 代理服务器状态
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProxyStatus {
    /// 是否运行中
    pub running: bool,
    /// 监听地址
    pub address: String,
    /// 监听端口
    pub port: u16,
    /// 活跃连接数
    pub active_connections: usize,
    /// 总请求数
    pub total_requests: u64,
    /// 成功请求数
    pub success_requests: u64,
    /// 失败请求数
    pub failed_requests: u64,
    /// 成功率 (0-100)
    pub success_rate: f32,
    /// 运行时间（秒）
    pub uptime_seconds: u64,
    /// 当前使用的 Provider 名称
    pub current_provider: Option<String>,
    /// 当前 Provider 的 ID
    pub current_provider_id: Option<String>,
    /// 最后一次请求时间
    pub last_request_at: Option<String>,
    /// 最后一次错误信息
    pub last_error: Option<String>,
    /// Provider 故障转移次数
    pub failover_count: u64,
    /// 当前活跃的代理目标列表
    #[serde(default)]
    pub active_targets: Vec<ActiveTarget>,
}

// ---------------------------------------------------------------------------
// ActiveTarget
// ---------------------------------------------------------------------------

/// 活跃的代理目标信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveTarget {
    pub app_type: String, // "Claude" | "Codex" | "Gemini"
    pub provider_name: String,
    pub provider_id: String,
}

// ---------------------------------------------------------------------------
// ProxyServerInfo
// ---------------------------------------------------------------------------

/// 代理服务器信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyServerInfo {
    pub address: String,
    pub port: u16,
    pub started_at: String,
}

// ---------------------------------------------------------------------------
// ProxyTakeoverStatus
// ---------------------------------------------------------------------------

/// 各应用的接管状态（是否改写该应用的 Live 配置指向本地代理）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProxyTakeoverStatus {
    pub claude: bool,
    pub codex: bool,
    pub gemini: bool,
    pub opencode: bool,
    pub openclaw: bool,
}

// ---------------------------------------------------------------------------
// ApiFormat
// ---------------------------------------------------------------------------

/// API 格式类型（预留，当前不需要格式转换）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ApiFormat {
    Claude,
    OpenAI,
    Gemini,
}

// ---------------------------------------------------------------------------
// ProviderHealth
// ---------------------------------------------------------------------------

/// Provider 健康状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderHealth {
    pub provider_id: String,
    pub app_type: String,
    pub is_healthy: bool,
    pub consecutive_failures: u32,
    pub last_success_at: Option<String>,
    pub last_failure_at: Option<String>,
    pub last_error: Option<String>,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// LiveBackup
// ---------------------------------------------------------------------------

/// Live 配置备份记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveBackup {
    /// 应用类型 (claude/codex/gemini)
    pub app_type: String,
    /// 原始配置 JSON
    pub original_config: String,
    /// 备份时间
    pub backed_up_at: String,
}

// ---------------------------------------------------------------------------
// GlobalProxyConfig
// ---------------------------------------------------------------------------

/// 全局代理配置（统一字段，三行镜像）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalProxyConfig {
    /// 代理总开关
    pub proxy_enabled: bool,
    /// 监听地址
    pub listen_address: String,
    /// 监听端口
    pub listen_port: u16,
    /// 是否启用日志
    pub enable_logging: bool,
}

// ---------------------------------------------------------------------------
// AppProxyConfig
// ---------------------------------------------------------------------------

/// 应用级代理配置（每个 app 独立）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppProxyConfig {
    /// 应用类型 (claude/codex/gemini)
    pub app_type: String,
    /// 该 app 代理启用开关
    pub enabled: bool,
    /// 该 app 自动故障转移开关
    pub auto_failover_enabled: bool,
    /// 最大重试次数
    pub max_retries: u32,
    /// 流式首字超时（秒）
    pub streaming_first_byte_timeout: u32,
    /// 流式静默超时（秒）
    pub streaming_idle_timeout: u32,
    /// 非流式总超时（秒）
    pub non_streaming_timeout: u32,
    /// 熔断失败阈值
    pub circuit_failure_threshold: u32,
    /// 熔断恢复阈值
    pub circuit_success_threshold: u32,
    /// 熔断恢复等待时间（秒）
    pub circuit_timeout_seconds: u32,
    /// 错误率阈值
    pub circuit_error_rate_threshold: f64,
    /// 计算错误率的最小请求数
    pub circuit_min_requests: u32,
}

impl AppProxyConfig {
    /// 返回指定 app_type 的默认配置
    pub fn default_for(app_type: &str) -> Self {
        Self {
            app_type: app_type.to_string(),
            enabled: false,
            auto_failover_enabled: false,
            max_retries: 3,
            streaming_first_byte_timeout: 60,
            streaming_idle_timeout: 120,
            non_streaming_timeout: 600,
            circuit_failure_threshold: 5,
            circuit_success_threshold: 2,
            circuit_timeout_seconds: 60,
            circuit_error_rate_threshold: 0.6,
            circuit_min_requests: 10,
        }
    }
}

// ---------------------------------------------------------------------------
// RectifierConfig
// ---------------------------------------------------------------------------

/// 整流器配置
///
/// 存储在 settings 表中
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RectifierConfig {
    /// 总开关：是否启用整流器（默认开启）
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 请求整流：启用 thinking 签名整流器（默认开启）
    ///
    /// 处理错误：Invalid 'signature' in 'thinking' block
    #[serde(default = "default_true")]
    pub request_thinking_signature: bool,
    /// 请求整流：启用 thinking budget 整流器（默认开启）
    ///
    /// 处理错误：budget_tokens + thinking 相关约束
    #[serde(default = "default_true")]
    pub request_thinking_budget: bool,
}

fn default_true() -> bool {
    true
}

impl Default for RectifierConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            request_thinking_signature: true,
            request_thinking_budget: true,
        }
    }
}

// ---------------------------------------------------------------------------
// LogConfig
// ---------------------------------------------------------------------------

fn default_log_level() -> String {
    "info".to_string()
}

/// 日志配置
///
/// 存储在 settings 表的 log_config 字段中（JSON 格式）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogConfig {
    /// 总开关：是否启用日志
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 日志级别: error, warn, info, debug, trace
    #[serde(default = "default_log_level")]
    pub level: String,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            level: "info".to_string(),
        }
    }
}

impl LogConfig {
    /// 将配置的日志级别转换为 tracing 兼容的级别字符串
    ///
    /// 返回标准化的级别字符串: "error", "warn", "info", "debug", "trace"
    /// 禁用时返回 "off"，无效级别回退到 "info"
    pub fn to_level_str(&self) -> &str {
        if !self.enabled {
            return "off";
        }
        match self.level.to_lowercase().as_str() {
            "error" => "error",
            "warn" => "warn",
            "info" => "info",
            "debug" => "debug",
            "trace" => "trace",
            _ => "info",
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- ProxyState tests --

    #[test]
    fn test_proxy_state_default() {
        let state = ProxyState::default();
        assert!(!state.running);
        assert_eq!(state.port, 9876);
        assert_eq!(state.host, "0.0.0.0");
        assert_eq!(state.request_count, 0);
    }

    // -- ProxyServerConfig tests --

    #[test]
    fn test_proxy_server_config_default() {
        let config = ProxyServerConfig::default();
        assert_eq!(config.listen_address, "0.0.0.0");
        assert_eq!(config.listen_port, 9876);
        assert_eq!(config.max_retries, 3);
        assert_eq!(config.request_timeout, 600);
        assert!(config.enable_logging);
        assert!(!config.live_takeover_active);
        assert_eq!(config.streaming_first_byte_timeout, 60);
        assert_eq!(config.streaming_idle_timeout, 120);
        assert_eq!(config.non_streaming_timeout, 600);
    }

    // -- RectifierConfig tests --

    #[test]
    fn test_rectifier_config_default_enabled() {
        // 验证 RectifierConfig::default() 返回全开启状态
        let config = RectifierConfig::default();
        assert!(config.enabled, "rectifier enabled should default to true");
        assert!(
            config.request_thinking_signature,
            "thinking signature rectifier should default to true"
        );
        assert!(
            config.request_thinking_budget,
            "thinking budget rectifier should default to true"
        );
    }

    #[test]
    fn test_rectifier_config_serde_default() {
        // 验证反序列化缺字段时使用默认值 true
        let json = "{}";
        let config: RectifierConfig = serde_json::from_str(json).unwrap();
        assert!(config.enabled);
        assert!(config.request_thinking_signature);
        assert!(config.request_thinking_budget);
    }

    // -- LogConfig tests --

    #[test]
    fn test_log_config_default() {
        let config = LogConfig::default();
        assert!(config.enabled);
        assert_eq!(config.level, "info");
    }

    #[test]
    fn test_log_config_serde_default() {
        let json = "{}";
        let config: LogConfig = serde_json::from_str(json).unwrap();
        assert!(config.enabled);
        assert_eq!(config.level, "info");
    }

    #[test]
    fn test_log_config_to_level_str() {
        let config = LogConfig {
            level: "error".to_string(),
            ..Default::default()
        };
        assert_eq!(config.to_level_str(), "error");

        let config = LogConfig {
            level: "warn".to_string(),
            ..Default::default()
        };
        assert_eq!(config.to_level_str(), "warn");

        let config = LogConfig {
            level: "info".to_string(),
            ..Default::default()
        };
        assert_eq!(config.to_level_str(), "info");

        let config = LogConfig {
            level: "debug".to_string(),
            ..Default::default()
        };
        assert_eq!(config.to_level_str(), "debug");

        let config = LogConfig {
            level: "trace".to_string(),
            ..Default::default()
        };
        assert_eq!(config.to_level_str(), "trace");

        // invalid level falls back to info
        let config = LogConfig {
            level: "invalid".to_string(),
            ..Default::default()
        };
        assert_eq!(config.to_level_str(), "info");

        // disabled returns "off"
        let config = LogConfig {
            enabled: false,
            level: "debug".to_string(),
        };
        assert_eq!(config.to_level_str(), "off");
    }

    #[test]
    fn test_log_config_serde_roundtrip() {
        let config = LogConfig {
            enabled: true,
            level: "debug".to_string(),
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: LogConfig = serde_json::from_str(&json).unwrap();
        assert!(parsed.enabled);
        assert_eq!(parsed.level, "debug");
    }
}
