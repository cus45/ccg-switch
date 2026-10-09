import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, CheckCircle2, Info, RotateCcw } from 'lucide-react';
import ModalDialog from '../common/ModalDialog';
import { showToast } from '../common/ToastContainer';

/** 后端 get_claude_desktop_status 的返回 */
interface ClaudeDesktopStatus {
    supported: boolean;
    installed: boolean;
    applied: boolean;
    configLibraryPath: string | null;
    actualBaseUrl: string | null;
    hasBackup: boolean;
}

interface ClaudeDesktopPanelProps {
    /** 供应商列表变化（切换 / 删除）后重新读取状态 */
    refreshKey: string;
    /** 恢复后刷新供应商列表（激活状态被清空） */
    onRestored: () => void;
}

/**
 * Claude Desktop 3P 配置状态条：是否已由本应用接管、当前网关、恢复原配置
 *
 * 写入的是 Desktop 的「配置库」条目（与 cc-switch 同思路），改动在 Desktop 重启后生效。
 */
export default function ClaudeDesktopPanel({ refreshKey, onRestored }: ClaudeDesktopPanelProps) {
    const { t } = useTranslation();
    const [status, setStatus] = useState<ClaudeDesktopStatus | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [restoring, setRestoring] = useState(false);

    const load = useCallback(() => {
        invoke<ClaudeDesktopStatus>('get_claude_desktop_status')
            .then(setStatus)
            .catch(() => setStatus(null));
    }, []);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    const restore = async () => {
        setConfirmOpen(false);
        setRestoring(true);
        try {
            await invoke('restore_claude_desktop');
            showToast(t('providers.claudeDesktop.restored', '已恢复 Claude Desktop 原配置，重启 Desktop 后生效'), 'success');
            onRestored();
            load();
        } catch (e) {
            showToast(String(e), 'error');
        } finally {
            setRestoring(false);
        }
    };

    if (!status) return null;

    if (!status.supported || !status.installed) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t('providers.claudeDesktop.notInstalled', '未检测到 Claude Desktop 配置目录，请先安装并启动一次 Claude Desktop。')}
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-gray-200 dark:border-base-300 bg-white dark:bg-base-100 px-3 py-2 text-xs">
            {status.applied ? (
                <span className="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    {t('providers.claudeDesktop.applied', '已接管')}
                    {status.actualBaseUrl && (
                        <code className="font-mono text-gray-500 dark:text-gray-400">{status.actualBaseUrl}</code>
                    )}
                </span>
            ) : (
                <span className="inline-flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <Info className="h-4 w-4" />
                    {t('providers.claudeDesktop.notApplied', '未接管：切换一个 Claude Desktop 供应商即可写入配置库')}
                </span>
            )}
            <span className="text-gray-400 dark:text-gray-500">
                {t('providers.claudeDesktop.restartHint', '修改在重启 Claude Desktop 后生效')}
            </span>
            {status.configLibraryPath && (
                <code
                    className="truncate max-w-[28rem] font-mono text-[11px] text-gray-400 dark:text-gray-500"
                    title={status.configLibraryPath}
                >
                    {status.configLibraryPath}
                </code>
            )}
            {(status.applied || status.hasBackup) && (
                <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={restoring}
                    className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-orange-600 hover:bg-orange-500/10 disabled:opacity-60 dark:text-orange-400"
                >
                    {restoring ? <span className="loading loading-spinner loading-xs" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    {t('providers.claudeDesktop.restore', '恢复原配置')}
                </button>
            )}

            <ModalDialog
                isOpen={confirmOpen}
                type="confirm"
                title={t('providers.claudeDesktop.restoreTitle', '恢复 Claude Desktop 原配置？')}
                message={t('providers.claudeDesktop.restoreMessage', '将移除本应用写入的网关条目，还原接管前生效的配置与部署模式，并取消 Claude Desktop 供应商的激活状态。')}
                onConfirm={restore}
                onCancel={() => setConfirmOpen(false)}
            />
        </div>
    );
}
