import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { ToolInstallState } from '../../../types/about';

interface ToolInstallLogProps {
    name: string;
    state: ToolInstallState;
    onDismiss: () => void;
}

const STATUS_STYLE: Record<ToolInstallState['status'], string> = {
    running: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    success: 'bg-green-500/10 text-green-600 dark:text-green-400',
    failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
    cancelled: 'bg-gray-500/10 text-gray-500 dark:text-gray-400',
};

/** 单个工具的安装 / 升级输出：实时滚动、可折叠，结束后可关闭 */
export default function ToolInstallLog({ name, state, onDismiss }: ToolInstallLogProps) {
    const { t } = useTranslation();
    const [collapsed, setCollapsed] = useState(false);
    const scrollRef = useRef<HTMLPreElement>(null);

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [state.logs.length, collapsed]);

    const running = state.status === 'running';

    return (
        <div className="mt-3 rounded-xl border border-gray-100 dark:border-base-200 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-base-200">
                <span className="text-sm font-medium text-gray-900 dark:text-base-content">
                    {t(state.action === 'install' ? 'settings.toolInstall.logTitleInstall' : 'settings.toolInstall.logTitleUpgrade', { name })}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLE[state.status]}`}>
                    {t(`settings.toolInstall.status.${state.status}`)}
                    {state.status === 'failed' && state.exitCode != null && ` (${state.exitCode})`}
                </span>
                <div className="ml-auto flex items-center gap-1">
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="btn btn-ghost btn-xs btn-square"
                        title={collapsed ? t('common.expand', { defaultValue: '展开' }) : t('common.collapse', { defaultValue: '收起' })}
                    >
                        {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                    </button>
                    {!running && (
                        <button onClick={onDismiss} className="btn btn-ghost btn-xs btn-square" title={t('common.close', { defaultValue: '关闭' })}>
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>
            {!collapsed && (
                <pre
                    ref={scrollRef}
                    className="max-h-56 overflow-auto px-3 py-2 text-[11px] leading-relaxed font-mono bg-gray-900 text-gray-200 whitespace-pre-wrap break-all"
                >
                    {state.logs.length > 0 ? state.logs.join('\n') : t('settings.toolInstall.waiting')}
                </pre>
            )}
        </div>
    );
}
