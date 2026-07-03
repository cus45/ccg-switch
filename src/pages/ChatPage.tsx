import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {invoke} from '@tauri-apps/api/core';
import {Package, PanelLeftOpen, RefreshCw, Trash2} from 'lucide-react';
import {useChatStore} from '../stores/useChatStore';
import {useMcpStoreV2} from '../stores/useMcpStoreV2';
import {useSdkStore} from '../stores/useSdkStore';
import SdkDependencyPanel, {getSdkDependencyPanelLabels} from '../components/chat/SdkDependencyPanel';
import AskUserQuestionDialog from '../components/chat/AskUserQuestionDialog';
import PlanApprovalDialog from '../components/chat/PlanApprovalDialog';
import ToolPermissionDialog from '../components/chat/ToolPermissionDialog';
import MessageAnchorRail from '../components/chat/MessageAnchorRail';
import RightDock from '../components/chat/dock/RightDock';
import StatusStrip from '../components/chat/dock/StatusStrip';
import ChatSessionSidebar from '../components/chat/ChatSessionSidebar';
import {ChatPane} from '../components/chat/ChatPane';
import {useChatPaneController} from '../components/chat/useChatPaneController';
import type {ChatWorkspaceProjectOption} from '../components/chat/composer/ContextBar';
import ModalDialog from '../components/common/ModalDialog';
import {
    getActivePermissionDialog,
    getChatTopChromeActionLabel,
    getSdkMissingBannerText,
    shouldIgnoreChatSessionSelection,
} from '../utils/chatUiBehavior';
import {
    canReconnectChatDaemon,
    getChatDaemonDiagnosticDisplayText,
    getChatDaemonDiagnosticText,
    getChatDaemonReconnectLabel,
    getChatDaemonReconnectShortLabel,
    getChatDaemonStatusKind,
    getChatDaemonStatusText,
} from '../utils/chatDaemonStatus';
import {buildChatMcpAvailabilitySummary} from '../utils/chatMcpStatus';
import {
    buildChatMcpConnectivityState,
    type ChatMcpConnectivityState,
    checkChatMcpConnectivity,
    EMPTY_CHAT_MCP_CONNECTIVITY_STATE,
} from '../utils/chatMcpConnectivity';
import {
    type ChatWorkspaceStatus,
    EMPTY_CHAT_WORKSPACE_STATUS,
    loadChatWorkspaceStatus,
} from '../utils/chatWorkspaceStatus';
import {
    type ChatSidebarLayoutState,
    getChatSidebarLayoutActionLabel,
    loadChatSidebarLayoutState,
    saveChatSidebarLayoutState,
} from '../utils/chatSidebarLayout';
import {getSessionSelectionKey, type SessionMeta} from '../types/session';
import type {EditDiffPreviewMode} from '../components/toolBlocks/EditDiffPreview';
import {apply1MContextSuffix, contextWindowFor} from '../components/chat/composer/constants';

/**
 * 交互式对话页 —— 对接 ai-bridge daemon（Claude Code / Codex）。
 *
 * 会话列（转录/搜索/锚点/状态摘要）收敛在 `<ChatPane>` + `useChatPaneController`；
 * 本页保留页面级 chrome（daemon 状态、SDK 依赖、会话侧栏、右侧 dock、权限弹窗）。
 */
export default function ChatPage() {
    const {t} = useTranslation();
    const sdkDependencyLabels = useMemo(() => getSdkDependencyPanelLabels(t), [t]);
    const {
        provider,
        permissionMode,
        model,
        reasoningEffort,
        contextTokens,
        contextMaxTokens,
        longContextEnabled,
        currentCwd,
        activeSession,
        pendingSessionKey,
        lastSessionLoadMetrics,
        daemonReady,
        daemonStatus,
        daemonReconnecting,
        error,
        pendingAskUserQuestion,
        pendingPlanApproval,
        pendingToolPermission,
        activeTabKey,
        init,
        reconnectDaemon,
        clear,
        loadSession,
        setCurrentCwd,
        startNewSession,
        answerAskUserQuestion,
        answerToolPermission,
        approvePlan,
    } = useChatStore();
    const pane = useChatPaneController({tabKey: activeTabKey, bindSearchShortcut: true});

    const [sdkModalOpen, setSdkModalOpen] = useState(false);
    const [sidebarLayoutState, setSidebarLayoutState] = useState(loadChatSidebarLayoutState);
    const [diffViewMode, setDiffViewMode] = useState<EditDiffPreviewMode>('unified');
    const [diffWrapLines, setDiffWrapLines] = useState(true);
    const [workspaceStatus, setWorkspaceStatus] = useState<ChatWorkspaceStatus>(EMPTY_CHAT_WORKSPACE_STATUS);
    const [workspaceProjects, setWorkspaceProjects] = useState<ChatWorkspaceProjectOption[]>([]);
    const [mcpConnectivity, setMcpConnectivity] = useState<ChatMcpConnectivityState>(EMPTY_CHAT_MCP_CONNECTIVITY_STATE);
    const mcpConnectivityRequestRef = useRef(0);
    const mcpConnectivityTargetKeyRef = useRef('');

    const sdkStatuses = useSdkStore((s) => s.statuses);
    const sdkInit = useSdkStore((s) => s.init);
    const mcpServers = useMcpStoreV2((s) => s.servers);
    const mcpLoading = useMcpStoreV2((s) => s.loading);
    const mcpError = useMcpStoreV2((s) => s.error);
    const loadMcpServers = useMcpStoreV2((s) => s.loadServers);

    useEffect(() => {
        void init();
        void sdkInit();
        void loadMcpServers();
    }, [init, loadMcpServers, sdkInit]);

    useEffect(() => {
        let cancelled = false;

        void invoke<Array<{name: string; path: string}>>('get_dashboard_projects')
            .then((projects) => {
                if (cancelled) return;
                setWorkspaceProjects(projects.map((project) => ({
                    name: project.name,
                    path: project.path,
                })));
            })
            .catch((error) => {
                console.error('[ChatPage] load workspace projects failed:', error);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        void loadChatWorkspaceStatus(currentCwd).then((status) => {
            if (!cancelled) {
                setWorkspaceStatus(status);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [currentCwd]);

    // 当前 provider 对应的 SDK 是否已安装。
    const sdkId = provider === 'claude' ? 'claude-sdk' : 'codex-sdk';
    const currentSdk = sdkStatuses.find((s) => s.id === sdkId);
    const sdkMissing = currentSdk ? !currentSdk.installed : false;
    const mcpStatus = useMemo(
        () => buildChatMcpAvailabilitySummary({
            servers: mcpServers,
            provider,
            loading: mcpLoading,
            error: mcpError,
        }),
        [mcpError, mcpLoading, mcpServers, provider],
    );
    const mcpConnectivityTargetIds = useMemo(
        () => mcpStatus.servers.filter((server) => server.enabled).map((server) => server.id),
        [mcpStatus],
    );
    const mcpConnectivityTargetKey = mcpConnectivityTargetIds.join('\n');
    const effectiveModelForContext = provider === 'claude'
        ? apply1MContextSuffix(model, longContextEnabled)
        : model;
    const contextFallbackMaxTokens = contextWindowFor(effectiveModelForContext);
    const contextResolvedMaxTokens = contextMaxTokens && contextMaxTokens > 0
        ? contextMaxTokens
        : contextFallbackMaxTokens;
    const contextUsagePercentage = contextResolvedMaxTokens > 0
        ? (contextTokens / contextResolvedMaxTokens) * 100
        : 0;
    const collapseSessionSidebarLabel = getChatSidebarLayoutActionLabel({
        action: 'collapse-session-sidebar',
        translate: t,
    });
    const expandSessionSidebarLabel = getChatSidebarLayoutActionLabel({
        action: 'expand-session-sidebar',
        translate: t,
    });
    const sessionSidebarCollapsed = sidebarLayoutState.sessionSidebarCollapsed;
    const activePermissionDialog = getActivePermissionDialog({
        hasAskUserQuestion: Boolean(pendingAskUserQuestion),
        askUserQuestionTimestamp: pendingAskUserQuestion?.timestamp ?? null,
        hasPlanApproval: Boolean(pendingPlanApproval),
        planApprovalTimestamp: pendingPlanApproval?.timestamp ?? null,
        hasToolPermission: Boolean(pendingToolPermission),
        toolPermissionTimestamp: pendingToolPermission?.timestamp ?? null,
    });
    const daemonStatusKind = getChatDaemonStatusKind({daemonReady, daemonStatus, daemonReconnecting});
    const showDaemonReconnect = daemonReconnecting
        || canReconnectChatDaemon({daemonReady, daemonStatus, daemonReconnecting});
    const daemonIndicatorClass = daemonStatusKind === 'ready'
        ? 'bg-success'
        : daemonStatusKind === 'offline' || daemonStatusKind === 'error'
            ? 'bg-error'
            : 'bg-warning';
    const daemonStatusText = getChatDaemonStatusText({
        daemonReady,
        daemonStatus,
        daemonReconnecting,
        translate: t,
    });
    const daemonDiagnosticText = getChatDaemonDiagnosticText({
        daemonReady,
        daemonStatus,
        daemonReconnecting,
        error,
    });
    const daemonDiagnosticDisplayText = getChatDaemonDiagnosticDisplayText({
        diagnosticText: daemonDiagnosticText,
        translate: t,
    });
    const daemonReconnectLabel = getChatDaemonReconnectLabel({
        daemonReconnecting,
        translate: t,
    });
    const daemonReconnectShortLabel = getChatDaemonReconnectShortLabel({
        daemonReconnecting,
        translate: t,
    });
    const sdkManageLabel = getChatTopChromeActionLabel({
        action: 'sdk-manage',
        translate: t,
    });
    const clearChatLabel = getChatTopChromeActionLabel({
        action: 'clear-chat',
        translate: t,
    });
    const sdkInstallLabel = getChatTopChromeActionLabel({
        action: 'sdk-install',
        translate: t,
    });
    const sdkMissingBannerText = getSdkMissingBannerText({
        sdkName: currentSdk?.displayName,
        translate: (key, options) => t(key, options),
    });

    useEffect(() => {
        mcpConnectivityTargetKeyRef.current = mcpConnectivityTargetKey;
        mcpConnectivityRequestRef.current += 1;
        setMcpConnectivity(EMPTY_CHAT_MCP_CONNECTIVITY_STATE);
    }, [mcpConnectivityTargetKey]);

    const handleClear = () => {
        pane.resetNavigation();
        void clear();
    };

    const handleSessionSelect = useCallback((session: SessionMeta) => {
        const sessionKey = getSessionSelectionKey(session);
        const activeSessionKey = activeSession ? getSessionSelectionKey(activeSession) : null;
        if (shouldIgnoreChatSessionSelection({
            sessionKey,
            activeSessionKey,
            pendingSessionKey,
        })) {
            return;
        }

        pane.resetNavigation();
        void loadSession(session);
    }, [activeSession, loadSession, pane.resetNavigation, pendingSessionKey]);

    const handleNewSession = useCallback((cwd?: string | null) => {
        pane.resetNavigation();
        void startNewSession(cwd ?? currentCwd);
    }, [currentCwd, pane.resetNavigation, startNewSession]);

    const handleWorkspaceChange = useCallback((nextCwd: string) => {
        pane.resetNavigation();
        setCurrentCwd(nextCwd);
        // 把通过 "Open folder" 选中的目录补进切换器列表，方便下次直接切回，
        // 避免它只能来自 get_dashboard_projects 的历史项目。
        setWorkspaceProjects((current) => {
            const normalized = nextCwd.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
            if (!normalized) return current;
            const exists = current.some(
                (project) => project.path.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase() === normalized,
            );
            if (exists) return current;
            const name = nextCwd.trim().split(/[\\/]+/).filter(Boolean).pop() ?? nextCwd.trim();
            return [{name, path: nextCwd.trim()}, ...current];
        });
    }, [pane.resetNavigation, setCurrentCwd]);

    const handleCheckMcpConnectivity = useCallback(() => {
        if (mcpConnectivityTargetIds.length === 0) return;
        const requestKey = mcpConnectivityTargetKey;
        const requestId = ++mcpConnectivityRequestRef.current;

        setMcpConnectivity((current) => buildChatMcpConnectivityState({
            checking: true,
            checkedAt: current.checkedAt,
            error: null,
            results: Object.values(current.resultByServerId),
        }));

        void checkChatMcpConnectivity(mcpConnectivityTargetIds)
            .then((results) => {
                if (
                    requestId !== mcpConnectivityRequestRef.current
                    || requestKey !== mcpConnectivityTargetKeyRef.current
                ) {
                    return;
                }
                setMcpConnectivity(buildChatMcpConnectivityState({
                    checking: false,
                    checkedAt: Date.now(),
                    error: null,
                    results,
                }));
            })
            .catch((error) => {
                if (
                    requestId !== mcpConnectivityRequestRef.current
                    || requestKey !== mcpConnectivityTargetKeyRef.current
                ) {
                    return;
                }
                setMcpConnectivity((current) => buildChatMcpConnectivityState({
                    checking: false,
                    checkedAt: Date.now(),
                    error: String(error),
                    results: Object.values(current.resultByServerId),
                }));
            });
    }, [mcpConnectivityTargetIds, mcpConnectivityTargetKey]);

    const updateSidebarLayoutState = useCallback((
        resolveNextState: (current: ChatSidebarLayoutState) => ChatSidebarLayoutState,
    ) => {
        setSidebarLayoutState((current) => {
            const next = resolveNextState(current);
            saveChatSidebarLayoutState(next);
            return next;
        });
    }, []);

    const setSessionSidebarCollapsed = useCallback((collapsed: boolean) => {
        updateSidebarLayoutState((current) => ({
            ...current,
            sessionSidebarCollapsed: collapsed,
        }));
    }, [updateSidebarLayoutState]);

    return (
        <div className="flex flex-col h-full">
            {/* 头部：daemon 状态 + 依赖 + 清空 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-base-300">
                <div className="flex items-center gap-1.5 text-xs" title={daemonDiagnosticDisplayText ?? daemonStatusText}>
                    <span
                        className={`inline-block w-2 h-2 rounded-full ${daemonIndicatorClass}`}
                    />
                    <span className="text-base-content/60">
                        {daemonStatusText}
                    </span>
                    {showDaemonReconnect && (
                        <button
                            type="button"
                            className="btn btn-ghost btn-xs h-6 min-h-0 gap-1 px-2 text-base-content/55"
                            title={daemonReconnectLabel}
                            aria-label={daemonReconnectLabel}
                            disabled={daemonReconnecting}
                            onClick={() => void reconnectDaemon()}
                        >
                            <RefreshCw size={12} className={daemonReconnecting ? 'animate-spin' : ''} />
                            {daemonReconnectShortLabel}
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        className={`btn btn-ghost btn-sm ${sdkMissing ? 'text-warning' : ''}`}
                        onClick={() => setSdkModalOpen(true)}
                    >
                        <Package size={16}/>
                        {sdkManageLabel}
                    </button>
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={handleClear}
                        disabled={!pane.hasMessages}
                    >
                        <Trash2 size={16}/>
                        {clearChatLabel}
                    </button>
                </div>
            </div>

            {/* 缺少 SDK 提示条 */}
            {sdkMissing && (
                <div className="px-4 pt-3">
                    <div className="alert alert-warning py-2 text-sm flex items-center justify-between">
                        <span>{sdkMissingBannerText}</span>
                        <button
                            className="btn btn-sm btn-warning"
                            onClick={() => setSdkModalOpen(true)}
                        >
                            {sdkInstallLabel}
                        </button>
                    </div>
                </div>
            )}

            {/* 消息区：预留 cc-gui 风格的搜索、锚点和状态扩展槽 */}
            <div className="chat-workspace-surface relative flex min-h-0 flex-1 overflow-hidden">
                {sessionSidebarCollapsed ? (
                    <div className="chat-session-sidebar-collapsed-rail hidden lg:flex">
                        <button
                            type="button"
                            className="chat-sidebar-toggle-button"
                            title={expandSessionSidebarLabel}
                            aria-label={expandSessionSidebarLabel}
                            onClick={() => setSessionSidebarCollapsed(false)}
                        >
                            <PanelLeftOpen size={15} />
                        </button>
                    </div>
                ) : (
                    <div className="chat-session-sidebar-shell">
                        <ChatSessionSidebar
                            activeSession={activeSession}
                            currentCwd={currentCwd}
                            pendingSessionKey={pendingSessionKey}
                            onSessionSelect={handleSessionSelect}
                            onNewSession={handleNewSession}
                            onCollapse={() => setSessionSidebarCollapsed(true)}
                            collapseLabel={collapseSessionSidebarLabel}
                        />
                    </div>
                )}

                <MessageAnchorRail
                    hasMessages={pane.hasMessages}
                    anchors={pane.anchorItems}
                    activeAnchorId={pane.activeAnchorId}
                    activeAnchorLabel={pane.activeAnchorLabel}
                    containerRef={pane.scrollRef}
                    messageNodeMap={pane.messageNodeMapRef}
                    onActiveAnchorChange={pane.setActiveAnchorId}
                    onScrollToTop={pane.scrollToTop}
                    onScrollToBottom={pane.scrollToBottom}
                />

                <div className="chat-review-layout">
                    <ChatPane
                        controller={pane}
                        variant="main"
                        sdkMissing={sdkMissing}
                        onSdkMissing={() => setSdkModalOpen(true)}
                        mcpStatus={mcpStatus}
                        workspaceProjects={workspaceProjects}
                        onWorkspaceChange={handleWorkspaceChange}
                        workspaceStatus={workspaceStatus}
                        onWorkspaceStatusChange={setWorkspaceStatus}
                    />

                    <div className="hidden xl:contents">
                        <RightDock
                            currentCwd={currentCwd}
                            gitRoot={workspaceStatus.gitRoot}
                            allEdits={pane.statusSummary.allEdits}
                            diffViewMode={diffViewMode}
                            onDiffViewModeChange={setDiffViewMode}
                            diffWrapLines={diffWrapLines}
                            onDiffWrapLinesChange={setDiffWrapLines}
                            statusStrip={(
                                <StatusStrip
                                    daemonIndicatorClass={daemonIndicatorClass}
                                    daemonStatusText={daemonStatusText}
                                    daemonDiagnosticText={daemonDiagnosticDisplayText}
                                    contextPercentage={contextUsagePercentage}
                                    contextUsedTokens={contextTokens}
                                    contextMaxTokens={contextResolvedMaxTokens}
                                    provider={provider}
                                    messageCount={pane.renderableMessageCount}
                                    daemonReady={daemonReady}
                                    model={model}
                                    permissionMode={permissionMode}
                                    reasoningEffort={reasoningEffort}
                                    sdkStatus={currentSdk ?? null}
                                    daemonStatus={daemonStatus}
                                    daemonReconnecting={daemonReconnecting}
                                    daemonError={error}
                                    mcpStatus={mcpStatus}
                                    mcpConnectivity={mcpConnectivity}
                                    sessionLoadMetrics={lastSessionLoadMetrics}
                                    anchorCount={pane.anchorCount}
                                    activeAnchorLabel={pane.activeAnchorLabel}
                                    currentCwd={currentCwd}
                                    isStreaming={pane.isStreaming}
                                    statusSummary={pane.statusSummary}
                                    onSelectTool={pane.handleSelectStatusTool}
                                    onReconnectDaemon={() => void reconnectDaemon()}
                                    onCheckMcpConnectivity={handleCheckMcpConnectivity}
                                />
                            )}
                        />
                    </div>
                </div>
            </div>

            {/* 错误提示 */}
            {error && (
                <div className="px-4 pb-2">
                    <div className="alert alert-error py-2 text-sm">{error}</div>
                </div>
            )}

            {/* SDK 依赖管理弹窗 */}
            <ModalDialog
                isOpen={sdkModalOpen}
                title={sdkDependencyLabels.title}
                maxWidthClass="max-w-xl"
                confirmText={sdkDependencyLabels.close}
                cancelText={sdkDependencyLabels.cancel}
                onConfirm={() => setSdkModalOpen(false)}
                onCancel={() => setSdkModalOpen(false)}
                onClose={() => setSdkModalOpen(false)}
            >
                <SdkDependencyPanel/>
            </ModalDialog>

            {/* AskUserQuestion 权限请求弹窗 */}
            {activePermissionDialog === 'ask-user-question' && pendingAskUserQuestion && (
                <AskUserQuestionDialog
                    request={pendingAskUserQuestion}
                    onAnswer={(answers) =>
                        answerAskUserQuestion(pendingAskUserQuestion.requestId, answers)
                    }
                    onCancel={() => answerAskUserQuestion(pendingAskUserQuestion.requestId, {})}
                />
            )}

            {/* PlanApproval 权限请求弹窗 */}
            {activePermissionDialog === 'plan-approval' && pendingPlanApproval && (
                <PlanApprovalDialog
                    request={pendingPlanApproval}
                    onApprove={(approved, targetMode) =>
                        approvePlan(pendingPlanApproval.requestId, approved, targetMode)
                    }
                    onCancel={() => approvePlan(pendingPlanApproval.requestId, false, 'default')}
                />
            )}

            {/* 普通工具权限请求弹窗 */}
            {activePermissionDialog === 'tool-permission' && pendingToolPermission && (
                <ToolPermissionDialog
                    request={pendingToolPermission}
                    onAnswer={(allow) => answerToolPermission(pendingToolPermission.requestId, allow)}
                />
            )}
        </div>
    );
}
