import {useTranslation} from 'react-i18next';
import {RefreshCw} from 'lucide-react';
import {useEffect} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useDashboardStore} from '../stores/useDashboardStore';
import {usageKeys} from '../hooks/useUsageQueries';
import OverviewKpiRow from '../components/dashboard/OverviewKpiRow';

/**
 * 主页：只保留一行 KPI 概览。
 * 代理统计明细与本地会话图表都在 /usage（「本地会话」分区承接原先的会话统计）。
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
            </div>
        </div>
    );
}

export default Dashboard;
