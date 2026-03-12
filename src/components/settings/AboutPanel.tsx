import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { ExternalLink, RefreshCw, Terminal, CheckCircle, AlertCircle, Copy, Info, Download, ArrowUpCircle } from 'lucide-react';
import appIcon from '../../assets/app-icon.png';

interface ToolVersion {
    name: string;
    version: string | null;
    latestVersion: string | null;
    error: string | null;
}

interface UpdateInfo {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion: string;
    releaseNotes: string;
    downloadUrl: string | null;
    fileSize: number | null;
    publishedAt: string | null;
}

interface DownloadProgress {
    downloaded: number;
    total: number;
    percentage: number;
}

interface InstallProgress {
    stage: string;
    message: string;
    percentage: number;
}

const INSTALL_COMMANDS = `# Claude Code
curl -fsSL https://claude.ai/install.sh | bash
# Codex
npm i -g @openai/codex@latest
# Gemini CLI
npm i -g @google/gemini-cli@latest
# OpenCode
curl -fsSL https://opencode.ai/install | bash`;

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AboutPanel() {
    const { t } = useTranslation();
    const [version, setVersion] = useState<string>('');
    const [toolVersions, setToolVersions] = useState<ToolVersion[]>([]);
    const [loadingTools, setLoadingTools] = useState(true);
    const [checking, setChecking] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [checkError, setCheckError] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
    const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
    const [installing, setInstalling] = useState(false);
    const [installStage, setInstallStage] = useState<string>('idle');

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

    // 监听下载进度事件
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        listen<DownloadProgress>('update-download-progress', (event) => {
            setDownloadProgress(event.payload);
        }).then(fn => { unlisten = fn; });
        return () => { unlisten?.(); };
    }, []);

    // 监听安装进度事件
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        listen<InstallProgress>('update-install-progress', (event) => {
            setInstallStage(event.payload.stage);
        }).then(fn => { unlisten = fn; });
        return () => { unlisten?.(); };
    }, []);

    const handleCheckUpdate = async () => {
        setChecking(true);
        setUpdateInfo(null);
        setCheckError(null);
        setDownloadedPath(null);
        setDownloadProgress(null);
        try {
            const info = await invoke<UpdateInfo>('check_for_updates');
            setUpdateInfo(info);
        } catch (e: any) {
            setCheckError(typeof e === 'string' ? e : e?.message || '检查更新失败');
        }
        setChecking(false);
    };

    const handleDownload = async () => {
        if (!updateInfo?.downloadUrl) return;
        setDownloading(true);
        setDownloadProgress(null);
        setDownloadedPath(null);
        try {
            const path = await invoke<string>('download_update', { url: updateInfo.downloadUrl });
            setDownloadedPath(path);
        } catch (e: any) {
            setCheckError(typeof e === 'string' ? e : e?.message || '下载失败');
        }
        setDownloading(false);
    };

    const handleInstall = async () => {
        if (!downloadedPath) return;
        setInstalling(true);
        setInstallStage('mounting');
        try {
            await invoke('install_update', { filePath: downloadedPath });
            // 成功后保持 installing 状态，等待用户重启
        } catch (e: any) {
            setCheckError(typeof e === 'string' ? e : e?.message || '安装失败');
            setInstalling(false);
            setInstallStage('idle');
        }
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

    const handleRelaunch = async () => {
        // 提示用户手动重启应用（因为安装完成后需要重启才能加载新版本）
        setCheckError('安装完成！请手动关闭应用并重新打开以使用新版本。');
        setInstalling(false);
        setInstallStage('idle');
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
                    {t('settings.about.title', { defaultValue: '关于' })}
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
                            {/* 已是最新版本提示 */}
                            {updateInfo && !updateInfo.hasUpdate && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-500/20">
                                    <CheckCircle className="w-3 h-3" />
                                    {t('settings.upToDate', { defaultValue: '已是最新版本' })}
                                </span>
                            )}
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
                            disabled={checking || installing}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg text-white bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 transition-all shadow-sm disabled:opacity-60"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
                            {checking
                                ? t('settings.checking', { defaultValue: '检查中...' })
                                : t('settings.checkForUpdates', { defaultValue: '检查更新' })}
                        </button>
                    </div>
                </div>

                {/* 检查失败提示 */}
                {checkError && (
                    <div className="mt-3 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                        <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <span className="text-xs text-red-600 dark:text-red-400 break-words">{checkError}</span>
                                {/* 权限不足引导文案 */}
                                {(checkError.includes('权限不足') || checkError.includes('EPERM')) && (
                                    <div className="mt-2 p-2 rounded-md bg-red-100/50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                                        <p className="text-[11px] text-red-700 dark:text-red-300 leading-relaxed">
                                            <span className="font-medium">解决方案：</span>请将 CCG Switch 移动到 /Applications 文件夹后重试，或手动复制下载的安装包到 /Applications 目录。
                                        </p>
                                    </div>
                                )}
                                {/* 挂载失败 - 提供重新下载按钮 */}
                                {(checkError.includes('挂载失败') || checkError.toLowerCase().includes('mount failed')) && (
                                    <div className="mt-2">
                                        <button
                                            onClick={() => {
                                                setCheckError(null);
                                                setDownloadedPath(null);
                                                handleDownload();
                                            }}
                                            disabled={downloading}
                                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-60"
                                        >
                                            <Download className="w-3 h-3" />
                                            {downloading ? '重新下载中...' : '重新下载更新'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* 发现新版本 */}
                {updateInfo?.hasUpdate && (
                    <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ArrowUpCircle className="w-4.5 h-4.5 text-blue-500" />
                                <span className="text-sm font-medium text-gray-900 dark:text-base-content">
                                    {t('settings.newVersionFound', { defaultValue: '发现新版本' })}
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400">
                                    v{updateInfo.latestVersion}
                                </span>
                            </div>
                            {updateInfo.publishedAt && (
                                <span className="text-xs text-gray-400">
                                    {new Date(updateInfo.publishedAt).toLocaleDateString()}
                                </span>
                            )}
                        </div>

                        {/* Release Notes */}
                        {updateInfo.releaseNotes && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 max-h-24 overflow-y-auto whitespace-pre-wrap leading-relaxed bg-white/50 dark:bg-base-200/50 rounded-md p-2.5">
                                {updateInfo.releaseNotes}
                            </div>
                        )}

                        {/* 下载进度条 */}
                        {downloading && downloadProgress && (
                            <div className="space-y-1.5">
                                <div className="w-full h-2 bg-gray-200 dark:bg-base-300 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-300"
                                        style={{ width: `${downloadProgress.percentage}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-[11px] text-gray-400">
                                    <span>{formatFileSize(downloadProgress.downloaded)} / {formatFileSize(downloadProgress.total)}</span>
                                    <span>{downloadProgress.percentage.toFixed(0)}%</span>
                                </div>
                            </div>
                        )}

                        {/* 操作按钮 */}
                        <div className="flex items-center gap-2">
                            {!downloadedPath && !downloading && (
                                <button
                                    onClick={handleDownload}
                                    disabled={!updateInfo.downloadUrl}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg text-white bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 transition-all shadow-sm disabled:opacity-60"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    {t('settings.downloadUpdate', { defaultValue: '下载更新' })}
                                    {updateInfo.fileSize && (
                                        <span className="opacity-75">({formatFileSize(updateInfo.fileSize)})</span>
                                    )}
                                </button>
                            )}
                            {downloading && (
                                <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-500">
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    {t('settings.downloading', { defaultValue: '下载中...' })}
                                </span>
                            )}
                            {downloadedPath && !installing && (
                                <button
                                    onClick={handleInstall}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg text-white bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 transition-all shadow-sm"
                                >
                                    <ArrowUpCircle className="w-3.5 h-3.5" />
                                    {t('settings.installUpdate', { defaultValue: '安装更新' })}
                                </button>
                            )}
                            {installing && (
                                <>
                                    {installStage === 'success' ? (
                                        <button
                                            onClick={handleRelaunch}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg text-white bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 transition-all shadow-sm"
                                        >
                                            <RefreshCw className="w-3.5 h-3.5" />
                                            {t('settings.relaunchNow', { defaultValue: '立即重启' })}
                                        </button>
                                    ) : (
                                        <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-500">
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            {t(`settings.installStage.${installStage}`, { defaultValue: '正在启动安装程序...' })}
                                        </span>
                                    )}
                                </>
                            )}
                            {!updateInfo.downloadUrl && (
                                <span className="text-xs text-gray-400">
                                    {t('settings.noInstallerFound', { defaultValue: '未找到当前平台的安装包' })}
                                </span>
                            )}
                        </div>
                    </div>
                )}
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
