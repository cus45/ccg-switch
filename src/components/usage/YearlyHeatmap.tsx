import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Flame } from 'lucide-react';
import { useYearlyHeatmap } from '../../hooks/useUsageQueries';
import type { HeatmapDay, StatsFilters } from '../../types/usage';
import { formatCompactTokens } from './session/format';
import { card, muted, segment, segmentItem } from './styles';
import { cn } from '../../utils/cn';

export type HeatmapMetric = 'requests' | 'tokens' | 'cost';

interface Props {
    filters: StatsFilters;
    refreshMs: number;
}

const MONTH_KEYS = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
] as const;

const WEEKDAYS = [
    { row: 1, label: 'Mon' },
    { row: 3, label: 'Wed' },
    { row: 5, label: 'Fri' },
];

const LEVEL_COLORS: Record<number, string> = {
    0: 'bg-gray-100 dark:bg-base-200/80 hover:ring-1 hover:ring-gray-300 dark:hover:ring-base-300',
    1: 'bg-emerald-100 dark:bg-emerald-950/70 hover:ring-1 hover:ring-emerald-300 dark:hover:ring-emerald-700',
    2: 'bg-emerald-300 dark:bg-emerald-800 hover:ring-1 hover:ring-emerald-400 dark:hover:ring-emerald-600',
    3: 'bg-emerald-500 dark:bg-emerald-600 hover:ring-1 hover:ring-emerald-600 dark:hover:ring-emerald-400',
    4: 'bg-emerald-700 dark:bg-emerald-400 hover:ring-1 hover:ring-emerald-800 dark:hover:ring-emerald-300',
};

interface TooltipState {
    day: HeatmapDay;
    x: number;
    y: number;
}

export function YearlyHeatmap({ filters, refreshMs }: Props) {
    const { t } = useTranslation();
    const { data: days, isLoading } = useYearlyHeatmap(filters, refreshMs);
    const [metric, setMetric] = useState<HeatmapMetric>('requests');
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);

    // 计算当年度汇总数据
    const summary = useMemo(() => {
        if (!days || days.length === 0) {
            return { activeDays: 0, totalRequests: 0, totalTokens: 0, totalCost: 0 };
        }
        let activeDays = 0;
        let totalRequests = 0;
        let totalTokens = 0;
        let totalCost = 0;

        for (const d of days) {
            if (d.requestCount > 0) activeDays += 1;
            totalRequests += d.requestCount;
            totalTokens += d.totalTokens;
            totalCost += Number.parseFloat(d.totalCost) || 0;
        }

        return {
            activeDays,
            totalRequests,
            totalTokens,
            totalCost: totalCost.toFixed(4),
        };
    }, [days]);

    // 计算指标数值与分阶阈值
    const getMetricValue = (d: HeatmapDay, m: HeatmapMetric): number => {
        switch (m) {
            case 'requests':
                return d.requestCount;
            case 'tokens':
                return d.totalTokens;
            case 'cost':
                return Number.parseFloat(d.totalCost) || 0;
        }
    };

    const thresholds = useMemo(() => {
        if (!days || days.length === 0) return { q1: 0, q2: 0, q3: 0 };
        const nonZero = days
            .map((d) => getMetricValue(d, metric))
            .filter((v) => v > 0)
            .sort((a, b) => a - b);

        if (nonZero.length === 0) return { q1: 0, q2: 0, q3: 0 };
        const n = nonZero.length;
        return {
            q1: nonZero[Math.floor(n * 0.25)] || nonZero[0],
            q2: nonZero[Math.floor(n * 0.50)] || nonZero[0],
            q3: nonZero[Math.floor(n * 0.75)] || nonZero[n - 1],
        };
    }, [days, metric]);

    const getLevel = (d: HeatmapDay | null): number => {
        if (!d) return 0;
        const val = getMetricValue(d, metric);
        if (val <= 0) return 0;
        if (val <= thresholds.q1) return 1;
        if (val <= thresholds.q2) return 2;
        if (val <= thresholds.q3) return 3;
        return 4;
    };

    // 将 365 天组织成 7 行 × 53 周矩阵与月份标头
    const { columns, monthHeaders } = useMemo(() => {
        if (!days || days.length === 0) return { columns: [], monthHeaders: [] };

        const cols: (HeatmapDay | null)[][] = [];
        const mHeaders: { colIndex: number; label: string }[] = [];

        // 解析第一天的星期几（0: Sun, 1: Mon, ..., 6: Sat）
        const [y0, m0, d0] = days[0].date.split('-').map(Number);
        const firstDayOfWeek = new Date(y0, m0 - 1, d0).getDay();

        let currentWeek: (HeatmapDay | null)[] = [];
        for (let i = 0; i < firstDayOfWeek; i++) {
            currentWeek.push(null);
        }

        let lastMonth = -1;

        for (const day of days) {
            const [y, m, d] = day.date.split('-').map(Number);
            const dateObj = new Date(y, m - 1, d);
            const month = dateObj.getMonth();

            // 若进入了新月份，且在该周的前几天
            if (month !== lastMonth && d <= 7) {
                const colIdx = cols.length;
                // 保证标签之间至少隔开 2 周，避免月名重叠
                const lastHeader = mHeaders[mHeaders.length - 1];
                if (!lastHeader || colIdx - lastHeader.colIndex >= 3) {
                    mHeaders.push({
                        colIndex: colIdx,
                        label: t(`usage.heatmap.months.${MONTH_KEYS[month]}`, {
                            defaultValue: MONTH_KEYS[month].toUpperCase(),
                        }),
                    });
                    lastMonth = month;
                }
            }

            currentWeek.push(day);
            if (currentWeek.length === 7) {
                cols.push(currentWeek);
                currentWeek = [];
            }
        }

        if (currentWeek.length > 0) {
            while (currentWeek.length < 7) {
                currentWeek.push(null);
            }
            cols.push(currentWeek);
        }

        return { columns: cols, monthHeaders: mHeaders };
    }, [days, t]);

    const handleMouseEnter = (
        e: React.MouseEvent<HTMLDivElement>,
        day: HeatmapDay | null
    ) => {
        if (!day) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setTooltip({
            day,
            x: rect.left + rect.width / 2,
            y: rect.top - 8,
        });
    };

    const handleMouseLeave = () => {
        setTooltip(null);
    };

    if (isLoading) {
        return (
            <div className={cn(card, 'space-y-4 p-5')} aria-busy="true">
                <div className="flex items-center justify-between">
                    <div className="skeleton h-5 w-48" />
                    <div className="skeleton h-7 w-52" />
                </div>
                <div className="skeleton h-36 w-full" />
            </div>
        );
    }

    return (
        <div className={cn(card, 'space-y-4 p-5')}>
            {/* 顶栏：标题、指标切换与年汇总 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <Flame className="h-4 w-4" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-base-content">
                            {t('usage.yearlyHeatmap')}
                        </h3>
                        <p className={cn('text-xs', muted)}>
                            {t('usage.yearlyHeatmapSubtitle')}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* 指标切换按钮 */}
                    <div className={segment} role="tablist" aria-label={t('usage.heatmap.metric')}>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={metric === 'requests'}
                            className={segmentItem(metric === 'requests')}
                            onClick={() => setMetric('requests')}
                        >
                            {t('usage.heatmap.requests')}
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={metric === 'tokens'}
                            className={segmentItem(metric === 'tokens')}
                            onClick={() => setMetric('tokens')}
                        >
                            {t('usage.heatmap.tokens')}
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={metric === 'cost'}
                            className={segmentItem(metric === 'cost')}
                            onClick={() => setMetric('cost')}
                        >
                            {t('usage.heatmap.cost')}
                        </button>
                    </div>
                </div>
            </div>

            {/* 热力图网格滚动区域 */}
            <div className="relative overflow-x-auto pb-2 pt-1">
                <div className="inline-block min-w-full">
                    {/* 月份标头行 */}
                    <div className="flex pl-8 text-[11px] font-medium text-gray-400 dark:text-gray-500">
                        <div className="relative h-4 w-full">
                            {monthHeaders.map((m) => (
                                <span
                                    key={m.colIndex}
                                    className="absolute whitespace-nowrap"
                                    style={{ left: `${m.colIndex * 15}px` }}
                                >
                                    {m.label}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* 网格主容器：左侧星期标号 + 右侧矩阵 */}
                    <div className="flex gap-2">
                        {/* 左侧星期标签 */}
                        <div className="flex flex-col justify-between py-0.5 text-[10px] font-medium text-gray-400 dark:text-gray-500">
                            {WEEKDAYS.map((w) => (
                                <span
                                    key={w.label}
                                    style={{ height: '12px', lineHeight: '12px' }}
                                >
                                    {w.label}
                                </span>
                            ))}
                        </div>

                        {/* 53 列网格 */}
                        <div className="flex gap-[3px]">
                            {columns.map((col, colIdx) => (
                                <div key={colIdx} className="flex flex-col gap-[3px]">
                                    {col.map((day, rowIdx) => {
                                        const level = getLevel(day);
                                        const colorClass = LEVEL_COLORS[level];
                                        return (
                                            <div
                                                key={rowIdx}
                                                className={cn(
                                                    'h-3 w-3 rounded-sm transition-all',
                                                    day ? colorClass : 'opacity-0 pointer-events-none'
                                                )}
                                                onMouseEnter={(e) => handleMouseEnter(e, day)}
                                                onMouseLeave={handleMouseLeave}
                                            />
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* 底栏：年度汇总统计与图例 */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3 text-xs dark:border-base-200">
                <div className="flex flex-wrap items-center gap-4 text-gray-600 dark:text-gray-300">
                    <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-gray-400" />
                        <span>
                            {t('usage.heatmap.totalActiveDays')}:{' '}
                            <strong className="font-semibold text-gray-900 dark:text-base-content">
                                {summary.activeDays}
                            </strong>{' '}
                            / 365
                        </span>
                    </span>
                    <span>
                        {t('usage.heatmap.totalYearRequests')}:{' '}
                        <strong className="font-semibold text-gray-900 dark:text-base-content">
                            {summary.totalRequests.toLocaleString()}
                        </strong>
                    </span>
                    <span>
                        {t('usage.heatmap.totalYearTokens')}:{' '}
                        <strong className="font-semibold text-gray-900 dark:text-base-content">
                            {formatCompactTokens(summary.totalTokens)}
                        </strong>
                    </span>
                    <span>
                        {t('usage.heatmap.totalYearCost')}:{' '}
                        <strong className="font-semibold text-emerald-600 dark:text-emerald-400">
                            ${summary.totalCost}
                        </strong>
                    </span>
                </div>

                {/* 图例 */}
                <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                    <span>{t('usage.heatmap.less')}</span>
                    {[0, 1, 2, 3, 4].map((lvl) => (
                        <div
                            key={lvl}
                            className={cn('h-3 w-3 rounded-sm', LEVEL_COLORS[lvl])}
                        />
                    ))}
                    <span>{t('usage.heatmap.more')}</span>
                </div>
            </div>

            {/* 悬浮 Tooltip 浮层 */}
            {tooltip && (
                <div
                    className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border border-gray-100 bg-white/95 px-3 py-2 text-xs shadow-xl backdrop-blur-sm dark:border-base-200 dark:bg-base-100/95"
                    style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
                >
                    <div className="font-semibold text-gray-900 dark:text-base-content">
                        {tooltip.day.date}
                    </div>
                    {tooltip.day.requestCount === 0 ? (
                        <div className={cn('mt-0.5', muted)}>
                            {t('usage.heatmap.noData')}
                        </div>
                    ) : (
                        <div className="mt-1 space-y-0.5 text-gray-600 dark:text-gray-300">
                            <div className="flex justify-between gap-4">
                                <span>{t('usage.heatmap.requests')}:</span>
                                <span className="font-medium text-gray-900 dark:text-base-content">
                                    {tooltip.day.requestCount.toLocaleString()}
                                </span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span>{t('usage.heatmap.tokens')}:</span>
                                <span className="font-medium text-gray-900 dark:text-base-content">
                                    {tooltip.day.totalTokens.toLocaleString()}
                                </span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span>{t('usage.heatmap.cost')}:</span>
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                    ${Number.parseFloat(tooltip.day.totalCost).toFixed(4)}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
