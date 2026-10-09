import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, DollarSign, Layers, MessageSquare, FolderOpen, type LucideIcon } from 'lucide-react';
import { useUsageSummary, useUsageTrends } from '../../hooks/useUsageQueries';
import { useDashboardStore } from '../../stores/useDashboardStore';
import { formatCost, formatTokens, getLocaleFromLanguage } from '../../utils/format';
import { cn } from '../../utils/cn';
import { muted } from '../usage/styles';
import type { UsageRangeSelection } from '../../types/usage';

/** 概览固定近 7 天；时间范围切换在 /usage 页面 */
const RANGE: UsageRangeSelection = { preset: '7d' };
const NO_FILTERS = {};
const WINDOW_DAYS = 7;

type Source = 'proxy' | 'local';

interface Kpi {
    key: string;
    label: string;
    /** null = 数据源不可用，显示 "—" */
    value: string | null;
    exact?: string;
    sub?: string;
    source: Source;
    icon: LucideIcon;
    color: string;
    spark?: number[];
}

/** 近 N 天的本地日期键（YYYY-MM-DD），从旧到新 */
function recentDateKeys(days: number): string[] {
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = new Date();
    return Array.from({ length: days }, (_, i) => {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i));
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    });
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
    if (values.length < 2 || values.every((v) => v === 0)) {
        return <div className="h-6" />;
    }
    const max = Math.max(...values, 1);
    const points = values
        .map((v, i) => `${(i / (values.length - 1)) * 100},${22 - (v / max) * 20}`)
        .join(' ');
    return (
        <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={cn('h-6 w-full', color)}>
            <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}

/**
 * 主页唯一的统计卡片：一行 KPI
 *
 * 两类数据源口径不同，每项都标注来源：
 * - 代理：经本地代理转发并落库的请求（含费用）
 * - 本地：扫描 ~/.claude 下的会话 / 历史文件
 * 代理没有数据时 Token 回退到本地会话的近 7 天 token。
 */
export default function OverviewKpiRow() {
    const { t, i18n } = useTranslation();
    const locale = getLocaleFromLanguage(i18n.resolvedLanguage || i18n.language);
    const summaryQuery = useUsageSummary(RANGE, NO_FILTERS, 0);
    const trendsQuery = useUsageTrends(RANGE, NO_FILTERS, 0);
    const { stats, activity, tokenStats, hasLoaded } = useDashboardStore();

    const summary = summaryQuery.data;
    const trends = trendsQuery.data;
    const proxyFailed = summaryQuery.isError;
    const loading = (summaryQuery.isLoading && !proxyFailed) || !hasLoaded;

    const kpis = useMemo<Kpi[]>(() => {
        const keys = recentDateKeys(WINDOW_DAYS);

        const localTokenByDay = new Map(
            (tokenStats?.dailyModelTokens ?? []).map((d) => [
                d.date,
                Object.values(d.tokensByModel).reduce((s, v) => s + v, 0),
            ])
        );
        const localTokenSpark = keys.map((k) => localTokenByDay.get(k) ?? 0);
        const localTokenTotal = localTokenSpark.reduce((s, v) => s + v, 0);

        const promptsByDay = new Map(activity.map((a) => [a.date, a.count]));
        const promptSpark = keys.map((k) => promptsByDay.get(k) ?? 0);

        const proxyTokens = summary?.realTotalTokens ?? 0;
        const useLocalTokens = !summary || proxyTokens === 0;

        return [
            {
                key: 'requests',
                label: t('dashboard.kpi.requests'),
                value: summary ? summary.totalRequests.toLocaleString(locale) : null,
                source: 'proxy',
                icon: Activity,
                color: 'text-blue-500',
                spark: trends?.map((d) => d.requestCount),
            },
            {
                key: 'cost',
                label: t('dashboard.kpi.cost'),
                value: summary ? formatCost(summary.totalCost) : null,
                exact: summary ? formatCost(summary.totalCost, 6) : undefined,
                source: 'proxy',
                icon: DollarSign,
                color: 'text-emerald-500',
                spark: trends?.map((d) => Number(d.totalCost) || 0),
            },
            useLocalTokens
                ? {
                      key: 'tokens',
                      label: t('dashboard.kpi.tokens'),
                      value: tokenStats ? formatTokens(localTokenTotal) : null,
                      exact: localTokenTotal.toLocaleString(locale),
                      source: 'local',
                      icon: Layers,
                      color: 'text-violet-500',
                      spark: localTokenSpark,
                  }
                : {
                      key: 'tokens',
                      label: t('dashboard.kpi.tokens'),
                      value: formatTokens(proxyTokens),
                      exact: proxyTokens.toLocaleString(locale),
                      source: 'proxy',
                      icon: Layers,
                      color: 'text-violet-500',
                      spark: trends?.map((d) => d.totalTokens),
                  },
            {
                key: 'prompts',
                label: t('dashboard.kpi.prompts'),
                value: hasLoaded ? promptSpark.reduce((s, v) => s + v, 0).toLocaleString(locale) : null,
                source: 'local',
                icon: MessageSquare,
                color: 'text-pink-500',
                spark: promptSpark,
            },
            {
                key: 'sessions',
                label: t('dashboard.kpi.sessions'),
                value: stats ? stats.total_sessions.toLocaleString(locale) : null,
                sub: stats ? t('dashboard.kpi.projectsCount', { count: stats.total_projects }) : undefined,
                source: 'local',
                icon: FolderOpen,
                color: 'text-cyan-500',
            },
        ];
    }, [summary, trends, stats, activity, tokenStats, hasLoaded, t, locale]);

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
            <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                    {t('dashboard.kpi.title')}
                    <span className={cn('ml-2 text-xs font-normal', muted)}>{t('dashboard.kpi.window')}</span>
                </h2>
                <Link
                    to="/usage"
                    className="btn btn-ghost btn-sm gap-1 text-sm font-normal opacity-70 hover:opacity-100"
                >
                    {t('usage.viewDetails')}
                    <ArrowRight className="h-3.5 w-3.5" />
                </Link>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
                {kpis.map((kpi) => (
                    <div key={kpi.key} className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <kpi.icon className={cn('h-3.5 w-3.5 shrink-0', kpi.color)} />
                            <span className={cn('truncate text-xs', muted)}>{kpi.label}</span>
                            <span
                                className={cn(
                                    'ml-auto shrink-0 rounded px-1 py-px text-[10px] leading-none',
                                    kpi.source === 'proxy'
                                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                        : 'bg-gray-500/10 text-gray-500 dark:text-gray-400'
                                )}
                                title={t(kpi.source === 'proxy' ? 'dashboard.kpi.sourceProxyHint' : 'dashboard.kpi.sourceLocalHint')}
                            >
                                {t(kpi.source === 'proxy' ? 'dashboard.kpi.sourceProxy' : 'dashboard.kpi.sourceLocal')}
                            </span>
                        </div>
                        {loading && kpi.value === null ? (
                            <div className="skeleton mt-2 h-7 w-20" />
                        ) : (
                            <div
                                className="mt-1 truncate text-2xl font-bold tabular-nums text-gray-900 dark:text-base-content"
                                title={kpi.exact ?? kpi.value ?? undefined}
                            >
                                {kpi.value ?? '—'}
                            </div>
                        )}
                        {kpi.spark ? (
                            <Sparkline values={kpi.spark} color={kpi.color} />
                        ) : (
                            <div className={cn('flex h-6 items-center text-xs', muted)}>{kpi.sub}</div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
