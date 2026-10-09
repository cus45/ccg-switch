import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { RefreshCw, Terminal, CheckCircle, AlertCircle, Download, ArrowUpCircle } from 'lucide-react';
import { useAboutStore } from '../../../stores/useAboutStore';
import ModalDialog from '../../common/ModalDialog';
import { showToast } from '../../common/ToastContainer';
import ToolInstallLog from './ToolInstallLog';
import type { InstallPlan, ToolAction, ToolInstallStatus } from '../../../types/about';

const TOOL_NAMES = ['claude', 'codex', 'gemini', 'opencode'];
const NODE_DOWNLOAD_URL = 'https://nodejs.org/';

function getDisplayName(name: string) {
    if (name === 'opencode') return 'OpenCode';
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** latest 是否比 current 新（按数字段比较，预发布后缀忽略） */
function isNewer(latest: string, current: string): boolean {
    const parse = (v: string) => v.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
    const a = parse(latest);
    const b = parse(current);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d !== 0) return d > 0;
    }
    return false;
}

function ToolStatusGrid() {
    const { t } = useTranslation();
    const {
        toolVersions, loadingTools, fetchToolVersions,
        toolInstalls, startToolInstall, cancelToolInstall, dismissToolInstall,
    } = useAboutStore();
    const [pendingPlan, setPendingPlan] = useState<InstallPlan | null>(null);
    const [npmMissing, setNpmMissing] = useState(false);
    const [planLoading, setPlanLoading] = useState<string | null>(null);

    // 结束时弹 toast：只在 running → 终态 的那一刻
    const prevStatus = useRef<Record<string, ToolInstallStatus>>({});
    useEffect(() => {
        for (const [tool, state] of Object.entries(toolInstalls)) {
            const prev = prevStatus.current[tool];
            if (prev === 'running' && state.status !== 'running') {
                const name = getDisplayName(tool);
                if (state.status === 'success') {
                    showToast(t('settings.toolInstall.success', { name }), 'success');
                } else if (state.status === 'failed') {
                    showToast(t('settings.toolInstall.failed', { name }), 'error');
                }
            }
            prevStatus.current[tool] = state.status;
        }
    }, [toolInstalls, t]);

    const requestInstall = async (tool: string, action: ToolAction) => {
        setPlanLoading(tool);
        try {
            const plan = await invoke<InstallPlan>('get_tool_install_plan', { tool, action });
            setPendingPlan(plan);
        } catch (e) {
            const msg = String(e);
            if (msg.includes('npm_missing')) {
                setNpmMissing(true);
            } else {
                showToast(msg, 'error');
            }
        } finally {
            setPlanLoading(null);
        }
    };

    const confirmInstall = () => {
        if (!pendingPlan) return;
        void startToolInstall(pendingPlan.tool, pendingPlan.action);
        setPendingPlan(null);
    };

    const anyRunningLogs = TOOL_NAMES.filter((name) => toolInstalls[name]);

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
                    TOOL_NAMES.map((name) => (
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
                    TOOL_NAMES.map((toolName) => {
                        const tool = toolVersions.find(t => t.name === toolName);
                        const hasUpdate = !!(tool?.version && tool?.latestVersion && isNewer(tool.latestVersion, tool.version));
                        const running = toolInstalls[toolName]?.status === 'running';
                        const action: ToolAction | null = !tool?.version ? 'install' : hasUpdate ? 'upgrade' : null;
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
                                {running ? (
                                    <button
                                        onClick={() => cancelToolInstall(toolName)}
                                        className="btn btn-xs w-full gap-1 btn-outline btn-error"
                                    >
                                        <span className="loading loading-spinner loading-xs" />
                                        {t('settings.toolInstall.cancel')}
                                    </button>
                                ) : action && !loadingTools ? (
                                    <button
                                        onClick={() => requestInstall(toolName, action)}
                                        disabled={planLoading === toolName}
                                        className="btn btn-xs w-full gap-1 border-0 text-white bg-gradient-to-r from-orange-500 to-pink-500 hover:opacity-90 disabled:opacity-60"
                                    >
                                        {planLoading === toolName ? (
                                            <span className="loading loading-spinner loading-xs" />
                                        ) : action === 'install' ? (
                                            <Download className="w-3 h-3" />
                                        ) : (
                                            <ArrowUpCircle className="w-3 h-3" />
                                        )}
                                        {action === 'install'
                                            ? t('settings.toolInstall.install')
                                            : t('settings.toolInstall.upgradeTo', { version: tool?.latestVersion })}
                                    </button>
                                ) : null}
                            </div>
                        );
                    })
                )}
            </div>

            {anyRunningLogs.map((toolName) => (
                <ToolInstallLog
                    key={toolName}
                    name={getDisplayName(toolName)}
                    state={toolInstalls[toolName]}
                    onDismiss={() => dismissToolInstall(toolName)}
                />
            ))}

            <ModalDialog
                isOpen={!!pendingPlan}
                type="confirm"
                title={pendingPlan
                    ? t(pendingPlan.action === 'install' ? 'settings.toolInstall.confirmInstallTitle' : 'settings.toolInstall.confirmUpgradeTitle', { name: getDisplayName(pendingPlan.tool) })
                    : ''}
                onConfirm={confirmInstall}
                onCancel={() => setPendingPlan(null)}
                confirmText={t('settings.toolInstall.run')}
            >
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                    {t('settings.toolInstall.confirmHint')}
                </p>
                <pre className="text-xs font-mono bg-gray-50 dark:bg-base-200 px-3 py-2 rounded-lg border border-gray-100 dark:border-base-300 whitespace-pre-wrap break-all text-gray-700 dark:text-gray-300">
                    {pendingPlan?.command}
                </pre>
            </ModalDialog>

            <ModalDialog
                isOpen={npmMissing}
                type="info"
                title={t('settings.toolInstall.npmMissingTitle')}
                message={t('settings.toolInstall.npmMissing')}
                onConfirm={() => {
                    setNpmMissing(false);
                    void open(NODE_DOWNLOAD_URL);
                }}
                onCancel={() => setNpmMissing(false)}
                confirmText={t('settings.toolInstall.openNode')}
            />
        </div>
    );
}

export default ToolStatusGrid;
