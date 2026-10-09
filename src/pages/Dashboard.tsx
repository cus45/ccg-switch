import {useTranslation} from 'react-i18next';
import {RefreshCw} from 'lucide-react';
import {lazy, Suspense, useEffect} from 'react';
import {Link} from 'react-router-dom';
import {useQueryClient} from '@tanstack/react-query';
import {useDashboardStore} from '../stores/useDashboardStore';
import {usageKeys} from '../hooks/useUsageQueries';
import OverviewKpiRow from '../components/dashboard/OverviewKpiRow';
import SessionStatsSection from '../components/usage/session/SessionStatsSection';
import {UsageChartSkeleton} from '../components/usage/UsageChartSkeleton';
import type {UsageRangeSelection} from '../types/usage';

// recharts 体积大，独立 chunk
const UsageTrendChart = lazy(() =>
    import('../components/usage/UsageTrendChart').then((m) => ({ default: m.UsageTrendChart }))
);

/** 主页统一看近 7 天 */
const OVERVIEW_RANGE: UsageRangeSelection = { preset: '7d' };
const NO_FILTERS = {};

/**
 * 主页：KPI 概览 → 代理请求趋势 → 本地会话图表（趋势 / 模型占比 / 项目排行 / 时段）。
 * 明细表格、筛选与完整会话统计在 /usage。
 */
function Dashboard() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const { hasLoaded, loading, loadData } = useDashboardStore();

    useEffect(() => {
        if (!hasLoaded) {
            void loadData();
        }
    }, [hasLoaded, loadData]);

    const refresh = () => {
        void loadData(true);
        void queryClient.invalidateQueries({ queryKey: usageKeys.all });
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
                        onClick={refresh}
                        disabled={loading}
                        className="btn btn-ghost btn-sm hover:bg-base-200 transition-all duration-200 hover:-translate-y-0.5"
                        title={t('common.refresh')}
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                <OverviewKpiRow />

                {/* 代理请求趋势（近 7 天） */}
                <Suspense fallback={<UsageChartSkeleton />}>
                    <UsageTrendChart range={OVERVIEW_RANGE} filters={NO_FILTERS} refreshMs={0} />
                </Suspense>

                {/* 本地会话 */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-base-content">
                            {t('dashboard.localSessionTitle')}
                        </h2>
                        <Link
                            to="/usage?tab=session"
                            className="btn btn-ghost btn-sm gap-1 text-sm font-normal opacity-70 hover:opacity-100"
                        >
                            {t('usage.viewDetails')}
                        </Link>
                    </div>
                    <SessionStatsSection variant="overview" />
                </div>
            </div>
        </div>
    );
}

export default Dashboard;
