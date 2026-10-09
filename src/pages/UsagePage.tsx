import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
    Activity,
    AlertCircle,
    BarChart3,
    Coins,
    HardDrive,
    ListFilter,
    Network,
    RefreshCw,
    ScanLine,
    type LucideIcon,
} from 'lucide-react';
import {
    usageKeys,
    useModelStats,
    useProviderStats,
    useScanSessionUsage,
} from '../hooks/useUsageQueries';
import { RANGE_LABEL_KEYS, TIME_RANGES, resolveUsageRange } from '../services/usage';
import { UsageSummaryCards } from '../components/usage/UsageSummaryCards';
import { UsageChartSkeleton } from '../components/usage/UsageChartSkeleton';
import { RequestLogTable } from '../components/usage/RequestLogTable';
import { ProviderStatsTable } from '../components/usage/ProviderStatsTable';
import { ModelStatsTable } from '../components/usage/ModelStatsTable';
import { PricingConfigPanel } from '../components/usage/PricingConfigPanel';
import SessionStatsSection from '../components/usage/session/SessionStatsSection';
import { getUsageProviderLabel } from '../components/usage/providerLabel';
import { showToast } from '../components/common/ToastContainer';
import {
    card,
    fieldLabel,
    ghostBtn,
    muted,
    segment,
    segmentItem,
    select,
} from '../components/usage/styles';
import { cn } from '../utils/cn';
import type {
    RefreshInterval,
    StatsFilters,
    UsageRangeSelection,
} from '../types/usage';

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

/** 自定义区间最大跨度：30 天（与预设里最长的范围对齐） */
const MAX_CUSTOM_RANGE_SECONDS = 30 * 24 * 3600;

/** 日期时间输入框：不占满整行 */
const datetimeInput = 'input input-bordered input-sm tabular-nums';

/** Unix 秒 → `datetime-local` 需要的 `YYYY-MM-DDTHH:mm`（本地时区） */
function toDatetimeLocal(ts: number): string {
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` 字符串 → Unix 秒，非法返回 null */
function fromDatetimeLocal(value: string): number | null {
    if (value.length < 16) return null;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

type Tab = 'logs' | 'providers' | 'models';
const TABS: { key: Tab; icon: LucideIcon; labelKey: string }[] = [
    { key: 'logs', icon: ListFilter, labelKey: 'usage.requestLogs' },
    { key: 'providers', icon: Activity, labelKey: 'usage.providerStats' },
    { key: 'models', icon: BarChart3, labelKey: 'usage.modelStats' },
];

type View = 'proxy' | 'session';
const VIEWS: { key: View; icon: LucideIcon; labelKey: string }[] = [
    { key: 'proxy', icon: Network, labelKey: 'usage.viewProxy' },
    { key: 'session', icon: HardDrive, labelKey: 'usage.viewSession' },
];

/** 供应商下拉选项：名字 + 请求数 */
interface Option {
    name: string;
    count: number;
}

/** 把聚合结果按名字汇总出下拉选项，按请求数降序 */
function toOptions<T>(
    rows: T[] | undefined,
    nameOf: (row: T) => string,
    countOf: (row: T) => number,
    selected: string | undefined
): Option[] {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
        const name = nameOf(row);
        counts.set(name, (counts.get(name) ?? 0) + countOf(row));
    }
    // 数据刷新后选中项可能掉出列表（如改了时间范围）；补回去保证用户看得见、能清除
    if (selected && !counts.has(selected)) counts.set(selected, 0);
    return Array.from(counts, ([name, count]) => ({ name, count })).sort(
        (a, b) => b.count - a.count
    );
}

export default function UsagePage() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();

    // 与参考项目一致：默认 1d 窗口 + 30s 自动刷新
    const [range, setRange] = useState<UsageRangeSelection>({ preset: '1d' });
    const [appType, setAppType] = useState('all');
    const [providerName, setProviderName] = useState<string | undefined>(undefined);
    const [model, setModel] = useState<string | undefined>(undefined);
    const [activeTab, setActiveTab] = useState<Tab>('logs');
    const [refreshMs, setRefreshMs] = useState<RefreshInterval>(30000);
    const [pricingOpen, setPricingOpen] = useState(false);

    // 视图记在 query 里：主页 / 其它入口可用 /usage?tab=session 直达本地会话
    const [searchParams, setSearchParams] = useSearchParams();
    const view: View = searchParams.get('tab') === 'session' ? 'session' : 'proxy';
    const switchView = (next: View) =>
        setSearchParams(next === 'session' ? { tab: 'session' } : {}, { replace: true });

    const scanSession = useScanSessionUsage();

    /** 顶部筛选行下发的全局筛选；'all' 不下发 */
    const filters: StatsFilters = useMemo(
        () => ({
            appType: appType === 'all' ? undefined : appType,
            providerName,
            model,
        }),
        [appType, providerName, model]
    );

    // 下拉选项池：供应商只跟应用 / 时间范围走（不受自身选中值影响）；
    // 模型随所选供应商级联 —— 与参考项目一致。
    const { data: providerRows } = useProviderStats(range, { appType: filters.appType }, refreshMs);
    const { data: modelRows } = useModelStats(
        range,
        { appType: filters.appType, providerName },
        refreshMs
    );
    const providerOptions = useMemo(
        () =>
            toOptions(
                providerRows,
                (row) => row.providerName,
                (row) => row.requestCount,
                providerName
            ),
        [providerRows, providerName]
    );
    const modelOptions = useMemo(
        () => toOptions(modelRows, (row) => row.model, (row) => row.requestCount, model),
        [modelRows, model]
    );

    // 切应用清掉下游筛选，避免留下一个在新范围内查无数据的「幽灵」组合；切供应商同理清模型
    const changeAppType = (next: string) => {
        setAppType(next);
        if (next !== appType) {
            setProviderName(undefined);
            setModel(undefined);
        }
    };
    const changeProviderName = (next: string | undefined) => {
        setProviderName(next);
        if (next !== providerName) setModel(undefined);
    };

    /** 自定义区间的校验：只看 custom 预设 */
    const rangeError = useMemo(() => {
        if (range.preset !== 'custom') return null;
        const { startDate, endDate } = resolveUsageRange(range);
        if (startDate > endDate) return t('usage.invalidTimeRangeOrder');
        if (endDate - startDate > MAX_CUSTOM_RANGE_SECONDS) return t('usage.timeRangeTooLarge');
        return null;
    }, [range, t]);

    /** 切到自定义：以当前窗口为起点，用户在此基础上改 */
    const switchToCustom = () => {
        const { startDate, endDate } = resolveUsageRange(range);
        setRange({
            preset: 'custom',
            customStartDate: startDate,
            customEndDate: endDate,
            liveEndTime: false,
        });
    };

    const handleCustomTime = (key: 'customStartDate' | 'customEndDate', value: string) => {
        const ts = fromDatetimeLocal(value);
        setRange((prev) => ({ ...prev, preset: 'custom', [key]: ts ?? undefined }));
    };

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

    const displayStart =
        range.preset === 'custom' && range.customStartDate != null
            ? range.customStartDate
            : undefined;
    const displayEnd =
        range.preset === 'custom' && range.customEndDate != null ? range.customEndDate : undefined;

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

                    {view === 'proxy' && (
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
                    </div>
                    )}
                </div>

                {/* 数据源切换：代理请求（落库日志）/ 本地会话（扫描 ~/.claude），口径不同分开看 */}
                <div className={cn(segment, 'w-fit')} role="tablist">
                    {VIEWS.map((v) => (
                        <button
                            key={v.key}
                            type="button"
                            role="tab"
                            aria-selected={view === v.key}
                            className={segmentItem(view === v.key, true)}
                            onClick={() => switchView(v.key)}
                        >
                            <v.icon className="h-4 w-4" />
                            {t(v.labelKey)}
                        </button>
                    ))}
                </div>

                {view === 'proxy' ? (
                <>
                {/* 顶部全局筛选行：作用范围是整页 —— 汇总、趋势与三张明细表 */}
                <div className={cn(card, 'p-4')}>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        <label className="block">
                            <span className={fieldLabel}>{t('usage.appType')}</span>
                            <select
                                className={select}
                                value={appType}
                                onChange={(e) => changeAppType(e.target.value)}
                            >
                                <option value="all">{t('usage.allApps')}</option>
                                <option value="claude">Claude</option>
                                <option value="codex">Codex</option>
                                <option value="gemini">Gemini</option>
                            </select>
                        </label>

                        <label className="block">
                            <span className={fieldLabel}>{t('usage.providerFilter.label')}</span>
                            <select
                                className={select}
                                value={providerName ?? ''}
                                title={t('usage.providerFilter.title')}
                                onChange={(e) => changeProviderName(e.target.value || undefined)}
                            >
                                <option value="">{t('usage.providerFilter.all')}</option>
                                {providerOptions.map((option) => (
                                    <option key={option.name} value={option.name}>
                                        {`${getUsageProviderLabel(option.name, t).label} (${option.count})`}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="block">
                            <span className={fieldLabel}>{t('usage.modelFilter.label')}</span>
                            <select
                                className={select}
                                value={model ?? ''}
                                title={t('usage.modelFilter.title')}
                                onChange={(e) => setModel(e.target.value || undefined)}
                            >
                                <option value="">{t('usage.allModels')}</option>
                                {modelOptions.map((option) => (
                                    <option key={option.name} value={option.name}>
                                        {`${option.name} (${option.count})`}
                                    </option>
                                ))}
                            </select>
                        </label>

                    </div>

                    <div className="mt-3">
                        <span className={fieldLabel}>{t('usage.timeRange')}</span>
                        <div className="flex flex-wrap items-center gap-2">
                            <div
                                className={segment}
                                role="radiogroup"
                                aria-label={t('usage.timeRange')}
                            >
                                {TIME_RANGES.map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        role="radio"
                                        aria-checked={range.preset === preset}
                                        className={segmentItem(range.preset === preset)}
                                        onClick={() => setRange({ preset })}
                                    >
                                        {t(RANGE_LABEL_KEYS[preset])}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={range.preset === 'custom'}
                                    className={segmentItem(range.preset === 'custom')}
                                    onClick={switchToCustom}
                                >
                                    {t('usage.customRange')}
                                </button>
                            </div>

                            {/* 自定义区间：显式起止 + 「结束时间跟随当前时刻」 */}
                            {range.preset === 'custom' && (
                                <>
                                    <input
                                        type="datetime-local"
                                        className={datetimeInput}
                                        value={
                                            displayStart != null
                                                ? toDatetimeLocal(displayStart)
                                                : ''
                                        }
                                        onChange={(e) =>
                                            handleCustomTime('customStartDate', e.target.value)
                                        }
                                    />
                                    <span className={muted}>~</span>
                                    <input
                                        type="datetime-local"
                                        className={cn(
                                            datetimeInput,
                                            range.liveEndTime && 'text-gray-400 dark:text-gray-500'
                                        )}
                                        disabled={range.liveEndTime}
                                        value={
                                            displayEnd != null ? toDatetimeLocal(displayEnd) : ''
                                        }
                                        onChange={(e) =>
                                            handleCustomTime('customEndDate', e.target.value)
                                        }
                                    />
                                    <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                        <input
                                            type="checkbox"
                                            className="checkbox checkbox-xs"
                                            checked={range.liveEndTime ?? false}
                                            onChange={(e) =>
                                                setRange((prev) => ({
                                                    ...prev,
                                                    liveEndTime: e.target.checked,
                                                }))
                                            }
                                        />
                                        {t('usage.liveEndTime')}
                                    </label>
                                </>
                            )}
                        </div>
                    </div>

                    {rangeError && (
                        <div
                            role="alert"
                            className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400"
                        >
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                            {rangeError}
                        </div>
                    )}
                </div>

                {/* 汇总卡片 */}
                <UsageSummaryCards range={range} filters={filters} refreshMs={refreshMs} />

                {/* 趋势图（懒加载：recharts 独立 chunk，先出骨架再填充） */}
                <Suspense fallback={<UsageChartSkeleton />}>
                    <UsageTrendChart range={range} filters={filters} refreshMs={refreshMs} />
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
                        <RequestLogTable range={range} filters={filters} refreshMs={refreshMs} />
                    )}
                    {activeTab === 'providers' && (
                        <ProviderStatsTable range={range} filters={filters} refreshMs={refreshMs} />
                    )}
                    {activeTab === 'models' && (
                        <ModelStatsTable range={range} filters={filters} refreshMs={refreshMs} />
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
                </>
                ) : (
                    <SessionStatsSection />
                )}
            </div>
        </div>
    );
}
