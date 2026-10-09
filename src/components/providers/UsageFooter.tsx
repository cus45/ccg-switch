import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {invoke} from '@tauri-apps/api/core';
import {AlertCircle, Clock, RefreshCw, Wallet} from 'lucide-react';
import {getUsageScriptConfig, Provider, UsageResult} from '../../types/provider';
import {useProviderLimits} from '../../hooks/useUsageQueries';
import {formatCost} from '../../utils/format';

interface UsageFooterProps {
    provider: Provider;
}

/**
 * 供应商卡片上的余额/用量展示条。
 *
 * 两条独立的用量体系：
 * 1. `usageScript` —— 用户自定义脚本查中转商/官方站余额（需在 meta 里启用）
 * 2. 限额（limitDailyUsd / limitMonthlyUsd）—— 基于代理记账的真实花费，
 *    与脚本体系互不依赖：配了限额就能显示，没配脚本也能显示
 */
export default function UsageFooter({ provider }: UsageFooterProps) {
    const { t } = useTranslation();
    const config = getUsageScriptConfig(provider);
    const enabled = !!config?.enabled;
    const [usage, setUsage] = useState<UsageResult | null>(null);
    const [loading, setLoading] = useState(false);
    const loadingRef = useRef(false);
    const [lastQueriedAt, setLastQueriedAt] = useState<number | null>(null);
    // 相对时间的「当前时间」每 30s 走一格，让「N 分钟前」保持新鲜
    const [now, setNow] = useState(() => Date.now());

    // 限额状态：仅对活跃供应商查询（其他供应商的账还在记，但没必要实时展示）
    const limits = useProviderLimits(provider.id, provider.appType);

    const refresh = useCallback(async () => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true);
        try {
            const result = await invoke<UsageResult>('query_provider_usage', { providerId: provider.id });
            setUsage(result);
        } catch (error) {
            setUsage({ success: false, error: String(error) });
        } finally {
            loadingRef.current = false;
            setLoading(false);
            setLastQueriedAt(Date.now());
        }
    }, [provider.id]);

    useEffect(() => {
        if (!enabled) return;
        void refresh();
        const intervalMin = provider.isActive ? (config?.autoQueryInterval ?? 0) : 0;
        if (intervalMin > 0) {
            const timer = setInterval(() => void refresh(), intervalMin * 60_000);
            return () => clearInterval(timer);
        }
    }, [enabled, provider.isActive, refresh]);

    // 相对时间显示：有时间戳才需要走表
    useEffect(() => {
        if (!lastQueriedAt) return;
        const timer = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(timer);
    }, [lastQueriedAt]);

    /** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 */
    const relativeTime = (ts: number) => {
        const diff = Math.floor((now - ts) / 1000);
        if (diff < 60) return t('usage_script.justNow');
        if (diff < 3600) return t('usage_script.minutesAgo', {count: Math.floor(diff / 60)});
        if (diff < 86400) return t('usage_script.hoursAgo', {count: Math.floor(diff / 3600)});
        return t('usage_script.daysAgo', {count: Math.floor(diff / 86400)});
    };

    const limitsData = limits.data;
    const hasLimits = !!limitsData?.dailyLimit || !!limitsData?.monthlyLimit;

    // 两条体系都没数据就不渲染，避免挂一个空壳
    if (!enabled && !hasLimits) return null;

    return (
        <div className="mb-2 rounded-lg border border-base-200 bg-base-200/40 px-2.5 py-1.5">
            {/* 限额体系：基于真实记账的花费 */}
            {hasLimits && limitsData && (
                <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                    {limitsData.dailyLimit && (
                        <span
                            className={`tabular-nums ${
                                limitsData.dailyExceeded
                                    ? 'font-semibold text-red-500'
                                    : 'text-base-content/60'
                            }`}
                        >
                            {t('usage_script.today')}{' '}
                            <span className="font-medium">
                                {formatCost(limitsData.dailyUsage)}
                            </span>
                            {' / '}
                            {formatCost(limitsData.dailyLimit)}
                        </span>
                    )}
                    {limitsData.monthlyLimit && (
                        <span
                            className={`tabular-nums ${
                                limitsData.monthlyExceeded
                                    ? 'font-semibold text-red-500'
                                    : 'text-base-content/60'
                            }`}
                        >
                            {t('usage_script.this_month')}{' '}
                            <span className="font-medium">
                                {formatCost(limitsData.monthlyUsage)}
                            </span>
                            {' / '}
                            {formatCost(limitsData.monthlyLimit)}
                        </span>
                    )}
                </div>
            )}

            {/* 脚本体系：查余额 */}
            {enabled && (
            <div className="flex items-center gap-2 text-xs">
                <Wallet className="w-3.5 h-3.5 text-base-content/40 shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    {!usage && <span className="text-base-content/40">{t('usage_script.loading')}</span>}
                    {usage && !usage.success && (
                        <span className="flex items-center gap-1 text-red-500 truncate" title={usage.error}>
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            {usage.error || t('usage_script.query_failed')}
                        </span>
                    )}
                    {usage?.success && (usage.data ?? []).map((item, idx) => {
                        const expired = item.isValid === false;
                        const low = item.remaining !== undefined
                            && item.remaining < (item.total ?? item.remaining) * 0.1;
                        return (
                            <div key={idx} className="flex items-center gap-2 min-w-0">
                                {item.planName && (
                                    <span className={`truncate ${expired ? 'text-red-500' : 'text-base-content/60'}`} title={item.planName}>
                                        {item.planName}
                                    </span>
                                )}
                                {expired && (
                                    <span className="text-red-500 text-[10px] px-1 py-0 bg-red-500/10 rounded shrink-0">
                                        {item.invalidMessage || t('usage_script.invalid')}
                                    </span>
                                )}
                                <span className="ml-auto flex items-center gap-1.5 shrink-0 tabular-nums">
                                    {item.total !== undefined && (
                                        <span className="text-base-content/50">
                                            {t('usage_script.total')}{' '}
                                            {item.total === -1 ? '∞' : item.total.toFixed(2)}
                                        </span>
                                    )}
                                    {item.used !== undefined && (
                                        <span className="text-base-content/50">
                                            {t('usage_script.used')} {item.used.toFixed(2)}
                                        </span>
                                    )}
                                    {item.remaining !== undefined && (
                                        <span className={`font-semibold ${expired ? 'text-red-500' : low ? 'text-orange-500' : 'text-green-600 dark:text-green-400'}`}>
                                            {t('usage_script.remaining')} {item.remaining.toFixed(2)}
                                        </span>
                                    )}
                                    {item.unit && <span className="text-base-content/50">{item.unit}</span>}
                                </span>
                            </div>
                        );
                    })}
                </div>
                {lastQueriedAt && (
                    <span
                        className="flex shrink-0 items-center gap-1 text-[10px] text-base-content/40"
                        title={new Date(lastQueriedAt).toLocaleString()}
                    >
                        <Clock className="w-3 h-3" />
                        {relativeTime(lastQueriedAt)}
                    </span>
                )}
                <button
                    onClick={(e) => { e.stopPropagation(); void refresh(); }}
                    disabled={loading}
                    className="btn btn-ghost btn-xs btn-circle shrink-0"
                    title={t('usage_script.refresh')}
                >
                    <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>
            )}
        </div>
    );
}
