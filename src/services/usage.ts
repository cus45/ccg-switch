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
    TimeRange,
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

/** 是否按小时分桶展示（今天、24 小时） */
export function isHourlyRange(range: TimeRange): boolean {
    return range === 'today' || range === '1d';
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

export async function getUsageSummary(range: TimeRange): Promise<UsageSummary> {
    const { startDate, endDate } = getTimeWindow(range);
    return invoke('get_usage_summary', { startDate, endDate });
}

export async function getUsageTrends(range: TimeRange): Promise<DailyStats[]> {
    const { startDate, endDate } = getTimeWindow(range);
    return invoke('get_usage_trends', { startDate, endDate });
}

/** 供应商聚合 —— 时间窗口与汇总卡一致 */
export async function getProviderStats(range: TimeRange): Promise<ProviderStats[]> {
    const { startDate, endDate } = getTimeWindow(range);
    return invoke('get_provider_stats', { startDate, endDate });
}

/** 模型聚合 —— 时间窗口与汇总卡一致 */
export async function getModelStats(range: TimeRange): Promise<ModelStats[]> {
    const { startDate, endDate } = getTimeWindow(range);
    return invoke('get_model_stats', { startDate, endDate });
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
