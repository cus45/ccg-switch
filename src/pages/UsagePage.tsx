import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
    Activity,
    BarChart3,
    Coins,
    ListFilter,
    RefreshCw,
    ScanLine,
    type LucideIcon,
} from 'lucide-react';
import { usageKeys, useScanSessionUsage } from '../hooks/useUsageQueries';
import { RANGE_LABEL_KEYS, TIME_RANGES } from '../services/usage';
import { UsageSummaryCards } from '../components/usage/UsageSummaryCards';
import { UsageChartSkeleton } from '../components/usage/UsageChartSkeleton';
import { RequestLogTable } from '../components/usage/RequestLogTable';
import { ProviderStatsTable } from '../components/usage/ProviderStatsTable';
import { ModelStatsTable } from '../components/usage/ModelStatsTable';
import { PricingConfigPanel } from '../components/usage/PricingConfigPanel';
import { showToast } from '../components/common/ToastContainer';
import { card, ghostBtn, muted, segment, segmentItem } from '../components/usage/styles';
import { cn } from '../utils/cn';
import type { RefreshInterval, TimeRange } from '../types/usage';

// recharts 体积大，拆成独立 chunk：首屏先出卡片与骨架，图表代码到达后再填充
const UsageTrendChart = lazy(() =>
    import('../components/usage/UsageTrendChart').then((m) => ({ default: m.UsageTrendChart }))
);

/** 自动刷新间隔循环序列：0 = 关闭 */
const REFRESH_OPTIONS: RefreshInterval[] = [0, 5000, 10000, 30000, 60000];

/** 自动扫描会话文件的间隔：2 分钟 */
const AUTO_SCAN_INTERVAL_MS = 120_000;

/** 进页面后首次扫描的延迟：先让汇总 / 趋势 / 日志查询拿到数据库，首屏不被扫描抢占 */
const INITIAL_SCAN_DELAY_MS = 1_000;


type Tab = 'logs' | 'providers' | 'models';
const TABS: { key: Tab; icon: LucideIcon; labelKey: string }[] = [
    { key: 'logs', icon: ListFilter, labelKey: 'usage.requestLogs' },
    { key: 'providers', icon: Activity, labelKey: 'usage.providerStats' },
    { key: 'models', icon: BarChart3, labelKey: 'usage.modelStats' },
];

export default function UsagePage() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();

    // 与参考项目一致：默认 1d 窗口 + 30s 自动刷新
    const [timeRange, setTimeRange] = useState<TimeRange>('1d');
    const [activeTab, setActiveTab] = useState<Tab>('logs');
    const [refreshMs, setRefreshMs] = useState<RefreshInterval>(30000);
    const [pricingOpen, setPricingOpen] = useState(false);

    const scanSession = useScanSessionUsage();

    // 进页面延后 1s 扫一次，之后每 2 分钟自动扫 —— 会话文件是外部写入的，
    // 没有事件可监听，只能靠定时轮询。扫描是文件级增量，稳态下只是 stat 一遍文件。
    useEffect(() => {
        const run = () => {
            scanSession.mutate(undefined, {
                onSuccess: (r) => {
                    if (r.inserted > 0) {
                        showToast(
                            t('usage.scan.imported', { count: r.inserted }),
                            'success'
                        );
                    }
                },
                onError: () => {
                    // 扫描失败不打扰用户 —— 会话目录可能根本不存在
                },
            });
        };

        const initial = setTimeout(run, INITIAL_SCAN_DELAY_MS);
        const timer = setInterval(run, AUTO_SCAN_INTERVAL_MS);
        return () => {
            clearTimeout(initial);
            clearInterval(timer);
        };
        // 只在挂载时建立一次定时器
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 点刷新图标在 0/5/10/30/60s 之间循环，切换后让整棵树失效
    const cycleRefresh = () => {
        const idx = REFRESH_OPTIONS.indexOf(refreshMs);
        const next = REFRESH_OPTIONS[(idx + 1) % REFRESH_OPTIONS.length];
        setRefreshMs(next);
        void queryClient.invalidateQueries({ queryKey: usageKeys.all });
    };

    const handleManualScan = () =>
        scanSession.mutate(undefined, {
            onSuccess: (r) => {
                if (r.inserted > 0) {
                    showToast(t('usage.scan.imported', { count: r.inserted }), 'success');
                } else {
                    showToast(t('usage.scan.nothingNew', { files: r.files }), 'info');
                }
            },
            onError: (e) => showToast(String(e), 'error'),
        });

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="mx-auto max-w-7xl space-y-6 p-6">
                {/* 页头：图标块 + 标题 + 右侧控制簇 */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 shadow-md">
                            <BarChart3 className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900 dark:text-base-content">
                                {t('usage.title')}
                            </h1>
                            <p className={cn('text-sm', muted)}>{t('usage.subtitle')}</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            className={ghostBtn}
                            onClick={handleManualScan}
                            disabled={scanSession.isPending}
                            title={t('usage.scan.hint')}
                        >
                            {scanSession.isPending ? (
                                <span className="loading loading-spinner loading-xs" />
                            ) : (
                                <ScanLine className="h-4 w-4" />
                            )}
                            {t('usage.scan.button')}
                        </button>
                        <button
                            type="button"
                            className={ghostBtn}
                            onClick={cycleRefresh}
                            title={t('usage.refreshHint')}
                        >
                            <RefreshCw
                                className={cn('h-4 w-4', refreshMs > 0 && 'text-blue-500')}
                            />
                            <span className="font-mono text-xs tabular-nums">
                                {refreshMs > 0 ? `${refreshMs / 1000}s` : '--'}
                            </span>
                        </button>
                        <div className={segment} role="tablist" aria-label={t('usage.timeRange')}>
                            {TIME_RANGES.map((r) => (
                                <button
                                    key={r}
                                    type="button"
                                    role="tab"
                                    aria-selected={timeRange === r}
                                    className={segmentItem(timeRange === r)}
                                    onClick={() => setTimeRange(r)}
                                >
                                    {t(RANGE_LABEL_KEYS[r])}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 汇总卡片 */}
                <UsageSummaryCards range={timeRange} refreshMs={refreshMs} />

                {/* 趋势图（懒加载：recharts 独立 chunk，先出骨架再填充） */}
                <Suspense fallback={<UsageChartSkeleton />}>
                    <UsageTrendChart range={timeRange} refreshMs={refreshMs} />
                </Suspense>

                {/* 明细标签页 */}
                <div className="space-y-4">
                    <div className={cn(segment, 'w-fit')} role="tablist">
                        {TABS.map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                role="tab"
                                aria-selected={activeTab === tab.key}
                                className={segmentItem(activeTab === tab.key, true)}
                                onClick={() => setActiveTab(tab.key)}
                            >
                                <tab.icon className="h-4 w-4" />
                                {t(tab.labelKey)}
                            </button>
                        ))}
                    </div>

                    {activeTab === 'logs' && (
                        <RequestLogTable range={timeRange} refreshMs={refreshMs} />
                    )}
                    {activeTab === 'providers' && (
                        <ProviderStatsTable range={timeRange} refreshMs={refreshMs} />
                    )}
                    {activeTab === 'models' && (
                        <ModelStatsTable range={timeRange} refreshMs={refreshMs} />
                    )}
                </div>

                {/* 定价配置：默认收起（与参考项目一致，属于高级设置） */}
                <div className={cn(card, 'collapse collapse-arrow overflow-hidden')}>
                    <input
                        type="checkbox"
                        checked={pricingOpen}
                        onChange={(e) => setPricingOpen(e.target.checked)}
                    />
                    <div className="collapse-title flex items-center gap-3 py-4">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                            <Coins className="h-5 w-5" />
                        </div>
                        <div className="text-left">
                            <h3 className="text-base font-semibold text-gray-900 dark:text-base-content">
                                {t('usage.modelPricing')}
                            </h3>
                            <p className={cn('text-sm font-normal', muted)}>
                                {t('usage.modelPricingDesc')}
                            </p>
                        </div>
                    </div>
                    <div className="collapse-content">{pricingOpen && <PricingConfigPanel />}</div>
                </div>
            </div>
        </div>
    );
}
