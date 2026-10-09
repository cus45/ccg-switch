import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts';
import { useUsageTrends } from '../../hooks/useUsageQueries';
import { formatCost, getLocaleFromLanguage, parseFiniteNumber } from '../../utils/format';
import type { StatsFilters, UsageRangeSelection } from '../../types/usage';
import { isHourlyRange } from '../../services/usage';
import { cn } from '../../utils/cn';
import { UsageChartSkeleton } from './UsageChartSkeleton';
import { card, chip } from './styles';

interface UsageTrendChartProps {
    range: UsageRangeSelection;
    /** 顶部筛选行下发的全局筛选（应用 / 供应商 / 模型） */
    filters: StatsFilters;
    refreshMs: number;
}

interface TooltipEntry {
    color?: string;
    name?: string;
    dataKey?: string | number;
    value?: number | string;
}

interface TrendTooltipProps {
    active?: boolean;
    payload?: TooltipEntry[];
    label?: string;
    locale: string;
}

/**
 * 自定义提示框
 *
 * 必须定义在组件外：放在渲染函数里每次刷新都会产生新的组件类型，
 * recharts 会卸载重建整个提示框（轮询时 hover 会闪）。
 */
function TrendTooltip({ active, payload, label, locale }: TrendTooltipProps) {
    if (!active || !payload || payload.length === 0) return null;
    return (
        <div className="rounded-lg border border-gray-100 bg-white/95 p-3 text-sm shadow-lg backdrop-blur-md dark:border-base-200 dark:bg-base-100/95">
            <p className="mb-2 font-medium text-gray-900 dark:text-base-content">{label}</p>
            {payload.map((entry, index) => (
                <div
                    key={index}
                    className="flex items-center gap-2 text-sm"
                    style={{ color: entry.color }}
                >
                    <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: entry.color }}
                    />
                    <span className="font-medium">{entry.name}:</span>
                    <span className="tabular-nums">
                        {entry.dataKey === 'cost'
                            ? formatCost(entry.value?.toString())
                            : Number(entry.value ?? 0).toLocaleString(locale)}
                    </span>
                </div>
            ))}
        </div>
    );
}

export function UsageTrendChart({ range, filters, refreshMs }: UsageTrendChartProps) {
    const { t, i18n } = useTranslation();
    const { data: trends, isLoading, isPlaceholderData } = useUsageTrends(
        range,
        filters,
        refreshMs
    );

    const isToday = isHourlyRange(range);
    const dateLocale = getLocaleFromLanguage(i18n.resolvedLanguage || i18n.language);

    // 数据与语言/范围不变时不重算（轮询返回相同引用时直接复用）
    const chartData = useMemo(
        () =>
            (trends ?? []).map((stat) => {
                const pointDate = new Date(stat.date);
                return {
                    rawDate: stat.date,
                    label: isToday
                        ? pointDate.toLocaleString(dateLocale, {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                          })
                        : pointDate.toLocaleDateString(dateLocale, {
                              month: '2-digit',
                              day: '2-digit',
                          }),
                    inputTokens: stat.totalInputTokens,
                    outputTokens: stat.totalOutputTokens,
                    cacheCreationTokens: stat.totalCacheCreationTokens,
                    cacheReadTokens: stat.totalCacheReadTokens,
                    cost: parseFiniteNumber(stat.totalCost),
                };
            }),
        [trends, isToday, dateLocale]
    );

    if (isLoading) {
        return <UsageChartSkeleton />;
    }

    return (
        <div className={cn(card, 'p-5 transition-opacity', isPlaceholderData && 'opacity-60')}>
            <div className="mb-6 flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-900 dark:text-base-content">
                    {t('usage.trends')}
                </h3>
                <span className={chip('neutral')}>
                    {range.preset === 'today'
                        ? t('usage.rangeThisDay')
                        : range.preset === '1d'
                          ? t('usage.rangeToday')
                          : range.preset === '7d'
                            ? t('usage.rangeLast7Days')
                            : range.preset === '30d'
                              ? t('usage.rangeLast30Days')
                              : t('usage.customRange')}
                </span>
            </div>

            <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="colorCacheCreation" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f97316" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="colorCacheRead" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="currentColor"
                            className="opacity-30"
                        />
                        <XAxis
                            dataKey="label"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: 'currentColor', fontSize: 12 }}
                            className="text-base-content/60"
                            dy={10}
                        />
                        <YAxis
                            yAxisId="tokens"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: 'currentColor', fontSize: 12 }}
                            className="text-base-content/60"
                            tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                        />
                        <YAxis
                            yAxisId="cost"
                            orientation="right"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: 'currentColor', fontSize: 12 }}
                            className="text-base-content/60"
                            tickFormatter={(value) => `$${value.toFixed(2)}`}
                        />
                        <Tooltip
                            content={<TrendTooltip locale={dateLocale} />}
                            cursor={{ stroke: 'currentColor', strokeOpacity: 0.2 }}
                        />
                        <Legend />
                        <Area
                            yAxisId="tokens"
                            type="monotone"
                            dataKey="inputTokens"
                            name={t('usage.inputTokens')}
                            stroke="#3b82f6"
                            fillOpacity={1}
                            fill="url(#colorInput)"
                            strokeWidth={2}
                        />
                        <Area
                            yAxisId="tokens"
                            type="monotone"
                            dataKey="outputTokens"
                            name={t('usage.outputTokens')}
                            stroke="#22c55e"
                            fillOpacity={1}
                            fill="url(#colorOutput)"
                            strokeWidth={2}
                        />
                        <Area
                            yAxisId="tokens"
                            type="monotone"
                            dataKey="cacheCreationTokens"
                            name={t('usage.cacheCreationTokens')}
                            stroke="#f97316"
                            fillOpacity={1}
                            fill="url(#colorCacheCreation)"
                            strokeWidth={2}
                        />
                        <Area
                            yAxisId="tokens"
                            type="monotone"
                            dataKey="cacheReadTokens"
                            name={t('usage.cacheReadTokens')}
                            stroke="#a855f7"
                            fillOpacity={1}
                            fill="url(#colorCacheRead)"
                            strokeWidth={2}
                        />
                        <Area
                            yAxisId="cost"
                            type="monotone"
                            dataKey="cost"
                            name={t('usage.cost')}
                            stroke="#f43f5e"
                            fill="none"
                            strokeWidth={2}
                            strokeDasharray="4 4"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
