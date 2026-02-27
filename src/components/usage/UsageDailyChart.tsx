import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import type { UsageDailySummary } from '../../stores/useUsageStore';

interface UsageDailyChartProps {
    summaries: UsageDailySummary[];
}

function UsageDailyChart({ summaries }: UsageDailyChartProps) {
    const { t } = useTranslation();

    if (summaries.length === 0) {
        return (
            <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
                <div className="flex items-center gap-2 mb-4">
                    <BarChart3 className="w-5 h-5 text-emerald-500" />
                    <h2 className="font-semibold text-gray-900 dark:text-base-content">
                        {t('usage.dailyChart', 'Daily Token Usage')}
                    </h2>
                </div>
                <div className="h-48 flex items-center justify-center text-sm text-gray-400">
                    {t('usage.noData', 'No usage data available')}
                </div>
            </div>
        );
    }

    // 按日期正序排列（最早的在左边）
    const sorted = [...summaries].sort((a, b) => a.date.localeCompare(b.date));
    const dailyTokens = sorted.map(s => s.totalInputTokens + s.totalOutputTokens);
    const maxTokens = Math.max(...dailyTokens, 1);

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-5 h-5 text-emerald-500" />
                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                    {t('usage.dailyChart', 'Daily Token Usage')}
                </h2>
                <span className="text-xs text-gray-400 ml-auto">
                    {sorted.length} {t('usage.days', 'days')}
                </span>
            </div>

            <div className="flex">
                {/* Y 轴标签 */}
                <div className="flex flex-col justify-between h-48 pr-2 text-xs text-gray-400 shrink-0">
                    <span>{formatCompact(maxTokens)}</span>
                    <span>{formatCompact(Math.round(maxTokens / 2))}</span>
                    <span>0</span>
                </div>
                {/* 柱状图区域 */}
                <div className="flex-1 flex flex-col">
                    <div className="flex items-end gap-1 h-48">
                        {sorted.map((summary, i) => {
                            const tokens = dailyTokens[i];
                            const height = Math.max((tokens / maxTokens) * 100, 3);
                            return (
                                <div
                                    key={summary.date}
                                    className="flex-1 h-full flex flex-col items-center justify-end group relative"
                                >
                                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                                        {formatCompact(tokens)}
                                    </div>
                                    <div
                                        className="w-full rounded-t bg-gradient-to-t from-emerald-500 to-emerald-400 dark:from-emerald-600 dark:to-emerald-400 transition-all duration-200 group-hover:from-emerald-600 group-hover:to-emerald-500 group-hover:scale-y-105 min-w-[4px]"
                                        style={{ height: `${height}%` }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                    {/* X 轴日期标签 */}
                    <div className="flex gap-1 mt-1">
                        {sorted.map((summary, i) => {
                            // 标签太多时只显示部分
                            const showLabel = sorted.length <= 14 || i % Math.ceil(sorted.length / 10) === 0 || i === sorted.length - 1;
                            return (
                                <div key={summary.date} className="flex-1 text-center">
                                    <span className="text-[10px] text-gray-400">
                                        {showLabel ? formatDateLabel(summary.date) : ''}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

function formatCompact(v: number): string {
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toLocaleString();
}

function formatDateLabel(rawDate?: string): string {
    if (!rawDate) return '';
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) return rawDate;
    return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

export default UsageDailyChart;
