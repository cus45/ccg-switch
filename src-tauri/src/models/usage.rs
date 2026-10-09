//! 用量统计的跨层数据模型
//!
//! 全部 camelCase 序列化，与前端 `types/usage.ts` 一一对应。
//! 成本字段用 String 传输，避免 JS number 丢精度。

use serde::{Deserialize, Serialize};

/// 汇总卡片数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub total_requests: u64,
    pub total_cost: String,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_creation_tokens: u64,
    pub total_cache_read_tokens: u64,
    /// 百分比，0-100
    pub success_rate: f32,
    /// 真实消耗 = 新鲜输入 + 输出 + 缓存写入 + 缓存命中（与参考项目同口径）
    pub real_total_tokens: u64,
    /// 缓存命中率 = 缓存命中 ÷（新鲜输入 + 缓存写入 + 缓存命中），0.0–1.0
    pub cache_hit_rate: f64,
}

/// 趋势图的一个桶（≤24h 窗口按小时，否则按天）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyStats {
    /// 桶起始时刻，RFC3339
    pub date: String,
    pub request_count: u64,
    pub total_cost: String,
    pub total_tokens: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_creation_tokens: u64,
    pub total_cache_read_tokens: u64,
}

/// 按 provider 聚合
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStats {
    pub provider_id: String,
    /// provider 被删后为 "Unknown"，历史记录不丢
    pub provider_name: String,
    pub app_type: String,
    pub request_count: u64,
    /// 真实消耗（新鲜输入 + 输出 + 缓存写入 + 缓存命中），各行之和等于汇总卡的真实消耗
    pub total_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub total_cost: String,
    pub success_rate: f32,
    pub avg_latency_ms: u64,
    /// 速度分子：满足条件的请求的输出 token 之和（见 dao 的 speed_eligible_sql）
    pub speed_output_tokens: u64,
    /// 速度分母：同一批请求的生成时间之和（总耗时 - 首字耗时），毫秒
    pub speed_generation_ms: u64,
    /// 估算速度分子：会话日志导入、有估算耗时、输出 ≥ 200 token 的请求的输出之和。
    /// 和上面那组分开累计：估算的耗时含首字等待，口径不同，不能加在一起。
    pub est_speed_output_tokens: u64,
    /// 估算速度分母：同一批请求的估算耗时之和，毫秒。
    pub est_speed_duration_ms: u64,
}

/// 按模型聚合
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStats {
    pub model: String,
    pub request_count: u64,
    /// 输入 + 输出，不含缓存（与汇总卡「总 Token」同口径）
    pub total_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub total_cost: String,
    pub avg_cost_per_request: String,
}

/// 请求日志过滤条件
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFilters {
    pub app_type: Option<String>,
    /// provider 展示名精确匹配（顶部下拉的取值）
    pub provider_name: Option<String>,
    /// 模型名精确匹配（顶部下拉的取值）
    pub model: Option<String>,
    pub status_code: Option<u16>,
    /// Unix 秒
    pub start_date: Option<i64>,
    pub end_date: Option<i64>,
}

/// 聚合查询的筛选条件（应用 / 供应商 / 模型）
///
/// 汇总、趋势、供应商、模型四张聚合表共用，与请求日志表同一套匹配口径：
/// 应用精确匹配；供应商按展示名精确匹配（会话占位行 "Claude (Session)" /
/// "Codex (Session)" 也能选中）；模型精确匹配。
#[derive(Debug, Clone, Default)]
pub struct StatsFilters {
    pub app_type: Option<String>,
    pub provider_name: Option<String>,
    pub model: Option<String>,
}

/// 单条请求日志
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLogDetail {
    pub request_id: String,
    pub provider_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    pub app_type: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_model: Option<String>,
    pub cost_multiplier: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
    pub input_cost_usd: String,
    pub output_cost_usd: String,
    pub cache_read_cost_usd: String,
    pub cache_creation_cost_usd: String,
    pub total_cost_usd: String,
    pub is_streaming: bool,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_token_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub status_code: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    /// Unix 秒
    pub created_at: i64,
    /// 思考强度（客户端原值）；会话日志与代理请求体里没有时为 None
    pub reasoning_effort: Option<String>,
    /// 数据来源：`proxy` / `session_log` / `codex_session`；历史行为 None 时前端按 proxy 处理
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_source: Option<String>,
}

/// 分页结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedLogs {
    pub data: Vec<RequestLogDetail>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
}

/// 定价条目（面板展示与编辑）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricingInfo {
    pub model_id: String,
    pub display_name: String,
    pub input_cost_per_million: String,
    pub output_cost_per_million: String,
    pub cache_read_cost_per_million: String,
    pub cache_creation_cost_per_million: String,
}

/// Provider 限额状态
///
/// 日/月用量来自 `proxy_request_logs` 的真实花费，限额来自 `providers.meta`
/// 的 `limitDailyUsd` / `limitMonthlyUsd`（provider 级），未配置时对应字段为 None。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderLimitStatus {
    pub provider_id: String,
    /// provider 展示名；provider 被删后回退 "Unknown"
    pub provider_name: String,
    pub app_type: String,
    pub daily_usage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_limit: Option<String>,
    pub daily_exceeded: bool,
    pub monthly_usage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monthly_limit: Option<String>,
    pub monthly_exceeded: bool,
}
