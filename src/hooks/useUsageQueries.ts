/**
 * 用量统计的 react-query hooks
 *
 * 轮询间隔由调用方传入，`0` 表示关闭。后台不轮询（`refetchIntervalInBackground: false`），
 * 避免应用最小化后仍持续 invoke。
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as usageApi from '../services/usage';
import type {
    LogFilters,
    PricingModelSource,
    StatsFilters,
    UsageRangeSelection,
} from '../types/usage';

/** 查询键命名空间 —— 失效时按前缀批量清理 */
export const usageKeys = {
    all: ['usage'] as const,
    summary: (range: UsageRangeSelection, filters: StatsFilters) =>
        ['usage', 'summary', range, filters] as const,
    trends: (range: UsageRangeSelection, filters: StatsFilters) =>
        ['usage', 'trends', range, filters] as const,
    providerStats: (range: UsageRangeSelection, filters: StatsFilters) =>
        ['usage', 'providerStats', range, filters] as const,
    modelStats: (range: UsageRangeSelection, filters: StatsFilters) =>
        ['usage', 'modelStats', range, filters] as const,
    logs: (filters: LogFilters, page: number, pageSize: number) =>
        ['usage', 'logs', filters, page, pageSize] as const,
    detail: (requestId: string) => ['usage', 'detail', requestId] as const,
    pricing: () => ['usage', 'pricing'] as const,
    globalConfig: (appType: string) => ['usage', 'globalConfig', appType] as const,
    limits: (providerId: string, appType: string) =>
        ['usage', 'limits', providerId, appType] as const,
    retention: () => ['usage', 'retention'] as const,
    loggingEnabled: () => ['usage', 'loggingEnabled'] as const,
};

/** `0` → 关闭轮询；react-query 用 `false` 表达 */
function pollInterval(ms: number): number | false {
    return ms > 0 ? ms : false;
}

/**
 * 聚合类查询（汇总/趋势/供应商/模型）的共用选项
 *
 * - `placeholderData: keepPreviousData`：切 1d/7d/30d 时保留上一份数据直到新数据到达，
 *   避免整块卡片/图表被 spinner 替换造成布局跳动；调用方用 `isPlaceholderData` 做淡化提示。
 * - `staleTime`：Tab 来回切换会重新挂载表格，5s 内不重复请求；
 *   手动刷新走 `invalidateQueries`，不受 staleTime 影响。
 */
const AGGREGATE_STALE_MS = 5_000;

function aggregateQueryOptions(refreshMs: number) {
    return {
        refetchInterval: pollInterval(refreshMs),
        refetchIntervalInBackground: false,
        staleTime: AGGREGATE_STALE_MS,
        placeholderData: keepPreviousData,
    };
}

export function useUsageSummary(
    range: UsageRangeSelection,
    filters: StatsFilters,
    refreshMs: number
) {
    return useQuery({
        queryKey: usageKeys.summary(range, filters),
        queryFn: () => usageApi.getUsageSummary(range, filters),
        ...aggregateQueryOptions(refreshMs),
    });
}

export function useUsageTrends(
    range: UsageRangeSelection,
    filters: StatsFilters,
    refreshMs: number
) {
    return useQuery({
        queryKey: usageKeys.trends(range, filters),
        queryFn: () => usageApi.getUsageTrends(range, filters),
        ...aggregateQueryOptions(refreshMs),
    });
}

/** 供应商聚合 —— 时间范围与筛选口径跟汇总卡一致 */
export function useProviderStats(
    range: UsageRangeSelection,
    filters: StatsFilters,
    refreshMs: number
) {
    return useQuery({
        queryKey: usageKeys.providerStats(range, filters),
        queryFn: () => usageApi.getProviderStats(range, filters),
        ...aggregateQueryOptions(refreshMs),
    });
}

/** 模型聚合 —— 时间范围与筛选口径跟汇总卡一致 */
export function useModelStats(
    range: UsageRangeSelection,
    filters: StatsFilters,
    refreshMs: number
) {
    return useQuery({
        queryKey: usageKeys.modelStats(range, filters),
        queryFn: () => usageApi.getModelStats(range, filters),
        ...aggregateQueryOptions(refreshMs),
    });
}

export function useRequestLogs(
    filters: LogFilters,
    page: number,
    pageSize: number,
    refreshMs: number
) {
    return useQuery({
        queryKey: usageKeys.logs(filters, page, pageSize),
        queryFn: () => usageApi.getRequestLogs(filters, page, pageSize),
        refetchInterval: pollInterval(refreshMs),
        refetchIntervalInBackground: false,
        // 翻页时保留上一页数据，避免表格闪空
        placeholderData: (prev) => prev,
    });
}

export function useRequestDetail(requestId: string | null) {
    return useQuery({
        queryKey: usageKeys.detail(requestId ?? ''),
        queryFn: () => usageApi.getRequestDetail(requestId!),
        enabled: !!requestId,
    });
}

export function useModelPricing() {
    return useQuery({
        queryKey: usageKeys.pricing(),
        queryFn: usageApi.getModelPricing,
    });
}

export function useUpdateModelPricing() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (params: {
            modelId: string;
            displayName: string;
            inputCost: string;
            outputCost: string;
            cacheReadCost: string;
            cacheCreationCost: string;
        }) =>
            usageApi.updateModelPricing(
                params.modelId,
                params.displayName,
                params.inputCost,
                params.outputCost,
                params.cacheReadCost,
                params.cacheCreationCost
            ),
        onSuccess: () => {
            // 定价变了 → 成本也变，整个 usage 命名空间都失效
            void qc.invalidateQueries({ queryKey: usageKeys.all });
        },
    });
}

export function useDeleteModelPricing() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (modelId: string) => usageApi.deleteModelPricing(modelId),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: usageKeys.all });
        },
    });
}

/** 全局计费配置（倍率 + 定价模型来源） */
export function useGlobalPricingConfig(appType: string) {
    return useQuery({
        queryKey: usageKeys.globalConfig(appType),
        queryFn: async () => {
            const [multiplier, modelSource] = await Promise.all([
                usageApi.getDefaultCostMultiplier(appType),
                usageApi.getPricingModelSource(appType),
            ]);
            return { multiplier, modelSource };
        },
        enabled: !!appType,
    });
}

export function useSetGlobalPricingConfig(appType: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (params: { multiplier?: string; modelSource?: PricingModelSource }) => {
            if (params.multiplier !== undefined) {
                await usageApi.setDefaultCostMultiplier(appType, params.multiplier);
            }
            if (params.modelSource !== undefined) {
                await usageApi.setPricingModelSource(appType, params.modelSource);
            }
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: usageKeys.all });
        },
    });
}

/** 查限额状态；providerId / appType 任一为空则不查 */
export function useProviderLimits(providerId: string, appType: string) {
    return useQuery({
        queryKey: usageKeys.limits(providerId, appType),
        queryFn: () => usageApi.checkProviderLimits(providerId, appType),
        enabled: !!providerId && !!appType,
    });
}

/** 日志保留天数（0 = 永久保留） */
export function useUsageRetention() {
    return useQuery({
        queryKey: usageKeys.retention(),
        queryFn: usageApi.getUsageRetentionDays,
    });
}

/** 改保留天数 */
export function useSetUsageRetention() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (days: number) => usageApi.setUsageRetentionDays(days),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: usageKeys.retention() });
        },
    });
}

/** 手动清理超期日志，返回删除行数 */
export function useCleanupUsageLogs() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: usageApi.cleanupUsageLogs,
        onSuccess: () => {
            // 日志没了，所有聚合都得重算
            void qc.invalidateQueries({ queryKey: usageKeys.all });
        },
    });
}

/** 是否记录用量日志 */
export function useUsageLoggingEnabled() {
    return useQuery({
        queryKey: usageKeys.loggingEnabled(),
        queryFn: usageApi.getUsageLoggingEnabled,
    });
}

/** 开关用量日志采集 */
export function useSetUsageLoggingEnabled() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (enabled: boolean) => usageApi.setUsageLoggingEnabled(enabled),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: usageKeys.loggingEnabled() });
        },
    });
}

/**
 * 扫描本地会话文件采集用量
 *
 * 与代理记账互补：请求没走本项目代理时代理路径拿不到数据，
 * 但Claude Code / Codex 的会话 JSONL 里始终有 usage。
 * 后端按 requestId 幂等去重，重复触发安全。
 */
export function useScanSessionUsage() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: usageApi.scanSessionUsage,
        onSuccess: (result) => {
            // 只有真写进去新数据才需要让聚合失效
            if (result.inserted > 0) {
                void qc.invalidateQueries({ queryKey: usageKeys.all });
            }
        },
    });
}
