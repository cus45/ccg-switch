import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Database, DollarSign, Gauge, Layers, type LucideIcon } from 'lucide-react';
import { useUsageSummary } from '../../hooks/useUsageQueries';
import { formatCost, formatTokens, getLocaleFromLanguage } from '../../utils/format';
import type { TimeRange } from '../../types/usage';
import { cn } from '../../utils/cn';
import { card, cardHover, muted } from './styles';

interface UsageSummaryCardsProps {
    range: TimeRange;
    refreshMs: number;
}

interface SubRow {
    label: string;
    value: string;
    /** 分项前的小色点，与趋势图里同一指标的颜色一致 */
    dot: string;
}

interface StatCard {
    title: string;
    value: string;
    /** 悬停时看精确值 */
    exact?: string;
    icon: LucideIcon;
    gradient: string;
    rows: SubRow[];
}

/** 卡片标题行：标题 + 渐变图标块 */
function CardHeader({
    title,
    icon: Icon,
    gradient,
    help,
}: {
    title: string;
    icon: LucideIcon;
    gradient: string;
    help?: string;
}) {
    return (
        <div className="flex items-start justify-between gap-3">
            <p
                className={cn('truncate text-xs font-medium uppercase tracking-wide', muted)}
                title={help}
            >
                {title}
            </p>
            <div
                className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-md',
                    gradient
                )}
            >
                <Icon className="h-5 w-5" />
            </div>
        </div>
    );
}

/**
 * 缓存命中率卡
 *
 * 命中率 = 缓存命中 ÷（新鲜输入 + 缓存写入 + 缓存命中），与参考项目 cc-switch 同口径。
 * 后端已把 Codex / Gemini 含缓存的输入归一成新鲜输入，这里直接用。
 */
function CacheHitRateCard({
    rate,
    cacheRead,
    cacheable,
}: {
    rate: number;
    cacheRead: number;
    cacheable: number;
}) {
    const { t } = useTranslation();
    const percent = Math.max(0, Math.min(100, rate * 100));
    const label = `${percent.toFixed(percent >= 99.95 ? 0 : 1)}%`;
    // 命中率越高越好：≥60% 绿、≥30% 黄、更低灰
    const tone =
        percent >= 60
            ? { text: 'text-emerald-500', bar: 'bg-emerald-500' }
            : percent >= 30
              ? { text: 'text-amber-500', bar: 'bg-amber-500' }
              : { text: 'text-gray-500 dark:text-gray-400', bar: 'bg-gray-400' };

    return (
        <div className={cn(cardHover, 'p-5')}>
            <CardHeader
                title={t('usage.cacheHitRate')}
                icon={Gauge}
                gradient="from-emerald-500 to-green-500"
                help={t('usage.hitRateHelp')}
            />
            <h3 className={cn('mt-2 text-2xl font-bold tabular-nums', tone.text)}>{label}</h3>
            <div className="mt-4 h-[52px] border-t border-gray-100 pt-3 dark:border-base-200">
                <div
                    className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-base-200"
                    role="progressbar"
                    aria-label={t('usage.cacheHitRate')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(percent)}
                >
                    <div
                        className={cn('h-full rounded-full transition-[width] duration-500', tone.bar)}
                        style={{ width: `${percent}%` }}
                    />
                </div>
                <p className={cn('mt-2 truncate text-xs tabular-nums', muted)} title={t('usage.hitRateHelp')}>
                    {formatTokens(cacheRead)} / {formatTokens(cacheable)}
                </p>
            </div>
        </div>
    );
}

export function UsageSummaryCards({ range, refreshMs }: UsageSummaryCardsProps) {
    const { t, i18n } = useTranslation();
    const { data: summary, isLoading, isPlaceholderData } = useUsageSummary(range, refreshMs);
    const locale = getLocaleFromLanguage(i18n.resolvedLanguage || i18n.language);

    const inputTokens = summary?.totalInputTokens ?? 0;
    const outputTokens = summary?.totalOutputTokens ?? 0;
    const cacheCreationTokens = summary?.totalCacheCreationTokens ?? 0;
    const cacheReadTokens = summary?.totalCacheReadTokens ?? 0;
    const realTotal =
        summary?.realTotalTokens ?? inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;

    const stats = useMemo<StatCard[]>(
        () => [
            {
                title: t('usage.totalRequests'),
                value: (summary?.totalRequests ?? 0).toLocaleString(locale),
                icon: Activity,
                gradient: 'from-blue-500 to-indigo-500',
                rows: [],
            },
            {
                title: t('usage.totalCost'),
                value: formatCost(summary?.totalCost),
                exact: formatCost(summary?.totalCost, 6),
                icon: DollarSign,
                gradient: 'from-emerald-500 to-teal-500',
                rows: [],
            },
            {
                // 真实消耗 = 新鲜输入 + 输出 + 缓存写入 + 缓存命中；供应商 / 模型表的 Tokens 列各行之和等于它
                title: t('usage.realTotal'),
                value: formatTokens(realTotal),
                exact: realTotal.toLocaleString(locale),
                icon: Layers,
                gradient: 'from-violet-500 to-purple-500',
                rows: [
                    {
                        label: t('usage.freshInput'),
                        value: formatTokens(inputTokens),
                        dot: 'bg-blue-500',
                    },
                    {
                        label: t('usage.output'),
                        value: formatTokens(outputTokens),
                        dot: 'bg-emerald-500',
                    },
                ],
            },
            {
                title: t('usage.cacheTokens'),
                value: formatTokens(cacheCreationTokens + cacheReadTokens),
                exact: (cacheCreationTokens + cacheReadTokens).toLocaleString(locale),
                icon: Database,
                gradient: 'from-orange-500 to-amber-500',
                rows: [
                    {
                        label: t('usage.cacheWrite'),
                        value: formatTokens(cacheCreationTokens),
                        dot: 'bg-orange-500',
                    },
                    {
                        label: t('usage.cacheRead'),
                        value: formatTokens(cacheReadTokens),
                        dot: 'bg-violet-500',
                    },
                ],
            },
        ],
        [summary, t, locale, realTotal, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens]
    );

    const grid = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5';

    if (isLoading) {
        return (
            <div className={grid}>
                {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className={cn(card, 'p-5')} aria-busy="true">
                        <div className="flex items-start justify-between">
                            <div className="skeleton h-3 w-20" />
                            <div className="skeleton h-10 w-10 rounded-lg" />
                        </div>
                        <div className="skeleton mt-4 h-7 w-28" />
                        <div className="mt-4 space-y-2 border-t border-gray-100 pt-3 dark:border-base-200">
                            <div className="skeleton h-3 w-full" />
                            <div className="skeleton h-3 w-2/3" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className={cn(grid, 'transition-opacity', isPlaceholderData && 'opacity-60')}>
            {stats.map((stat) => (
                <div key={stat.title} className={cn(cardHover, 'p-5')}>
                    <CardHeader title={stat.title} icon={stat.icon} gradient={stat.gradient} />
                    <h3
                        className="mt-2 truncate text-2xl font-bold tabular-nums text-gray-900 dark:text-base-content"
                        title={stat.exact ?? stat.value}
                    >
                        {stat.value}
                    </h3>

                    {/* 分项区固定高度：没有分项的卡片也占同样的高度，各卡底边对齐 */}
                    <div
                        className={cn(
                            'mt-4 h-[52px] border-t pt-3',
                            stat.rows.length > 0
                                ? 'border-gray-100 dark:border-base-200'
                                : 'border-transparent'
                        )}
                    >
                        {stat.rows.length > 0 && (
                            <div className="flex flex-col gap-1.5 text-xs">
                                {stat.rows.map((r) => (
                                    <div key={r.label} className="flex items-center justify-between">
                                        <span className={cn('flex items-center gap-1.5', muted)}>
                                            <span className={cn('h-1.5 w-1.5 rounded-full', r.dot)} />
                                            {r.label}
                                        </span>
                                        <span className="font-medium tabular-nums text-gray-700 dark:text-gray-200">
                                            {r.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ))}

            <CacheHitRateCard
                rate={summary?.cacheHitRate ?? 0}
                cacheRead={cacheReadTokens}
                cacheable={inputTokens + cacheCreationTokens + cacheReadTokens}
            />
        </div>
    );
}
