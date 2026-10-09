//! 把请求用量落库到 `proxy_request_logs`
//!
//! 调用方一律在 `tokio::spawn` 里执行 —— 记账失败不能影响转发。

use super::calculator::{CostBreakdown, CostCalculator, ModelPricing};
use super::parser::TokenUsage;
use crate::database::dao::usage_logs::RequestLogRow;
use crate::database::Database;
use rust_decimal::Decimal;
use std::str::FromStr;
use std::sync::Arc;

/// provider.meta 与全局配置里的键名
const META_COST_MULTIPLIER: &str = "costMultiplier";
const META_PRICING_MODEL_SOURCE: &str = "pricingModelSource";

/// 定价查表用哪个模型名
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PricingModelSource {
    /// 用响应里自报的模型名（默认）
    Response,
    /// 用请求里声明的模型名
    Request,
}

impl PricingModelSource {
    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "response" => Some(Self::Response),
            "request" => Some(Self::Request),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Response => "response",
            Self::Request => "request",
        }
    }
}

/// 计费配置：倍率 + 定价模型来源
#[derive(Debug, Clone)]
pub struct PricingConfig {
    pub cost_multiplier: Decimal,
    pub model_source: PricingModelSource,
}

impl Default for PricingConfig {
    fn default() -> Self {
        Self {
            cost_multiplier: Decimal::ONE,
            model_source: PricingModelSource::Response,
        }
    }
}

/// 全局默认倍率的配置键（按 app_type 分）
pub fn default_multiplier_key(app_type: &str) -> String {
    format!("default_cost_multiplier:{app_type}")
}

/// 全局默认定价模型来源的配置键（按 app_type 分）
pub fn pricing_model_source_key(app_type: &str) -> String {
    format!("pricing_model_source:{app_type}")
}

/// 待落库的一次请求
pub struct UsageRecord {
    pub request_id: String,
    pub provider_id: String,
    pub app_type: String,
    /// 响应里自报的模型名
    pub model: String,
    /// 请求里声明的模型名
    pub request_model: String,
    pub usage: TokenUsage,
    pub latency_ms: u64,
    pub first_token_ms: Option<u64>,
    pub status_code: u16,
    pub error_message: Option<String>,
    pub session_id: Option<String>,
    pub provider_type: Option<String>,
    pub is_streaming: bool,
    /// 思考强度（从请求体里取，客户端原值）
    pub reasoning_effort: Option<String>,
}

pub struct UsageLogger {
    db: Arc<Database>,
}

/// 用量日志采集开关的配置键
///
/// 与 `commands::usage_commands::LOGGING_KEY` 同一个键 —— 缺省为开。
const LOGGING_ENABLED_KEY: &str = "usage_logging_enabled";

impl UsageLogger {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// 是否记录用量日志
    ///
    /// 关掉时代理照常转发，只是不落库。读失败按「记录」处理 ——
    /// 采集开关不该因为一次配置读取失败就静默丢掉所有统计数据。
    fn is_logging_enabled(&self) -> bool {
        match self.db.get_app_config(LOGGING_ENABLED_KEY) {
            Ok(Some(v)) => v.trim() == "1" || v.trim().eq_ignore_ascii_case("true"),
            Ok(None) => true,
            Err(e) => {
                tracing::warn!("[Usage] 读取日志开关失败，按开启处理: {e}");
                true
            }
        }
    }

    /// 解析计费配置：provider.meta → 全局默认 → 硬默认
    ///
    /// 任一层非法都告警后落到下一层，绝不 panic —— 配置错误不该让请求记不上账。
    pub fn resolve_pricing_config(&self, provider_id: &str, app_type: &str) -> PricingConfig {
        let global_multiplier = self
            .db
            .get_app_config(&default_multiplier_key(app_type))
            .ok()
            .flatten()
            .and_then(|raw| match Decimal::from_str(&raw) {
                Ok(v) => Some(v),
                Err(e) => {
                    tracing::warn!("[Usage] 全局倍率非法 (app_type={app_type}): {raw} - {e}");
                    None
                }
            })
            .unwrap_or(Decimal::ONE);

        let global_source = self
            .db
            .get_app_config(&pricing_model_source_key(app_type))
            .ok()
            .flatten()
            .and_then(|raw| match PricingModelSource::parse(&raw) {
                Some(v) => Some(v),
                None => {
                    tracing::warn!("[Usage] 全局计费模型来源非法 (app_type={app_type}): {raw}");
                    None
                }
            })
            .unwrap_or(PricingModelSource::Response);

        let meta = self
            .db
            .get_provider_by_app(provider_id, app_type)
            .ok()
            .flatten()
            .and_then(|p| p.meta);

        let cost_multiplier = meta
            .as_ref()
            .and_then(|m| m.get(META_COST_MULTIPLIER))
            .filter(|raw| !raw.trim().is_empty())
            .and_then(|raw| match Decimal::from_str(raw) {
                Ok(v) => Some(v),
                Err(e) => {
                    tracing::warn!(
                        "[Usage] 供应商倍率非法 (provider_id={provider_id}): {raw} - {e}"
                    );
                    None
                }
            })
            .unwrap_or(global_multiplier);

        let model_source = meta
            .as_ref()
            .and_then(|m| m.get(META_PRICING_MODEL_SOURCE))
            .filter(|raw| !raw.trim().is_empty())
            .and_then(|raw| match PricingModelSource::parse(raw) {
                Some(v) => Some(v),
                None => {
                    tracing::warn!(
                        "[Usage] 供应商计费模型来源非法 (provider_id={provider_id}): {raw}"
                    );
                    None
                }
            })
            .unwrap_or(global_source);

        PricingConfig {
            cost_multiplier,
            model_source,
        }
    }

    /// 算成本并落库
    ///
    /// 定价缺失时按 0 成本记录 —— 有 token 记录比完全没记录有用。
    /// 日志开关关闭时直接跳过，不做任何写入。
    pub fn log_usage(&self, record: UsageRecord) -> Result<(), String> {
        if !self.is_logging_enabled() {
            return Ok(());
        }

        let config = self.resolve_pricing_config(&record.provider_id, &record.app_type);

        let pricing_model = match config.model_source {
            PricingModelSource::Response => record.model.as_str(),
            PricingModelSource::Request => record.request_model.as_str(),
        };

        let pricing = self
            .db
            .find_model_pricing(pricing_model)
            .map_err(|e| format!("查询模型定价失败: {e}"))?
            .and_then(|row| {
                ModelPricing::from_strings(
                    &row.input_cost_per_million,
                    &row.output_cost_per_million,
                    &row.cache_read_cost_per_million,
                    &row.cache_creation_cost_per_million,
                )
                .map_err(|e| {
                    tracing::warn!("[Usage] 定价数据非法 (model={pricing_model}): {e}");
                    e
                })
                .ok()
            });

        if pricing.is_none() {
            tracing::warn!("[Usage] 模型定价未找到，成本记 0: {pricing_model}");
        }

        let cost = CostCalculator::try_calculate_for_app(
            &record.app_type,
            &record.usage,
            pricing.as_ref(),
            config.cost_multiplier,
        );

        self.db
            .insert_request_log(&build_row(&record, cost.as_ref(), config.cost_multiplier))
    }

    /// 记录一次失败请求（无 usage，仅状态码与错误）
    pub fn log_error(&self, record: UsageRecord) -> Result<(), String> {
        if !self.is_logging_enabled() {
            return Ok(());
        }

        let config = self.resolve_pricing_config(&record.provider_id, &record.app_type);
        self.db
            .insert_request_log(&build_row(&record, None, config.cost_multiplier))
    }
}

/// 把 record + 成本组装成表行；无成本时五项均为 "0"
fn build_row(
    record: &UsageRecord,
    cost: Option<&CostBreakdown>,
    cost_multiplier: Decimal,
) -> RequestLogRow {
    let zero = || "0".to_string();
    let (input_cost, output_cost, cache_read_cost, cache_creation_cost, total_cost) = match cost {
        Some(c) => (
            c.input_cost.to_string(),
            c.output_cost.to_string(),
            c.cache_read_cost.to_string(),
            c.cache_creation_cost.to_string(),
            c.total_cost.to_string(),
        ),
        None => (zero(), zero(), zero(), zero(), zero()),
    };

    RequestLogRow {
        request_id: record.request_id.clone(),
        provider_id: record.provider_id.clone(),
        app_type: record.app_type.clone(),
        model: record.model.clone(),
        request_model: Some(record.request_model.clone()),
        input_tokens: record.usage.input_tokens,
        output_tokens: record.usage.output_tokens,
        cache_read_tokens: record.usage.cache_read_tokens,
        cache_creation_tokens: record.usage.cache_creation_tokens,
        input_cost_usd: input_cost,
        output_cost_usd: output_cost,
        cache_read_cost_usd: cache_read_cost,
        cache_creation_cost_usd: cache_creation_cost,
        total_cost_usd: total_cost,
        latency_ms: record.latency_ms,
        first_token_ms: record.first_token_ms,
        duration_ms: Some(record.latency_ms),
        status_code: record.status_code,
        error_message: record.error_message.clone(),
        session_id: record.session_id.clone(),
        provider_type: record.provider_type.clone(),
        is_streaming: record.is_streaming,
        cost_multiplier: cost_multiplier.to_string(),
        created_at: chrono::Utc::now().timestamp(),
        // 代理路径记账，来源显式标注以便与会话文件解析区分
        data_source: Some("proxy".to_string()),
        reasoning_effort: record.reasoning_effort.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::app_type::AppType;
    use crate::models::provider::Provider;
    use std::collections::HashMap;

    fn db() -> Arc<Database> {
        Arc::new(Database::in_memory().unwrap())
    }

    /// 插一个带 meta 的 provider
    fn insert_provider(
        db: &Database,
        id: &str,
        app_type: AppType,
        meta: Option<HashMap<String, String>>,
    ) {
        let provider = Provider {
            id: id.to_string(),
            name: format!("Provider {id}"),
            app_type,
            api_key: "sk-test".to_string(),
            url: None,
            default_sonnet_model: None,
            default_opus_model: None,
            default_haiku_model: None,
            default_reasoning_model: None,
            custom_params: None,
            settings_config: None,
            meta,
            icon: None,
            in_failover_queue: false,
            description: None,
            tags: None,
            is_active: false,
            created_at: chrono::Utc::now(),
            last_used: None,
            proxy_config: None,
        };
        db.upsert_provider(&provider).unwrap();
    }

    fn meta_of(pairs: &[(&str, &str)]) -> Option<HashMap<String, String>> {
        Some(
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        )
    }

    fn record(provider_id: &str, model: &str, request_model: &str) -> UsageRecord {
        UsageRecord {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: provider_id.to_string(),
            app_type: "claude".to_string(),
            model: model.to_string(),
            request_model: request_model.to_string(),
            usage: TokenUsage {
                input_tokens: 1_000_000,
                output_tokens: 0,
                cache_read_tokens: 0,
                cache_creation_tokens: 0,
                model: None,
            },
            latency_ms: 100,
            first_token_ms: None,
            status_code: 200,
            error_message: None,
            session_id: None,
            provider_type: None,
            is_streaming: false,
            reasoning_effort: None,
        }
    }

    fn read_costs(db: &Database, provider_id: &str) -> (String, String) {
        let conn = db.conn.lock().unwrap();
        conn.query_row(
            "SELECT total_cost_usd, cost_multiplier FROM proxy_request_logs WHERE provider_id = ?1",
            rusqlite::params![provider_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    // ---------- 倍率解析链 ----------

    #[test]
    fn multiplier_defaults_to_one_without_any_config() {
        let db = db();
        insert_provider(&db, "p1", AppType::Claude, None);
        let logger = UsageLogger::new(db.clone());

        let config = logger.resolve_pricing_config("p1", "claude");
        assert_eq!(config.cost_multiplier, Decimal::ONE);
        assert_eq!(config.model_source, PricingModelSource::Response);
    }

    #[test]
    fn multiplier_falls_back_to_global_when_provider_has_none() {
        let db = db();
        insert_provider(&db, "p1", AppType::Claude, None);
        db.set_app_config(&default_multiplier_key("claude"), "1.5")
            .unwrap();
        let logger = UsageLogger::new(db.clone());

        assert_eq!(
            logger.resolve_pricing_config("p1", "claude").cost_multiplier,
            Decimal::from_str("1.5").unwrap()
        );
    }

    #[test]
    fn provider_multiplier_overrides_global() {
        let db = db();
        insert_provider(&db, "p1", AppType::Claude, meta_of(&[(META_COST_MULTIPLIER, "3")]));
        db.set_app_config(&default_multiplier_key("claude"), "1.5")
            .unwrap();
        let logger = UsageLogger::new(db.clone());

        assert_eq!(
            logger.resolve_pricing_config("p1", "claude").cost_multiplier,
            Decimal::from(3)
        );
    }

    #[test]
    fn empty_provider_multiplier_falls_back_to_global() {
        // 用户清空输入框 → 空字符串，应视为未设置而非 0
        let db = db();
        insert_provider(&db, "p1", AppType::Claude, meta_of(&[(META_COST_MULTIPLIER, "")]));
        db.set_app_config(&default_multiplier_key("claude"), "2")
            .unwrap();
        let logger = UsageLogger::new(db.clone());

        assert_eq!(
            logger.resolve_pricing_config("p1", "claude").cost_multiplier,
            Decimal::from(2)
        );
    }

    #[test]
    fn malformed_multiplier_falls_back_instead_of_failing() {
        let db = db();
        insert_provider(&db, "p1", AppType::Claude, meta_of(&[(META_COST_MULTIPLIER, "abc")]));
        let logger = UsageLogger::new(db.clone());

        assert_eq!(
            logger.resolve_pricing_config("p1", "claude").cost_multiplier,
            Decimal::ONE,
            "非法倍率必须回落，不能让记账整体失败"
        );
    }

    #[test]
    fn missing_provider_still_resolves_to_defaults() {
        let db = db();
        let logger = UsageLogger::new(db.clone());
        // provider 已被删除，但历史请求仍要能记账
        assert_eq!(
            logger.resolve_pricing_config("ghost", "claude").cost_multiplier,
            Decimal::ONE
        );
    }

    // ---------- 定价模型来源 ----------

    #[test]
    fn model_source_parses_request_and_response() {
        let db = db();
        insert_provider(
            &db,
            "p1",
            AppType::Claude,
            meta_of(&[(META_PRICING_MODEL_SOURCE, "request")]),
        );
        let logger = UsageLogger::new(db.clone());
        assert_eq!(
            logger.resolve_pricing_config("p1", "claude").model_source,
            PricingModelSource::Request
        );
    }

    #[test]
    fn invalid_model_source_falls_back_to_response() {
        let db = db();
        insert_provider(
            &db,
            "p1",
            AppType::Claude,
            meta_of(&[(META_PRICING_MODEL_SOURCE, "nonsense")]),
        );
        let logger = UsageLogger::new(db.clone());
        assert_eq!(
            logger.resolve_pricing_config("p1", "claude").model_source,
            PricingModelSource::Response
        );
    }

    #[test]
    fn request_source_prices_by_request_model() {
        let db = db();
        insert_provider(
            &db,
            "p1",
            AppType::Claude,
            meta_of(&[(META_PRICING_MODEL_SOURCE, "request")]),
        );
        let logger = UsageLogger::new(db.clone());

        // 响应模型无定价、请求模型有定价 → 走 request 来源应算出非 0 成本
        logger
            .log_usage(record("p1", "unknown-response-model", "claude-sonnet-4-5-20250929"))
            .unwrap();

        let (total, _) = read_costs(&db, "p1");
        assert_eq!(total, "3", "1M input × $3/1M = $3");
    }

    #[test]
    fn response_source_prices_by_response_model() {
        let db = db();
        insert_provider(&db, "p1", AppType::Claude, None);
        let logger = UsageLogger::new(db.clone());

        logger
            .log_usage(record("p1", "claude-sonnet-4-5-20250929", "some-alias"))
            .unwrap();

        let (total, _) = read_costs(&db, "p1");
        assert_eq!(total, "3");
    }

    // ---------- 落库 ----------

    #[test]
    fn multiplier_is_persisted_and_applied_to_total() {
        let db = db();
        insert_provider(&db, "p1", AppType::Claude, meta_of(&[(META_COST_MULTIPLIER, "2")]));
        let logger = UsageLogger::new(db.clone());

        logger
            .log_usage(record("p1", "claude-sonnet-4-5-20250929", "x"))
            .unwrap();

        let (total, multiplier) = read_costs(&db, "p1");
        assert_eq!(multiplier, "2");
        assert_eq!(total, "6", "1M input × $3 × 2 = $6");
    }

    #[test]
    fn unknown_model_logs_zero_cost_but_keeps_tokens() {
        let db = db();
        insert_provider(&db, "p1", AppType::Claude, None);
        let logger = UsageLogger::new(db.clone());

        logger
            .log_usage(record("p1", "totally-unknown-xyz", "totally-unknown-xyz"))
            .unwrap();

        let conn = db.conn.lock().unwrap();
        let (total, input): (String, i64) = conn
            .query_row(
                "SELECT total_cost_usd, input_tokens FROM proxy_request_logs WHERE provider_id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(total, "0", "定价缺失记 0 成本");
        assert_eq!(input, 1_000_000, "但 token 必须留下");
    }

    #[test]
    fn log_error_persists_status_and_message() {
        let db = db();
        insert_provider(&db, "p1", AppType::Claude, None);
        let logger = UsageLogger::new(db.clone());

        let mut rec = record("p1", "claude-sonnet-4-5-20250929", "x");
        rec.status_code = 401;
        rec.error_message = Some("invalid api key".to_string());
        rec.usage = TokenUsage::default();
        logger.log_error(rec).unwrap();

        let conn = db.conn.lock().unwrap();
        let (status, err, total): (i64, Option<String>, String) = conn
            .query_row(
                "SELECT status_code, error_message, total_cost_usd
                 FROM proxy_request_logs WHERE provider_id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, 401);
        assert_eq!(err.as_deref(), Some("invalid api key"));
        assert_eq!(total, "0");
    }

    #[test]
    fn claude_input_is_fresh_and_billed_in_full() {
        let db = db();
        insert_provider(&db, "p1", AppType::Claude, None);
        let logger = UsageLogger::new(db.clone());

        let mut rec = record("p1", "claude-sonnet-4-5-20250929", "x");
        rec.usage = TokenUsage {
            input_tokens: 1_000_000,
            output_tokens: 0,
            cache_read_tokens: 1_000_000,
            cache_creation_tokens: 0,
            model: None,
        };
        logger.log_usage(rec).unwrap();

        // Claude 的 input 与 cache_read 互不包含：输入 3.0 + 命中 0.30 = 3.30
        let (total, _) = read_costs(&db, "p1");
        assert_eq!(
            Decimal::from_str(&total).unwrap(),
            Decimal::from_str("3.30").unwrap()
        );
    }
}
