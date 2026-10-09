// 会话统计图表共用的格式化工具（自 Dashboard 迁出）

export function truncateText(text: string, maxLength: number) {
    return text.length <= maxLength ? text : `${text.slice(0, Math.max(maxLength - 3, 1))}...`;
}

export function formatCompactTokens(value: number) {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString();
}

export function formatDateLabel(rawDate?: string) {
    if (!rawDate) return '';
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) return rawDate;
    return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

export function formatDateFull(rawDate?: string) {
    if (!rawDate) return '';
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) return rawDate;
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}
