import { useTranslation } from 'react-i18next';
import { Activity, BarChart3, Clock, Coins, FolderOpen, Hash, MessageSquare, PieChart, RefreshCw } from 'lucide-react';
import { useState, useEffect, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { useDashboardStore } from '../stores/useDashboardStore';

interface ChartPoint {
    x: number;
    y: number;
}

interface PieShareItem {
    name: string;
    tokens: number;
    color: string;
}

interface DonutSegment extends PieShareItem {
    dash: number;
    offset: number;
}

function Dashboard() {
    const { t } = useTranslation();
    const { stats, activity, tokenStats, projectTokenStats, hasLoaded, loading, loadData, refreshStatsCache, refreshingStats } = useDashboardStore();
    const [hoveredTrendIndex, setHoveredTrendIndex] = useState<number | null>(null);
    const [hoveredPieName, setHoveredPieName] = useState<string | null>(null);

    useEffect(() => {
        if (!hasLoaded) {
            void loadData();
        }
    }, [hasLoaded, loadData]);

    const recentActivity = useMemo(() => activity.slice(-30), [activity]);
    const maxCount = useMemo(() => Math.max(...recentActivity.map(a => a.count), 1), [recentActivity]);

    const modelEntries = useMemo(() => tokenStats ? Object.entries(tokenStats.modelUsage) : [], [tokenStats]);
    const totalTokens = useMemo(() => modelEntries.reduce((sum, [, u]) => sum + u.inputTokens + u.outputTokens, 0), [modelEntries]);

    const { dailyTotals, trendPoints, trendLinePath, trendAreaPath, midTrendDay, totalRecentTokens, avgDailyTokens, peakTokenDay, maxSmoothedDailyTokens } = useMemo(() => {
        const recentTokenDays = (tokenStats?.dailyModelTokens || []).slice(-30);
        const _dailyTotals = recentTokenDays.map(d => ({
            date: d.date,
            total: Object.values(d.tokensByModel).reduce((s, v) => s + v, 0),
        }));
        const _smoothed = smoothDailyTotals(_dailyTotals);
        const maxSmoothed = Math.max(..._smoothed.map(d => d.total), 1);

        const _trendPoints: ChartPoint[] = _smoothed.map((day, index) => {
            const x = _smoothed.length <= 1 ? 50 : 6 + (index / (_smoothed.length - 1)) * 88;
            const y = 86 - (day.total / maxSmoothed) * 70;
            return { x, y: Math.min(Math.max(y, 12), 86) };
        });
        const _trendLinePath = buildSmoothPath(_trendPoints);
        const _trendAreaPath = _trendLinePath && _trendPoints.length > 0
            ? `${_trendLinePath} L ${_trendPoints[_trendPoints.length - 1].x} 86 L ${_trendPoints[0].x} 86 Z`
            : '';
        const _midTrendDay = _dailyTotals.length > 0 ? _dailyTotals[Math.floor((_dailyTotals.length - 1) / 2)] : null;
        const _totalRecentTokens = _dailyTotals.reduce((sum, day) => sum + day.total, 0);
        const _avgDailyTokens = _dailyTotals.length > 0 ? Math.round(_totalRecentTokens / _dailyTotals.length) : 0;
        const _peakTokenDay = _dailyTotals.length > 0
            ? _dailyTotals.reduce((peak, current) => (current.total > peak.total ? current : peak), _dailyTotals[0])
            : null;

        return {
            dailyTotals: _dailyTotals,
            trendPoints: _trendPoints,
            trendLinePath: _trendLinePath,
            trendAreaPath: _trendAreaPath,
            midTrendDay: _midTrendDay,
            totalRecentTokens: _totalRecentTokens,
            avgDailyTokens: _avgDailyTokens,
            peakTokenDay: _peakTokenDay,
            maxSmoothedDailyTokens: maxSmoothed,
        };
    }, [tokenStats]);

    const hoveredTrendPoint = hoveredTrendIndex !== null ? trendPoints[hoveredTrendIndex] : null;
    const hoveredTrendDay = hoveredTrendIndex !== null ? dailyTotals[hoveredTrendIndex] : null;
    const hoveredTrendLabelX = hoveredTrendPoint ? Math.min(Math.max(hoveredTrendPoint.x, 10), 90) : 50;

    const { hourData, maxHourCount } = useMemo(() => {
        const _hourData = Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            count: tokenStats?.hourCounts?.[String(i)] || 0,
        }));
        return { hourData: _hourData, maxHourCount: Math.max(..._hourData.map(h => h.count), 1) };
    }, [tokenStats]);

    const topModels = useMemo(() => [...modelEntries]
        .sort(([, a], [, b]) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
        .slice(0, 10), [modelEntries]);

    const { topProjects, maxProjectTokens } = useMemo(() => {
        const _topProjects = [...projectTokenStats]
            .sort((a, b) => b.total_tokens - a.total_tokens)
            .slice(0, 12);
        return { topProjects: _topProjects, maxProjectTokens: Math.max(..._topProjects.map(p => p.total_tokens), 1) };
    }, [projectTokenStats]);

    const { pieData, donutSegments, donutRadius, donutCircumference } = useMemo(() => {
        const pieColors = ['#14b8a6', '#3b82f6', '#f97316', '#a855f7', '#22c55e', '#94a3b8'];
        const primaryPieData: PieShareItem[] = topModels.slice(0, 5).map(([name, usage], index) => ({
            name,
            tokens: usage.inputTokens + usage.outputTokens,
            color: pieColors[index],
        }));
        const primaryPieTokens = primaryPieData.reduce((sum, item) => sum + item.tokens, 0);
        const othersTokens = Math.max(totalTokens - primaryPieTokens, 0);
        const _pieData: PieShareItem[] = othersTokens > 0
            ? [...primaryPieData, { name: t('token_usage.others'), tokens: othersTokens, color: pieColors[5] }]
            : primaryPieData;
        const donutRadius = 34;
        const donutCircumference = 2 * Math.PI * donutRadius;
        return { pieData: _pieData, donutSegments: buildDonutSegments(_pieData, totalTokens, donutCircumference), donutRadius, donutCircumference };
    }, [topModels, totalTokens, t]);

    const hoveredPieItem = hoveredPieName ? pieData.find(item => item.name === hoveredPieName) || null : null;
    const hoveredPieShare = hoveredPieItem && totalTokens > 0
        ? ((hoveredPieItem.tokens / totalTokens) * 100).toFixed(1)
        : null;

    const handleTrendMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
        if (trendPoints.length === 0) {
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) {
            return;
        }
        const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
        let nearestIndex = 0;
        let minDistance = Number.POSITIVE_INFINITY;
        trendPoints.forEach((point, index) => {
            const distance = Math.abs(point.x - xPercent);
            if (distance < minDistance) {
                minDistance = distance;
                nearestIndex = index;
            }
        });
        setHoveredTrendIndex(nearestIndex);
    };

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="p-6 space-y-6 max-w-7xl mx-auto">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-base-content">
                            {t('dashboard.welcome')}
                        </h1>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">
                            {t('dashboard.subtitle')}
                        </p>
                    </div>
                    <button
                        onClick={() => loadData(true)}
                        disabled={loading}
                        className="btn btn-ghost btn-sm hover:bg-base-200 transition-all duration-200 hover:-translate-y-0.5"
                        title={t('common.refresh')}
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {stats && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                        <StatCard icon={Activity} label={t('dashboard.stats_startups')} value={stats.num_startups} color="text-blue-500" />
                        <StatCard icon={Coins} label={t('token_usage.total_tokens')} value={totalTokens} color="text-emerald-500" />
                        <StatCard icon={Hash} label={t('dashboard.stats_sessions')} value={stats.total_sessions} color="text-purple-500" />
                        <StatCard icon={MessageSquare} label={t('token_usage.total_messages')} value={tokenStats?.totalMessages || 0} color="text-pink-500" />
                        <StatCard icon={FolderOpen} label={t('dashboard.stats_projects')} value={stats.total_projects} color="text-cyan-500" />
                        <StatCard icon={BarChart3} label={t('dashboard.stats_history')} value={stats.total_history} color="text-amber-500" />
                    </div>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    {recentActivity.length > 0 && (
                        <div className="xl:col-span-2 bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
                            <div className="flex items-center gap-2 mb-4">
                                <BarChart3 className="w-5 h-5 text-gray-500" />
                                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                                    {t('dashboard.activity_title')}
                                </h2>
                            </div>
                            <div className="flex">
                                <div className="flex flex-col justify-between h-36 pr-2 text-xs text-gray-400 shrink-0">
                                    <span>{maxCount}</span>
                                    <span>{Math.round(maxCount / 2)}</span>
                                    <span>0</span>
                                </div>
                                <div className="flex-1 flex flex-col">
                                    <div className="flex items-end gap-1 h-36">
                                        {recentActivity.map((entry, i) => {
                                            const height = Math.max((entry.count / maxCount) * 100, 4);
                                            return (
                                                <div key={i} className="flex-1 h-full flex flex-col items-center justify-end group relative">
                                                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                                                        {entry.count}
                                                    </div>
                                                    <div
                                                        className="w-full rounded-t bg-gradient-to-t from-blue-500 to-blue-400 dark:from-blue-600 dark:to-blue-400 transition-all duration-200 group-hover:from-blue-600 group-hover:to-blue-500 group-hover:scale-y-105 min-w-[4px]"
                                                        style={{ height: `${height}%` }}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="flex gap-1 mt-1">
                                        {recentActivity.map((entry, i) => (
                                            <div key={i} className="flex-1 text-center">
                                                <span className="text-[10px] text-gray-400">{formatDateLabel(entry.date)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
                        <div className="flex items-center gap-2 mb-4">
                            <Clock className="w-5 h-5 text-gray-500" />
                            <h2 className="font-semibold text-gray-900 dark:text-base-content">
                                {t('token_usage.hourly_title')}
                            </h2>
                        </div>
                        <div className="flex items-end gap-[2px] h-36">
                            {hourData.map((h) => {
                                const height = Math.max((h.count / maxHourCount) * 100, 3);
                                return (
                                    <div key={h.hour} className="flex-1 h-full flex flex-col items-center justify-end group relative">
                                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                                            {h.hour}:00 · {h.count}
                                        </div>
                                        <div
                                            className="w-full rounded-t bg-gradient-to-t from-indigo-500 to-indigo-400 dark:from-indigo-600 dark:to-indigo-400 transition-all duration-200 group-hover:from-indigo-600 group-hover:to-indigo-500 group-hover:scale-y-105 min-w-[3px]"
                                            style={{ height: `${height}%` }}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex gap-[2px] mt-1">
                            {hourData.map((h) => (
                                <div key={h.hour} className="flex-1 text-center">
                                    <span className="text-[9px] text-gray-400">{h.hour % 6 === 0 ? `${h.hour}` : ''}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    {dailyTotals.length > 0 && (
                        <div className="xl:col-span-2 bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
                            <div className="flex items-center gap-2 mb-4">
                                <BarChart3 className="w-5 h-5 text-emerald-500" />
                                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                                    {t('token_usage.daily_trend_title')}
                                </h2>
                                <span className="text-xs text-gray-400">{dailyTotals.length} days</span>
                                <button
                                    onClick={() => refreshStatsCache()}
                                    disabled={refreshingStats}
                                    className="ml-auto px-2 py-1 text-xs bg-gray-100 dark:bg-base-200 text-gray-600 dark:text-gray-400 rounded hover:bg-gray-200 dark:hover:bg-base-100 transition-colors flex items-center gap-1 disabled:opacity-50"
                                    title={t('token_usage.refresh_stats_title')}
                                >
                                    <RefreshCw className={`w-3 h-3 ${refreshingStats ? 'animate-spin' : ''}`} />
                                    {refreshingStats ? t('token_usage.refreshing_stats') : t('token_usage.refresh_stats')}
                                </button>
                            </div>

                            <div className="grid grid-cols-3 gap-2 mb-4">
                                <TrendMetric label={t('token_usage.total_tokens')} value={formatCompactTokens(totalRecentTokens)} />
                                <TrendMetric label={t('token_usage.avg_per_day')} value={formatCompactTokens(avgDailyTokens)} />
                                <TrendMetric label={t('token_usage.peak')} value={peakTokenDay ? formatCompactTokens(peakTokenDay.total) : '0'} />
                            </div>

                            <div className="rounded-lg border border-gray-200 dark:border-[#1f355e] bg-gray-50/60 dark:bg-[#0d1833]/60 p-3">
                                <div className="flex">
                                    <div className="w-12 h-52 pr-2 text-[10px] text-gray-400 dark:text-slate-400/90 flex flex-col justify-between">
                                        <span>{formatCompactTokens(maxSmoothedDailyTokens)}</span>
                                        <span>{formatCompactTokens(Math.round(maxSmoothedDailyTokens / 2))}</span>
                                        <span>0</span>
                                    </div>
                                    <div className="flex-1 h-52 relative">
                                        <svg
                                            viewBox="0 0 100 90"
                                            preserveAspectRatio="none"
                                            className="w-full h-full cursor-crosshair"
                                            onMouseMove={handleTrendMouseMove}
                                            onMouseLeave={() => setHoveredTrendIndex(null)}
                                        >
                                            <defs>
                                                <linearGradient id="trendAreaFill" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.18" />
                                                    <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.00" />
                                                </linearGradient>
                                            </defs>
                                            {[16, 32, 48, 64, 80].map(y => (
                                                <line
                                                    key={y}
                                                    x1="0"
                                                    y1={y}
                                                    x2="100"
                                                    y2={y}
                                                    stroke="currentColor"
                                                    className="text-gray-200 dark:text-[#22365a]"
                                                    strokeWidth="0.5"
                                                    vectorEffect="non-scaling-stroke"
                                                />
                                            ))}
                                            {trendAreaPath && (
                                                <path d={trendAreaPath} fill="url(#trendAreaFill)" />
                                            )}
                                            {trendLinePath && (
                                                <path
                                                    d={trendLinePath}
                                                    fill="none"
                                                    stroke="#14b8a6"
                                                    strokeWidth="1.6"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    vectorEffect="non-scaling-stroke"
                                                />
                                            )}
                                            {hoveredTrendPoint && (
                                                <>
                                                    <line
                                                        x1={hoveredTrendPoint.x}
                                                        y1="12"
                                                        x2={hoveredTrendPoint.x}
                                                        y2="86"
                                                        stroke="#22d3ee"
                                                        strokeOpacity="0.45"
                                                        strokeWidth="0.8"
                                                        strokeDasharray="1.8 1.8"
                                                        vectorEffect="non-scaling-stroke"
                                                    />
                                                </>
                                            )}
                                        </svg>
                                        {hoveredTrendPoint && hoveredTrendDay && (
                                            <div
                                                className="absolute -top-2 -translate-y-full px-2 py-1 rounded-md text-xs bg-slate-900/95 border border-slate-700 text-slate-100 pointer-events-none whitespace-nowrap"
                                                style={{ left: `${hoveredTrendLabelX}%`, transform: 'translate(-50%, -100%)' }}
                                            >
                                                <div className="text-slate-300">{formatDateFull(hoveredTrendDay.date)}</div>
                                                <div className="font-semibold text-cyan-300">{hoveredTrendDay.total.toLocaleString()}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-2 grid grid-cols-3 text-[11px] text-gray-400">
                                <span className="justify-self-start whitespace-nowrap">{formatDateFull(dailyTotals[0]?.date)}</span>
                                <span className="justify-self-center whitespace-nowrap">{formatDateFull(midTrendDay?.date)}</span>
                                <span className="justify-self-end whitespace-nowrap">{formatDateFull(dailyTotals[dailyTotals.length - 1]?.date)}</span>
                            </div>
                        </div>
                    )}

                    <div className={`bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 ${dailyTotals.length === 0 ? 'xl:col-span-3' : ''}`}>
                        <div className="flex items-center gap-2 mb-4">
                            <PieChart className="w-5 h-5 text-teal-500" />
                            <h2 className="font-semibold text-gray-900 dark:text-base-content">{t('token_usage.model_share_title')}</h2>
                        </div>

                        {pieData.length === 0 ? (
                            <div className="h-48 flex items-center justify-center text-sm text-gray-400">
                                {t('token_usage.no_data')}
                            </div>
                        ) : (
                            <>
                                <div className="flex justify-center">
                                    <div className="relative w-44 h-44">
                                        <svg
                                            viewBox="0 0 100 100"
                                            className="w-full h-full -rotate-90"
                                            onMouseLeave={() => setHoveredPieName(null)}
                                        >
                                            <circle
                                                cx="50"
                                                cy="50"
                                                r={donutRadius}
                                                fill="none"
                                                stroke="currentColor"
                                                className="text-gray-200 dark:text-[#1f2f4d]"
                                                strokeWidth="16"
                                            />
                                            {donutSegments.map((segment) => {
                                                const isActive = hoveredPieName === segment.name;
                                                const hasActive = hoveredPieName !== null;
                                                return (
                                                    <circle
                                                        key={segment.name}
                                                        cx="50"
                                                        cy="50"
                                                        r={donutRadius}
                                                        fill="none"
                                                        stroke={segment.color}
                                                        strokeWidth={isActive ? 18 : 16}
                                                        strokeDasharray={`${segment.dash} ${donutCircumference}`}
                                                        strokeDashoffset={-segment.offset}
                                                        opacity={hasActive && !isActive ? 0.35 : 1}
                                                        className="cursor-pointer transition-all duration-150"
                                                        onMouseEnter={() => setHoveredPieName(segment.name)}
                                                    />
                                                );
                                            })}
                                        </svg>
                                        <div className="absolute inset-[24%] rounded-full bg-white dark:bg-base-100 border border-gray-100 dark:border-base-300 flex items-center justify-center">
                                            <div className="text-center">
                                                <div className="text-[10px] text-gray-500">{hoveredPieItem ? t('token_usage.current_model') : t('token_usage.total_tokens')}</div>
                                                <div className="text-xs font-semibold text-gray-900 dark:text-base-content px-2">
                                                    {hoveredPieItem ? truncateText(hoveredPieItem.name, 20) : formatCompactTokens(totalTokens)}
                                                </div>
                                                {hoveredPieItem && hoveredPieShare && (
                                                    <div className="text-[10px] mt-0.5 text-cyan-500">
                                                        {hoveredPieShare}% · {formatCompactTokens(hoveredPieItem.tokens)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 space-y-2">
                                    {pieData.map((item) => {
                                        const share = totalTokens > 0 ? (item.tokens / totalTokens) * 100 : 0;
                                        return (
                                            <div
                                                key={item.name}
                                                className={`flex items-center justify-between text-sm rounded px-1 py-0.5 transition-colors cursor-pointer ${
                                                    hoveredPieName === item.name ? 'bg-cyan-500/10' : ''
                                                }`}
                                                onMouseEnter={() => setHoveredPieName(item.name)}
                                                onMouseLeave={() => setHoveredPieName(null)}
                                            >
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                                                    <span className="truncate text-gray-700 dark:text-gray-200" title={item.name}>
                                                        {item.name}
                                                    </span>
                                                </div>
                                                <div className="text-gray-500 dark:text-gray-400 shrink-0">
                                                    {share.toFixed(1)}% · {formatCompactTokens(item.tokens)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
                        <div className="flex items-center gap-2 mb-4">
                            <Coins className="w-5 h-5 text-amber-500" />
                            <h2 className="font-semibold text-gray-900 dark:text-base-content">
                                {t('token_usage.model_usage_title')}
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-base-200">
                                        <th className="text-left py-2 pr-4 font-medium">Model</th>
                                        <th className="text-right py-2 px-2 font-medium">{t('token_usage.input_tokens')}</th>
                                        <th className="text-right py-2 px-2 font-medium">{t('token_usage.output_tokens')}</th>
                                        <th className="text-right py-2 pl-2 font-medium">{t('token_usage.total_tokens')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {topModels.map(([model, usage]) => (
                                        <tr key={model} className="border-b border-gray-50 dark:border-base-200 last:border-0 hover:bg-gray-50 dark:hover:bg-base-200 transition-colors">
                                            <td className="py-2 pr-4 font-medium text-gray-900 dark:text-base-content truncate max-w-[220px]" title={model}>
                                                {model}
                                            </td>
                                            <td className="py-2 px-2 text-right text-gray-600 dark:text-gray-300">{usage.inputTokens.toLocaleString()}</td>
                                            <td className="py-2 px-2 text-right text-gray-600 dark:text-gray-300">{usage.outputTokens.toLocaleString()}</td>
                                            <td className="py-2 pl-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                                                {(usage.inputTokens + usage.outputTokens).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
                        <div className="flex items-center gap-2 mb-4">
                            <FolderOpen className="w-5 h-5 text-cyan-500" />
                            <h2 className="font-semibold text-gray-900 dark:text-base-content">
                                {t('dashboard.project_token_title')}
                            </h2>
                        </div>
                        {topProjects.length === 0 ? (
                            <div className="text-sm text-gray-400">{t('dashboard.project_token_empty')}</div>
                        ) : (
                            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                                {topProjects.map((project) => (
                                    <div
                                        key={project.path}
                                        className="p-2.5 rounded-lg bg-gray-50 dark:bg-base-200 border border-transparent hover:border-cyan-200 dark:hover:border-cyan-700 transition-all duration-200 hover:-translate-y-0.5"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-gray-900 dark:text-base-content truncate" title={project.path}>
                                                    {project.name}
                                                </div>
                                                <div className="text-[11px] text-gray-400">
                                                    {project.session_count} {t('dashboard.projects_sessions')}
                                                </div>
                                            </div>
                                            <div className="text-sm font-semibold text-cyan-600 dark:text-cyan-400 shrink-0">
                                                {project.total_tokens.toLocaleString()}
                                            </div>
                                        </div>
                                        <div className="mt-2 h-1.5 rounded-full bg-gray-200 dark:bg-base-300 overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                                                style={{ width: `${Math.max((project.total_tokens / maxProjectTokens) * 100, 2)}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({
    icon: Icon,
    label,
    value,
    color,
}: {
    icon: React.ElementType;
    label: string;
    value: number;
    color: string;
}) {
    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <div className="flex items-center gap-3">
                <Icon className={`w-5 h-5 ${color}`} />
                <div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-base-content">
                        {value.toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
                </div>
            </div>
        </div>
    );
}

function TrendMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-gray-200 dark:border-[#28426c] bg-gray-100/70 dark:bg-[#0f1d39]/70 px-3 py-2">
            <div className="text-[11px] text-gray-500 dark:text-slate-300/90">{label}</div>
            <div className="text-sm font-semibold text-emerald-600 dark:text-cyan-300">{value}</div>
        </div>
    );
}

function smoothDailyTotals(dailyTotals: Array<{ date: string; total: number }>) {
    return dailyTotals.map((day, index, allDays) => {
        const prev = allDays[index - 1]?.total ?? day.total;
        const next = allDays[index + 1]?.total ?? day.total;
        return {
            date: day.date,
            total: Math.round((prev + day.total + next) / 3),
        };
    });
}

function buildSmoothPath(points: ChartPoint[]) {
    if (points.length === 0) {
        return '';
    }
    if (points.length === 1) {
        return `M ${points[0].x} ${points[0].y}`;
    }

    const [firstPoint, ...restPoints] = points;
    let path = `M ${firstPoint.x} ${firstPoint.y}`;
    for (let index = 0; index < restPoints.length; index++) {
        const currentPoint = restPoints[index];
        const previousPoint = points[index];
        const controlX = (previousPoint.x + currentPoint.x) / 2;
        path += ` Q ${controlX} ${previousPoint.y}, ${currentPoint.x} ${currentPoint.y}`;
    }
    return path;
}

function buildDonutSegments(items: PieShareItem[], total: number, circumference: number): DonutSegment[] {
    if (items.length === 0 || total <= 0 || circumference <= 0) {
        return [];
    }

    let offset = 0;
    return items.map((item) => {
        const ratio = item.tokens / total;
        const dash = ratio * circumference;
        const segment: DonutSegment = {
            ...item,
            dash,
            offset,
        };
        offset += dash;
        return segment;
    });
}

function truncateText(text: string, maxLength: number) {
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(maxLength - 3, 1))}...`;
}

function formatCompactTokens(value: number) {
    if (value >= 1_000_000_000) {
        return `${(value / 1_000_000_000).toFixed(1)}B`;
    }
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toLocaleString();
}

function formatDateLabel(rawDate?: string) {
    if (!rawDate) {
        return '';
    }
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) {
        return rawDate;
    }
    return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

function formatDateFull(rawDate?: string) {
    if (!rawDate) {
        return '';
    }
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) {
        return rawDate;
    }
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export default Dashboard;
