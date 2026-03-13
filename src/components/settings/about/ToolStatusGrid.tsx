import { useTranslation } from 'react-i18next';
import { RefreshCw, Terminal, CheckCircle, AlertCircle } from 'lucide-react';
import { useAboutStore } from '../../../stores/useAboutStore';

function ToolStatusGrid() {
    const { t } = useTranslation();
    const { toolVersions, loadingTools, fetchToolVersions } = useAboutStore();

    const getDisplayName = (name: string) => {
        if (name === 'opencode') return 'OpenCode';
        return name.charAt(0).toUpperCase() + name.slice(1);
    };

    const toolNames = ['claude', 'codex', 'gemini', 'opencode'];

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                    {t('settings.localEnvCheck', { defaultValue: '本地环境检查' })}
                </h2>
                <button
                    onClick={() => fetchToolVersions(true)}
                    disabled={loadingTools}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-base-300 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-base-300 transition-colors disabled:opacity-60"
                >
                    <RefreshCw className={`w-3 h-3 ${loadingTools ? 'animate-spin' : ''}`} />
                    {loadingTools
                        ? t('common.refreshing', { defaultValue: '刷新中...' })
                        : t('common.refresh', { defaultValue: '刷新' })}
                </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {/* 骨架屏: 首次加载且无数据时显示 */}
                {loadingTools && toolVersions.length === 0 ? (
                    toolNames.map((name) => (
                        <div key={name} className="rounded-xl border border-gray-100 dark:border-base-200 bg-gray-50/50 dark:bg-base-200/50 p-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="skeleton w-4 h-4 rounded" />
                                    <div className="skeleton h-4 w-16 rounded" />
                                </div>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-gray-400" />
                            </div>
                            <div className="skeleton h-3 w-20 rounded" />
                        </div>
                    ))
                ) : (
                    toolNames.map((toolName) => {
                        const tool = toolVersions.find(t => t.name === toolName);
                        const hasUpdate = tool?.version && tool?.latestVersion && tool.version !== tool.latestVersion;
                        return (
                            <div
                                key={toolName}
                                className="rounded-xl border border-gray-100 dark:border-base-200 bg-gray-50/50 dark:bg-base-200/50 p-4 space-y-2 hover:border-blue-500/30 transition-colors"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Terminal className="w-4 h-4 text-gray-400" />
                                        <span className="text-sm font-medium text-gray-900 dark:text-base-content">
                                            {getDisplayName(toolName)}
                                        </span>
                                    </div>
                                    {loadingTools ? (
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-gray-400" />
                                    ) : tool?.version ? (
                                        hasUpdate ? (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
                                                {tool.latestVersion}
                                            </span>
                                        ) : (
                                            <CheckCircle className="w-4 h-4 text-green-500" />
                                        )
                                    ) : (
                                        <AlertCircle className="w-4 h-4 text-yellow-500" />
                                    )}
                                </div>
                                <div className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate">
                                    {loadingTools
                                        ? t('common.loading', { defaultValue: '加载中...' })
                                        : tool?.version
                                            ? tool.version
                                            : tool?.error || t('settings.notInstalled', { defaultValue: '未安装' })}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

export default ToolStatusGrid;
