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
