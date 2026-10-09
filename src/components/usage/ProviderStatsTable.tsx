import { useTranslation } from 'react-i18next';
import { Inbox } from 'lucide-react';
import { useProviderStats } from '../../hooks/useUsageQueries';
import {
    formatCost,
    formatTokens,
    formatTokensPerSecond,
    getLocaleFromLanguage,
} from '../../utils/format';
import type { TimeRange } from '../../types/usage';
import { cn } from '../../utils/cn';
import { getUsageProviderLabel, usageProviderTitle } from './providerLabel';
import { card, chip, emptyState, row, tableWrap, thead, type ChipTone } from './styles';

interface ProviderStatsTableProps {
    range: TimeRange;
    refreshMs: number;
}

/** 成功率着色：≥99 绿、≥95 黄、更低红 */
function successTone(rate: number): ChipTone {
    if (rate >= 99) return 'success';
    if (rate >= 95) return 'warning';
    return 'error';
}

/**
 * 供应商统计（列与参考项目 cc-switch 新版一致）
 *
 * 供应商 / 请求数 / Tokens（真实消耗）/ 成本 / 成功率 / 速度。
 * Tokens 与汇总卡「真实消耗」同口径，各行之和等于顶部总数；
 * 后端已按请求数排序。
 */
export function ProviderStatsTable({ range, refreshMs }: ProviderStatsTableProps) {
    const { t, i18n } = useTranslation();
    const { data: stats, isLoading, isPlaceholderData } = useProviderStats(range, refreshMs);
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
            <table className="table min-w-[620px]" aria-label={t('usage.providerStats')}>
                <thead className={thead}>
                    <tr>
                        <th>{t('usage.provider')}</th>
                        <th className="text-right">{t('usage.requests')}</th>
                        <th className="text-right">{t('usage.tokens')}</th>
                        <th className="text-right">{t('usage.cost')}</th>
                        <th className="text-right">{t('usage.successRate')}</th>
                        <th className="text-right" title={t('usage.speedHelp')}>
                            {t('usage.speed')}
                        </th>
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
                        stats.map((stat) => {
                            const provider = getUsageProviderLabel(stat.providerName, t);
                            const speed = formatTokensPerSecond(
                                stat.speedOutputTokens,
                                stat.speedGenerationMs
                            );
                            return (
                                <tr key={`${stat.providerId}-${stat.appType}`} className={row}>
                                    <td>
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span
                                                className={cn(
                                                    'block max-w-[260px] truncate font-medium',
                                                    provider.isSession
                                                        ? 'text-gray-600 dark:text-gray-300'
                                                        : 'text-gray-900 dark:text-base-content'
                                                )}
                                                title={usageProviderTitle(provider)}
                                            >
                                                {provider.label}
                                            </span>
                                            {/* 会话占位名里已经带了应用名，不再重复 */}
                                            {!provider.isSession && (
                                                <span className={chip('neutral')}>{stat.appType}</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="text-right tabular-nums">
                                        {stat.requestCount.toLocaleString(locale)}
                                    </td>
                                    <td
                                        className="text-right tabular-nums"
                                        title={stat.totalTokens.toLocaleString(locale)}
                                    >
                                        {formatTokens(stat.totalTokens)}
                                    </td>
                                    <td
                                        className="text-right font-semibold tabular-nums text-gray-900 dark:text-base-content"
                                        title={formatCost(stat.totalCost, 6)}
                                    >
                                        {formatCost(stat.totalCost)}
                                    </td>
                                    <td className="text-right">
                                        <span className={chip(successTone(stat.successRate))}>
                                            {stat.successRate.toFixed(
                                                stat.successRate >= 99.95 ? 0 : 1
                                            )}
                                            %
                                        </span>
                                    </td>
                                    <td
                                        className={cn(
                                            'text-right tabular-nums',
                                            speed == null
                                                ? 'text-gray-400 dark:text-gray-500'
                                                : 'text-gray-700 dark:text-gray-200'
                                        )}
                                    >
                                        {speed == null ? (
                                            '—'
                                        ) : (
                                            <>
                                                {speed}
                                                <span className="ms-0.5 text-[11px] font-normal text-gray-400">
                                                    tok/s
                                                </span>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
}
