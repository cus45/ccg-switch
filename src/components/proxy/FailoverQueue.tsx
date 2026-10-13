import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitMerge, Info } from 'lucide-react';
import { useProviderStore } from '../../stores/useProviderStore';
import { showToast } from '../common/ToastContainer';
import { PROXY_APP_TYPES, APP_LABELS, APP_COLORS, AppType } from '../../types/app';

export default function FailoverQueue() {
    const { t } = useTranslation();
    const { providers, hasLoaded, loading, loadAllProviders, updateProvider } = useProviderStore();
    const [activeTab, setActiveTab] = useState<AppType>('claude');

    useEffect(() => {
        if (!hasLoaded) {
            void loadAllProviders();
        }
    }, [hasLoaded, loadAllProviders]);

    const handleToggle = async (id: string, current: boolean) => {
        try {
            await updateProvider(id, { inFailoverQueue: !current });
            showToast(
                !current ? t('proxy.failover.added') : t('proxy.failover.removed'),
                'success',
            );
        } catch (error) {
            showToast(t('proxy.failover.updateFailed', { error: String(error) }), 'error');
        }
    };

    // 按当前 tab 过滤
    const filtered = providers.filter((p) => p.appType === activeTab);
    const queued = filtered.filter((p) => p.inFailoverQueue);
    const queueCount = queued.length;
    const queueIndexMap = new Map(queued.map((p, i) => [p.id, i + 1]));

    // 每个 tab 的统计
    const tabStats = PROXY_APP_TYPES.map((type) => {
        const list = providers.filter((p) => p.appType === type);
        return { type, total: list.length, queued: list.filter((p) => p.inFailoverQueue).length };
    });

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl shadow-sm border border-gray-100 dark:border-base-200">
            {/* 标题 */}
            <div className="flex items-center gap-2 px-5 pt-4 pb-3">
                <GitMerge className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold text-gray-900 dark:text-base-content">{t('proxy.failover.title')}</h2>
                <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                    {t('proxy.failover.joinedCount', { queued: queueCount, total: filtered.length })}
                </span>
            </div>

            {/* Tab 导航 */}
            <div className="flex border-b border-gray-100 dark:border-base-200 px-5 gap-1" role="tablist">
                {tabStats.map(({ type, total, queued }) => (
                    <button
                        key={type}
                        role="tab"
                        aria-selected={activeTab === type}
                        onClick={() => setActiveTab(type)}
                        className={`relative px-3 py-2 text-xs font-medium transition-colors rounded-t-lg ${
                            activeTab === type
                                ? 'text-gray-900 dark:text-base-content bg-gray-50 dark:bg-base-200'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                    >
                        <span className="flex items-center gap-1.5">
                            <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: APP_COLORS[type] }}
                            />
                            {APP_LABELS[type]}
                            {total > 0 && (
                                <span className={`text-[10px] px-1 rounded-full ${
                                    queued > 0
                                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                        : 'bg-gray-100 dark:bg-base-200 text-gray-400'
                                }`}>
                                    {queued}/{total}
                                </span>
                            )}
                        </span>
                        {activeTab === type && (
                            <span
                                className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full"
                                style={{ backgroundColor: APP_COLORS[type] }}
                            />
                        )}
                    </button>
                ))}
            </div>

            {/* Provider 列表 */}
            <div className="p-4">
                {filtered.length === 0 ? (
                    <div className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                        {t('proxy.failover.empty', { app: APP_LABELS[activeTab] })}
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {filtered.map((provider) => (
                            <div
                                key={provider.id}
                                className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${
                                    provider.inFailoverQueue
                                        ? 'bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800'
                                        : 'bg-gray-50 dark:bg-base-200/50 hover:bg-gray-100 dark:hover:bg-base-200 border border-transparent'
                                }`}
                            >
                                <div className="flex items-center gap-2.5 min-w-0">
                                    {/* 优先级序号 */}
                                    {provider.inFailoverQueue && (
                                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold shrink-0">
                                            P{queueIndexMap.get(provider.id)}
                                        </span>
                                    )}
                                    <span className={`text-sm font-medium truncate ${
                                        provider.inFailoverQueue
                                            ? 'text-blue-700 dark:text-blue-300'
                                            : 'text-gray-700 dark:text-gray-300'
                                    }`}>
                                        {provider.name}
                                    </span>
                                    {provider.isActive && (
                                        <span className="badge badge-xs badge-success shrink-0">{t('proxy.failover.active')}</span>
                                    )}
                                </div>
                                <input
                                    type="checkbox"
                                    checked={provider.inFailoverQueue}
                                    onChange={() => void handleToggle(provider.id, provider.inFailoverQueue)}
                                    disabled={loading}
                                    aria-label={t('proxy.failover.ariaLabel', { name: provider.name })}
                                    className="checkbox checkbox-sm checkbox-primary disabled:opacity-50"
                                />
                            </div>
                        ))}
                    </div>
                )}

                {/* 提示 */}
                {filtered.length > 0 && (
                    <div className="flex items-start gap-1.5 mt-3 text-xs text-gray-400 dark:text-gray-500">
                        <Info className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>{t('proxy.failover.hint')}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
