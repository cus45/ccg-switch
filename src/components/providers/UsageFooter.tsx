import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {invoke} from '@tauri-apps/api/core';
import {AlertCircle, RefreshCw, Wallet} from 'lucide-react';
import {getUsageScriptConfig, Provider, UsageResult} from '../../types/provider';

interface UsageFooterProps {
    provider: Provider;
}

/**
 * 供应商卡片上的余额/用量展示条。
 * 仅在 meta.usageScript 启用时渲染；挂载时查询一次，
 * 当前激活的供应商按 autoQueryInterval 自动刷新。
 */
export default function UsageFooter({ provider }: UsageFooterProps) {
    const { t } = useTranslation();
    const config = getUsageScriptConfig(provider);
    const enabled = !!config?.enabled;
    const [usage, setUsage] = useState<UsageResult | null>(null);
    const [loading, setLoading] = useState(false);
    const loadingRef = useRef(false);

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

    if (!enabled) return null;

    return (
        <div className="mb-2 rounded-lg border border-base-200 bg-base-200/40 px-2.5 py-1.5">
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
                <button
                    onClick={(e) => { e.stopPropagation(); void refresh(); }}
                    disabled={loading}
                    className="btn btn-ghost btn-xs btn-circle shrink-0"
                    title={t('usage_script.refresh')}
                >
                    <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>
        </div>
    );
}
