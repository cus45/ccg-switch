/**
 * 用量统计服务层
 *
 * 封装 Tauri 命令，供 react-query hooks 调用。
 * 时间窗口统一转 Unix 秒传给后端。
 */

import { invoke } from '@tauri-apps/api/core';
import type {
    UsageSummary,
    DailyStats,
    ProviderStats,
    ModelStats,
    PaginatedLogs,
    LogFilters,
    RequestLogDetail,
    ModelPricingInfo,
    ProviderLimitStatus,
    SessionScanResult,
    StatsFilters,
    TimeRange,
    UsageRangeSelection,
    PricingModelSource,
} from '../types/usage';

/** 页面上可选的时间范围（顺序即按钮顺序） */
export const TIME_RANGES: TimeRange[] = ['today', '1d', '7d', '30d'];

/** 时间范围按钮文案 */
export const RANGE_LABEL_KEYS: Record<TimeRange, string> = {
    today: 'usage.thisDay',
    '1d': 'usage.today',
    '7d': 'usage.last7days',
    '30d': 'usage.last30days',
};

/**
 * 是否按小时分桶展示
 *
 * 预设「今天 / 24 小时」按小时；自定义区间看实际跨度（≤ 24h 才按小时）。
 */
export function isHourlyRange(selection: UsageRangeSelection): boolean {
    if (selection.preset !== 'custom') {
        return selection.preset === 'today' || selection.preset === '1d';
    }
    const { startDate, endDate } = resolveUsageRange(selection);
    return endDate - startDate <= 24 * 3600;
}

/**
 * TimeRange 转 Unix 秒
 *
 * `today` 从本地时区今天 0 点开始；其余是以 `nowMs` 为终点的滚动窗口。
 * 传 `nowMs` 是为了让日志表的滚动窗口能按自己的节拍重算。
 */
export function getTimeWindow(
    range: TimeRange,
    nowMs: number = Date.now()
): { startDate: number; endDate: number } {
    const endDate = Math.floor(nowMs / 1000);
    if (range === 'today') {
        const midnight = new Date(nowMs);
        midnight.setHours(0, 0, 0, 0);
        return { startDate: Math.floor(midnight.getTime() / 1000), endDate };
    }
    const hours = range === '1d' ? 24 : range === '7d' ? 168 : 720; // 30d
    return { startDate: endDate - hours * 3600, endDate };
}

/** 自定义区间默认跨度：24 小时（没填起止时按它兜底） */
const DEFAULT_CUSTOM_RANGE_SECONDS = 24 * 3600;

/**
 * 把顶部的时间范围选择解析成 Unix 秒窗口
 *
 * 预设走 `getTimeWindow`；`custom` 用显式起止，`liveEndTime` 让终点始终是「现在」。
 */
export function resolveUsageRange(
    selection: UsageRangeSelection,
    nowMs: number = Date.now()
): { startDate: number; endDate: number } {
    if (selection.preset !== 'custom') {
        return getTimeWindow(selection.preset, nowMs);
    }
    const nowSeconds = Math.floor(nowMs / 1000);
    return {
        startDate: selection.customStartDate ?? nowSeconds - DEFAULT_CUSTOM_RANGE_SECONDS,
        endDate: selection.liveEndTime ? nowSeconds : (selection.customEndDate ?? nowSeconds),
    };
}

/** 把筛选条件转成命令参数；空值交给后端按「不筛选」处理 */
function filterArgs(filters: StatsFilters) {
    return {
        appType: filters.appType,
        providerName: filters.providerName,
        model: filters.model,
    };
}

/** 汇总卡 —— 时间窗口与顶部筛选行同时生效 */
export async function getUsageSummary(
    range: UsageRangeSelection,
    filters: StatsFilters = {}
): Promise<UsageSummary> {
    const { startDate, endDate } = resolveUsageRange(range);
    return invoke('get_usage_summary', { startDate, endDate, ...filterArgs(filters) });
}

export async function getUsageTrends(
    range: UsageRangeSelection,
    filters: StatsFilters = {}
): Promise<DailyStats[]> {
    const { startDate, endDate } = resolveUsageRange(range);
    return invoke('get_usage_trends', { startDate, endDate, ...filterArgs(filters) });
}

/** 供应商聚合 —— 时间窗口与筛选口径跟汇总卡一致 */
export async function getProviderStats(
    range: UsageRangeSelection,
    filters: StatsFilters = {}
): Promise<ProviderStats[]> {
    const { startDate, endDate } = resolveUsageRange(range);
    return invoke('get_provider_stats', { startDate, endDate, ...filterArgs(filters) });
}

/** 模型聚合 —— 时间窗口与筛选口径跟汇总卡一致 */
export async function getModelStats(
    range: UsageRangeSelection,
    filters: StatsFilters = {}
): Promise<ModelStats[]> {
    const { startDate, endDate } = resolveUsageRange(range);
    return invoke('get_model_stats', { startDate, endDate, ...filterArgs(filters) });
}

export async function getRequestLogs(
    filters: LogFilters,
    page: number,
    pageSize: number
): Promise<PaginatedLogs> {
    return invoke('get_request_logs', { filters, page, pageSize });
}

export async function getRequestDetail(requestId: string): Promise<RequestLogDetail | null> {
    return invoke('get_request_detail', { requestId });
}

export async function getModelPricing(): Promise<ModelPricingInfo[]> {
    return invoke('get_model_pricing');
}

export async function updateModelPricing(
    modelId: string,
    displayName: string,
    inputCost: string,
    outputCost: string,
    cacheReadCost: string,
    cacheCreationCost: string
): Promise<void> {
    return invoke('update_model_pricing', {
        modelId,
        displayName,
        inputCost,
        outputCost,
        cacheReadCost,
        cacheCreationCost,
    });
}

export async function deleteModelPricing(modelId: string): Promise<void> {
    return invoke('delete_model_pricing', { modelId });
}

export async function getDefaultCostMultiplier(appType: string): Promise<string> {
    return invoke('get_default_cost_multiplier', { appType });
}

export async function setDefaultCostMultiplier(appType: string, value: string): Promise<void> {
    return invoke('set_default_cost_multiplier', { appType, value });
}

export async function getPricingModelSource(appType: string): Promise<PricingModelSource> {
    return invoke('get_pricing_model_source', { appType });
}

export async function setPricingModelSource(
    appType: string,
    value: PricingModelSource
): Promise<void> {
    return invoke('set_pricing_model_source', { appType, value });
}

/** 查 provider 的日/月用量与限额状态 */
export async function checkProviderLimits(
    providerId: string,
    appType: string
): Promise<ProviderLimitStatus> {
    return invoke('check_provider_limits', { providerId, appType });
}

/** 读日志保留天数（0 = 永久保留） */
export async function getUsageRetentionDays(): Promise<number> {
    return invoke('get_usage_retention_days');
}

/** 设日志保留天数（0 = 永久保留） */
export async function setUsageRetentionDays(days: number): Promise<void> {
    return invoke('set_usage_retention_days', { days });
}

/** 立即清理超期日志，返回删除行数 */
export async function cleanupUsageLogs(): Promise<number> {
    return invoke('cleanup_usage_logs');
}

/** 是否记录用量日志（默认开启） */
export async function getUsageLoggingEnabled(): Promise<boolean> {
    return invoke('get_usage_logging_enabled');
}

/** 开关用量日志采集 */
export async function setUsageLoggingEnabled(enabled: boolean): Promise<void> {
    return invoke('set_usage_logging_enabled', { enabled });
}

/** 扫描本地会话文件采集用量 */
export async function scanSessionUsage(): Promise<SessionScanResult> {
    return invoke('scan_session_usage');
}
