import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ExternalLink, RefreshCw, CheckCircle, AlertCircle, Download, Info } from 'lucide-react';
import { useAboutStore } from '../../../stores/useAboutStore';
import appIcon from '../../../assets/app-icon.png';
import UpdateBanner from './UpdateBanner';

function VersionInfoCard() {
    const { t } = useTranslation();
    const {
        appVersion, updateInfo, checking, checkError, installing,
        downloading, checkForUpdates, setCheckError, setDownloadedPath, downloadUpdate,
    } = useAboutStore();

    const handleOpenChangelog = async () => {
        try {
            const displayVersion = appVersion ? `v${appVersion}` : '';
            const url = displayVersion
                ? `https://github.com/cus45/ccg-switch/releases/tag/${displayVersion}`
                : 'https://github.com/cus45/ccg-switch/releases';
            await invoke('open_external', { url });
        } catch (e) {
            console.error('Failed to open changelog:', e);
        }
    };

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
            {/* 顶部: 图标+版本+按钮 */}
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
                            <span className="font-medium text-gray-900 dark:text-base-content">v{appVersion || '...'}</span>
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
                        onClick={checkForUpdates}
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
                                            if (updateInfo?.downloadUrl) {
                                                downloadUpdate(updateInfo.downloadUrl);
                                            }
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

            {/* 发现新版本横幅 */}
            <UpdateBanner />
        </div>
    );
}

export default VersionInfoCard;
