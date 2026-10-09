/**
 * 格式化工具 —— 成本与 token 数
 *
 * 成本一律走 `parseFiniteNumber` 反序列化 —— 后端用 rust_decimal 保精度，
 * 传输用 string，展示前转回数值。
 */

/** 解析后端的 Decimal 字符串为有限数值；非法值返回 0 */
export function parseFiniteNumber(raw: string | undefined): number {
    if (!raw) return 0;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
}

/**
 * 格式化美元成本
 *
 * 默认按量级选精度：≥1 留 2 位，<1 留 4 位，精确 0 显示 "$0"。
 * 传 `decimals` 可强制固定精度 —— 请求详情要展示 6 位分项成本，
 * 那里需要看清每一项而不是看量级。
 */
export function formatCost(costStr: string | undefined, decimals?: number): string {
    const cost = parseFiniteNumber(costStr);
    if (decimals !== undefined) {
        return `$${cost.toFixed(decimals)}`;
    }
    if (cost === 0) return '$0';
    if (cost >= 1) return `$${cost.toFixed(2)}`;
    return `$${cost.toFixed(4)}`;
}

/** 按 locale 格式化整数（千分位） */
export function formatNumber(count: number | undefined, locale?: string): string {
    if (count === undefined || !Number.isFinite(count)) return '0';
    return count.toLocaleString(locale);
}

/** 格式化 token 数：≥1M 用 "X.XXM"，≥1K 用 "X.XXK"，否则原值 */
export function formatTokens(count: number | undefined): string {
    if (!count || !Number.isFinite(count)) return '0';
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(2)}K`;
    return count.toString();
}

/** 格式化百分比：保留 1 位小数 */
export function formatPercent(rate: number | undefined): string {
    if (!rate || !Number.isFinite(rate)) return '0%';
    return `${rate.toFixed(1)}%`;
}

/** 格式化延迟：≥1s 用秒，否则用毫秒 */
export function formatLatency(ms: number | undefined): string {
    if (!ms || !Number.isFinite(ms)) return '0ms';
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.round(ms)}ms`;
}

/**
 * 汇总速度：Σ输出 ÷ Σ生成时间（不是逐条平均，免得短请求把数字带歪）
 *
 * 没有可用数据时返回 null，调用方显示「—」。
 */
export function formatTokensPerSecond(
    outputTokens: number | undefined,
    generationMs: number | undefined
): string | null {
    if (!outputTokens || !generationMs || generationMs <= 0) return null;
    const tps = outputTokens / (generationMs / 1000);
    if (!Number.isFinite(tps) || tps <= 0) return null;
    return tps >= 100 ? Math.round(tps).toString() : tps.toFixed(1);
}

/** 单条请求的速度输入（精确与估算共用） */
export interface SpeedInput {
    outputTokens: number;
    latencyMs: number;
    firstTokenMs?: number | null;
    dataSource?: string | null;
}

/** 估算速度的输出门槛：会话日志导入的请求没有首字计时，耗时是按日志时间戳估的、
 * 含首字等待；输出越少首字占比越大、算出来越偏低，所以门槛比精确口径高。 */
export const SPEED_ESTIMATE_MIN_OUTPUT_TOKENS = 200;

/** 估算耗时短于此值时不估速度：输出 200 token 以上却不到 1 秒，多半是起点取晚了。 */
export const SPEED_ESTIMATE_MIN_DURATION_MS = 1000;

/** 这条请求是不是从会话日志导入的（不是路由服务记的）。 */
export function isSessionLogRequest(log: { dataSource?: string | null }): boolean {
    return (
        typeof log.dataSource === 'string' &&
        log.dataSource !== '' &&
        log.dataSource !== 'proxy'
    );
}

/** 一条请求的精确生成时间（毫秒）= 耗时 − 首字；缺首字或差值不大于 0 返回 null。 */
function getGenerationMs(log: SpeedInput): number | null {
    if (typeof log.firstTokenMs !== 'number') return null;
    const ms = log.latencyMs - log.firstTokenMs;
    return ms > 0 ? ms : null;
}

/** 一条请求的精确速度（tok/s），从首字算到结束；没有首字计时返回 null。 */
export function getOutputTokensPerSecond(log: SpeedInput): number | null {
    const ms = getGenerationMs(log);
    if (ms == null || !log.outputTokens) return null;
    const tps = log.outputTokens / (ms / 1000);
    return Number.isFinite(tps) && tps > 0 ? tps : null;
}

/** 这条请求能不能估速度：会话日志导入、没有首字计时、输出不少于 200 token、估算耗时不短于 1 秒。 */
export function isSpeedEstimateEligible(log: SpeedInput): boolean {
    return (
        isSessionLogRequest(log) &&
        log.firstTokenMs == null &&
        log.outputTokens >= SPEED_ESTIMATE_MIN_OUTPUT_TOKENS &&
        log.latencyMs >= SPEED_ESTIMATE_MIN_DURATION_MS
    );
}

/** 单条估算速度（tok/s）= 输出 token ÷（估算耗时 / 1000），含首字等待；不满足条件返回 null。 */
export function getEstimatedTokensPerSecond(log: SpeedInput): number | null {
    if (!isSpeedEstimateEligible(log)) return null;
    const tps = log.outputTokens / (log.latencyMs / 1000);
    return Number.isFinite(tps) && tps > 0 ? tps : null;
}

/** 单条速度的数值格式化（精确与估算共用）。 */
function formatSingleSpeed(tps: number | null): string | null {
    if (tps == null) return null;
    return tps >= 100 ? Math.round(tps).toString() : tps.toFixed(1);
}

/** 单条精确速度的展示文本；没有返回 null。 */
export function formatOutputTokensPerSecond(log: SpeedInput): string | null {
    return formatSingleSpeed(getOutputTokensPerSecond(log));
}

/** 单条估算速度的展示文本；没有返回 null。 */
export function formatEstimatedTokensPerSecond(log: SpeedInput): string | null {
    return formatSingleSpeed(getEstimatedTokensPerSecond(log));
}

/** 解析 ISO 日期为本地短格式（如 "09/01 10:00" 或 "09/01"） */
export function formatBucketDate(isoDate: string, showTime: boolean = false): string {
    try {
        const date = new Date(isoDate);
        if (!showTime) {
            return date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
        }
        return date.toLocaleString(undefined, {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return isoDate;
    }
}

/**
 * i18n 语言码 → Intl locale
 *
 * 所有以 `zh` 开头的变体（zh / zh-CN / zh-TW ...）都归到 zh-CN。
 * 不能用 `language === 'zh'`：LanguageDetector 会解出 `zh-CN`，
 * 严格相等会让界面是中文、日期和千分位却按 en-US 渲染。
 */
export function getLocaleFromLanguage(language: string | undefined): string {
    if (language && language.toLowerCase().startsWith('zh')) return 'zh-CN';
    return 'en-US';
}
