/**
 * 用量统计类型
 *
 * 与 `src-tauri/src/models/usage.rs` 一一对应。
 * 成本字段一律是 string —— 后端用 Decimal 存储，转 number 会丢精度。
 * 展示前用 `format.ts` 的 `parseFiniteNumber` 解析。
 */

/** 汇总卡片 */
export interface UsageSummary {
    totalRequests: number;
    totalCost: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheCreationTokens: number;
    totalCacheReadTokens: number;
    /** 百分比，0-100 */
    successRate: number;
    /** 真实消耗 = 新鲜输入 + 输出 + 缓存写入 + 缓存命中 */
    realTotalTokens: number;
    /** 缓存命中率 = 命中 ÷（新鲜输入 + 写入 + 命中），0.0–1.0 */
    cacheHitRate: number;
}

/** 趋势图的一个桶（≤24h 窗口按小时，否则按天） */
export interface DailyStats {
    /** 桶起始时刻，RFC3339 */
    date: string;
    requestCount: number;
    totalCost: string;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheCreationTokens: number;
    totalCacheReadTokens: number;
}

/** 按 provider 聚合 */
export interface ProviderStats {
    providerId: string;
    /**
     * 显示名：会话文件导入的行是占位名 "Claude (Session)" / "Codex (Session)"，
     * 供应商被删后回落到 providerId；显示前经 getUsageProviderLabel 翻译
     */
    providerName: string;
    appType: string;
    requestCount: number;
    /** 真实消耗（与汇总卡「真实消耗」同口径，各行之和等于它） */
    totalTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalCost: string;
    successRate: number;
    avgLatencyMs: number;
    /** 速度分子：参与统计的请求的输出 token 之和 */
    speedOutputTokens: number;
    /** 速度分母：同一批请求的生成时间之和（毫秒） */
    speedGenerationMs: number;
    /** 估算速度分子：会话日志导入、有估算耗时、输出 ≥ 200 token 的请求的输出之和 */
    estSpeedOutputTokens: number;
    /** 估算速度分母：同一批请求的估算耗时之和（毫秒） */
    estSpeedDurationMs: number;
}

/** 按模型聚合 */
export interface ModelStats {
    model: string;
    requestCount: number;
    /** 真实消耗（与汇总卡「真实消耗」同口径） */
    totalTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalCost: string;
    avgCostPerRequest: string;
}

/** 请求日志过滤条件 */
export interface LogFilters {
    appType?: string;
    /** provider 展示名精确匹配（顶部下拉的取值） */
    providerName?: string;
    /** 模型名精确匹配（顶部下拉的取值） */
    model?: string;
    statusCode?: number;
    /** Unix 秒 */
    startDate?: number;
    /** Unix 秒 */
    endDate?: number;
}

/**
 * 顶部筛选行的筛选条件（应用 / 供应商 / 模型）
 *
 * 全局生效：同时驱动汇总卡、趋势图与三张明细表（请求日志 / 供应商 / 模型）。
 */
export interface StatsFilters {
    appType?: string;
    providerName?: string;
    model?: string;
}

/** 时间范围预设（含自定义区间） */
export type UsageRangePreset = TimeRange | 'custom';

/**
 * 顶部筛选行的时间范围选择
 *
 * `custom` 用显式起止；`liveEndTime` 让终点跟随当前时刻（即旧的「跟随」模式）。
 */
export interface UsageRangeSelection {
    preset: UsageRangePreset;
    /** preset = 'custom' 时的起始时刻（Unix 秒） */
    customStartDate?: number;
    /** preset = 'custom' 时的结束时刻（Unix 秒）；liveEndTime 为真时忽略 */
    customEndDate?: number;
    /** custom 模式下结束时间跟随当前时刻 */
    liveEndTime?: boolean;
}

/** 单条请求日志 */
export interface RequestLogDetail {
    requestId: string;
    providerId: string;
    providerName?: string;
    appType: string;
    model: string;
    requestModel?: string;
    costMultiplier: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    inputCostUsd: string;
    outputCostUsd: string;
    cacheReadCostUsd: string;
    cacheCreationCostUsd: string;
    totalCostUsd: string;
    isStreaming: boolean;
    latencyMs: number;
    firstTokenMs?: number;
    durationMs?: number;
    statusCode: number;
    errorMessage?: string;
    /** Unix 秒 */
    createdAt: number;
    /** 思考强度（客户端原值，如 low / medium / high / xhigh / max）；没有时为 null */
    reasoningEffort?: string | null;
    /** 数据来源：proxy / session_log / codex_session；没有时为 null（按 proxy 处理） */
    dataSource?: string | null;
}

/** 分页结果 */
export interface PaginatedLogs {
    data: RequestLogDetail[];
    total: number;
    page: number;
    pageSize: number;
}

/** 定价条目 */
export interface ModelPricingInfo {
    modelId: string;
    displayName: string;
    inputCostPerMillion: string;
    outputCostPerMillion: string;
    cacheReadCostPerMillion: string;
    cacheCreationCostPerMillion: string;
}

/** Provider 限额状态 */
export interface ProviderLimitStatus {
    providerId: string;
    /** provider 展示名；被删后为 "Unknown" */
    providerName: string;
    appType: string;
    dailyUsage: string;
    /** 未配置限额时为 undefined */
    dailyLimit?: string;
    dailyExceeded: boolean;
    monthlyUsage: string;
    monthlyLimit?: string;
    monthlyExceeded: boolean;
}

/** 趋势时间范围 */
/** today = 本地今天 0 点至今；1d / 7d / 30d = 滚动窗口 */
export type TimeRange = 'today' | '1d' | '7d' | '30d';

/** 会话文件扫描结果 */
export interface SessionScanResult {
    /** 本次新增入库的行数 */
    inserted: number;
    /** 因已存在而跳过的行数 */
    skipped: number;
    /** 解析失败或无 token 而忽略的行数 */
    ignored: number;
    /** 扫描过的会话文件数 */
    files: number;
}

/** 定价模型来源 */
export type PricingModelSource = 'response' | 'request';

/** 日志时间筛选模式 */
export type LogTimeMode = 'rolling' | 'fixed';

/** 自动刷新间隔（毫秒），`0` = 关闭 */
export type RefreshInterval = 0 | 5000 | 10000 | 30000 | 60000;
