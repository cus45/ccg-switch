#![allow(dead_code)]
//! 代理请求日志与模型定价的数据访问层
//!
//! `proxy_request_logs` 是用量统计的唯一数据源，由代理转发路径旁路写入。
//! 成本字段以 Decimal 字符串存储，聚合时才转 REAL。

use crate::database::{lock_conn, Database};
use crate::models::usage::{
    DailyStats, LogFilters, ModelStats, PaginatedLogs, ProviderStats, RequestLogDetail,
    StatsFilters, UsageSummary,
};
use crate::proxy::usage::calculator::{CostCalculator, ModelPricing};
use crate::proxy::usage::parser::TokenUsage;
use chrono::{Local, TimeZone};
use rusqlite::{Connection, OptionalExtension, ToSql};
use rust_decimal::Decimal;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::MutexGuard;

/// 一条待写入的请求日志
///
/// 字段与 `proxy_request_logs` 表一一对应。成本项均为 Decimal 的字符串表示。
#[derive(Debug, Clone)]
pub struct RequestLogRow {
    pub request_id: String,
    pub provider_id: String,
    pub app_type: String,
    pub model: String,
    pub request_model: Option<String>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
    pub input_cost_usd: String,
    pub output_cost_usd: String,
    pub cache_read_cost_usd: String,
    pub cache_creation_cost_usd: String,
    pub total_cost_usd: String,
    pub latency_ms: u64,
    pub first_token_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub status_code: u16,
    pub error_message: Option<String>,
    pub session_id: Option<String>,
    pub provider_type: Option<String>,
    pub is_streaming: bool,
    pub cost_multiplier: String,
    pub created_at: i64,
    /// 数据来源：`proxy` = 代理记账，`session_log` / `codex_session` = 本地会话文件解析
    pub data_source: Option<String>,
    /// 思考强度（客户端原值，如 low / medium / high / xhigh / max）
    pub reasoning_effort: Option<String>,
}

/// 模型定价（USD per 1M tokens，Decimal 字符串）
#[derive(Debug, Clone)]
pub struct ModelPricingRow {
    pub input_cost_per_million: String,
    pub output_cost_per_million: String,
    pub cache_read_cost_per_million: String,
    pub cache_creation_cost_per_million: String,
}

/// 清洗模型名：去 `/` 前缀、去 `:` 后缀、`@` 换 `-`
///
/// `moonshotai/gpt-5.2-codex@low:v2` → `gpt-5.2-codex-low`
pub fn clean_model_id(model_id: &str) -> String {
    model_id
        .rsplit_once('/')
        .map_or(model_id, |(_, right)| right)
        .split(':')
        .next()
        .unwrap_or(model_id)
        .trim()
        .replace('@', "-")
}

impl Database {
    /// 只读连接 —— 供会话文件扫描器等批量读场景使用
    ///
    /// 返回 `Result` 而非直接给锁，因为调用方拿不到 `MutexGuard`
    /// 需要自行控制生命周期（例如在遍历过程中同时写库）。
    pub fn conn_for_read(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.conn.lock().map_err(|e| format!("Mutex lock failed: {e}"))
    }

    /// 写入一条请求日志
    ///
    /// 调用方在 `tokio::spawn` 里执行，失败只记日志不回传给转发路径。
    pub fn insert_request_log(&self, log: &RequestLogRow) -> Result<(), String> {
        let conn = lock_conn!(self.conn);

        conn.execute(
            "INSERT OR REPLACE INTO proxy_request_logs (
                request_id, provider_id, app_type, model, request_model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                input_cost_usd, output_cost_usd, cache_read_cost_usd,
                cache_creation_cost_usd, total_cost_usd,
                latency_ms, first_token_ms, duration_ms, status_code, error_message,
                session_id, provider_type, is_streaming, cost_multiplier, created_at,
                data_source, reasoning_effort
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26
            )",
            rusqlite::params![
                log.request_id,
                log.provider_id,
                log.app_type,
                log.model,
                log.request_model,
                log.input_tokens,
                log.output_tokens,
                log.cache_read_tokens,
                log.cache_creation_tokens,
                log.input_cost_usd,
                log.output_cost_usd,
                log.cache_read_cost_usd,
                log.cache_creation_cost_usd,
                log.total_cost_usd,
                log.latency_ms as i64,
                log.first_token_ms.map(|v| v as i64),
                log.duration_ms.map(|v| v as i64),
                log.status_code as i64,
                log.error_message,
                log.session_id,
                log.provider_type,
                log.is_streaming as i64,
                log.cost_multiplier,
                log.created_at,
                log.data_source,
                log.reasoning_effort,
            ],
        )
        .map_err(|e| format!("Failed to insert request log: {e}"))?;

        Ok(())
    }

    /// 读某个会话文件的扫描进度，返回 (size, mtime_ms, offset, last_effort, last_model)；从未扫过返回 None
    pub fn get_session_scan_state(
        &self,
        path: &str,
    ) -> Result<Option<(i64, i64, i64, Option<String>, Option<String>)>, String> {
        let conn = lock_conn!(self.conn);
        conn.query_row(
            "SELECT size, mtime_ms, offset, last_effort, last_model FROM session_scan_files WHERE path = ?1",
            [path],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .map_err(|e| format!("Failed to read session scan state: {e}"))
    }

    /// 一个事务里提交一个会话文件的采集结果：批量写入日志行 + 更新该文件的扫描进度
    ///
    /// 两者必须原子：进度先于行落盘会丢数据（下次从新 offset 续读，这批行永远进不来）；
    /// 行先于进度落盘只会让下次重读一遍，INSERT OR IGNORE 按 request_id 主键去重，无副作用。
    /// 与代理记账的 insert_request_log 不同，这里用 OR IGNORE 而不是 OR REPLACE：
    /// 已存在的行（无论来自代理还是上次扫描）保持原样，返回值只算真正新增的行数。
    pub fn commit_session_file(
        &self,
        rows: &[RequestLogRow],
        path: &str,
        size: i64,
        mtime_ms: i64,
        offset: i64,
        last_effort: Option<&str>,
        last_model: Option<&str>,
    ) -> Result<u32, String> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to begin transaction: {e}"))?;

        let mut inserted = 0u32;
        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT OR IGNORE INTO proxy_request_logs (
                        request_id, provider_id, app_type, model, request_model,
                        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                        input_cost_usd, output_cost_usd, cache_read_cost_usd,
                        cache_creation_cost_usd, total_cost_usd,
                        latency_ms, first_token_ms, duration_ms, status_code, error_message,
                        session_id, provider_type, is_streaming, cost_multiplier, created_at,
                        data_source, reasoning_effort
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                        ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26
                    )",
                )
                .map_err(|e| format!("Failed to prepare insert: {e}"))?;
            for log in rows {
                let n = stmt
                    .execute(rusqlite::params![
                        log.request_id,
                        log.provider_id,
                        log.app_type,
                        log.model,
                        log.request_model,
                        log.input_tokens,
                        log.output_tokens,
                        log.cache_read_tokens,
                        log.cache_creation_tokens,
                        log.input_cost_usd,
                        log.output_cost_usd,
                        log.cache_read_cost_usd,
                        log.cache_creation_cost_usd,
                        log.total_cost_usd,
                        log.latency_ms as i64,
                        log.first_token_ms.map(|v| v as i64),
                        log.duration_ms.map(|v| v as i64),
                        log.status_code as i64,
                        log.error_message,
                        log.session_id,
                        log.provider_type,
                        log.is_streaming as i64,
                        log.cost_multiplier,
                        log.created_at,
                        log.data_source,
                        log.reasoning_effort,
                    ])
                    .map_err(|e| format!("Failed to insert request log: {e}"))?;
                inserted += n as u32;

                // 行已存在（代理先记过，或是升级前导入的）：只回填缺失的字段，其余保持原样
                if n == 0 {
                    if log.reasoning_effort.is_some() {
                        tx.prepare_cached(
                            "UPDATE proxy_request_logs SET reasoning_effort = ?1
                             WHERE request_id = ?2 AND reasoning_effort IS NULL",
                        )
                        .and_then(|mut up| up.execute(rusqlite::params![log.reasoning_effort, log.request_id]))
                        .map_err(|e| format!("Failed to backfill reasoning_effort: {e}"))?;
                    }
                    // 升级前导入的 Codex 行 model 为空（会话文件的用量行不带 model，
                    // 需要靠 turn_context 补齐）：回填 model 并重算成本。
                    // 只在该行 model 仍为空、且新行已解析出非空 model 时回填，
                    // 不覆盖代理先记下的真实 model。
                    if !log.model.is_empty() {
                        tx.prepare_cached(
                            "UPDATE proxy_request_logs
                             SET model = ?1, request_model = ?2,
                                 input_cost_usd = ?3, output_cost_usd = ?4,
                                 cache_read_cost_usd = ?5, cache_creation_cost_usd = ?6,
                                 total_cost_usd = ?7
                             WHERE request_id = ?8 AND (model IS NULL OR model = '')",
                        )
                        .and_then(|mut up| {
                            up.execute(rusqlite::params![
                                log.model,
                                log.request_model,
                                log.input_cost_usd,
                                log.output_cost_usd,
                                log.cache_read_cost_usd,
                                log.cache_creation_cost_usd,
                                log.total_cost_usd,
                                log.request_id,
                            ])
                        })
                        .map_err(|e| format!("Failed to backfill model/cost: {e}"))?;
                    }
                    // 会话行的耗时（latency_ms）是后加的估算：旧库里仍为 0，重扫时回填。
                    // 只在原值为 0/NULL（没有计时）时写，不覆盖代理先记下的真实耗时；
                    // 同时把旧代码写死的 duration_ms = 0 清成 NULL，让展示端回退到 latency_ms。
                    if log.latency_ms > 0 {
                        tx.prepare_cached(
                            "UPDATE proxy_request_logs
                             SET latency_ms = ?1, duration_ms = ?2
                             WHERE request_id = ?3
                               AND (latency_ms IS NULL OR latency_ms = 0)",
                        )
                        .and_then(|mut up| {
                            up.execute(rusqlite::params![
                                log.latency_ms as i64,
                                log.duration_ms.map(|v| v as i64),
                                log.request_id,
                            ])
                        })
                        .map_err(|e| format!("Failed to backfill latency: {e}"))?;
                    }
                }
            }
        }

        tx.execute(
            "INSERT OR REPLACE INTO session_scan_files (path, size, mtime_ms, offset, last_effort, last_model)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![path, size, mtime_ms, offset, last_effort, last_model],
        )
        .map_err(|e| format!("Failed to update session scan state: {e}"))?;

        tx.commit()
            .map_err(|e| format!("Failed to commit session file: {e}"))?;
        Ok(inserted)
    }

    /// 查模型定价：先精确匹配清洗后的名称，再退最长前缀
    ///
    /// 前缀兜底是为了让未来的快照日期（如新一版 `claude-sonnet-4-5-2026xxxx`）
    /// 仍能落到同代价格上，而不是直接记 0 成本。
    /// 取最长前缀，保证 `gpt-4o-mini` 不会被 `gpt-4o` 抢走。
    ///
    /// 未命中返回 `Ok(None)`，调用方按 0 成本记录并告警 —— 定价缺失不能阻断请求。
    pub fn find_model_pricing(&self, model_id: &str) -> Result<Option<ModelPricingRow>, String> {
        let conn = lock_conn!(self.conn);
        let cleaned = clean_model_id(model_id);

        let exact = conn
            .query_row(
                "SELECT input_cost_per_million, output_cost_per_million,
                        cache_read_cost_per_million, cache_creation_cost_per_million
                 FROM model_pricing WHERE model_id = ?1",
                rusqlite::params![cleaned],
                |row| {
                    Ok(ModelPricingRow {
                        input_cost_per_million: row.get(0)?,
                        output_cost_per_million: row.get(1)?,
                        cache_read_cost_per_million: row.get(2)?,
                        cache_creation_cost_per_million: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to query model_pricing: {e}"))?;

        if exact.is_some() {
            return Ok(exact);
        }

        // 前缀兜底：清洗后的名称以某个 model_id 开头，取最长的那条
        let prefix = conn
            .query_row(
                "SELECT input_cost_per_million, output_cost_per_million,
                        cache_read_cost_per_million, cache_creation_cost_per_million
                 FROM model_pricing
                 WHERE ?1 LIKE model_id || '%'
                 ORDER BY LENGTH(model_id) DESC
                 LIMIT 1",
                rusqlite::params![cleaned],
                |row| {
                    Ok(ModelPricingRow {
                        input_cost_per_million: row.get(0)?,
                        output_cost_per_million: row.get(1)?,
                        cache_read_cost_per_million: row.get(2)?,
                        cache_creation_cost_per_million: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to query model_pricing by prefix: {e}"))?;

        Ok(prefix)
    }

    /// 列出全部定价（供定价配置面板使用）
    pub fn list_model_pricing(
        &self,
    ) -> Result<Vec<(String, String, ModelPricingRow)>, String> {
        let conn = lock_conn!(self.conn);

        let mut stmt = conn
            .prepare(
                "SELECT model_id, display_name,
                        input_cost_per_million, output_cost_per_million,
                        cache_read_cost_per_million, cache_creation_cost_per_million
                 FROM model_pricing
                 ORDER BY display_name, model_id",
            )
            .map_err(|e| format!("Failed to prepare model_pricing query: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    ModelPricingRow {
                        input_cost_per_million: row.get(2)?,
                        output_cost_per_million: row.get(3)?,
                        cache_read_cost_per_million: row.get(4)?,
                        cache_creation_cost_per_million: row.get(5)?,
                    },
                ))
            })
            .map_err(|e| format!("Failed to read model_pricing: {e}"))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| format!("Failed to read model_pricing row: {e}"))?);
        }
        Ok(result)
    }

    /// 新增或覆盖一条定价
    pub fn upsert_model_pricing(
        &self,
        model_id: &str,
        display_name: &str,
        pricing: &ModelPricingRow,
    ) -> Result<(), String> {
        let conn = lock_conn!(self.conn);

        conn.execute(
            "INSERT OR REPLACE INTO model_pricing (
                model_id, display_name, input_cost_per_million, output_cost_per_million,
                cache_read_cost_per_million, cache_creation_cost_per_million
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                model_id,
                display_name,
                pricing.input_cost_per_million,
                pricing.output_cost_per_million,
                pricing.cache_read_cost_per_million,
                pricing.cache_creation_cost_per_million,
            ],
        )
        .map_err(|e| format!("Failed to upsert model_pricing: {e}"))?;

        Ok(())
    }

    /// 删除一条定价
    pub fn delete_model_pricing(&self, model_id: &str) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM model_pricing WHERE model_id = ?1",
            rusqlite::params![model_id],
        )
        .map_err(|e| format!("Failed to delete model_pricing: {e}"))?;
        Ok(())
    }
}

/// 一小时 / 一天的秒数
const HOUR_SECONDS: i64 = 3600;
const DAY_SECONDS: i64 = 86_400;

/// 由四类 token 推导（真实消耗, 缓存命中率）；输入必须已是新鲜输入
///
/// 命中率 = 缓存命中 ÷（新鲜输入 + 缓存写入 + 缓存命中），与参考项目 cc-switch 同口径。
fn derive_real_total_and_hit_rate(
    fresh_input: u64,
    output: u64,
    cache_creation: u64,
    cache_read: u64,
) -> (u64, f64) {
    let real_total = fresh_input + output + cache_creation + cache_read;
    let cacheable = fresh_input + cache_creation + cache_read;
    let hit_rate = if cacheable > 0 {
        cache_read as f64 / cacheable as f64
    } else {
        0.0
    };
    (real_total, hit_rate)
}

/// 单行的「新鲜输入」SQL 表达式
///
/// Claude 的 `input_tokens` 不含缓存；Codex / Gemini 的含缓存命中，要扣掉才能跨应用相加。
/// 不归一的话，Codex 请求会把缓存命中重复计进「输入」，命中率被拉低、真实消耗被抬高。
/// 应用清单与计费共用 `calculator::CACHE_INCLUSIVE_APP_TYPES`。
fn fresh_input_sql(alias: &str) -> String {
    let p = if alias.is_empty() {
        String::new()
    } else {
        format!("{alias}.")
    };
    let apps = crate::proxy::usage::calculator::CACHE_INCLUSIVE_APP_TYPES
        .iter()
        .map(|a| format!("'{a}'"))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "(CASE WHEN {p}app_type IN ({apps}) AND {p}input_tokens >= {p}cache_read_tokens \
         THEN {p}input_tokens - {p}cache_read_tokens ELSE {p}input_tokens END)"
    )
}

/// 单行的「真实消耗」：新鲜输入 + 输出 + 缓存写入 + 缓存命中
///
/// 供应商、模型分组统计的 `total_tokens` 都用它，保证各行之和等于汇总卡的真实消耗。
fn real_total_tokens_sql(alias: &str) -> String {
    let p = if alias.is_empty() {
        String::new()
    } else {
        format!("{alias}.")
    };
    format!(
        "({} + {p}output_tokens + {p}cache_creation_tokens + {p}cache_read_tokens)",
        fresh_input_sql(alias)
    )
}

/// 参与速度统计的最少输出 token：太短的请求生成时间以网络抖动为主，速度没意义
const SPEED_MIN_OUTPUT_TOKENS: i64 = 100;
/// 参与速度统计的最短生成时间（毫秒）
const SPEED_MIN_GENERATION_MS: i64 = 100;

/// 一行能否参与速度统计（与参考项目同口径）
///
/// 只有经代理的流式请求才有首字耗时；会话文件导入的行没有延迟数据，不参与。
fn speed_eligible_sql(alias: &str) -> String {
    format!(
        "{alias}.first_token_ms IS NOT NULL AND {alias}.output_tokens >= {SPEED_MIN_OUTPUT_TOKENS} \
         AND {alias}.latency_ms - {alias}.first_token_ms >= {SPEED_MIN_GENERATION_MS}"
    )
}

/// 估算速度的输出门槛：估算的耗时含首字等待，输出越少首字占比越大、算出来越偏低，
/// 所以比精确口径的门槛高。
pub const SPEED_ESTIMATE_MIN_OUTPUT_TOKENS: i64 = 200;

/// 估算耗时短于这个毫秒数时不估速度：输出 200 token 以上却不到 1 秒，多半是起点取晚了。
pub const SPEED_ESTIMATE_MIN_DURATION_MS: i64 = 1000;

/// 明细行能不能估速度的 SQL 条件（和前端 `isSpeedEstimateEligible` 同口径）：
/// 会话日志导入的行（没有首字计时），耗时是导入时按日志时间戳估的。
fn speed_estimate_eligible_sql(alias: &str) -> String {
    format!(
        "COALESCE({alias}.data_source, 'proxy') <> 'proxy' \
         AND {alias}.first_token_ms IS NULL \
         AND {alias}.output_tokens >= {SPEED_ESTIMATE_MIN_OUTPUT_TOKENS} \
         AND {alias}.latency_ms >= {SPEED_ESTIMATE_MIN_DURATION_MS}"
    )
}

/// 供应商显示名
///
/// 会话文件导入的行没有对应的 providers 记录，返回固定占位名（前端按名翻译成
/// 「Claude · 会话日志」）；被删除的供应商回落到 provider_id，历史记录仍可辨认。
fn provider_name_coalesce(log_alias: &str, provider_alias: &str) -> String {
    format!(
        "COALESCE({provider_alias}.name, CASE {log_alias}.provider_id \
         WHEN '_session' THEN 'Claude (Session)' \
         WHEN '_codex_session' THEN 'Codex (Session)' \
         ELSE {log_alias}.provider_id END)"
    )
}

/// 构造筛选条件（应用 / 供应商 / 模型）
///
/// 与请求日志表同一套匹配口径：应用精确匹配；供应商按展示名精确匹配（会话占位行
/// "Claude (Session)" / "Codex (Session)" 也能选中）；模型精确匹配。
///
/// `alias` 是日志表别名，空串表示无别名单表查询。供应商条件依赖 providers 表的
/// `p` 别名 —— 调用方的 SQL 必须带 `LEFT JOIN providers p`。
fn filter_conditions(alias: &str, filters: &StatsFilters) -> (Vec<String>, Vec<Box<dyn ToSql>>) {
    let col = |c: &str| {
        if alias.is_empty() {
            c.to_string()
        } else {
            format!("{alias}.{c}")
        }
    };

    let mut conditions = Vec::new();
    let mut params: Vec<Box<dyn ToSql>> = Vec::new();
    if let Some(app_type) = &filters.app_type {
        conditions.push(format!("{} = ?", col("app_type")));
        params.push(Box::new(app_type.clone()));
    }
    if let Some(name) = &filters.provider_name {
        conditions.push(format!("{} = ?", provider_name_coalesce(alias, "p")));
        params.push(Box::new(name.clone()));
    }
    if let Some(model) = &filters.model {
        conditions.push(format!("{} = ?", col("model")));
        params.push(Box::new(model.clone()));
    }

    (conditions, params)
}

/// 构造聚合查询的 WHERE 子句（时间窗口 + 应用/供应商/模型筛选）
///
/// 返回 `(子句, 参数)`。`alias` 为空串表示无表别名的单表查询。
/// 抽出来是因为汇总、趋势、provider、模型四张表的口径必须完全一致 ——
/// 各自拼一遍早晚会漏掉某一张，导致顶部切时间范围或改筛选时部分表格数字不动。
fn stats_where(
    alias: &str,
    start_date: Option<i64>,
    end_date: Option<i64>,
    filters: &StatsFilters,
) -> (String, Vec<Box<dyn ToSql>>) {
    let col = |c: &str| {
        if alias.is_empty() {
            c.to_string()
        } else {
            format!("{alias}.{c}")
        }
    };

    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn ToSql>> = Vec::new();
    if let Some(start) = start_date {
        conditions.push(format!("{} >= ?", col("created_at")));
        params.push(Box::new(start));
    }
    if let Some(end) = end_date {
        conditions.push(format!("{} <= ?", col("created_at")));
        params.push(Box::new(end));
    }

    let (filter_conds, filter_params) = filter_conditions(alias, filters);
    conditions.extend(filter_conds);
    params.extend(filter_params);

    if conditions.is_empty() {
        (String::new(), params)
    } else {
        (format!("WHERE {}", conditions.join(" AND ")), params)
    }
}

/// 把 SELECT 出的一行映射为 `RequestLogDetail`
///
/// 列顺序必须与 `LOG_DETAIL_COLUMNS` 严格一致。
fn map_log_detail(row: &rusqlite::Row<'_>) -> rusqlite::Result<RequestLogDetail> {
    Ok(RequestLogDetail {
        request_id: row.get(0)?,
        provider_id: row.get(1)?,
        provider_name: row.get(2)?,
        app_type: row.get(3)?,
        model: row.get(4)?,
        request_model: row.get(5)?,
        cost_multiplier: row
            .get::<_, Option<String>>(6)?
            .unwrap_or_else(|| "1".to_string()),
        input_tokens: row.get::<_, i64>(7)? as u32,
        output_tokens: row.get::<_, i64>(8)? as u32,
        cache_read_tokens: row.get::<_, i64>(9)? as u32,
        cache_creation_tokens: row.get::<_, i64>(10)? as u32,
        input_cost_usd: row.get(11)?,
        output_cost_usd: row.get(12)?,
        cache_read_cost_usd: row.get(13)?,
        cache_creation_cost_usd: row.get(14)?,
        total_cost_usd: row.get(15)?,
        is_streaming: row.get::<_, i64>(16)? != 0,
        latency_ms: row.get::<_, i64>(17)? as u64,
        first_token_ms: row.get::<_, Option<i64>>(18)?.map(|v| v as u64),
        duration_ms: row.get::<_, Option<i64>>(19)?.map(|v| v as u64),
        status_code: row.get::<_, i64>(20)? as u16,
        error_message: row.get(21)?,
        created_at: row.get(22)?,
        reasoning_effort: row.get(23)?,
        data_source: row.get(24)?,
    })
}

/// 日志 / 详情查询里的供应商显示名（别名固定为 l / p）
///
/// 必须与 `provider_name_coalesce("l", "p")` 逐字一致 —— const 里没法调函数，
/// 由测试 `log_provider_name_matches_stats_expression` 锁住，防止两处漂移。
const LOG_PROVIDER_NAME: &str = "COALESCE(p.name, CASE l.provider_id WHEN '_session' THEN 'Claude (Session)' WHEN '_codex_session' THEN 'Codex (Session)' ELSE l.provider_id END)";

/// 与 `map_log_detail` 的索引对应（第 3 列即 LOG_PROVIDER_NAME）
const LOG_DETAIL_COLUMNS: &str = "l.request_id, l.provider_id, COALESCE(p.name, CASE l.provider_id WHEN '_session' THEN 'Claude (Session)' WHEN '_codex_session' THEN 'Codex (Session)' ELSE l.provider_id END) AS provider_name, l.app_type,
     l.model, l.request_model, l.cost_multiplier,
     l.input_tokens, l.output_tokens, l.cache_read_tokens, l.cache_creation_tokens,
     l.input_cost_usd, l.output_cost_usd, l.cache_read_cost_usd,
     l.cache_creation_cost_usd, l.total_cost_usd,
     l.is_streaming, l.latency_ms, l.first_token_ms, l.duration_ms,
     l.status_code, l.error_message, l.created_at, l.reasoning_effort, l.data_source";

impl Database {
    /// 汇总：请求数、成本、四类 token、成功率
    pub fn get_usage_summary(
        &self,
        start_date: Option<i64>,
        end_date: Option<i64>,
        filters: &StatsFilters,
    ) -> Result<UsageSummary, String> {
        let conn = lock_conn!(self.conn);

        let (where_clause, params) = stats_where("l", start_date, end_date, filters);

        let fresh_input = fresh_input_sql("l");
        let sql = format!(
            "SELECT
                COUNT(*),
                COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0),
                COALESCE(SUM({fresh_input}), 0),
                COALESCE(SUM(l.output_tokens), 0),
                COALESCE(SUM(l.cache_creation_tokens), 0),
                COALESCE(SUM(l.cache_read_tokens), 0),
                COALESCE(SUM(CASE WHEN l.status_code >= 200 AND l.status_code < 300 THEN 1 ELSE 0 END), 0)
             FROM proxy_request_logs l
             LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type
             {where_clause}"
        );
        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();

        conn.query_row(&sql, refs.as_slice(), |row| {
            let total_requests: i64 = row.get(0)?;
            let total_cost: f64 = row.get(1)?;
            let input = row.get::<_, i64>(2)?.max(0) as u64;
            let output = row.get::<_, i64>(3)?.max(0) as u64;
            let cache_creation = row.get::<_, i64>(4)?.max(0) as u64;
            let cache_read = row.get::<_, i64>(5)?.max(0) as u64;
            let success_count: i64 = row.get(6)?;
            let (real_total_tokens, cache_hit_rate) =
                derive_real_total_and_hit_rate(input, output, cache_creation, cache_read);

            Ok(UsageSummary {
                total_requests: total_requests as u64,
                total_cost: format!("{total_cost:.6}"),
                total_input_tokens: input,
                total_output_tokens: output,
                total_cache_creation_tokens: cache_creation,
                total_cache_read_tokens: cache_read,
                success_rate: if total_requests > 0 {
                    (success_count as f32 / total_requests as f32) * 100.0
                } else {
                    0.0
                },
                real_total_tokens,
                cache_hit_rate,
            })
        })
        .map_err(|e| format!("Failed to query usage summary: {e}"))
    }

    /// 趋势：滑动窗口分桶
    ///
    /// 窗口 ≤24h 按小时（固定 24 桶，规避浮点误差），>24h 按天。
    /// 空桶补零，保证图表 X 轴连续 —— 缺桶会让折线图把两个远隔的日期连成直线。
    pub fn get_daily_trends(
        &self,
        start_date: Option<i64>,
        end_date: Option<i64>,
        filters: &StatsFilters,
    ) -> Result<Vec<DailyStats>, String> {
        let conn = lock_conn!(self.conn);
        let fresh_input = fresh_input_sql("l");

        let end_ts = end_date.unwrap_or_else(|| Local::now().timestamp());
        let mut start_ts = start_date.unwrap_or(end_ts - DAY_SECONDS);
        if start_ts >= end_ts {
            start_ts = end_ts - DAY_SECONDS;
        }

        let duration = end_ts - start_ts;
        let bucket_seconds = if duration <= DAY_SECONDS {
            HOUR_SECONDS
        } else {
            DAY_SECONDS
        };
        let bucket_count = if bucket_seconds == HOUR_SECONDS {
            24
        } else {
            ((duration as f64) / bucket_seconds as f64).ceil().max(1.0) as i64
        };

        let (where_clause, filter_params) = stats_where("l", Some(start_ts), Some(end_ts), filters);
        let trends_sql = format!(
                "SELECT
                    CAST((l.created_at - ?) / ? AS INTEGER) AS bucket_idx,
                    COUNT(*),
                    COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0),
                    COALESCE(SUM({fresh_input} + l.output_tokens), 0),
                    COALESCE(SUM({fresh_input}), 0),
                    COALESCE(SUM(l.output_tokens), 0),
                    COALESCE(SUM(l.cache_creation_tokens), 0),
                    COALESCE(SUM(l.cache_read_tokens), 0)
                 FROM proxy_request_logs l
                 LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type
                 {where_clause}
                 GROUP BY bucket_idx
                 ORDER BY bucket_idx ASC"
        );
        let mut stmt = conn
            .prepare(&trends_sql)
            .map_err(|e| format!("Failed to prepare trends query: {e}"))?;

        // 占位符顺序：桶基准、桶宽度、窗口起、窗口止、筛选
        let mut trend_params: Vec<Box<dyn ToSql>> =
            vec![Box::new(start_ts), Box::new(bucket_seconds)];
        trend_params.extend(filter_params);
        let trend_refs: Vec<&dyn ToSql> = trend_params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt
            .query_map(trend_refs.as_slice(), |row| {
                let cost: f64 = row.get(2)?;
                Ok((
                    row.get::<_, i64>(0)?,
                    DailyStats {
                        date: String::new(),
                        request_count: row.get::<_, i64>(1)? as u64,
                        total_cost: format!("{cost:.6}"),
                        total_tokens: row.get::<_, i64>(3)? as u64,
                        total_input_tokens: row.get::<_, i64>(4)? as u64,
                        total_output_tokens: row.get::<_, i64>(5)? as u64,
                        total_cache_creation_tokens: row.get::<_, i64>(6)? as u64,
                        total_cache_read_tokens: row.get::<_, i64>(7)? as u64,
                    },
                ))
            })
            .map_err(|e| format!("Failed to read trends: {e}"))?;

        let mut buckets: HashMap<i64, DailyStats> = HashMap::new();
        for row in rows {
            let (idx, stat) = row.map_err(|e| format!("Failed to read trend row: {e}"))?;
            if idx < 0 {
                continue;
            }
            // 边界请求（created_at == end_ts）会落到第 bucket_count 桶，归并到末桶
            buckets.insert(idx.min(bucket_count - 1), stat);
        }

        let mut result = Vec::with_capacity(bucket_count as usize);
        for i in 0..bucket_count {
            let bucket_start = Local
                .timestamp_opt(start_ts + i * bucket_seconds, 0)
                .single()
                .unwrap_or_else(Local::now);
            let date = bucket_start.to_rfc3339();

            match buckets.remove(&i) {
                Some(mut stat) => {
                    stat.date = date;
                    result.push(stat);
                }
                None => result.push(DailyStats {
                    date,
                    request_count: 0,
                    total_cost: "0.000000".to_string(),
                    total_tokens: 0,
                    total_input_tokens: 0,
                    total_output_tokens: 0,
                    total_cache_creation_tokens: 0,
                    total_cache_read_tokens: 0,
                }),
            }
        }

        Ok(result)
    }

    /// 按 provider 聚合；provider 被删后名字显示 Unknown，不丢历史记录
    ///
    /// 时间窗口与汇总卡、趋势图保持同一口径 —— 否则顶部切 1d/7d/30d 时
    /// 这张表纹丝不动，用户会以为统计坏了。
    pub fn get_provider_stats(
        &self,
        start_date: Option<i64>,
        end_date: Option<i64>,
        filters: &StatsFilters,
    ) -> Result<Vec<ProviderStats>, String> {
        let conn = lock_conn!(self.conn);

        let (where_clause, params) = stats_where("l", start_date, end_date, filters);
        let pname = provider_name_coalesce("l", "p");
        let real_total = real_total_tokens_sql("l");
        let speed_ok = speed_eligible_sql("l");
        let est_ok = speed_estimate_eligible_sql("l");
        let sql = format!(
            "SELECT l.provider_id, {pname}, l.app_type,
                    COUNT(*),
                    COALESCE(SUM({real_total}), 0),
                    COALESCE(SUM(l.cache_read_tokens), 0),
                    COALESCE(SUM(l.cache_creation_tokens), 0),
                    COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0),
                    COALESCE(SUM(CASE WHEN l.status_code >= 200 AND l.status_code < 300
                                 THEN 1 ELSE 0 END), 0),
                    COALESCE(AVG(l.latency_ms), 0),
                    COALESCE(SUM(CASE WHEN {speed_ok} THEN l.output_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN {speed_ok} THEN l.latency_ms - l.first_token_ms
                                 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN {est_ok} THEN l.output_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN {est_ok} THEN l.latency_ms ELSE 0 END), 0)
             FROM proxy_request_logs l
             LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type
             {where_clause}
             GROUP BY l.provider_id, l.app_type
             ORDER BY 4 DESC, 8 DESC"
        );

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare provider stats query: {e}"))?;

        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt
            .query_map(refs.as_slice(), |row| {
                let request_count: i64 = row.get(3)?;
                let total_cost: f64 = row.get(7)?;
                let success_count: i64 = row.get(8)?;
                let avg_latency: f64 = row.get(9)?;

                Ok(ProviderStats {
                    provider_id: row.get(0)?,
                    provider_name: row.get(1)?,
                    app_type: row.get(2)?,
                    request_count: request_count as u64,
                    total_tokens: row.get::<_, i64>(4)? as u64,
                    cache_read_tokens: row.get::<_, i64>(5)? as u64,
                    cache_creation_tokens: row.get::<_, i64>(6)? as u64,
                    total_cost: format!("{total_cost:.6}"),
                    success_rate: if request_count > 0 {
                        (success_count as f32 / request_count as f32) * 100.0
                    } else {
                        0.0
                    },
                    avg_latency_ms: avg_latency.round() as u64,
                    speed_output_tokens: row.get::<_, i64>(10)?.max(0) as u64,
                    speed_generation_ms: row.get::<_, i64>(11)?.max(0) as u64,
                    est_speed_output_tokens: row.get::<_, i64>(12)?.max(0) as u64,
                    est_speed_duration_ms: row.get::<_, i64>(13)?.max(0) as u64,
                })
            })
            .map_err(|e| format!("Failed to read provider stats: {e}"))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| format!("Failed to read provider stat row: {e}"))?);
        }
        Ok(result)
    }

    /// 按模型聚合（时间窗口口径同provider 统计）
    pub fn get_model_stats(
        &self,
        start_date: Option<i64>,
        end_date: Option<i64>,
        filters: &StatsFilters,
    ) -> Result<Vec<ModelStats>, String> {
        let conn = lock_conn!(self.conn);
        let real_total = real_total_tokens_sql("l");

        let (where_clause, params) = stats_where("l", start_date, end_date, filters);
        let sql = format!(
            "SELECT l.model, COUNT(*),
                    COALESCE(SUM({real_total}), 0),
                    COALESCE(SUM(l.cache_read_tokens), 0),
                    COALESCE(SUM(l.cache_creation_tokens), 0),
                    COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0)
             FROM proxy_request_logs l
             LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type
             {where_clause}
             GROUP BY l.model
             ORDER BY 6 DESC"
        );

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare model stats query: {e}"))?;

        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt
            .query_map(refs.as_slice(), |row| {
                let request_count: i64 = row.get(1)?;
                let total_cost: f64 = row.get(5)?;
                let avg = if request_count > 0 {
                    total_cost / request_count as f64
                } else {
                    0.0
                };

                Ok(ModelStats {
                    model: row.get(0)?,
                    request_count: request_count as u64,
                    total_tokens: row.get::<_, i64>(2)? as u64,
                    cache_read_tokens: row.get::<_, i64>(3)? as u64,
                    cache_creation_tokens: row.get::<_, i64>(4)? as u64,
                    total_cost: format!("{total_cost:.6}"),
                    avg_cost_per_request: format!("{avg:.6}"),
                })
            })
            .map_err(|e| format!("Failed to read model stats: {e}"))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| format!("Failed to read model stat row: {e}"))?);
        }
        Ok(result)
    }

    /// 查某provider 在今日 / 本月的实际花费（本地时区）
    ///
    /// 供限额判定用。日界用 `date(...,'localtime')`，月界用 `strftime('%Y-%m',...)`，
    /// 与用户直觉的「今天」「这个月」一致。
    pub fn get_provider_period_usage(
        &self,
        provider_id: &str,
        app_type: &str,
    ) -> Result<(String, String), String> {
        let conn = lock_conn!(self.conn);
        let sql = "SELECT
                COALESCE(SUM(CASE WHEN date(created_at, 'unixepoch', 'localtime')
                                   = date('now', 'localtime')
                          THEN CAST(total_cost_usd AS REAL) ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at, 'unixepoch', 'localtime')
                                   = strftime('%Y-%m', 'now', 'localtime')
                          THEN CAST(total_cost_usd AS REAL) ELSE 0 END), 0)
             FROM proxy_request_logs
             WHERE provider_id = ?1 AND app_type = ?2";

        let (daily, monthly) = conn
            .query_row(sql, rusqlite::params![provider_id, app_type], |row| {
                Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?))
            })
            .map_err(|e| format!("Failed to query provider period usage: {e}"))?;

        Ok((format!("{daily:.6}"), format!("{monthly:.6}")))
    }

    /// 读 provider 展示名与它配置的日/月限额（USD）
    ///
    /// 限额解析失败按「未配置」处理并告警 —— 限额写坏不该让统计面板整块报错。
    pub fn get_provider_limits(
        &self,
        provider_id: &str,
        app_type: &str,
    ) -> Result<(String, Option<String>, Option<String>), String> {
        const META_LIMIT_DAILY: &str = "limitDailyUsd";
        const META_LIMIT_MONTHLY: &str = "limitMonthlyUsd";

        let conn = lock_conn!(self.conn);
        let row = conn
            .query_row(
                "SELECT name, meta FROM providers WHERE id = ?1 AND app_type = ?2",
                rusqlite::params![provider_id, app_type],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| format!("Failed to query provider: {e}"))?;

        let Some((name, raw)) = row else {
            return Ok(("Unknown".to_string(), None, None));
        };

        let meta = raw
            .and_then(|r| serde_json::from_str::<serde_json::Value>(&r).ok())
            .unwrap_or(serde_json::Value::Null);

        let pick = |key: &str| -> Option<String> {
            let v = meta.get(key)?.as_str()?.trim();
            if v.is_empty() {
                return None;
            }
            match Decimal::from_str(v) {
                Ok(d) if !d.is_sign_negative() => Some(d.to_string()),
                Ok(_) => {
                    tracing::warn!("[Usage] provider {provider_id} 的 {key} 为负数，忽略: {v}");
                    None
                }
                Err(_) => {
                    tracing::warn!(
                        "[Usage] provider {provider_id} 的 {key} 不是合法数值，忽略: {v}"
                    );
                    None
                }
            }
        };

        Ok((name, pick(META_LIMIT_DAILY), pick(META_LIMIT_MONTHLY)))
    }

    /// 删除早于 `cutoff_ts`（Unix 秒）的请求日志，返回删除行数
    ///
    /// 只删明细表不动汇总 —— 汇总是实时聚合的，没有独立存储。
    pub fn delete_logs_before(&self, cutoff_ts: i64) -> Result<u32, String> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "DELETE FROM proxy_request_logs WHERE created_at < ?1",
                rusqlite::params![cutoff_ts],
            )
            .map_err(|e| format!("Failed to cleanup request logs: {e}"))?;
        Ok(affected as u32)
    }

    /// 清理后做一次 VACUUM，把文件真正收缩
    ///
    /// 独立事务：VACUUM 不能在事务里跑。
    fn vacuum(&self) -> Result<(), String> {
        let conn = lock_conn!(self.conn);
        conn.execute_batch("VACUUM")
            .map_err(|e| format!("VACUUM failed: {e}"))
    }

    /// 按保留天数清理：0 表示永久保留
    pub fn cleanup_old_logs(&self, retention_days: u32) -> Result<u32, String> {
        if retention_days == 0 {
            return Ok(0);
        }
        let cutoff = Local::now().timestamp() - (retention_days as i64) * DAY_SECONDS;
        let removed = self.delete_logs_before(cutoff)?;
        if removed > 0 {
            self.vacuum()?;
        }
        Ok(removed)
    }

    /// 请求日志总行数与库文件体积（字节），供「数据清理」面板展示
    pub fn usage_logs_size(&self) -> Result<(u64, u64), String> {
        let conn = lock_conn!(self.conn);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM proxy_request_logs", [], |row| row.get(0))
            .map_err(|e| format!("Failed to count request logs: {e}"))?;
        let page_count: i64 = conn
            .query_row("PRAGMA page_count", [], |row| row.get(0))
            .map_err(|e| format!("Failed to read page_count: {e}"))?;
        let page_size: i64 = conn
            .query_row("PRAGMA page_size", [], |row| row.get(0))
            .map_err(|e| format!("Failed to read page_size: {e}"))?;
        Ok((count as u64, (page_count * page_size) as u64))
    }

    /// 请求日志分页查询
    pub fn get_request_logs(
        &self,
        filters: &LogFilters,
        page: u32,
        page_size: u32,
    ) -> Result<PaginatedLogs, String> {
        let conn = lock_conn!(self.conn);

        let mut conditions: Vec<&str> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(app_type) = &filters.app_type {
            conditions.push("l.app_type = ?");
            params.push(Box::new(app_type.clone()));
        }
        if let Some(name) = &filters.provider_name {
            // 供应商 / 模型都来自顶部下拉的精确值，不做模糊匹配 ——
            // 模糊匹配会让「gpt-5」把「gpt-5-mini」也算进来，与下拉里显示的计数对不上。
            conditions.push("COALESCE(p.name, CASE l.provider_id WHEN '_session' THEN 'Claude (Session)' WHEN '_codex_session' THEN 'Codex (Session)' ELSE l.provider_id END) = ?");
            params.push(Box::new(name.clone()));
        }
        if let Some(model) = &filters.model {
            conditions.push("l.model = ?");
            params.push(Box::new(model.clone()));
        }
        if let Some(status) = filters.status_code {
            conditions.push("l.status_code = ?");
            params.push(Box::new(status as i64));
        }
        if let Some(start) = filters.start_date {
            conditions.push("l.created_at >= ?");
            params.push(Box::new(start));
        }
        if let Some(end) = filters.end_date {
            conditions.push("l.created_at <= ?");
            params.push(Box::new(end));
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        let count_sql = format!(
            "SELECT COUNT(*) FROM proxy_request_logs l
             LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type
             {where_clause}"
        );
        let count_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let total: u32 = conn
            .query_row(&count_sql, count_refs.as_slice(), |row| {
                row.get::<_, i64>(0).map(|v| v as u32)
            })
            .map_err(|e| format!("Failed to count request logs: {e}"))?;

        let sql = format!(
            "SELECT {LOG_DETAIL_COLUMNS}
             FROM proxy_request_logs l
             LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type
             {where_clause}
             ORDER BY l.created_at DESC
             LIMIT ? OFFSET ?"
        );
        params.push(Box::new(page_size as i64));
        params.push(Box::new((page * page_size) as i64));

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare request logs query: {e}"))?;
        let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt
            .query_map(refs.as_slice(), map_log_detail)
            .map_err(|e| format!("Failed to read request logs: {e}"))?;

        let mut data = Vec::new();
        for row in rows {
            data.push(row.map_err(|e| format!("Failed to read request log row: {e}"))?);
        }
        drop(stmt);

        // 补算落库时定价缺失的历史行；双缓存避免逐行重复查表
        let mut cache = BackfillCache::default();
        for log in data.iter_mut() {
            backfill_log_cost(&conn, log, &mut cache);
        }

        Ok(PaginatedLogs {
            data,
            total,
            page,
            page_size,
        })
    }

    /// 单条请求详情
    pub fn get_request_detail(
        &self,
        request_id: &str,
    ) -> Result<Option<RequestLogDetail>, String> {
        let conn = lock_conn!(self.conn);
        let sql = format!(
            "SELECT {LOG_DETAIL_COLUMNS}
             FROM proxy_request_logs l
             LEFT JOIN providers p ON l.provider_id = p.id AND l.app_type = p.app_type
             WHERE l.request_id = ?1"
        );

        let detail = conn
            .query_row(&sql, rusqlite::params![request_id], map_log_detail)
            .optional()
            .map_err(|e| format!("Failed to query request detail: {e}"))?;

        Ok(match detail {
            Some(mut d) => {
                let mut cache = BackfillCache::default();
                backfill_log_cost(&conn, &mut d, &mut cache);
                Some(d)
            }
            None => None,
        })
    }
}

// ============================================================================
// 成本补算（R2.4）
// ============================================================================

/// 逐行补算时的查表缓存，避免一页 20 行重复查同一模型的定价
#[derive(Default)]
struct BackfillCache {
    pricing: HashMap<String, Option<ModelPricing>>,
    multiplier: HashMap<(String, String), Decimal>,
}

/// 补算一行的成本
///
/// 触发条件：**有 token 但成本为 0** —— 即落库时定价缺失（模型不在定价表里），
/// 事后用户补了定价，历史记录就能算出真实成本。
///
/// 关键设计：直接调用 `CostCalculator::calculate`，**不重写公式**。
/// cc-switch 在这里复制了一份计算逻辑，两处实现同一公式迟早漂移；
/// 复用同一函数让漂移不可能发生。
///
/// 失败只 warn：补算是增值行为，不能让查询整体失败。
fn backfill_log_cost(
    conn: &rusqlite::Connection,
    log: &mut RequestLogDetail,
    cache: &mut BackfillCache,
) {
    let has_cost = Decimal::from_str(&log.total_cost_usd)
        .map(|c| c > Decimal::ZERO)
        .unwrap_or(false);
    let has_tokens = log.input_tokens > 0
        || log.output_tokens > 0
        || log.cache_read_tokens > 0
        || log.cache_creation_tokens > 0;

    if has_cost || !has_tokens {
        return;
    }

    let pricing = match lookup_pricing_cached(conn, cache, &log.model) {
        Some(p) => p,
        None => return, // 定价仍然缺失，保持 0
    };
    let multiplier = lookup_multiplier_cached(conn, cache, &log.provider_id, &log.app_type);

    let usage = TokenUsage {
        input_tokens: log.input_tokens,
        output_tokens: log.output_tokens,
        cache_read_tokens: log.cache_read_tokens,
        cache_creation_tokens: log.cache_creation_tokens,
        model: None,
    };
    let cost = CostCalculator::calculate_for_app(&log.app_type, &usage, &pricing, multiplier);

    log.input_cost_usd = cost.input_cost.to_string();
    log.output_cost_usd = cost.output_cost.to_string();
    log.cache_read_cost_usd = cost.cache_read_cost.to_string();
    log.cache_creation_cost_usd = cost.cache_creation_cost.to_string();
    log.total_cost_usd = cost.total_cost.to_string();
    log.cost_multiplier = multiplier.to_string();

    if let Err(e) = conn.execute(
        "UPDATE proxy_request_logs
         SET input_cost_usd = ?1, output_cost_usd = ?2, cache_read_cost_usd = ?3,
             cache_creation_cost_usd = ?4, total_cost_usd = ?5, cost_multiplier = ?6
         WHERE request_id = ?7",
        rusqlite::params![
            log.input_cost_usd,
            log.output_cost_usd,
            log.cache_read_cost_usd,
            log.cache_creation_cost_usd,
            log.total_cost_usd,
            log.cost_multiplier,
            log.request_id,
        ],
    ) {
        tracing::warn!("[Usage] 成本补算回写失败 (request_id={}): {e}", log.request_id);
    }
}

/// 带缓存的定价查表（含清洗 + 前缀兜底，与 `find_model_pricing` 同逻辑）
fn lookup_pricing_cached(
    conn: &rusqlite::Connection,
    cache: &mut BackfillCache,
    model: &str,
) -> Option<ModelPricing> {
    if let Some(hit) = cache.pricing.get(model) {
        return hit.clone();
    }

    let cleaned = clean_model_id(model);
    let row = conn
        .query_row(
            "SELECT input_cost_per_million, output_cost_per_million,
                    cache_read_cost_per_million, cache_creation_cost_per_million
             FROM model_pricing
             WHERE model_id = ?1
                OR ?1 LIKE model_id || '%'
             ORDER BY CASE WHEN model_id = ?1 THEN 0 ELSE 1 END,
                      LENGTH(model_id) DESC
             LIMIT 1",
            rusqlite::params![cleaned],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .unwrap_or(None);

    let pricing = row.and_then(|(i, o, cr, cc)| ModelPricing::from_strings(&i, &o, &cr, &cc).ok());
    cache.pricing.insert(model.to_string(), pricing.clone());
    pricing
}

/// 带缓存的倍率查表
///
/// 优先级链必须与 `UsageLogger::resolve_pricing_config` 完全一致：
/// `provider.meta.costMultiplier` → `app_configs.default_cost_multiplier:{app}` → 1。
///
/// 早期版本这里漏了全局倍率那一层，导致「配了全局 1.5 倍又补算历史行」时
/// 补出来的成本只有实时的 1/1.5 倍 —— 同一批数据两个口径。
fn lookup_multiplier_cached(
    conn: &rusqlite::Connection,
    cache: &mut BackfillCache,
    provider_id: &str,
    app_type: &str,
) -> Decimal {
    let key = (provider_id.to_string(), app_type.to_string());
    if let Some(hit) = cache.multiplier.get(&key) {
        return *hit;
    }

    let provider_meta = conn
        .query_row(
            "SELECT meta FROM providers WHERE id = ?1 AND app_type = ?2",
            rusqlite::params![provider_id, app_type],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .ok()
        .flatten()
        .flatten()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|meta| {
            meta.get("costMultiplier")
                .and_then(|v| v.as_str())
                .and_then(|s| Decimal::from_str(s).ok())
        });

    let multiplier = provider_meta.unwrap_or_else(|| {
        conn.query_row(
            "SELECT value FROM app_configs WHERE key = ?1",
            rusqlite::params![format!("default_cost_multiplier:{app_type}")],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|raw| match Decimal::from_str(&raw) {
            Ok(d) => Some(d),
            Err(_) => {
                tracing::warn!("[Usage] 全局倍率不是合法数值，回退 1: {raw}");
                None
            }
        })
        .unwrap_or(Decimal::ONE)
    });

    cache.multiplier.insert(key, multiplier);
    multiplier
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_log() -> RequestLogRow {
        RequestLogRow {
            request_id: "req-1".into(),
            provider_id: "prov-1".into(),
            app_type: "claude".into(),
            model: "claude-sonnet-4-5-20250929".into(),
            request_model: Some("sonnet".into()),
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_tokens: 200,
            cache_creation_tokens: 100,
            input_cost_usd: "0.0024".into(),
            output_cost_usd: "0.0075".into(),
            cache_read_cost_usd: "0.00006".into(),
            cache_creation_cost_usd: "0.000375".into(),
            total_cost_usd: "0.010335".into(),
            latency_ms: 1200,
            first_token_ms: Some(300),
            duration_ms: Some(1200),
            status_code: 200,
            error_message: None,
            session_id: Some("sess-1".into()),
            provider_type: Some("claude".into()),
            is_streaming: true,
            cost_multiplier: "1".into(),
            created_at: 1_700_000_000,
            data_source: Some("proxy".into()),
            reasoning_effort: None,
        }
    }

    #[test]
    fn insert_and_read_back_request_log() {
        let db = Database::in_memory().unwrap();
        db.insert_request_log(&sample_log()).unwrap();

        let conn = db.conn.lock().unwrap();
        let (model, total, streaming, first_token): (String, String, i64, i64) = conn
            .query_row(
                "SELECT model, total_cost_usd, is_streaming, first_token_ms
                 FROM proxy_request_logs WHERE request_id = 'req-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();

        assert_eq!(model, "claude-sonnet-4-5-20250929");
        assert_eq!(total, "0.010335", "成本必须原样往返，不能被转成浮点");
        assert_eq!(streaming, 1);
        assert_eq!(first_token, 300);
    }

    #[test]
    fn clean_model_id_strips_prefix_suffix_and_at() {
        assert_eq!(clean_model_id("claude-haiku-4-5"), "claude-haiku-4-5");
        assert_eq!(clean_model_id("anthropic/claude-haiku-4-5"), "claude-haiku-4-5");
        assert_eq!(clean_model_id("moonshotai/kimi-k2-0905:exa"), "kimi-k2-0905");
        assert_eq!(clean_model_id("gpt-5.2-codex@low"), "gpt-5.2-codex-low");
        assert_eq!(
            clean_model_id("openai/gpt-5.2-codex@low:v2"),
            "gpt-5.2-codex-low"
        );
    }

    #[test]
    fn seeded_pricing_is_present_and_idempotent() {
        let db = Database::in_memory().unwrap();

        let count: i64 = {
            let conn = db.conn.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM model_pricing", [], |r| r.get(0))
                .unwrap()
        };
        assert!(count > 0, "seed 必须写入定价数据");

        // 再跑一次 seed：INSERT OR IGNORE 不应产生重复行
        {
            let conn = db.conn.lock().unwrap();
            crate::database::schema_seed_for_test(&conn).unwrap();
        }
        let count2: i64 = {
            let conn = db.conn.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM model_pricing", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(count, count2, "seed 必须幂等");
    }

    #[test]
    fn find_pricing_exact_beats_prefix() {
        let db = Database::in_memory().unwrap();

        // claude-opus-4-5-20251101 是精确行（5/25），claude-opus-4 是前缀行（15/75）。
        // 必须命中精确行，否则 4.5 会按 4 的价算，贵 3 倍。
        let p = db.find_model_pricing("claude-opus-4-5-20251101").unwrap();
        let p = p.expect("精确 id 应命中");
        assert_eq!(p.input_cost_per_million, "5");
        assert_eq!(p.output_cost_per_million, "25");
    }

    #[test]
    fn find_pricing_falls_back_to_longest_prefix() {
        let db = Database::in_memory().unwrap();

        // 未来快照日期：无精确行，应退到 claude-sonnet-4 前缀
        let p = db
            .find_model_pricing("claude-sonnet-4-9-20991231")
            .unwrap()
            .expect("应退到前缀行");
        assert_eq!(p.input_cost_per_million, "3");

        // 最长前缀优先：gpt-4o-mini 不能被 gpt-4o 抢走
        let mini = db.find_model_pricing("gpt-4o-mini").unwrap().unwrap();
        assert_eq!(mini.input_cost_per_million, "0.15");
        let full = db.find_model_pricing("gpt-4o").unwrap().unwrap();
        assert_eq!(full.input_cost_per_million, "2.5");
    }

    #[test]
    fn find_pricing_cleans_before_matching() {
        let db = Database::in_memory().unwrap();
        let p = db
            .find_model_pricing("anthropic/claude-sonnet-4-5-20250929")
            .unwrap()
            .expect("带前缀的模型名应清洗后命中");
        assert_eq!(p.input_cost_per_million, "3");
    }

    #[test]
    fn find_pricing_returns_none_for_unknown() {
        let db = Database::in_memory().unwrap();
        assert!(db
            .find_model_pricing("totally-unknown-model-xyz")
            .unwrap()
            .is_none());
    }

    // ---------- 聚合查询 ----------

    /// 造一条日志，允许指定时间与成本
    fn log_at(request_id: &str, created_at: i64, total_cost: &str, status: u16) -> RequestLogRow {
        RequestLogRow {
            request_id: request_id.into(),
            provider_id: "prov-1".into(),
            app_type: "claude".into(),
            model: "claude-sonnet-4-5-20250929".into(),
            request_model: Some("sonnet".into()),
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 20,
            cache_creation_tokens: 10,
            input_cost_usd: "0.1".into(),
            output_cost_usd: "0.2".into(),
            cache_read_cost_usd: "0.01".into(),
            cache_creation_cost_usd: "0.02".into(),
            total_cost_usd: total_cost.into(),
            latency_ms: 500,
            first_token_ms: Some(100),
            duration_ms: Some(500),
            status_code: status,
            error_message: None,
            session_id: None,
            provider_type: None,
            is_streaming: false,
            cost_multiplier: "1".into(),
            created_at,
            data_source: Some("proxy".to_string()),
            reasoning_effort: None,
        }
    }

    #[test]
    fn summary_aggregates_tokens_and_success_rate() {
        let db = Database::in_memory().unwrap();
        db.insert_request_log(&log_at("r1", 1000, "0.5", 200)).unwrap();
        db.insert_request_log(&log_at("r2", 2000, "0.25", 200)).unwrap();
        db.insert_request_log(&log_at("r3", 3000, "0", 500)).unwrap();

        let s = db.get_usage_summary(None, None, &StatsFilters::default()).unwrap();
        assert_eq!(s.total_requests, 3);
        assert_eq!(s.total_cost, "0.750000");
        assert_eq!(s.total_input_tokens, 300);
        assert_eq!(s.total_output_tokens, 150);
        assert_eq!(s.total_cache_read_tokens, 60);
        assert_eq!(s.total_cache_creation_tokens, 30);
        // 2/3 成功
        assert!((s.success_rate - 66.666_67).abs() < 0.01);
    }

    #[test]
    fn summary_respects_time_window() {
        let db = Database::in_memory().unwrap();
        db.insert_request_log(&log_at("old", 1_000, "1", 200)).unwrap();
        db.insert_request_log(&log_at("new", 100_000, "2", 200)).unwrap();

        let s = db.get_usage_summary(Some(50_000), Some(200_000), &StatsFilters::default()).unwrap();
        assert_eq!(s.total_requests, 1, "窗口外的记录不能计入");
        assert_eq!(s.total_cost, "2.000000");
    }

    #[test]
    fn summary_of_empty_table_is_all_zero() {
        let db = Database::in_memory().unwrap();
        let s = db.get_usage_summary(None, None, &StatsFilters::default()).unwrap();
        assert_eq!(s.total_requests, 0);
        assert_eq!(s.total_cost, "0.000000");
        assert_eq!(s.success_rate, 0.0, "空表不能除零");
    }

    #[test]
    fn trends_24h_window_yields_exactly_24_hour_buckets() {
        let db = Database::in_memory().unwrap();
        let end = 1_700_000_000i64;
        let start = end - 86_400;

        let trends = db.get_daily_trends(Some(start), Some(end), &StatsFilters::default()).unwrap();
        assert_eq!(trends.len(), 24, "≤24h 窗口固定 24 个小时桶");
    }

    #[test]
    fn trends_multi_day_window_yields_day_buckets() {
        let db = Database::in_memory().unwrap();
        let end = 1_700_000_000i64;
        let start = end - 7 * 86_400;

        let trends = db.get_daily_trends(Some(start), Some(end), &StatsFilters::default()).unwrap();
        assert_eq!(trends.len(), 7, "7 天窗口 7 个天桶");
    }

    #[test]
    fn trends_fill_empty_buckets_with_zero() {
        let db = Database::in_memory().unwrap();
        let end = 1_700_000_000i64;
        let start = end - 86_400;
        // 只在第 0 桶放一条
        db.insert_request_log(&log_at("r1", start + 60, "1.5", 200))
            .unwrap();

        let trends = db.get_daily_trends(Some(start), Some(end), &StatsFilters::default()).unwrap();
        assert_eq!(trends.len(), 24);
        assert_eq!(trends[0].request_count, 1);
        assert_eq!(trends[0].total_cost, "1.500000");

        // 其余 23 桶必须补零而非缺失 —— 缺桶会让折线图把远隔的点连成直线
        let empty = trends.iter().skip(1).filter(|t| t.request_count == 0).count();
        assert_eq!(empty, 23);
        assert!(trends.iter().all(|t| !t.date.is_empty()), "每桶都要有时间标签");
    }

    #[test]
    fn trends_buckets_are_chronologically_ordered() {
        let db = Database::in_memory().unwrap();
        let end = 1_700_000_000i64;
        let trends = db.get_daily_trends(Some(end - 86_400), Some(end), &StatsFilters::default()).unwrap();

        let dates: Vec<&str> = trends.iter().map(|t| t.date.as_str()).collect();
        let mut sorted = dates.clone();
        sorted.sort_unstable();
        assert_eq!(dates, sorted, "桶必须按时间升序");
    }

    #[test]
    fn trends_handles_inverted_window_by_falling_back() {
        let db = Database::in_memory().unwrap();
        // start > end：应回退成 end 前 24h，而不是 panic 或返回空
        let trends = db.get_daily_trends(Some(2_000_000), Some(1_000_000), &StatsFilters::default()).unwrap();
        assert_eq!(trends.len(), 24);
    }

    #[test]
    fn trends_place_boundary_request_in_last_bucket() {
        let db = Database::in_memory().unwrap();
        let end = 1_700_000_000i64;
        let start = end - 86_400;
        // created_at == end 会算出 bucket_idx == 24（越界），必须归并到末桶
        db.insert_request_log(&log_at("edge", end, "1", 200)).unwrap();

        let trends = db.get_daily_trends(Some(start), Some(end), &StatsFilters::default()).unwrap();
        assert_eq!(trends.len(), 24);
        assert_eq!(
            trends[23].request_count, 1,
            "边界请求应落在末桶，不能凭空丢失"
        );
    }

    #[test]
    fn provider_stats_join_name_and_compute_rates() {
        let db = Database::in_memory().unwrap();
        db.insert_request_log(&log_at("r1", 1000, "1", 200)).unwrap();
        db.insert_request_log(&log_at("r2", 2000, "1", 500)).unwrap();

        let stats = db.get_provider_stats(None, None, &StatsFilters::default()).unwrap();
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].provider_id, "prov-1");
        // provider 表里没有这条记录 → 回落到 provider_id，历史记录仍可辨认
        assert_eq!(stats[0].provider_name, "prov-1");
        assert_eq!(stats[0].request_count, 2);
        // 真实消耗 = (100 + 50 + 10 + 20) × 2
        assert_eq!(stats[0].total_tokens, 360);
        assert!((stats[0].success_rate - 50.0).abs() < 0.01);
        assert_eq!(stats[0].avg_latency_ms, 500);
    }

    /// G-2 回归：时间范围必须真的过滤掉窗口外的记录。
    ///
    /// 修复前这两张表完全无视时间窗口，UI 切 1d/7d/30d 时数字纹丝不动。
    #[test]
    fn provider_and_model_stats_respect_time_window() {
        let db = Database::in_memory().unwrap();
        // created_at: 1000（旧）与 5000（新）
        db.insert_request_log(&log_at("old", 1000, "1", 200)).unwrap();
        db.insert_request_log(&log_at("new", 5000, "1", 200)).unwrap();

        let windowed = db.get_provider_stats(Some(4000), Some(6000), &StatsFilters::default()).unwrap();
        assert_eq!(windowed.len(), 1);
        assert_eq!(windowed[0].request_count, 1, "窗口外的记录必须被过滤");

        let all = db.get_provider_stats(None, None, &StatsFilters::default()).unwrap();
        assert_eq!(all[0].request_count, 2, "不限窗口时应返回全部");

        let models = db.get_model_stats(Some(4000), Some(6000), &StatsFilters::default()).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].request_count, 1);
    }

    /// 顶部筛选行：应用 / 供应商 / 模型三个筛选必须同时作用于汇总、趋势与两张统计表
    #[test]
    fn stats_respect_app_provider_and_model_filters() {
        let db = Database::in_memory().unwrap();
        // claude / prov-1 / claude-sonnet-4-5-20250929
        db.insert_request_log(&log_at("c1", 1000, "1", 200)).unwrap();
        // codex / prov-2 / gpt-5.2
        let mut codex = log_at("x1", 1000, "1", 200);
        codex.provider_id = "prov-2".into();
        codex.app_type = "codex".into();
        codex.model = "gpt-5.2".into();
        db.insert_request_log(&codex).unwrap();

        // 应用筛选
        let by_app = db
            .get_provider_stats(
                None,
                None,
                &StatsFilters {
                    app_type: Some("codex".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(by_app.len(), 1);
        assert_eq!(by_app[0].app_type, "codex");
        assert_eq!(by_app[0].request_count, 1);

        // 供应商筛选：没有 providers 记录时按 provider_id 回落匹配
        let by_provider = db
            .get_model_stats(
                None,
                None,
                &StatsFilters {
                    provider_name: Some("prov-1".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(by_provider.len(), 1);
        assert_eq!(by_provider[0].model, "claude-sonnet-4-5-20250929");

        // 模型筛选（汇总卡也要跟随）
        let by_model = db
            .get_usage_summary(
                None,
                None,
                &StatsFilters {
                    model: Some("gpt-5.2".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(by_model.total_requests, 1);
        assert_eq!(by_model.total_output_tokens, 50);

        // 趋势同样吃筛选：窗口内两条记录，按应用筛选后只剩 claude 那条
        let trends = db
            .get_daily_trends(
                Some(0),
                Some(10_000),
                &StatsFilters {
                    app_type: Some("claude".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        let total: u64 = trends.iter().map(|t| t.request_count).sum();
        assert_eq!(total, 1, "趋势图也要跟随筛选");
    }

    /// 供应商的 total_tokens 是真实消耗，各行之和必须等于汇总卡的真实消耗
    #[test]
    fn provider_stats_total_matches_summary_real_total() {
        let db = Database::in_memory().unwrap();
        // log_at 默认 input=100 / output=50 / cache_read=20 / cache_creation=10
        db.insert_request_log(&log_at("r1", 1000, "1", 200)).unwrap();

        let stats = db.get_provider_stats(None, None, &StatsFilters::default()).unwrap();
        assert_eq!(stats[0].total_tokens, 180);
        assert_eq!(stats[0].cache_read_tokens, 20);
        assert_eq!(stats[0].cache_creation_tokens, 10);

        let summary = db.get_usage_summary(None, None, &StatsFilters::default()).unwrap();
        assert_eq!(summary.real_total_tokens, 180);
    }

    /// 缓存命中率：命中 ÷（新鲜输入 + 写入 + 命中）；Codex 的输入含缓存，要先扣
    #[test]
    fn summary_cache_hit_rate_normalizes_cache_inclusive_input() {
        let db = Database::in_memory().unwrap();
        // Claude：input=100（新鲜）/ cache_read=20 / cache_creation=10
        db.insert_request_log(&log_at("claude-1", 1000, "1", 200)).unwrap();
        // Codex：input=1000 含 600 命中 → 新鲜输入 400
        let mut codex = log_at("codex-1", 1000, "1", 200);
        codex.app_type = "codex".into();
        codex.input_tokens = 1000;
        codex.cache_read_tokens = 600;
        codex.cache_creation_tokens = 0;
        db.insert_request_log(&codex).unwrap();

        let s = db.get_usage_summary(None, None, &StatsFilters::default()).unwrap();
        assert_eq!(s.total_input_tokens, 100 + 400, "Codex 的命中不能再算进输入");
        // 命中 620 ÷（新鲜 500 + 写入 10 + 命中 620）
        let expected = 620.0 / 1130.0;
        assert!((s.cache_hit_rate - expected).abs() < 1e-9);
        assert_eq!(s.real_total_tokens, 500 + 100 + 10 + 620);
    }

    /// 会话文件导入的行显示占位名，前端据此翻译成「Claude · 会话日志」
    #[test]
    fn provider_stats_label_session_rows() {
        let db = Database::in_memory().unwrap();
        let mut claude = log_at("s1", 1000, "1", 200);
        claude.provider_id = "_session".into();
        db.insert_request_log(&claude).unwrap();
        let mut codex = log_at("s2", 1000, "1", 200);
        codex.provider_id = "_codex_session".into();
        codex.app_type = "codex".into();
        db.insert_request_log(&codex).unwrap();

        let names: Vec<String> = db
            .get_provider_stats(None, None, &StatsFilters::default())
            .unwrap()
            .into_iter()
            .map(|s| s.provider_name)
            .collect();
        assert!(names.contains(&"Claude (Session)".to_string()));
        assert!(names.contains(&"Codex (Session)".to_string()));
    }

    #[test]
    fn reasoning_effort_round_trips_and_backfills_existing_rows() {
        let db = Database::in_memory().unwrap();
        let mut row = log_at("e1", 1000, "1", 200);
        row.reasoning_effort = Some("xhigh".into());
        db.insert_request_log(&row).unwrap();
        let detail = db.get_request_detail("e1").unwrap().unwrap();
        assert_eq!(detail.reasoning_effort.as_deref(), Some("xhigh"));

        // 升级前导入的行没有思考强度：重扫时只回填它，不算新增
        let legacy = log_at("e2", 1000, "1", 200);
        db.insert_request_log(&legacy).unwrap();
        let mut rescanned = legacy.clone();
        rescanned.reasoning_effort = Some("medium".into());
        let inserted = db
            .commit_session_file(&[rescanned], "f", 1, 1, 1, None, None)
            .unwrap();
        assert_eq!(inserted, 0, "已存在的行不算新增");
        let detail = db.get_request_detail("e2").unwrap().unwrap();
        assert_eq!(detail.reasoning_effort.as_deref(), Some("medium"));

        // 已有值的行不被覆盖
        let mut other = row.clone();
        other.reasoning_effort = Some("low".into());
        db.commit_session_file(&[other], "f", 1, 1, 1, None, None).unwrap();
        let detail = db.get_request_detail("e1").unwrap().unwrap();
        assert_eq!(detail.reasoning_effort.as_deref(), Some("xhigh"));
    }

    #[test]
    fn session_row_latency_backfills_existing_rows() {
        let db = Database::in_memory().unwrap();

        // 升级前导入的会话行：latency_ms = 0、duration_ms = 0（旧代码写死的占位）
        let mut legacy = log_at("s1", 1000, "0", 200);
        legacy.data_source = Some("session_log".into());
        legacy.latency_ms = 0;
        legacy.first_token_ms = None;
        legacy.duration_ms = Some(0);
        db.insert_request_log(&legacy).unwrap();

        // 重扫：带上估算出的耗时，回填而不算新增
        let mut rescanned = legacy.clone();
        rescanned.latency_ms = 8000;
        rescanned.duration_ms = None;
        let inserted = db
            .commit_session_file(&[rescanned], "f", 1, 1, 1, None, None)
            .unwrap();
        assert_eq!(inserted, 0, "已存在的行不算新增");
        let detail = db.get_request_detail("s1").unwrap().unwrap();
        assert_eq!(detail.latency_ms, 8000);
        assert_eq!(detail.duration_ms, None, "旧代码的 duration_ms = 0 应被清成 NULL");

        // 代理行已有真实耗时：不被估算值覆盖
        let mut proxy = log_at("p1", 1000, "1", 200);
        proxy.latency_ms = 500;
        db.insert_request_log(&proxy).unwrap();
        let mut rescan_again = proxy.clone();
        rescan_again.latency_ms = 9000;
        db.commit_session_file(&[rescan_again], "f", 1, 1, 1, None, None)
            .unwrap();
        let detail = db.get_request_detail("p1").unwrap().unwrap();
        assert_eq!(detail.latency_ms, 500, "不覆盖已有的真实耗时");
    }

    #[test]
    fn log_provider_name_matches_stats_expression() {
        let expected = provider_name_coalesce("l", "p")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(LOG_PROVIDER_NAME, expected);
        assert!(LOG_DETAIL_COLUMNS.contains(LOG_PROVIDER_NAME));
    }

    /// 速度只统计有首字耗时、输出足够长的请求：Σ输出 ÷ Σ(总耗时 - 首字)
    #[test]
    fn provider_stats_speed_uses_eligible_streaming_rows() {
        let db = Database::in_memory().unwrap();
        let mut fast = log_at("f1", 1000, "1", 200);
        fast.output_tokens = 500;
        fast.latency_ms = 6000;
        fast.first_token_ms = Some(1000);
        db.insert_request_log(&fast).unwrap();
        // 输出太短：不参与
        let mut short = log_at("f2", 1000, "1", 200);
        short.output_tokens = 20;
        short.latency_ms = 3000;
        short.first_token_ms = Some(500);
        db.insert_request_log(&short).unwrap();
        // 没有首字耗时（非流式 / 会话导入）：不参与
        let mut plain = log_at("f3", 1000, "1", 200);
        plain.output_tokens = 800;
        plain.first_token_ms = None;
        db.insert_request_log(&plain).unwrap();

        let s = &db.get_provider_stats(None, None, &StatsFilters::default()).unwrap()[0];
        assert_eq!(s.speed_output_tokens, 500);
        assert_eq!(s.speed_generation_ms, 5000);
    }

    /// 估算速度只统计会话日志导入、有估算耗时、输出足够长的请求：Σ输出 ÷ Σ耗时
    #[test]
    fn provider_stats_estimated_speed_sums_session_rows() {
        let db = Database::in_memory().unwrap();
        let insert = |id: &str, output: i64, latency: i64, source: &str| {
            let mut row = log_at(id, 1000, "1", 200);
            row.output_tokens = output as u32;
            row.latency_ms = latency as u64;
            row.first_token_ms = None;
            row.data_source = Some(source.to_string());
            db.insert_request_log(&row).unwrap();
        };
        // 计入：2000 token / 20000 ms
        insert("ok-a", 2_000, 20_000, "session_log");
        // 计入：200 token / 5000 ms
        insert("ok-b", 200, 5_000, "session_log");
        // 不计：输出不到 200
        insert("short", 199, 5_000, "session_log");
        // 不计：没估出耗时（0）
        insert("no-timing", 3_000, 0, "session_log");
        // 不计：耗时不到 1 秒
        insert("too-fast", 800, 900, "session_log");
        // 不计：路由服务记的行（data_source = proxy）
        insert("proxy-row", 2_000, 20_000, "proxy");

        let s = &db.get_provider_stats(None, None, &StatsFilters::default()).unwrap()[0];
        assert_eq!(s.est_speed_output_tokens, 2_200);
        assert_eq!(s.est_speed_duration_ms, 25_000);
        // 估算的不混进精确口径
        assert_eq!(s.speed_output_tokens, 0);
        assert_eq!(s.speed_generation_ms, 0);
    }

    #[test]
    fn model_stats_compute_average_cost() {
        let db = Database::in_memory().unwrap();
        db.insert_request_log(&log_at("r1", 1000, "1", 200)).unwrap();
        db.insert_request_log(&log_at("r2", 2000, "3", 200)).unwrap();

        let stats = db.get_model_stats(None, None, &StatsFilters::default()).unwrap();
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].total_cost, "4.000000");
        assert_eq!(stats[0].avg_cost_per_request, "2.000000");
    }

    /// G-3：限额判定。没配限额时不能判超限 —— 没设限额不等于用超了。
    #[test]
    fn provider_limits_only_flag_when_configured_and_exceeded() {
        let db = Database::in_memory().unwrap();
        let now = Local::now().timestamp();

        // 未配限额 → 不超限
        let (name, daily, monthly) = db.get_provider_limits("prov-1", "claude").unwrap();
        assert_eq!(name, "Unknown");
        assert!(daily.is_none() && monthly.is_none());

        // 用量口径：本地时区的今天/本月
        let (d, m) = db.get_provider_period_usage("prov-1", "claude").unwrap();
        assert_eq!(d, "0.000000");
        assert_eq!(m, "0.000000");

        // 不在窗口内的历史记录不计入今日/本月
        db.insert_request_log(&log_at("old", now - 40 * DAY_SECONDS, "1", 200))
            .unwrap();
        let (d2, m2) = db.get_provider_period_usage("prov-1", "claude").unwrap();
        assert_eq!(d2, "0.000000", "40 天前的记录不该算进今日");
        assert_eq!(m2, "0.000000", "40 天前的记录不该算进本月");
    }

    // ---------- 分页与过滤 ----------

    #[test]
    fn request_logs_paginate_newest_first() {
        let db = Database::in_memory().unwrap();
        for i in 0..25 {
            db.insert_request_log(&log_at(&format!("r{i}"), 1000 + i, "1", 200))
                .unwrap();
        }

        let page0 = db.get_request_logs(&LogFilters::default(), 0, 10).unwrap();
        assert_eq!(page0.total, 25);
        assert_eq!(page0.data.len(), 10);
        assert_eq!(page0.data[0].request_id, "r24", "应按时间倒序");

        let page2 = db.get_request_logs(&LogFilters::default(), 2, 10).unwrap();
        assert_eq!(page2.data.len(), 5, "末页只剩 5 条");
        assert_eq!(page2.page, 2);
    }

    #[test]
    fn request_logs_filter_by_status_code() {
        let db = Database::in_memory().unwrap();
        db.insert_request_log(&log_at("ok", 1000, "1", 200)).unwrap();
        db.insert_request_log(&log_at("err", 2000, "0", 401)).unwrap();

        let filters = LogFilters {
            status_code: Some(401),
            ..Default::default()
        };
        let result = db.get_request_logs(&filters, 0, 20).unwrap();
        assert_eq!(result.total, 1);
        assert_eq!(result.data[0].request_id, "err");
    }

    #[test]
    fn request_logs_filter_by_model_exact() {
        let db = Database::in_memory().unwrap();
        db.insert_request_log(&log_at("r1", 1000, "1", 200)).unwrap();
        let mut other = log_at("r2", 2000, "1", 200);
        other.model = "claude-sonnet-4-5-20250929-mini".into();
        db.insert_request_log(&other).unwrap();

        // 顶部下拉给的是精确模型名：前缀相同的另一个模型不能被算进来
        // （旧的模糊匹配会把 -mini 也算上，和下拉里显示的计数对不上）
        let filters = LogFilters {
            model: Some("claude-sonnet-4-5-20250929".into()),
            ..Default::default()
        };
        let result = db.get_request_logs(&filters, 0, 20).unwrap();
        assert_eq!(result.total, 1);
        assert_eq!(result.data[0].request_id, "r1");
    }

    #[test]
    fn request_logs_filter_by_time_range() {
        let db = Database::in_memory().unwrap();
        db.insert_request_log(&log_at("old", 1_000, "1", 200)).unwrap();
        db.insert_request_log(&log_at("new", 100_000, "1", 200)).unwrap();

        let filters = LogFilters {
            start_date: Some(50_000),
            ..Default::default()
        };
        let result = db.get_request_logs(&filters, 0, 20).unwrap();
        assert_eq!(result.total, 1);
        assert_eq!(result.data[0].request_id, "new");
    }

    #[test]
    fn request_detail_round_trips_all_fields() {
        let db = Database::in_memory().unwrap();
        db.insert_request_log(&sample_log()).unwrap();

        let detail = db.get_request_detail("req-1").unwrap().expect("should exist");
        assert_eq!(detail.request_id, "req-1");
        assert_eq!(detail.model, "claude-sonnet-4-5-20250929");
        assert_eq!(detail.request_model.as_deref(), Some("sonnet"));
        assert_eq!(detail.input_tokens, 1000);
        assert_eq!(detail.cache_read_tokens, 200);
        assert_eq!(detail.total_cost_usd, "0.010335");
        assert!(detail.is_streaming);
        assert_eq!(detail.first_token_ms, Some(300));
        assert_eq!(detail.cost_multiplier, "1");
    }

    #[test]
    fn request_detail_returns_none_for_missing_id() {
        let db = Database::in_memory().unwrap();
        assert!(db.get_request_detail("nope").unwrap().is_none());
    }

    // ---------- 成本补算 ----------

    /// 落库时定价缺失（成本 0 但有 token）→ 查询时补算并回写
    #[test]
    fn backfill_recomputes_zero_cost_rows() {
        let db = Database::in_memory().unwrap();
        // 1M input / 0 output，成本记 0 —— 模拟落库时 model_pricing 里没这个模型
        let mut row = log_at("r1", 1000, "0", 200);
        row.input_tokens = 1_000_000;
        row.output_tokens = 0;
        row.cache_read_tokens = 0;
        row.cache_creation_tokens = 0;
        row.input_cost_usd = "0".into();
        row.output_cost_usd = "0".into();
        row.cache_read_cost_usd = "0".into();
        row.cache_creation_cost_usd = "0".into();
        db.insert_request_log(&row).unwrap();

        let detail = db.get_request_detail("r1").unwrap().unwrap();
        // Sonnet 4.5 input $3/1M
        assert_eq!(detail.total_cost_usd, "3", "应按当前定价补算");
        assert_eq!(detail.input_cost_usd, "3");

        // 必须已回写 DB，不是只改内存
        let conn = db.conn.lock().unwrap();
        let stored: String = conn
            .query_row(
                "SELECT total_cost_usd FROM proxy_request_logs WHERE request_id = 'r1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, "3", "补算结果必须回写");
    }

    #[test]
    fn backfill_skips_rows_that_already_have_cost() {
        let db = Database::in_memory().unwrap();
        // 故意存一个"错"的成本，验证补算不会覆盖已有值
        let mut row = log_at("r1", 1000, "999", 200);
        row.input_tokens = 1_000_000;
        db.insert_request_log(&row).unwrap();

        let detail = db.get_request_detail("r1").unwrap().unwrap();
        assert_eq!(detail.total_cost_usd, "999", "已有成本不能被改写");
    }

    #[test]
    fn backfill_skips_rows_without_tokens() {
        let db = Database::in_memory().unwrap();
        // 错误请求：无 token、成本 0 —— 不该被补算成非 0
        let mut row = log_at("err", 1000, "0", 401);
        row.input_tokens = 0;
        row.output_tokens = 0;
        row.cache_read_tokens = 0;
        row.cache_creation_tokens = 0;
        db.insert_request_log(&row).unwrap();

        let detail = db.get_request_detail("err").unwrap().unwrap();
        assert_eq!(detail.total_cost_usd, "0", "无 token 的行保持 0");
    }

    #[test]
    fn backfill_leaves_zero_when_pricing_still_missing() {
        let db = Database::in_memory().unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute("DELETE FROM model_pricing", []).unwrap();
        }
        let mut row = log_at("r1", 1000, "0", 200);
        row.input_tokens = 1_000_000;
        db.insert_request_log(&row).unwrap();

        let detail = db.get_request_detail("r1").unwrap().unwrap();
        assert_eq!(detail.total_cost_usd, "0", "定价仍缺失就保持 0，不能猜");
    }

    #[test]
    fn backfill_applies_provider_multiplier() {
        let db = Database::in_memory().unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO providers (id, name, app_type, api_key, meta, is_active, created_at, in_failover_queue, sort_order)
                 VALUES ('prov-1', 'P', 'claude', 'k', '{\"costMultiplier\":\"2\"}', 0, 0, 0, 0)",
                [],
            )
            .unwrap();
        }
        let mut row = log_at("r1", 1000, "0", 200);
        row.input_tokens = 1_000_000;
        row.output_tokens = 0;
        row.cache_read_tokens = 0;
        row.cache_creation_tokens = 0;
        db.insert_request_log(&row).unwrap();

        let detail = db.get_request_detail("r1").unwrap().unwrap();
        assert_eq!(detail.input_cost_usd, "3", "分项是基础价");
        assert_eq!(detail.total_cost_usd, "6", "总价含倍率");
        assert_eq!(detail.cost_multiplier, "2");
    }

    /// 补算与实时计费必须给出同一结果
    ///
    /// 两条路径都调 `CostCalculator::calculate`，所以这里断言的是"复用生效了"，
    /// 而非"两份拷贝碰巧一致"。
    #[test]
    fn backfill_matches_live_calculator_exactly() {
        use crate::proxy::usage::calculator::{CostCalculator, ModelPricing};
        use crate::proxy::usage::parser::TokenUsage;

        let db = Database::in_memory().unwrap();
        let mut row = log_at("r1", 1000, "0", 200);
        row.input_tokens = 12_345;
        row.output_tokens = 6_789;
        row.cache_read_tokens = 2_222;
        row.cache_creation_tokens = 1_111;
        row.input_cost_usd = "0".into();
        row.output_cost_usd = "0".into();
        row.cache_read_cost_usd = "0".into();
        row.cache_creation_cost_usd = "0".into();
        db.insert_request_log(&row).unwrap();

        let backfilled = db.get_request_detail("r1").unwrap().unwrap();

        let expected = CostCalculator::calculate_for_app(
            "claude",
            &TokenUsage {
                input_tokens: 12_345,
                output_tokens: 6_789,
                cache_read_tokens: 2_222,
                cache_creation_tokens: 1_111,
                model: None,
            },
            &ModelPricing::from_strings("3", "15", "0.30", "3.75").unwrap(),
            Decimal::ONE,
        );

        assert_eq!(backfilled.input_cost_usd, expected.input_cost.to_string());
        assert_eq!(backfilled.output_cost_usd, expected.output_cost.to_string());
        assert_eq!(
            backfilled.cache_read_cost_usd,
            expected.cache_read_cost.to_string()
        );
        assert_eq!(
            backfilled.cache_creation_cost_usd,
            expected.cache_creation_cost.to_string()
        );
        assert_eq!(backfilled.total_cost_usd, expected.total_cost.to_string());
    }

    #[test]
    fn backfill_runs_for_paginated_list_too() {
        let db = Database::in_memory().unwrap();
        for i in 0..3 {
            let mut row = log_at(&format!("r{i}"), 1000 + i, "0", 200);
            row.input_tokens = 1_000_000;
            row.output_tokens = 0;
            row.cache_read_tokens = 0;
            row.cache_creation_tokens = 0;
            db.insert_request_log(&row).unwrap();
        }

        let result = db.get_request_logs(&LogFilters::default(), 0, 20).unwrap();
        assert_eq!(result.data.len(), 3);
        assert!(
            result.data.iter().all(|l| l.total_cost_usd == "3"),
            "列表查询也要补算"
        );
    }

    #[test]
    fn upsert_then_delete_pricing() {
        let db = Database::in_memory().unwrap();
        let pricing = ModelPricingRow {
            input_cost_per_million: "9.5".into(),
            output_cost_per_million: "19".into(),
            cache_read_cost_per_million: "0.95".into(),
            cache_creation_cost_per_million: "11.875".into(),
        };

        db.upsert_model_pricing("my-model", "My Model", &pricing)
            .unwrap();
        let got = db.find_model_pricing("my-model").unwrap().unwrap();
        assert_eq!(got.input_cost_per_million, "9.5");

        db.delete_model_pricing("my-model").unwrap();
        assert!(db.find_model_pricing("my-model").unwrap().is_none());
    }
}
