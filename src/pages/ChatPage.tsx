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
import MessageList from '../components/chat/MessageList';
import ConversationSearch from '../components/chat/ConversationSearch';
import MessageAnchorRail from '../components/chat/MessageAnchorRail';
import ScrollControl from '../components/chat/ScrollControl';
import RightDock from '../components/chat/dock/RightDock';
import StatusStrip from '../components/chat/dock/StatusStrip';
import ChatInputStatusTabs from '../components/chat/ChatInputStatusTabs';
import ChatSessionSidebar from '../components/chat/ChatSessionSidebar';
import ChatSessionTabs from '../components/chat/ChatSessionTabs';
import type {ChatWorkspaceProjectOption} from '../components/chat/composer/ContextBar';
import {ChatComposer} from '../components/chat/composer/ChatComposer';
import ModalDialog from '../components/common/ModalDialog';
import {
    getActivePermissionDialog,
    getChatTopChromeActionLabel,
    getCollapsedMessageWindow,
    getSdkMissingBannerText,
    highlightTranscriptToolAnchor,
    shouldBuildCompleteChatStatusSummary,
    shouldIgnoreChatSessionSelection,
    shouldRequestFullHistoryForSearch,
    VISIBLE_MESSAGE_WINDOW,
} from '../utils/chatUiBehavior';
import {
    buildChatStatusSummary,
    type ChatStatusEditSummary,
    type ChatStatusSummary,
    type ChatStatusToolSummary,
    getChatStatusEditKey,
    mergeChatInputStatusSummary,
} from '../utils/chatStatusSummary';
import {
    filterRenderableMessages,
    getAnchorPreview,
    getRecentRenderableMessages,
    getRenderableMessages,
    getSearchStatusContextMessages,
    isMessageAnchorCandidate,
} from '../utils/chatNavigation';
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
import type {ChatMessage} from '../types/chat';
import type {EditDiffPreviewMode} from '../components/toolBlocks/EditDiffPreview';
import {apply1MContextSuffix, contextWindowFor} from '../components/chat/composer/constants';

const BOTTOM_REVEAL_THRESHOLD = 160;

function findToolAnchorElement(root: HTMLElement, toolId: string): HTMLElement | null {
    const candidates = root.querySelectorAll<HTMLElement>('[data-chat-tool-id], [data-chat-tool-ids]');

    for (const candidate of candidates) {
        if (candidate.dataset.chatToolId === toolId) return candidate;
        const groupedToolIds = candidate.dataset.chatToolIds?.split(/\s+/).filter(Boolean) ?? [];
        if (groupedToolIds.includes(toolId)) return candidate;
    }

    return null;
}

interface FullHistorySearchState {
    sessionKey: string;
    status: 'loading' | 'complete' | 'error';
    messages: ChatMessage[] | null;
    error: string | null;
}
/**
 * 交互式对话页 —— 对接 ai-bridge daemon（Claude Code / Codex）。
 *
 * 这是集成的最小可用前端：发送消息、流式渲染回复、中止、清空。
 * 工具调用可视化、Diff、权限审批将在后续任务中补充。
 */
export default function ChatPage() {
    const {t} = useTranslation();
    const sdkDependencyLabels = useMemo(() => getSdkDependencyPanelLabels(t), [t]);
    const {
        messages,
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
        openTabs,
        activeTabKey,
        init,
        reconnectDaemon,
        clear,
        loadSession,
        loadActiveSessionFullHistory,
        expandActiveSessionHistory,
        focusTab,
        closeTab,
        closeOtherTabs,
        closeAllTabs,
        setCurrentCwd,
        startNewSession,
        answerAskUserQuestion,
        answerToolPermission,
        approvePlan,
    } = useChatStore();

    const [sdkModalOpen, setSdkModalOpen] = useState(false);
    const [isNearBottom, setIsNearBottom] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedAnchorCount, setCollapsedAnchorCount] = useState<number | null>(null);
    const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
    const [sidebarLayoutState, setSidebarLayoutState] = useState(loadChatSidebarLayoutState);
    const [selectedEditKey, setSelectedEditKey] = useState<string | null>(null);
    const [diffViewMode, setDiffViewMode] = useState<EditDiffPreviewMode>('unified');
    const [diffWrapLines, setDiffWrapLines] = useState(true);
    const [workspaceStatus, setWorkspaceStatus] = useState<ChatWorkspaceStatus>(EMPTY_CHAT_WORKSPACE_STATUS);
    const [workspaceProjects, setWorkspaceProjects] = useState<ChatWorkspaceProjectOption[]>([]);
    const [fullHistorySearchRetryCount, setFullHistorySearchRetryCount] = useState(0);
    const [completeStatusSummaryState, setCompleteStatusSummaryState] = useState<{
        key: string;
        summary: ChatStatusSummary;
    } | null>(null);
    const [fullHistorySearchState, setFullHistorySearchState] = useState<FullHistorySearchState | null>(null);
    const [mcpConnectivity, setMcpConnectivity] = useState<ChatMcpConnectivityState>(EMPTY_CHAT_MCP_CONNECTIVITY_STATE);
    const scrollRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const fullHistorySearchStateRef = useRef<FullHistorySearchState | null>(null);
    const isNearBottomRef = useRef(true);
    const messageNodeMapRef = useRef<Map<string, HTMLElement>>(new Map());
    const toolAnchorHighlightCleanupRef = useRef<(() => void) | null>(null);
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

    useEffect(() => () => {
        toolAnchorHighlightCleanupRef.current?.();
    }, []);

    const updateBottomState = useCallback(() => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;

        const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
        const nextIsNearBottom = distanceFromBottom < BOTTOM_REVEAL_THRESHOLD;
        isNearBottomRef.current = nextIsNearBottom;
        setIsNearBottom(nextIsNearBottom);
    }, []);

    useEffect(() => {
        const scrollEl = scrollRef.current;
        if (!scrollEl || !isNearBottomRef.current) return;

        requestAnimationFrame(() => {
            scrollEl.scrollTo({top: scrollEl.scrollHeight, behavior: 'smooth'});
        });
    }, [messages]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault();
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // 当前 provider 对应的 SDK 是否已安装。
    const sdkId = provider === 'claude' ? 'claude-sdk' : 'codex-sdk';
    const currentSdk = sdkStatuses.find((s) => s.id === sdkId);
    const sdkMissing = currentSdk ? !currentSdk.installed : false;
    const hasMessages = messages.length > 0;
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();
    const isSearchingTranscript = normalizedSearchQuery.length > 0;
    const activeSessionKey = useMemo(
        () => activeSession ? getSessionSelectionKey(activeSession) : null,
        [activeSession],
    );
    const activeFullHistorySearchState = fullHistorySearchState?.sessionKey === activeSessionKey
        ? fullHistorySearchState
        : null;
    const fullHistorySearchMessages = activeFullHistorySearchState?.status === 'complete'
        ? activeFullHistorySearchState.messages
        : null;
    const fullHistorySearchStatus = isSearchingTranscript
        && activeSessionKey
        && lastSessionLoadMetrics?.status === 'windowed'
        ? (activeFullHistorySearchState?.status ?? 'loading')
        : null;
    const searchSourceMessages = isSearchingTranscript && fullHistorySearchMessages
        ? fullHistorySearchMessages
        : messages;
    const hasEarlierServerHistory = !isSearchingTranscript
        && lastSessionLoadMetrics?.status === 'windowed';
    const isLoadingEarlierServerHistory = !isSearchingTranscript
        && lastSessionLoadMetrics?.status === 'loading';
    const baseNavigationWindow = useMemo(() => {
        if (isSearchingTranscript) return null;
        return getRecentRenderableMessages(messages, VISIBLE_MESSAGE_WINDOW);
    }, [isSearchingTranscript, messages]);
    const searchCollapsedWindow = useMemo(() => {
        if (!isSearchingTranscript) return null;
        const allRenderableMessages = getRenderableMessages(searchSourceMessages);
        return {
            renderableMessages: allRenderableMessages,
            window: getCollapsedMessageWindow({
                filteredCount: allRenderableMessages.length,
                revealedCount: 0,
                isSearching: true,
            }),
        };
    }, [isSearchingTranscript, searchSourceMessages]);
    const totalEarlierMessages = isSearchingTranscript
        ? (searchCollapsedWindow?.window.totalEarlierMessages ?? 0)
        : (baseNavigationWindow?.hiddenRenderableCount ?? 0);
    const clampedCollapsedAnchorCount = Math.min(
        collapsedAnchorCount ?? totalEarlierMessages,
        totalEarlierMessages,
    );
    const visibleNavigationCount = baseNavigationWindow
        ? Math.max(
            VISIBLE_MESSAGE_WINDOW,
            baseNavigationWindow.totalRenderableCount - clampedCollapsedAnchorCount,
        )
        : 0;
    const renderableMessages = useMemo(() => {
        if (isSearchingTranscript) return searchCollapsedWindow?.renderableMessages ?? [];
        if (!baseNavigationWindow) return [];
        if (visibleNavigationCount <= baseNavigationWindow.renderableMessages.length) {
            return baseNavigationWindow.renderableMessages;
        }
        return getRecentRenderableMessages(messages, visibleNavigationCount).renderableMessages;
    }, [
        baseNavigationWindow,
        isSearchingTranscript,
        messages,
        searchCollapsedWindow,
        visibleNavigationCount,
    ]);
    const filteredMessages = useMemo(
        () => (
            isSearchingTranscript
                ? filterRenderableMessages(renderableMessages, normalizedSearchQuery)
                : renderableMessages
        ),
        [isSearchingTranscript, normalizedSearchQuery, renderableMessages],
    );
    const renderableMessageCount = isSearchingTranscript
        ? renderableMessages.length
        : (baseNavigationWindow?.totalRenderableCount ?? renderableMessages.length);
    const visibleAnchorMessages = filteredMessages;
    const anchorItems = useMemo(() => {
        const userMessages = visibleAnchorMessages.filter(({ message }) => isMessageAnchorCandidate(message));

        return userMessages.map(({ message }, index) => {
            const preview = getAnchorPreview(message, t('chat.layout.anchorRail'));
            return {
                id: message.id,
                label: preview.label,
                kind: preview.kind,
                sequence: index + 1,
                total: userMessages.length,
                createdAt: message.createdAt,
            };
        });
    }, [t, visibleAnchorMessages]);
    const anchorCount = anchorItems.length;
    const isStreaming = useMemo(
        () => messages.some((message) => Boolean(message.streaming)),
        [messages],
    );
    const statusMessages = useMemo(() => {
        if (isSearchingTranscript) {
            return getSearchStatusContextMessages(searchSourceMessages, filteredMessages);
        }
        const firstVisibleIndex = renderableMessages[0]?.originalIndex ?? messages.length;
        return messages.slice(firstVisibleIndex);
    }, [filteredMessages, isSearchingTranscript, messages, renderableMessages, searchSourceMessages]);
    const statusSummary = useMemo(
        () => buildChatStatusSummary(statusMessages),
        [statusMessages],
    );
    const transcriptStatusKey = useMemo(() => {
        const firstMessage = messages[0];
        const lastMessage = messages[messages.length - 1];
        return `${messages.length}:${firstMessage?.id ?? ''}:${lastMessage?.id ?? ''}`;
    }, [messages]);
    const completeStatusSummary = completeStatusSummaryState?.key === transcriptStatusKey
        ? completeStatusSummaryState.summary
        : null;
    const inputStatusSummary = useMemo(
        () => mergeChatInputStatusSummary(statusSummary, completeStatusSummary),
        [completeStatusSummary, statusSummary],
    );
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
    const selectedEdit = useMemo<ChatStatusEditSummary | undefined>(() => {
        const allEdits = statusSummary.allEdits;
        if (allEdits.length === 0) return undefined;
        if (!selectedEditKey) return allEdits[0];
        return allEdits.find((edit) => getChatStatusEditKey(edit) === selectedEditKey) ?? allEdits[0];
    }, [selectedEditKey, statusSummary.allEdits]);
    const activeSelectedEditKey = selectedEdit ? getChatStatusEditKey(selectedEdit) : null;
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
    const activeAnchorLabel = useMemo(
        () => {
            const activeAnchor = anchorItems.find((anchor) => anchor.id === activeAnchorId);
            if (activeAnchor) return activeAnchor.label;
            if (anchorItems.length === 0) return undefined;

            const fallbackAnchor = isNearBottom
                ? anchorItems[anchorItems.length - 1]
                : anchorItems[0];
            return fallbackAnchor?.label;
        },
        [activeAnchorId, anchorItems, isNearBottom],
    );
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
        fullHistorySearchStateRef.current = fullHistorySearchState;
    }, [fullHistorySearchState]);

    useEffect(() => {
        if (!isSearchingTranscript) {
            setFullHistorySearchState(null);
            return;
        }
        if (!shouldRequestFullHistoryForSearch({
            isSearching: isSearchingTranscript,
            activeSessionKey,
            sessionLoadStatus: lastSessionLoadMetrics?.status ?? null,
            fullHistorySearchSessionKey: fullHistorySearchStateRef.current?.sessionKey ?? null,
            fullHistorySearchStatus: fullHistorySearchStateRef.current?.status ?? null,
        })) {
            return;
        }

        let cancelled = false;
        const searchSessionKey = activeSessionKey;
        if (!searchSessionKey) return;
        setFullHistorySearchState({
            sessionKey: searchSessionKey,
            status: 'loading',
            messages: null,
            error: null,
        });

        void loadActiveSessionFullHistory()
            .then((fullHistoryMessages) => {
                if (cancelled) return;
                if (fullHistoryMessages) {
                    setFullHistorySearchState({
                        sessionKey: searchSessionKey,
                        status: 'complete',
                        messages: fullHistoryMessages,
                        error: null,
                    });
                    return;
                }
                setFullHistorySearchState({
                    sessionKey: searchSessionKey,
                    status: 'error',
                    messages: null,
                    error: 'full-history-load-failed',
                });
            })
            .catch((error) => {
                if (cancelled) return;
                setFullHistorySearchState({
                    sessionKey: searchSessionKey,
                    status: 'error',
                    messages: null,
                    error: String(error),
                });
            });

        return () => {
            cancelled = true;
        };
    }, [
        activeSessionKey,
        fullHistorySearchRetryCount,
        isSearchingTranscript,
        lastSessionLoadMetrics?.status,
        loadActiveSessionFullHistory,
    ]);

    useEffect(() => {
        if (!shouldBuildCompleteChatStatusSummary({
            messageCount: messages.length,
            isSearching: isSearchingTranscript,
            sessionLoadStatus: lastSessionLoadMetrics?.status ?? null,
        })) {
            setCompleteStatusSummaryState(null);
            return;
        }

        let cancelled = false;
        setCompleteStatusSummaryState(null);

        const buildCompleteStatusSummary = () => {
            if (cancelled) return;
            setCompleteStatusSummaryState({
                key: transcriptStatusKey,
                summary: buildChatStatusSummary(messages),
            });
        };

        if (window.requestIdleCallback) {
            const idleHandle = window.requestIdleCallback(buildCompleteStatusSummary, {timeout: 800});
            return () => {
                cancelled = true;
                window.cancelIdleCallback(idleHandle);
            };
        }

        const timeoutHandle = window.setTimeout(buildCompleteStatusSummary, 0);
        return () => {
            cancelled = true;
            window.clearTimeout(timeoutHandle);
        };
    }, [isSearchingTranscript, lastSessionLoadMetrics?.status, messages, transcriptStatusKey]);

    useEffect(() => {
        mcpConnectivityTargetKeyRef.current = mcpConnectivityTargetKey;
        mcpConnectivityRequestRef.current += 1;
        setMcpConnectivity(EMPTY_CHAT_MCP_CONNECTIVITY_STATE);
    }, [mcpConnectivityTargetKey]);

    useEffect(() => {
        if (activeAnchorId && !anchorItems.some((anchor) => anchor.id === activeAnchorId)) {
            setActiveAnchorId(null);
        }
    }, [activeAnchorId, anchorItems]);

    const handleMessageNodeRef = useCallback((messageId: string, node: HTMLElement | null) => {
        if (node) {
            messageNodeMapRef.current.set(messageId, node);
            return;
        }

        messageNodeMapRef.current.delete(messageId);
    }, []);

    const resetConversationNavigation = useCallback(() => {
        setSearchQuery('');
        setCollapsedAnchorCount(null);
        setActiveAnchorId(null);
        messageNodeMapRef.current.clear();
        isNearBottomRef.current = true;
        setIsNearBottom(true);
    }, []);

    const handleSearchChange = useCallback((value: string) => {
        setSearchQuery(value);
        setActiveAnchorId(null);

        if (value.trim()) {
            requestAnimationFrame(() => {
                scrollRef.current?.scrollTo({top: 0, behavior: 'smooth'});
            });
        }
    }, []);

    const handleRetryFullHistorySearch = useCallback(() => {
        fullHistorySearchStateRef.current = null;
        setFullHistorySearchState(null);
        setFullHistorySearchRetryCount((count) => count + 1);
    }, []);

    const handleLoadEarlierServerHistory = useCallback(() => {
        void expandActiveSessionHistory();
    }, [expandActiveSessionHistory]);

    const handleSelectStatusTool = useCallback((tool: ChatStatusToolSummary) => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;

        const anchor = findToolAnchorElement(scrollEl, tool.toolId);
        if (!anchor) return;

        anchor.scrollIntoView({behavior: 'smooth', block: 'center'});
        anchor.focus({preventScroll: true});
        toolAnchorHighlightCleanupRef.current = highlightTranscriptToolAnchor(anchor, {
            previousCleanup: toolAnchorHighlightCleanupRef.current,
        });
        requestAnimationFrame(updateBottomState);
    }, [updateBottomState]);

    const handleClear = () => {
        resetConversationNavigation();
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

        resetConversationNavigation();
        void loadSession(session);
    }, [activeSession, loadSession, pendingSessionKey, resetConversationNavigation]);

    const handleNewSession = useCallback((cwd?: string | null) => {
        resetConversationNavigation();
        void startNewSession(cwd ?? currentCwd);
    }, [currentCwd, resetConversationNavigation, startNewSession]);

    const handleWorkspaceChange = useCallback((nextCwd: string) => {
        resetConversationNavigation();
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
    }, [resetConversationNavigation, setCurrentCwd]);

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

    const handleSelectedEditChange = useCallback((edit: ChatStatusEditSummary) => {
        setSelectedEditKey(getChatStatusEditKey(edit));
    }, []);

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

    const scrollToBottom = () => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;

        scrollEl.scrollTo({top: scrollEl.scrollHeight, behavior: 'smooth'});
        isNearBottomRef.current = true;
        setIsNearBottom(true);
    };

    const scrollToTop = () => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;

        scrollEl.scrollTo({top: 0, behavior: 'smooth'});
        isNearBottomRef.current = false;
        setIsNearBottom(false);
    };

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
                        disabled={messages.length === 0}
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
                    hasMessages={hasMessages}
                    anchors={anchorItems}
                    activeAnchorId={activeAnchorId}
                    activeAnchorLabel={activeAnchorLabel}
                    containerRef={scrollRef}
                    messageNodeMap={messageNodeMapRef}
                    onActiveAnchorChange={setActiveAnchorId}
                    onScrollToTop={scrollToTop}
                    onScrollToBottom={scrollToBottom}
                />

                <div className="chat-review-layout">
                    <section
                        className="chat-conversation-pane"
                        style={{flex: '1 1 0%'}}
                    >
                        <ChatSessionTabs
                            tabs={openTabs}
                            activeTabKey={activeTabKey}
                            onFocusTab={focusTab}
                            onCloseTab={closeTab}
                            onCloseOtherTabs={closeOtherTabs}
                            onCloseAllTabs={closeAllTabs}
                        />
                        <ConversationSearch ref={searchInputRef} value={searchQuery} onChange={handleSearchChange} />

                        <div
                            ref={scrollRef}
                            className="flex-1 scroll-pb-8 overflow-y-auto px-2 py-3 sm:px-3"
                            onScroll={updateBottomState}
                        >
                            {!hasMessages && (
                                <div className="flex h-full flex-col items-center justify-center text-base-content/40">
                                    <p className="text-sm">{t('chat.empty')}</p>
                                </div>
                            )}
                            <MessageList
                                messages={searchSourceMessages}
                                searchQuery={searchQuery}
                                fullHistorySearchStatus={fullHistorySearchStatus}
                                scrollContainerRef={scrollRef}
                                onCollapsedCountChange={setCollapsedAnchorCount}
                                onMessageNodeRef={handleMessageNodeRef}
                                onRetryFullHistorySearch={handleRetryFullHistorySearch}
                                hasEarlierServerHistory={hasEarlierServerHistory}
                                isLoadingEarlierServerHistory={isLoadingEarlierServerHistory}
                                onLoadEarlierServerHistory={handleLoadEarlierServerHistory}
                            />
                        </div>

                        <ScrollControl
                            visible={hasMessages && !isNearBottom}
                            onScrollToBottom={scrollToBottom}
                        />

                        {/* 发送控制台：约束在中间对话列，避免横跨会话栏/状态栏 */}
                        <ChatInputStatusTabs
                            statusSummary={inputStatusSummary}
                            isStreaming={isStreaming}
                            selectedEditKey={activeSelectedEditKey}
                            onSelectedEditChange={handleSelectedEditChange}
                            onSelectTool={handleSelectStatusTool}
                            mcpStatus={mcpStatus}
                            collapseStatusTabsOnDesktop
                        />
                        <ChatComposer
                            sdkMissing={sdkMissing}
                            onSdkMissing={() => setSdkModalOpen(true)}
                            cwd={currentCwd ?? undefined}
                            workspaceProjects={workspaceProjects}
                            onWorkspaceChange={handleWorkspaceChange}
                            workspaceStatus={workspaceStatus}
                            onWorkspaceStatusChange={setWorkspaceStatus}
                        />
                    </section>

                    <div className="hidden xl:contents">
                        <RightDock
                            currentCwd={currentCwd}
                            gitRoot={workspaceStatus.gitRoot}
                            allEdits={statusSummary.allEdits}
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
                                    messageCount={renderableMessageCount}
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
                                    anchorCount={anchorCount}
                                    activeAnchorLabel={activeAnchorLabel}
                                    currentCwd={currentCwd}
                                    isStreaming={isStreaming}
                                    statusSummary={statusSummary}
                                    onSelectTool={handleSelectStatusTool}
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
