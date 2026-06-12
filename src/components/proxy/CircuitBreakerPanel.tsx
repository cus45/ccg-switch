import { useEffect } from 'react';
import { Shield, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useProviderStore } from '../../stores/useProviderStore';
import { CircuitBreakerState } from '../../types/proxy';
import { useVisibleAppOptions } from '../../hooks/useVisibleAppOptions';

function getCircuitState(index: number): CircuitBreakerState {
    // 静态占位：前端展示模拟状态，实际由后端维护
    if (index % 3 === 0) return 'open';
    if (index % 5 === 0) return 'halfopen';
    return 'closed';
}

const STATE_CONFIG: Record<CircuitBreakerState, {
    label: string;
    icon: typeof CheckCircle;
    badgeClass: string;
    iconClass: string;
}> = {
    closed: {
        label: '正常',
        icon: CheckCircle,
        badgeClass: 'badge-success',
        iconClass: 'text-green-500',
    },
    open: {
        label: '断开',
        icon: XCircle,
        badgeClass: 'badge-error',
        iconClass: 'text-red-500',
    },
    halfopen: {
        label: '半开',
        icon: AlertCircle,
        badgeClass: 'badge-warning',
        iconClass: 'text-amber-500',
    },
};

export default function CircuitBreakerPanel() {
    const { providers, hasLoaded, loadAllProviders } = useProviderStore();
    const appOptions = useVisibleAppOptions();
    const displayApp = appOptions[0];

    useEffect(() => {
        if (!hasLoaded) {
            void loadAllProviders();
        }
    }, [hasLoaded, loadAllProviders]);

    const displayProviders = displayApp
        ? providers.filter((p) => p.appType === displayApp.appType)
        : [];

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl shadow-sm border border-gray-100 dark:border-base-200 p-5">
            <div className="flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold text-gray-900 dark:text-base-content">熔断器状态</h2>
                <span className="ml-auto text-xs text-gray-400 bg-gray-100 dark:bg-base-200 px-2 py-0.5 rounded-full">
                    占位展示
                </span>
            </div>

            {displayProviders.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                    暂无 {displayApp?.label ?? 'App'} Provider
                </div>
            ) : (
                <div className="space-y-2">
                    {displayProviders.map((provider, index) => {
                        const state = getCircuitState(index);
                        const cfg = STATE_CONFIG[state];
                        const Icon = cfg.icon;
                        return (
                            <div
                                key={provider.id}
                                className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-base-200/50 hover:bg-gray-100 dark:hover:bg-base-200 transition-colors"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <Icon className={`w-4 h-4 shrink-0 ${cfg.iconClass}`} />
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                                        {provider.name}
                                    </span>
                                </div>
                                <span className={`badge badge-sm ${cfg.badgeClass} shrink-0 ml-2`}>
                                    {cfg.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
