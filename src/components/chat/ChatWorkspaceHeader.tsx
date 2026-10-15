import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    Folder,
    GitBranch,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
    Trash2,
    Package,
    RefreshCw,
    Cpu,
    Bot,
    MessageSquare,
    ClipboardList,
    Zap,
    ChevronDown,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import ChatProviderSelector from './ChatProviderSelector';
import type { AppType } from '../../types/app';
import type { PermissionMode } from './composer/constants';
import { formatTokenCount } from '../../utils/chatFormat';

export interface ChatWorkspaceHeaderProps {
    currentCwd: string | null;
    gitBranch?: string | null;
    sessionTitle?: string | null;
    sessionSidebarCollapsed: boolean;
    onToggleSessionSidebar: () => void;
    sidebarToggleLabel: string;

    // Tokens
    contextTokens: number;
    contextMaxTokens: number;
    contextUsagePercentage: number;

    // Provider & Model
    provider: 'claude' | 'codex';
    model: string;
    onModelChange?: (model: string) => void;
    availableModels?: Array<{ id: string; label: string }>;

    // Permission Mode
    permissionMode: PermissionMode;
    onPermissionModeChange?: (mode: PermissionMode) => void;

    // Daemon Status
    daemonStatusText: string;
    daemonIndicatorClass: string;
    daemonDiagnosticDisplayText?: string | null;
    showDaemonReconnect: boolean;
    daemonReconnectLabel: string;
    daemonReconnectShortLabel: string;
    daemonReconnecting: boolean;
    onReconnectDaemon: () => void;

    // Actions
    hasMessages: boolean;
    isStreaming: boolean;
    onNewSession: () => void;
    onClearChat: () => void;
    onOpenSdkModal: () => void;
    sdkMissing: boolean;
    clearChatLabel: string;
    sdkManageLabel: string;
    newSessionLabel?: string;
}

const MODE_ICONS: Record<PermissionMode, React.ReactNode> = {
    default: <MessageSquare size={13} />,
    plan: <ClipboardList size={13} />,
    acceptEdits: <Bot size={13} />,
    bypassPermissions: <Zap size={13} />,
};

const MODE_LABELS: Record<PermissionMode, string> = {
    default: 'Chat',
    plan: 'Plan',
    acceptEdits: 'Edit',
    bypassPermissions: 'Bypass',
};

export const ChatWorkspaceHeader: React.FC<ChatWorkspaceHeaderProps> = ({
    currentCwd,
    gitBranch,
    sessionTitle,
    sessionSidebarCollapsed,
    onToggleSessionSidebar,
    sidebarToggleLabel,
    contextTokens,
    contextMaxTokens,
    contextUsagePercentage,
    provider,
    model,
    onModelChange,
    availableModels = [],
    permissionMode,
    onPermissionModeChange,
    daemonStatusText,
    daemonIndicatorClass,
    daemonDiagnosticDisplayText,
    showDaemonReconnect,
    daemonReconnectLabel,
    daemonReconnectShortLabel,
    daemonReconnecting,
    onReconnectDaemon,
    hasMessages,
    isStreaming,
    onNewSession,
    onClearChat,
    onOpenSdkModal,
    sdkMissing,
    clearChatLabel,
    sdkManageLabel,
    newSessionLabel = 'New Session',
}) => {
    const { t } = useTranslation();

    const folderName = currentCwd
        ? currentCwd.split(/[\\/]+/).filter(Boolean).pop() || currentCwd
        : t('chat.noWorkspace', 'No Workspace');

    const progressColor =
        contextUsagePercentage > 90
            ? 'bg-error'
            : contextUsagePercentage > 70
                ? 'bg-warning'
                : 'bg-primary';

    return (
        <header className="chat-workspace-header flex flex-wrap items-center justify-between gap-2 border-b border-base-content/10 bg-base-100/95 px-3 py-1.5 backdrop-blur-md z-30 min-h-[46px]">
            {/* Left Section: Workspace, Git branch, and Session name */}
            <div className="flex items-center gap-2 min-w-0">
                <button
                    type="button"
                    className="btn btn-ghost btn-xs h-7 w-7 p-0 text-base-content/70 hover:text-base-content"
                    title={sidebarToggleLabel}
                    aria-label={sidebarToggleLabel}
                    onClick={onToggleSessionSidebar}
                >
                    {sessionSidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
                </button>

                {/* Workspace Project Folder */}
                <div
                    className="flex items-center gap-1.5 rounded-md border border-base-content/10 bg-base-200/60 px-2 py-0.5 text-xs text-base-content/80"
                    title={currentCwd ?? undefined}
                >
                    <Folder size={12} className="text-primary/80" />
                    <span className="font-medium truncate max-w-[120px] sm:max-w-[160px]">{folderName}</span>
                </div>

                {/* Git Branch Badge */}
                {gitBranch && (
                    <div
                        className="hidden sm:flex items-center gap-1 rounded-md border border-info/20 bg-info/10 px-1.5 py-0.5 text-[11px] text-info font-mono"
                        title={`Branch: ${gitBranch}`}
                    >
                        <GitBranch size={11} />
                        <span className="truncate max-w-[100px]">{gitBranch}</span>
                    </div>
                )}

                {/* Session Title */}
                <div className="hidden md:flex items-center gap-1.5 pl-1 text-xs text-base-content/60 truncate max-w-[200px]">
                    <span className="text-base-content/30">/</span>
                    <span className="truncate font-medium text-base-content/90">
                        {sessionTitle || t('chat.newSession', 'New Chat')}
                    </span>
                </div>
            </div>

            {/* Middle Section: Token Context Gauge */}
            {contextMaxTokens > 0 && (
                <div
                    className="hidden lg:flex items-center gap-2 rounded-lg border border-base-content/10 bg-base-200/40 px-2.5 py-1 text-xs"
                    title={`${contextTokens.toLocaleString()} / ${contextMaxTokens.toLocaleString()} tokens (${contextUsagePercentage.toFixed(1)}%)`}
                >
                    <Cpu size={13} className="text-base-content/60" />
                    <div className="flex flex-col gap-0.5">
                        <div className="flex items-center justify-between gap-2 text-[10px] leading-none text-base-content/70">
                            <span className="font-mono">{formatTokenCount(contextTokens)} / {formatTokenCount(contextMaxTokens)}</span>
                            <span className="font-semibold">{contextUsagePercentage.toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-base-300">
                            <div
                                className={cn('h-full transition-all duration-300', progressColor)}
                                style={{ width: `${Math.min(100, Math.max(2, contextUsagePercentage))}%` }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Right Section: Provider Switcher, Model Switcher, Mode Pill, Status & Actions */}
            <div className="flex items-center gap-1.5">
                {/* Provider Hot-Switcher */}
                <ChatProviderSelector
                    appType={provider as AppType}
                    disabled={isStreaming}
                />

                {/* Model Selector Dropdown */}
                {availableModels.length > 0 && onModelChange && (
                    <div className="dropdown dropdown-end">
                        <div
                            tabIndex={0}
                            role="button"
                            className="btn btn-ghost btn-xs h-7 gap-1 border border-base-content/10 px-2 font-mono text-[11px] font-normal"
                        >
                            <span className="max-w-[110px] truncate">{availableModels.find((m) => m.id === model)?.label || model}</span>
                            <ChevronDown size={11} className="opacity-50" />
                        </div>
                        <ul
                            tabIndex={0}
                            className="dropdown-content menu z-50 mt-1 w-52 rounded-box border border-base-content/15 bg-base-100 p-1 shadow-lg"
                        >
                            {availableModels.map((item) => (
                                <li key={item.id}>
                                    <button
                                        type="button"
                                        onClick={() => onModelChange(item.id)}
                                        className={cn('text-xs', item.id === model && 'active font-medium')}
                                    >
                                        {item.label}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Permission Mode Pill */}
                {onPermissionModeChange && (
                    <div className="dropdown dropdown-end">
                        <div
                            tabIndex={0}
                            role="button"
                            className="btn btn-ghost btn-xs h-7 gap-1 border border-base-content/10 px-2 text-[11px]"
                            title={`Permission Mode: ${MODE_LABELS[permissionMode]}`}
                        >
                            <span className="text-primary">{MODE_ICONS[permissionMode]}</span>
                            <span className="hidden sm:inline">{MODE_LABELS[permissionMode]}</span>
                            <ChevronDown size={11} className="opacity-50" />
                        </div>
                        <ul
                            tabIndex={0}
                            className="dropdown-content menu z-50 mt-1 w-44 rounded-box border border-base-content/15 bg-base-100 p-1 shadow-lg"
                        >
                            {(Object.keys(MODE_LABELS) as PermissionMode[]).map((modeKey) => (
                                <li key={modeKey}>
                                    <button
                                        type="button"
                                        onClick={() => onPermissionModeChange(modeKey)}
                                        className={cn('flex items-center gap-2 text-xs', modeKey === permissionMode && 'active font-medium')}
                                    >
                                        {MODE_ICONS[modeKey]}
                                        <span>{MODE_LABELS[modeKey]}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Daemon Live Status Indicator */}
                <div
                    className="flex items-center gap-1.5 px-1 text-xs"
                    title={daemonDiagnosticDisplayText ?? daemonStatusText}
                >
                    <span className={cn('inline-block h-2 w-2 rounded-full', daemonIndicatorClass)} />
                    {showDaemonReconnect && (
                        <button
                            type="button"
                            className="btn btn-ghost btn-xs h-6 min-h-0 gap-1 px-1.5 text-base-content/60"
                            title={daemonReconnectLabel}
                            aria-label={daemonReconnectLabel}
                            disabled={daemonReconnecting}
                            onClick={onReconnectDaemon}
                        >
                            <RefreshCw size={11} className={daemonReconnecting ? 'animate-spin' : ''} />
                            <span className="hidden xl:inline text-[11px]">{daemonReconnectShortLabel}</span>
                        </button>
                    )}
                </div>

                <div className="divider divider-horizontal mx-0.5 my-1 h-4" />

                {/* Action Buttons: New Session, Clear, SDK Manager */}
                <button
                    type="button"
                    className="btn btn-ghost btn-xs h-7 min-h-0 gap-1 px-2 text-base-content/70 hover:text-base-content"
                    title={newSessionLabel}
                    aria-label={newSessionLabel}
                    onClick={onNewSession}
                >
                    <Plus size={14} />
                    <span className="hidden sm:inline text-xs">{t('chat.new', 'New')}</span>
                </button>

                <button
                    type="button"
                    className="btn btn-ghost btn-xs h-7 min-h-0 gap-1 px-2 text-base-content/70 hover:text-base-content"
                    title={clearChatLabel}
                    aria-label={clearChatLabel}
                    onClick={onClearChat}
                    disabled={!hasMessages || isStreaming}
                >
                    <Trash2 size={13} />
                </button>

                <button
                    type="button"
                    className={cn(
                        'btn btn-ghost btn-xs h-7 min-h-0 gap-1 px-2',
                        sdkMissing ? 'text-warning font-semibold' : 'text-base-content/70 hover:text-base-content'
                    )}
                    title={sdkManageLabel}
                    aria-label={sdkManageLabel}
                    onClick={onOpenSdkModal}
                >
                    <Package size={14} />
                </button>
            </div>
        </header>
    );
};

export default ChatWorkspaceHeader;
