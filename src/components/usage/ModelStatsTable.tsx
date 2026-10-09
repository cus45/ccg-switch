import { useTranslation } from 'react-i18next';
import { Inbox } from 'lucide-react';
import { useModelStats } from '../../hooks/useUsageQueries';
import { formatCost, getLocaleFromLanguage } from '../../utils/format';
import type { TimeRange } from '../../types/usage';
import { cn } from '../../utils/cn';
import { card, emptyState, row, tableWrap, thead } from './styles';

interface ModelStatsTableProps {
    range: TimeRange;
    refreshMs: number;
}

export function ModelStatsTable({ range, refreshMs }: ModelStatsTableProps) {
    const { t, i18n } = useTranslation();
    const { data: stats, isLoading, isPlaceholderData } = useModelStats(range, refreshMs);
    const locale = getLocaleFromLanguage(i18n.resolvedLanguage || i18n.language);

    if (isLoading) {
        return (
            <div className={cn(card, 'space-y-3 p-4')} aria-busy="true">
                {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="skeleton h-9 w-full" />
                ))}
            </div>
        );
    }

    return (
        <div className={cn(tableWrap, 'transition-opacity', isPlaceholderData && 'opacity-60')}>
            <table className="table">
                <thead className={thead}>
                    <tr>
                        <th>{t('usage.model')}</th>
                        <th className="text-right">{t('usage.totalRequests')}</th>
                        <th className="text-right">{t('usage.tokens')}</th>
                        <th className="text-right">{t('usage.cacheTokens')}</th>
                        <th className="text-right">{t('usage.totalCost')}</th>
                        <th className="text-right">{t('usage.avgCost')}</th>
                    </tr>
                </thead>
                <tbody>
                    {!stats || stats.length === 0 ? (
                        <tr>
                            <td colSpan={6}>
                                <div className={emptyState}>
                                    <Inbox className="h-8 w-8 opacity-40" />
                                    <span>{t('usage.noData')}</span>
                                </div>
                            </td>
                        </tr>
                    ) : (
                        stats.map((stat) => (
                            <tr key={stat.model} className={row}>
                                <td>
                                    <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-800 dark:bg-base-200 dark:text-gray-100">
                                        {stat.model}
                                    </code>
                                </td>
                                <td className="text-right tabular-nums">
                                    {stat.requestCount.toLocaleString(locale)}
                                </td>
                                <td className="text-right tabular-nums">
                                    {stat.totalTokens.toLocaleString(locale)}
                                </td>
                                <td className="text-right tabular-nums text-gray-500 dark:text-gray-400">
                                    {(stat.cacheReadTokens + stat.cacheCreationTokens).toLocaleString(
                                        locale
                                    )}
                                </td>
                                <td className="text-right font-semibold tabular-nums text-gray-900 dark:text-base-content">
                                    {formatCost(stat.totalCost)}
                                </td>
                                <td className="text-right tabular-nums text-gray-500 dark:text-gray-400">
                                    {formatCost(stat.avgCostPerRequest)}
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}
