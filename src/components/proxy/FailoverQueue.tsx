import { useEffect, useState } from 'react';
import { GitMerge, Info } from 'lucide-react';
import { useProviderStore } from '../../stores/useProviderStore';
import { showToast } from '../common/ToastContainer';
import { type AppType } from '../../types/app';
import { getFallbackVisibleAppOptions, useVisibleAppOptions } from '../../hooks/useVisibleAppOptions';

export default function FailoverQueue() {
    const { providers, hasLoaded, loading, loadAllProviders, updateProvider } = useProviderStore();
    const appOptions = useVisibleAppOptions();
    const [activeTab, setActiveTab] = useState<AppType>(() => getFallbackVisibleAppOptions()[0].appType);

    useEffect(() => {
        if (!hasLoaded) {
            void loadAllProviders();
        }
    }, [hasLoaded, loadAllProviders]);

    useEffect(() => {
        if (appOptions.length > 0 && !appOptions.some(option => option.appType === activeTab)) {
            setActiveTab(appOptions[0].appType);
        }
    }, [activeTab, appOptions]);

    const handleToggle = async (id: string, current: boolean) => {
        try {
            await updateProvider(id, { inFailoverQueue: !current });
            showToast(
                !current ? '已加入故障转移队列' : '已移出故障转移队列',
                'success',
            );
        } catch (error) {
            showToast('更新失败: ' + String(error), 'error');
        }
    };

    // 按当前 tab 过滤
    const filtered = providers.filter((p) => p.appType === activeTab);
    const queued = filtered.filter((p) => p.inFailoverQueue);
    const queueCount = queued.length;
    const queueIndexMap = new Map(queued.map((p, i) => [p.id, i + 1]));

    // 每个 tab 的统计
    const tabStats = appOptions.map(({ appType: type, label, color }) => {
        const list = providers.filter((p) => p.appType === type);
        return { type, label, color, total: list.length, queued: list.filter((p) => p.inFailoverQueue).length };
    });
    const activeLabel = appOptions.find(option => option.appType === activeTab)?.label ?? activeTab;

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl shadow-sm border border-gray-100 dark:border-base-200">
            {/* 标题 */}
            <div className="flex items-center gap-2 px-5 pt-4 pb-3">
                <GitMerge className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold text-gray-900 dark:text-base-content">故障转移队列</h2>
                <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                    {queueCount} / {filtered.length} 已加入
                </span>
            </div>

            {/* Tab 导航 */}
            <div className="flex border-b border-gray-100 dark:border-base-200 px-5 gap-1" role="tablist">
                {tabStats.map(({ type, label, color, total, queued }) => (
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
                                style={{ backgroundColor: color }}
                            />
                            {label}
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
                                style={{ backgroundColor: color }}
                            />
                        )}
                    </button>
                ))}
            </div>

            {/* Provider 列表 */}
            <div className="p-4">
                {filtered.length === 0 ? (
                    <div className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                        暂无 {activeLabel} Provider
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
                                        <span className="badge badge-xs badge-success shrink-0">Active</span>
                                    )}
                                </div>
                                <input
                                    type="checkbox"
                                    checked={provider.inFailoverQueue}
                                    onChange={() => void handleToggle(provider.id, provider.inFailoverQueue)}
                                    disabled={loading}
                                    aria-label={`${provider.name} 故障转移`}
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
                        <span>勾选的 Provider 将参与自动故障转移，当请求失败时按优先级（P1→P2→...）依次切换</span>
                    </div>
                )}
            </div>
        </div>
    );
}
