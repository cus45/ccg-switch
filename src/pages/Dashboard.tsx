import { useTranslation } from 'react-i18next';
import { Activity, BarChart3, Clock, Coins, FolderOpen, Hash, MessageSquare, PieChart, RefreshCw, TrendingUp } from 'lucide-react';
import { useState, useEffect, useMemo, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { useDashboardStore } from '../stores/useDashboardStore';

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

    const { dailyTotals, totalRecentTokens, avgDailyTokens, peakTokenDay, maxDailyTokens } = useMemo(() => {
        const recentTokenDays = (tokenStats?.dailyModelTokens || []).slice(-30);
        const _dailyTotals = recentTokenDays.map(d => ({
            date: d.date,
            total: Object.values(d.tokensByModel).reduce((s, v) => s + v, 0),
        }));
        const _maxDailyTokens = Math.max(..._dailyTotals.map(d => d.total), 1);
        const _totalRecentTokens = _dailyTotals.reduce((sum, day) => sum + day.total, 0);
        const _avgDailyTokens = _dailyTotals.length > 0 ? Math.round(_totalRecentTokens / _dailyTotals.length) : 0;
        const _peakTokenDay = _dailyTotals.length > 0
            ? _dailyTotals.reduce((peak, current) => (current.total > peak.total ? current : peak), _dailyTotals[0])
            : null;
        return { dailyTotals: _dailyTotals, totalRecentTokens: _totalRecentTokens, avgDailyTokens: _avgDailyTokens, peakTokenDay: _peakTokenDay, maxDailyTokens: _maxDailyTokens };
    }, [tokenStats]);

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
        const _donutRadius = 34;
        const _donutCircumference = 2 * Math.PI * _donutRadius;
        return { pieData: _pieData, donutSegments: buildDonutSegments(_pieData, totalTokens, _donutCircumference), donutRadius: _donutRadius, donutCircumference: _donutCircumference };
    }, [topModels, totalTokens, t]);

    const hoveredPieItem = hoveredPieName ? pieData.find(item => item.name === hoveredPieName) || null : null;
    const hoveredPieShare = hoveredPieItem && totalTokens > 0
        ? ((hoveredPieItem.tokens / totalTokens) * 100).toFixed(1)
        : null;

    // 趋势图日期标签：每隔 N 个显示一个，最多显示 ~6 个
    const trendLabelInterval = Math.max(1, Math.ceil(dailyTotals.length / 6));

    // 趋势曲线图 hover 状态
    const [hoveredTrendIndex, setHoveredTrendIndex] = useState<number | null>(null);

    const handleTrendMouseMove = useCallback((e: ReactMouseEvent<SVGSVGElement>) => {
        if (dailyTotals.length === 0) return;
        const svg = e.currentTarget;
        const rect = svg.getBoundingClientRect();
        const relativeX = e.clientX - rect.left;
        const svgWidth = rect.width;
        if (relativeX < 0 || relativeX > svgWidth) {
            setHoveredTrendIndex(null);
            return;
        }
        const ratio = relativeX / svgWidth;
        const idx = Math.round(ratio * (dailyTotals.length - 1));
        setHoveredTrendIndex(Math.max(0, Math.min(idx, dailyTotals.length - 1)));
    }, [dailyTotals]);

    // 构建平滑 SVG 路径（纯图表区域，无内边距，配合 preserveAspectRatio="none"）
    const TREND_VB_W = 1000;
    const TREND_VB_H = 140;

    const { trendLinePath, trendAreaPath, trendPoints } = useMemo(() => {
        if (dailyTotals.length === 0) return { trendLinePath: '', trendAreaPath: '', trendPoints: [] };

        const pad = 6;
        const w = TREND_VB_W - pad * 2;
        const h = TREND_VB_H - pad * 2 - 6; // 底部额外留 6px 防止曲线溢出
        const clampY = (y: number) => Math.max(0, Math.min(TREND_VB_H - 2, y));

        const points = dailyTotals.map((day, i) => ({
            x: pad + (dailyTotals.length === 1 ? w / 2 : (i / (dailyTotals.length - 1)) * w),
            y: clampY(pad + h - (day.total / maxDailyTokens) * h),
            pct: dailyTotals.length === 1 ? 50 : (i / (dailyTotals.length - 1)) * 100,
        }));

        let linePath = `M ${points[0].x},${points[0].y}`;
        if (points.length === 1) {
            linePath = `M ${points[0].x - 2},${points[0].y} L ${points[0].x + 2},${points[0].y}`;
        } else if (points.length === 2) {
            linePath += ` L ${points[1].x},${points[1].y}`;
        } else {
            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[Math.max(0, i - 1)];
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = points[Math.min(points.length - 1, i + 2)];
                const tension = 0.3;
                const cp1x = p1.x + (p2.x - p0.x) * tension;
                const cp1y = clampY(p1.y + (p2.y - p0.y) * tension);
                const cp2x = p2.x - (p3.x - p1.x) * tension;
                const cp2y = clampY(p2.y - (p3.y - p1.y) * tension);
                linePath += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
            }
        }

        const bottomY = TREND_VB_H;
        const areaPath = `${linePath} L ${points[points.length - 1].x},${bottomY} L ${points[0].x},${bottomY} Z`;

        return { trendLinePath: linePath, trendAreaPath: areaPath, trendPoints: points };
    }, [dailyTotals, maxDailyTokens]);

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
                        <div className="xl:col-span-2 bg-white dark:bg-base-100 rounded-xl p-5 pb-3 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 flex flex-col">
                            <div className="flex items-center gap-2 mb-2">
                                <BarChart3 className="w-5 h-5 text-gray-500" />
                                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                                    {t('dashboard.activity_title')}
                                </h2>
                            </div>
                            <div className="flex flex-1 min-h-0">
                                <div className="flex flex-col justify-between pr-2 text-xs text-gray-400 shrink-0">
                                    <span>{maxCount}</span>
                                    <span>{Math.round(maxCount / 2)}</span>
                                    <span>0</span>
                                </div>
                                <div className="flex-1 flex flex-col min-h-0">
                                    <div className="flex items-end gap-1 flex-1 min-h-0">
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

                    <HourlyClockChart hourData={hourData} maxHourCount={maxHourCount} />
                </div>

                {/* Token 每日趋势 + 模型占比 */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    {dailyTotals.length > 0 && (
                        <div className="xl:col-span-2 bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 flex flex-col overflow-hidden">
                            <div className="flex items-center gap-2 mb-4">
                                <TrendingUp className="w-5 h-5 text-emerald-500" />
                                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                                    {t('token_usage.daily_trend_title')}
                                </h2>
                                <span className="text-xs text-gray-400 tabular-nums">{dailyTotals.length}d</span>
                                <button
                                    onClick={() => refreshStatsCache()}
                                    disabled={refreshingStats}
                                    className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-base-300 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-base-300 transition-colors disabled:opacity-50"
                                    title={t('token_usage.refresh_stats_title')}
                                >
                                    <RefreshCw className={`w-3 h-3 ${refreshingStats ? 'animate-spin' : ''}`} />
                                    {refreshingStats ? t('token_usage.refreshing_stats') : t('token_usage.refresh_stats')}
                                </button>
                            </div>

                            {/* 摘要指标 */}
                            <div className="grid grid-cols-3 gap-2 mb-4">
                                <TrendMetric label={t('token_usage.total_tokens')} value={formatCompactTokens(totalRecentTokens)} />
                                <TrendMetric label={t('token_usage.avg_per_day')} value={formatCompactTokens(avgDailyTokens)} />
                                <TrendMetric label={t('token_usage.peak')} value={peakTokenDay ? formatCompactTokens(peakTokenDay.total) : '0'} />
                            </div>

                            {/* SVG 曲线面积图 */}
                            <div className="relative flex-1 min-h-0 flex flex-col">
                                <div className="flex flex-1 min-h-0">
                                    {/* Y 轴标签 */}
                                    <div className="flex flex-col justify-between pr-2 text-[10px] text-gray-400 dark:text-gray-500 shrink-0 tabular-nums text-right w-9">
                                        <span>{formatCompactTokens(maxDailyTokens)}</span>
                                        <span>{formatCompactTokens(Math.round(maxDailyTokens / 2))}</span>
                                        <span>0</span>
                                    </div>
                                    {/* 图表 SVG */}
                                    <div className="flex-1 min-w-0 relative overflow-hidden">
                                        <svg
                                            viewBox={`0 0 ${TREND_VB_W} ${TREND_VB_H}`}
                                            preserveAspectRatio="none"
                                            className="w-full h-full select-none block"
                                            onMouseMove={handleTrendMouseMove}
                                            onMouseLeave={() => setHoveredTrendIndex(null)}
                                        >
                                            <defs>
                                                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                                                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                                                </linearGradient>
                                            </defs>

                                            {/* 水平参考线 */}
                                            {[0.25, 0.5, 0.75].map((ratio) => (
                                                <line key={ratio}
                                                    x1="0" y1={TREND_VB_H * (1 - ratio)} x2={TREND_VB_W} y2={TREND_VB_H * (1 - ratio)}
                                                    stroke="currentColor" className="text-gray-100 dark:text-base-300"
                                                    strokeWidth="1" strokeDasharray="4,4" vectorEffect="non-scaling-stroke"
                                                />
                                            ))}

                                            {/* 面积填充 */}
                                            <path d={trendAreaPath} fill="url(#trendFill)" />

                                            {/* 曲线 */}
                                            <path d={trendLinePath} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                                        </svg>

                                        {/* Hover 指示器（HTML 覆盖层，避免 preserveAspectRatio 变形） */}
                                        {hoveredTrendIndex !== null && trendPoints[hoveredTrendIndex] && (
                                            <>
                                                {/* 垂直线 */}
                                                <div
                                                    className="absolute top-0 h-full w-px bg-emerald-500/40 pointer-events-none"
                                                    style={{ left: `${trendPoints[hoveredTrendIndex].pct}%` }}
                                                />
                                                {/* 圆点 */}
                                                <div
                                                    className="absolute w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-base-100 shadow pointer-events-none -translate-x-1/2 -translate-y-1/2"
                                                    style={{
                                                        left: `${trendPoints[hoveredTrendIndex].pct}%`,
                                                        top: `${(trendPoints[hoveredTrendIndex].y / TREND_VB_H) * 100}%`,
                                                    }}
                                                />
                                                {/* 光晕 */}
                                                <div
                                                    className="absolute w-5 h-5 rounded-full bg-emerald-500/15 pointer-events-none -translate-x-1/2 -translate-y-1/2"
                                                    style={{
                                                        left: `${trendPoints[hoveredTrendIndex].pct}%`,
                                                        top: `${(trendPoints[hoveredTrendIndex].y / TREND_VB_H) * 100}%`,
                                                    }}
                                                />
                                                {/* Tooltip：跟随曲线点，保持在可视区域内 */}
                                                <div
                                                    className="absolute pointer-events-none z-10 bg-gray-800 dark:bg-slate-700 text-white text-[11px] px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap"
                                                    style={{
                                                        left: `${trendPoints[hoveredTrendIndex].pct}%`,
                                                        top: `${(trendPoints[hoveredTrendIndex].y / TREND_VB_H) * 100}%`,
                                                        transform: `translateX(${trendPoints[hoveredTrendIndex].pct > 80 ? '-100%' : trendPoints[hoveredTrendIndex].pct < 15 ? '0%' : '-50%'}) translateY(${(trendPoints[hoveredTrendIndex].y / TREND_VB_H) < 0.3 ? '8px' : '-100%'})`,
                                                    }}
                                                >
                                                    <div className="text-gray-300 text-[10px]">{formatDateFull(dailyTotals[hoveredTrendIndex].date)}</div>
                                                    <div className="font-semibold">{dailyTotals[hoveredTrendIndex].total.toLocaleString()} tokens</div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* X 轴日期标签 */}
                                <div className="flex mt-1 mb-2 pl-9 shrink-0">
                                    {dailyTotals.map((day, i) => (
                                        <div key={i} className="flex-1 text-center overflow-hidden">
                                            <span className="text-[9px] text-gray-400 dark:text-gray-500">
                                                {i % trendLabelInterval === 0 || i === dailyTotals.length - 1
                                                    ? formatDateLabel(day.date)
                                                    : ''}
                                            </span>
                                        </div>
                                    ))}
                                </div>
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
                            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
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
        <div className="rounded-lg border border-gray-100 dark:border-base-300 bg-gray-50 dark:bg-base-200 px-3 py-2">
            <div className="text-[11px] text-gray-400">{label}</div>
            <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{value}</div>
        </div>
    );
}

function buildDonutSegments(items: PieShareItem[], total: number, circumference: number): DonutSegment[] {
    if (items.length === 0 || total <= 0 || circumference <= 0) {
        return [];
    }
    let offset = 0;
    return items.map((item) => {
        const ratio = item.tokens / total;
        const dash = ratio * circumference;
        const segment: DonutSegment = { ...item, dash, offset };
        offset += dash;
        return segment;
    });
}

function truncateText(text: string, maxLength: number) {
    return text.length <= maxLength ? text : `${text.slice(0, Math.max(maxLength - 3, 1))}...`;
}

function formatCompactTokens(value: number) {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString();
}

function formatDateLabel(rawDate?: string) {
    if (!rawDate) return '';
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) return rawDate;
    return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

function formatDateFull(rawDate?: string) {
    if (!rawDate) return '';
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) return rawDate;
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function HourlyClockChart({ hourData, maxHourCount }: { hourData: { hour: number; count: number }[]; maxHourCount: number }) {
    const { t } = useTranslation();
    const [hoveredHour, setHoveredHour] = useState<number | null>(null);

    const cx = 150;
    const cy = 150;
    const outerR = 120;
    const innerR = 40;
    const labelR = outerR + 18;

    const segments = hourData.map((h) => {
        const ratio = maxHourCount > 0 ? h.count / maxHourCount : 0;
        const r = innerR + (outerR - innerR) * Math.max(ratio, 0.04);
        const startAngle = (h.hour / 24) * 360 - 90;
        const endAngle = ((h.hour + 1) / 24) * 360 - 90;
        const gap = 0.8;
        const a1 = ((startAngle + gap / 2) * Math.PI) / 180;
        const a2 = ((endAngle - gap / 2) * Math.PI) / 180;
        return { ...h, ratio, r, a1, a2 };
    });

    const toPath = (s: (typeof segments)[0]) => {
        const x1i = cx + innerR * Math.cos(s.a1);
        const y1i = cy + innerR * Math.sin(s.a1);
        const x1o = cx + s.r * Math.cos(s.a1);
        const y1o = cy + s.r * Math.sin(s.a1);
        const x2o = cx + s.r * Math.cos(s.a2);
        const y2o = cy + s.r * Math.sin(s.a2);
        const x2i = cx + innerR * Math.cos(s.a2);
        const y2i = cy + innerR * Math.sin(s.a2);
        return `M${x1i},${y1i} L${x1o},${y1o} A${s.r},${s.r} 0 0,1 ${x2o},${y2o} L${x2i},${y2i} A${innerR},${innerR} 0 0,0 ${x1i},${y1i}Z`;
    };

    const hourLabels = [0, 3, 6, 9, 12, 15, 18, 21];

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 pb-3 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <div className="flex items-center gap-2 mb-1">
                <Clock className="w-5 h-5 text-indigo-500" />
                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                    {t('token_usage.hourly_title')}
                </h2>
            </div>
            <div className="flex items-center justify-center">
                <svg viewBox="0 0 300 300" className="w-full max-w-[300px]">
                    {/* 刻度圆环参考线 */}
                    {[0.25, 0.5, 0.75, 1].map((pct) => (
                        <circle
                            key={pct}
                            cx={cx} cy={cy}
                            r={innerR + (outerR - innerR) * pct}
                            fill="none"
                            stroke="currentColor"
                            className="text-gray-100 dark:text-base-300"
                            strokeWidth={0.5}
                        />
                    ))}
                    {/* 数据扇形 */}
                    {segments.map((s) => {
                        const isHovered = hoveredHour === s.hour;
                        return (
                            <path
                                key={s.hour}
                                d={toPath(s)}
                                className={`transition-all duration-150 cursor-pointer ${
                                    isHovered
                                        ? 'fill-indigo-500 dark:fill-indigo-400'
                                        : s.count > 0
                                            ? 'fill-indigo-400/70 dark:fill-indigo-500/70'
                                            : 'fill-gray-200 dark:fill-base-300'
                                }`}
                                style={isHovered ? { filter: 'drop-shadow(0 0 4px rgba(99,102,241,0.5))' } : undefined}
                                onMouseEnter={() => setHoveredHour(s.hour)}
                                onMouseLeave={() => setHoveredHour(null)}
                            />
                        );
                    })}
                    {/* 小时标签 */}
                    {hourLabels.map((h) => {
                        const angle = ((h / 24) * 360 - 90) * Math.PI / 180;
                        const x = cx + labelR * Math.cos(angle);
                        const y = cy + labelR * Math.sin(angle);
                        return (
                            <text
                                key={h}
                                x={x} y={y}
                                textAnchor="middle"
                                dominantBaseline="central"
                                className="fill-gray-400 dark:fill-gray-500"
                                style={{ fontSize: '13px', fontWeight: 500 }}
                            >
                                {String(h).padStart(2, '0')}
                            </text>
                        );
                    })}
                    {/* 中心数字 */}
                    <text x={cx} y={cy - 8} textAnchor="middle" dominantBaseline="central"
                        className="fill-gray-900 dark:fill-base-content font-bold" style={{ fontSize: '18px' }}>
                        {hoveredHour !== null ? segments[hoveredHour].count : hourData.reduce((s, h) => s + h.count, 0)}
                    </text>
                    <text x={cx} y={cy + 12} textAnchor="middle" dominantBaseline="central"
                        className="fill-gray-400 dark:fill-gray-500" style={{ fontSize: '11px' }}>
                        {hoveredHour !== null ? `${String(hoveredHour).padStart(2, '0')}:00` : t('token_usage.total_messages')}
                    </text>
                </svg>
            </div>
        </div>
    );
}

export default Dashboard;
