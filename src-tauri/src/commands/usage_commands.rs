//! 用量统计命令
//!
//! 纯读路径（除定价增删改），不参与转发。
//!
//! 所有命令都是 `async` + `spawn_blocking`：SQLite 调用是阻塞的，而同步 command
//! 在 Tauri 里跑在主线程上 —— 聚合查询、尤其是会话文件扫描期间，整个窗口会卡住。

use crate::database::dao::usage_logs::ModelPricingRow;
use crate::database::Database;
use crate::models::usage::{
    DailyStats, LogFilters, ModelPricingInfo, ModelStats, PaginatedLogs, ProviderLimitStatus,
    ProviderStats, RequestLogDetail, UsageSummary,
};
use crate::proxy::usage::logger::{default_multiplier_key, pricing_model_source_key};
use crate::store::AppState;
use std::str::FromStr;
use tauri::State;

/// 把阻塞的数据库调用丢到阻塞线程池，主线程与 async 运行时都不被占住
async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("后台任务执行失败: {e}"))?
}

/// 汇总卡片
#[tauri::command]
pub async fn get_usage_summary(
    state: State<'_, AppState>,
    start_date: Option<i64>,
    end_date: Option<i64>,
) -> Result<UsageSummary, String> {
    let db = state.db.clone();
    run_blocking(move || db.get_usage_summary(start_date, end_date)).await
}

/// 趋势图分桶数据
#[tauri::command]
pub async fn get_usage_trends(
    state: State<'_, AppState>,
    start_date: Option<i64>,
    end_date: Option<i64>,
) -> Result<Vec<DailyStats>, String> {
    let db = state.db.clone();
    run_blocking(move || db.get_daily_trends(start_date, end_date)).await
}

/// 按 provider 聚合
///
/// 时间窗口与汇总卡一致 —— 前端时间范围切换器覆盖全部统计表。
#[tauri::command]
pub async fn get_provider_stats(
    state: State<'_, AppState>,
    start_date: Option<i64>,
    end_date: Option<i64>,
) -> Result<Vec<ProviderStats>, String> {
    let db = state.db.clone();
    run_blocking(move || db.get_provider_stats(start_date, end_date)).await
}

/// 按模型聚合
#[tauri::command]
pub async fn get_model_stats(
    state: State<'_, AppState>,
    start_date: Option<i64>,
    end_date: Option<i64>,
) -> Result<Vec<ModelStats>, String> {
    let db = state.db.clone();
    run_blocking(move || db.get_model_stats(start_date, end_date)).await
}

/// 请求日志分页
#[tauri::command]
pub async fn get_request_logs(
    state: State<'_, AppState>,
    filters: Option<LogFilters>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<PaginatedLogs, String> {
    let db = state.db.clone();
    let filters = filters.unwrap_or_default();
    run_blocking(move || {
        db.get_request_logs(&filters, page.unwrap_or(0), page_size.unwrap_or(20))
    })
    .await
}

/// 单条请求详情
#[tauri::command]
pub async fn get_request_detail(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<Option<RequestLogDetail>, String> {
    let db = state.db.clone();
    run_blocking(move || db.get_request_detail(&request_id)).await
}

/// 定价列表
#[tauri::command]
pub async fn get_model_pricing(
    state: State<'_, AppState>,
) -> Result<Vec<ModelPricingInfo>, String> {
    let db = state.db.clone();
    run_blocking(move || {
        let rows = db.list_model_pricing()?;
        Ok(rows
            .into_iter()
            .map(|(model_id, display_name, p)| ModelPricingInfo {
                model_id,
                display_name,
                input_cost_per_million: p.input_cost_per_million,
                output_cost_per_million: p.output_cost_per_million,
                cache_read_cost_per_million: p.cache_read_cost_per_million,
                cache_creation_cost_per_million: p.cache_creation_cost_per_million,
            })
            .collect())
    })
    .await
}

/// 新增或修改定价
#[tauri::command]
pub async fn update_model_pricing(
    state: State<'_, AppState>,
    model_id: String,
    display_name: String,
    input_cost: String,
    output_cost: String,
    cache_read_cost: String,
    cache_creation_cost: String,
) -> Result<(), String> {
    if model_id.trim().is_empty() {
        return Err("模型 ID 不能为空".to_string());
    }

    // 提前校验：非法数值存进去会导致后续所有该模型的请求成本记 0
    for (label, value) in [
        ("输入单价", &input_cost),
        ("输出单价", &output_cost),
        ("缓存读取单价", &cache_read_cost),
        ("缓存写入单价", &cache_creation_cost),
    ] {
        match rust_decimal::Decimal::from_str_exact(value) {
            Err(_) => return Err(format!("{label}不是合法数值: {value}")),
            // 负价格会让总成本为负，汇总与趋势图直接失真，必须在后端拦住
            Ok(d) if d.is_sign_negative() => {
                return Err(format!("{label}不能为负数: {value}"));
            }
            _ => {}
        }
    }

    let db = state.db.clone();
    run_blocking(move || {
        db.upsert_model_pricing(
            model_id.trim(),
            display_name.trim(),
            &ModelPricingRow {
                input_cost_per_million: input_cost,
                output_cost_per_million: output_cost,
                cache_read_cost_per_million: cache_read_cost,
                cache_creation_cost_per_million: cache_creation_cost,
            },
        )
    })
    .await
}

/// 删除定价
#[tauri::command]
pub async fn delete_model_pricing(
    state: State<'_, AppState>,
    model_id: String,
) -> Result<(), String> {
    let db = state.db.clone();
    run_blocking(move || db.delete_model_pricing(&model_id)).await
}

// ---------- 全局计费配置（R8.2）----------

/// 读全局默认倍率
#[tauri::command]
pub async fn get_default_cost_multiplier(
    state: State<'_, AppState>,
    app_type: String,
) -> Result<String, String> {
    let db = state.db.clone();
    run_blocking(move || {
        Ok(db
            .get_app_config(&default_multiplier_key(&app_type))?
            .unwrap_or_else(|| "1".to_string()))
    })
    .await
}

/// 设全局默认倍率
#[tauri::command]
pub async fn set_default_cost_multiplier(
    state: State<'_, AppState>,
    app_type: String,
    value: String,
) -> Result<(), String> {
    match rust_decimal::Decimal::from_str_exact(&value) {
        Err(_) => return Err(format!("倍率不是合法数值: {value}")),
        // 负倍率会算出负成本
        Ok(d) if d.is_sign_negative() => return Err(format!("倍率不能为负数: {value}")),
        _ => {}
    }
    let db = state.db.clone();
    run_blocking(move || db.set_app_config(&default_multiplier_key(&app_type), &value)).await
}

/// 读全局定价模型来源
#[tauri::command]
pub async fn get_pricing_model_source(
    state: State<'_, AppState>,
    app_type: String,
) -> Result<String, String> {
    let db = state.db.clone();
    run_blocking(move || {
        Ok(db
            .get_app_config(&pricing_model_source_key(&app_type))?
            .unwrap_or_else(|| "response".to_string()))
    })
    .await
}

/// 设全局定价模型来源
#[tauri::command]
pub async fn set_pricing_model_source(
    state: State<'_, AppState>,
    app_type: String,
    value: String,
) -> Result<(), String> {
    if value != "response" && value != "request" {
        return Err(format!("计费模型来源只能是 response 或 request: {value}"));
    }
    let db = state.db.clone();
    run_blocking(move || db.set_app_config(&pricing_model_source_key(&app_type), &value)).await
}

// ---------- 配额限额 ----------

/// 查某 provider 的日/月用量与限额状态
///
/// 限额读 `providers.meta.limitDailyUsd` / `limitMonthlyUsd`；
/// 未配置限额时对应 limit 为 None、exceeded 为 false —— 没设限额不等于超限。
#[tauri::command]
pub async fn check_provider_limits(
    state: State<'_, AppState>,
    provider_id: String,
    app_type: String,
) -> Result<ProviderLimitStatus, String> {
    let db = state.db.clone();
    run_blocking(move || {
        let (provider_name, daily_limit, monthly_limit) =
            db.get_provider_limits(&provider_id, &app_type)?;
        let (daily_usage, monthly_usage) = db.get_provider_period_usage(&provider_id, &app_type)?;

        Ok(ProviderLimitStatus {
            provider_name,
            app_type,
            provider_id,
            daily_exceeded: exceeds_limit(&daily_usage, daily_limit.as_deref()),
            daily_usage,
            daily_limit,
            monthly_exceeded: exceeds_limit(&monthly_usage, monthly_limit.as_deref()),
            monthly_usage,
            monthly_limit,
        })
    })
    .await
}

/// 用量是否达到限额
///
/// 限额未配置或非法 → 一律判未超限：配置写坏不该让预警条一直红着。
fn exceeds_limit(usage: &str, limit: Option<&str>) -> bool {
    match (
        rust_decimal::Decimal::from_str(usage),
        limit.and_then(|l| rust_decimal::Decimal::from_str(l).ok()),
    ) {
        (Ok(u), Some(l)) => u >= l,
        _ => false,
    }
}

/// 扫描 Claude Code / Codex 的本地会话文件，采集未记录过的用量
///
/// 与代理记账互补：用户请求没走本项目代理时，代理路径拿不到任何数据，
/// 但会话文件里始终有 usage。幂等 —— 已入库的 requestId 会被跳过，
/// 所以可以随时手动触发。文件级增量，稳态下只是 stat 一遍文件。
#[tauri::command]
pub async fn scan_session_usage(state: State<'_, AppState>) -> Result<ScanResultDto, String> {
    let db = state.db.clone();
    run_blocking(move || {
        let result = crate::services::session_usage_scanner::scan_all(&db)?;
        Ok(ScanResultDto {
            inserted: result.inserted,
            skipped: result.skipped,
            ignored: result.ignored,
            files: result.files,
        })
    })
    .await
}

/// 扫描结果（camelCase 传输）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResultDto {
    /// 本次新增入库的行数
    pub inserted: u32,
    /// 因已存在而跳过的行数
    pub skipped: u32,
    /// 解析失败或无 token 而忽略的行数
    pub ignored: u32,
    /// 扫描过的会话文件数
    pub files: u32,
}

// ---------- 数据保留 ----------

/// 日志保留天数配置键（0 = 永久保留）
const RETENTION_KEY: &str = "usage_log_retention_days";
const DEFAULT_RETENTION_DAYS: u32 = 90;
const MAX_RETENTION_DAYS: u32 = 3650;

/// 用量日志采集开关配置键
const LOGGING_KEY: &str = "usage_logging_enabled";

/// 读「是否记录用量日志」
///
/// 默认开启。这个开关此前只存在于内存结构体里、采集路径从不检查，
/// 属于写了不生效的死配置 —— 现在真正接到落库判断上。
#[tauri::command]
pub async fn get_usage_logging_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    let db = state.db.clone();
    run_blocking(move || {
        Ok(db
            .get_app_config(LOGGING_KEY)?
            .map(|v| v.trim() == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(true))
    })
    .await
}

/// 设「是否记录用量日志」
///
/// 关掉后代理照常转发，只是不再落库 —— 用于隐私敏感或只想看实时状态的场景。
#[tauri::command]
pub async fn set_usage_logging_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    let db = state.db.clone();
    run_blocking(move || db.set_app_config(LOGGING_KEY, if enabled { "1" } else { "0" })).await
}

/// 读日志保留天数（0 = 永久保留）
#[tauri::command]
pub async fn get_usage_retention_days(state: State<'_, AppState>) -> Result<u32, String> {
    let db = state.db.clone();
    run_blocking(move || read_retention_days(&db)).await
}

/// 设日志保留天数（0 = 永久保留）
#[tauri::command]
pub async fn set_usage_retention_days(
    state: State<'_, AppState>,
    days: u32,
) -> Result<(), String> {
    if days > MAX_RETENTION_DAYS {
        return Err(format!("保留天数不能超过 {MAX_RETENTION_DAYS} 天"));
    }
    let db = state.db.clone();
    run_blocking(move || db.set_app_config(RETENTION_KEY, &days.to_string())).await
}

/// 立即清理超期日志，返回删除行数
///
/// 只删明细行并 VACUUM 收缩文件；历史成本不受影响，因为汇总是实时聚合的。
#[tauri::command]
pub async fn cleanup_usage_logs(state: State<'_, AppState>) -> Result<u32, String> {
    let db = state.db.clone();
    run_blocking(move || {
        let days = read_retention_days(&db)?;
        let removed = db.cleanup_old_logs(days)?;
        tracing::info!("[Usage] 手动清理日志：删除 {removed} 行（保留 {days} 天）");
        Ok(removed)
    })
    .await
}

/// 读保留天数的内部实现（供 command 与 cleanup 复用）
fn read_retention_days(db: &Database) -> Result<u32, String> {
    let raw = db.get_app_config(RETENTION_KEY)?;
    Ok(raw
        .and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|d| *d <= MAX_RETENTION_DAYS)
        .unwrap_or(DEFAULT_RETENTION_DAYS))
}
