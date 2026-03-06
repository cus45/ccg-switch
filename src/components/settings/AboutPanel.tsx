import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { ExternalLink, RefreshCw, Terminal, CheckCircle, AlertCircle, Copy, Info } from 'lucide-react';
import appIcon from '../../assets/app-icon.png';

interface ToolVersion {
    name: string;
    version: string | null;
    latestVersion: string | null;
    error: string | null;
}

const INSTALL_COMMANDS = `# Claude Code
curl -fsSL https://claude.ai/install.sh | bash
# Codex
npm i -g @openai/codex@latest
# Gemini CLI
npm i -g @google/gemini-cli@latest
# OpenCode
curl -fsSL https://opencode.ai/install | bash`;

function AboutPanel() {
    const { t } = useTranslation();
    const [version, setVersion] = useState<string>('');
    const [toolVersions, setToolVersions] = useState<ToolVersion[]>([]);
    const [loadingTools, setLoadingTools] = useState(true);
    const [checking, setChecking] = useState(false);

    const loadToolVersions = useCallback(async () => {
        setLoadingTools(true);
        try {
            const data = await invoke<ToolVersion[]>('get_tool_versions', { tools: null });
            setToolVersions(data);
        } catch (e) {
            console.error('Failed to load tool versions:', e);
        }
        setLoadingTools(false);
    }, []);

    useEffect(() => {
        getVersion().then(v => setVersion(v)).catch(() => setVersion('unknown'));
        loadToolVersions();
    }, [loadToolVersions]);

    const handleCheckUpdate = async () => {
        setChecking(true);
        try {
            await invoke('check_for_updates');
        } catch (e) {
            console.error('Failed to check for updates:', e);
        }
        setChecking(false);
    };

    const handleOpenChangelog = async () => {
        try {
            const displayVersion = version ? `v${version}` : '';
            const url = displayVersion
                ? `https://github.com/cus45/ccg-switch/releases/tag/${displayVersion}`
                : 'https://github.com/cus45/ccg-switch/releases';
            await invoke('open_external', { url });
        } catch (e) {
            console.error('Failed to open changelog:', e);
        }
    };

    const copyToClipboard = async (text: string) => {
        try { await navigator.clipboard.writeText(text); } catch { /* silent */ }
    };

    const getDisplayName = (name: string) => {
        if (name === 'opencode') return 'OpenCode';
        return name.charAt(0).toUpperCase() + name.slice(1);
    };

    return (
        <div className="space-y-6">
            {/* 关于 - 标题 */}
            <div>
                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                    {t('settings.about', { defaultValue: '关于' })}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                    {t('settings.aboutHint', { defaultValue: '查看版本信息与更新状态。' })}
                </p>
            </div>

            {/* 版本信息卡片 */}
            <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2.5">
                            <img src={appIcon} alt="CCG Switch" className="h-6 w-6 rounded" />
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-base-content">
                                CCG Switch
                            </h3>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-gray-200 dark:border-base-300 bg-gray-50 dark:bg-base-200">
                                <Info className="w-3 h-3 text-gray-400" />
                                <span className="text-gray-500">{t('settings.version', { defaultValue: '版本' })}</span>
                                <span className="font-medium text-gray-900 dark:text-base-content">v{version || '...'}</span>
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleOpenChangelog}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-base-300 bg-white dark:bg-base-200 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-base-300 transition-colors"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            {t('settings.releaseNotes', { defaultValue: '更新日志' })}
                        </button>
                        <button
                            onClick={handleCheckUpdate}
                            disabled={checking}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg text-white bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 transition-all shadow-sm disabled:opacity-60"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
                            {checking
                                ? t('settings.checking', { defaultValue: '检查中...' })
                                : t('settings.checkForUpdates', { defaultValue: '检查更新' })}
                        </button>
                    </div>
                </div>
            </div>

            {/* 本地环境检查 */}
            <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold text-gray-900 dark:text-base-content">
                        {t('settings.localEnvCheck', { defaultValue: '本地环境检查' })}
                    </h2>
                    <button
                        onClick={loadToolVersions}
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
                    {['claude', 'codex', 'gemini', 'opencode'].map((toolName) => {
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
                    })}
                </div>
            </div>

            {/* 一键安装命令 */}
            <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-gray-900 dark:text-base-content">
                        {t('settings.oneClickInstall', { defaultValue: '一键安装命令' })}
                    </h2>
                    <button
                        onClick={() => copyToClipboard(INSTALL_COMMANDS)}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-base-300 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-base-300 transition-colors"
                    >
                        <Copy className="w-3 h-3" />
                        {t('common.copy', { defaultValue: '复制' })}
                    </button>
                </div>
                <p className="text-xs text-gray-400 mb-2">
                    {t('settings.oneClickInstallHint', { defaultValue: '在终端中执行以下命令安装对应工具。' })}
                </p>
                <pre className="text-xs font-mono bg-gray-50 dark:bg-base-200 px-3 py-2.5 rounded-lg border border-gray-100 dark:border-base-300 overflow-x-auto text-gray-600 dark:text-gray-400 leading-relaxed">
                    {INSTALL_COMMANDS}
                </pre>
            </div>
        </div>
    );
}

export default AboutPanel;
