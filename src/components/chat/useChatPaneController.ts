import {
    type Dispatch,
    type RefObject,
    type SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {useTranslation} from 'react-i18next';
import {type ChatTabView, useChatStore, useChatTab} from '../../stores/useChatStore';
import {
    getCollapsedMessageWindow,
    highlightTranscriptToolAnchor,
    shouldBuildCompleteChatStatusSummary,
    shouldRequestFullHistoryForSearch,
    VISIBLE_MESSAGE_WINDOW,
} from '../../utils/chatUiBehavior';
import {
    buildChatStatusSummary,
    type ChatStatusEditSummary,
    type ChatStatusSummary,
    type ChatStatusToolSummary,
    getChatStatusEditKey,
    mergeChatInputStatusSummary,
} from '../../utils/chatStatusSummary';
import {
    type AnchorPreviewKind,
    filterRenderableMessages,
    getAnchorPreview,
    getRecentRenderableMessages,
    getRenderableMessages,
    getSearchStatusContextMessages,
    isMessageAnchorCandidate,
} from '../../utils/chatNavigation';
import {
    isFollowDetachIntent,
    isNearBottom as isNearBottomMetrics,
    nextUnreadCount,
    resolveFollowScrollBehavior,
} from '../../utils/chatScrollFollow';
import {getSessionSelectionKey} from '../../types/session';
import type {ChatMessage} from '../../types/chat';

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

/** 与 MessageAnchorRail 的 anchor item 结构等价（该类型未导出）。 */
export interface ChatPaneAnchorItem {
    id: string;
    label: string;
    kind?: AnchorPreviewKind;
    sequence: number;
    total: number;
    createdAt?: number;
}

type ChatPaneView = Pick<
    ChatTabView,
    'messages' | 'provider' | 'currentCwd' | 'activeSession' | 'lastSessionLoadMetrics' | 'error' | 'activeRequestId'
>;

export interface ChatPaneControllerOptions {
    /** 绑定的会话 tab；null/未命中时回退全局活跃投影（与重构前 ChatPage 行为一致）。 */
    tabKey: string | null;
    /** 是否绑定 Ctrl/Cmd+F 聚焦搜索。仅主聊天开启，避免多面板抢同一快捷键。 */
    bindSearchShortcut?: boolean;
}

/**
 * 会话列（转录/搜索/锚点/状态摘要/滚动）的状态控制器，按 `tabKey` 作用域。
 *
 * 从 ChatPage 原地提取：`<ChatPane>` 用它渲染会话列；ChatPage 继续用同一实例
 * 喂右侧 dock（StatusStrip / ReviewPanel 需要 statusSummary、锚点等转录派生数据），
 * 避免双份计算。侧边聊天（Stage D）自行创建独立实例。
 */
export interface ChatPaneController {
    tabKey: string | null;
    // 会话切片
    messages: ChatMessage[];
    provider: ChatTabView['provider'];
    currentCwd: string | null;
    /** 该 tab 的最近错误（发送失败/回合失败）；侧聊 pane 就地展示。 */
    error: string | null;
    hasMessages: boolean;
    isStreaming: boolean;
    /** 该 tab 进行中的 requestId（卡死提示轮询活动时间用） */
    activeRequestId: string | null;
    // 转录搜索
    searchQuery: string;
    searchInputRef: RefObject<HTMLInputElement | null>;
    handleSearchChange: (value: string) => void;
    searchSourceMessages: ChatMessage[];
    fullHistorySearchStatus: 'loading' | 'complete' | 'error' | null;
    handleRetryFullHistorySearch: () => void;
    // 滚动
    scrollRef: RefObject<HTMLDivElement | null>;
    isNearBottom: boolean;
    /** 脱离底部跟随后累积的新增消息数，供「回到底部」按钮显示角标。 */
    unreadCount: number;
    updateBottomState: () => void;
    scrollToBottom: () => void;
    scrollToTop: () => void;
    // 服务端历史窗口
    hasEarlierServerHistory: boolean;
    isLoadingEarlierServerHistory: boolean;
    handleLoadEarlierServerHistory: () => void;
    // 锚点导航
    anchorItems: ChatPaneAnchorItem[];
    anchorCount: number;
    activeAnchorId: string | null;
    setActiveAnchorId: (anchorId: string | null) => void;
    activeAnchorLabel: string | undefined;
    messageNodeMapRef: RefObject<Map<string, HTMLElement>>;
    handleMessageNodeRef: (messageId: string, node: HTMLElement | null) => void;
    setCollapsedAnchorCount: Dispatch<SetStateAction<number | null>>;
    // 状态摘要（输入区 tabs + dock StatusStrip/ReviewPanel 共用）
    statusSummary: ChatStatusSummary;
    inputStatusSummary: ChatStatusSummary;
    renderableMessageCount: number;
    activeSelectedEditKey: string | null;
    handleSelectedEditChange: (edit: ChatStatusEditSummary) => void;
    handleSelectStatusTool: (tool: ChatStatusToolSummary) => void;
    // 切会话/清空时复位导航状态
    resetNavigation: () => void;
}

export function useChatPaneController({
    tabKey,
    bindSearchShortcut = false,
}: ChatPaneControllerOptions): ChatPaneController {
    const {t} = useTranslation();
    const globalStore = useChatStore();
    const tabView = useChatTab(tabKey);
    const {loadActiveSessionFullHistory, expandActiveSessionHistory} = globalStore;
    // 完整历史补载/扩载 action 只作用于全局活跃 tab；非活跃面板（背景侧聊）不触发。
    const isActivePane = !tabKey || tabKey === globalStore.activeTabKey;

    const view: ChatPaneView = tabView ?? {
        messages: globalStore.messages,
        provider: globalStore.provider,
        currentCwd: globalStore.currentCwd,
        activeSession: globalStore.activeSession,
        lastSessionLoadMetrics: globalStore.lastSessionLoadMetrics,
        error: globalStore.error,
        activeRequestId: globalStore.activeRequestId,
    };
    const messages = view.messages;
    const lastSessionLoadMetrics = view.lastSessionLoadMetrics;

    const [isNearBottom, setIsNearBottom] = useState(true);
    const [unreadCount, setUnreadCount] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedAnchorCount, setCollapsedAnchorCount] = useState<number | null>(null);
    const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
    const [selectedEditKey, setSelectedEditKey] = useState<string | null>(null);
    const [fullHistorySearchRetryCount, setFullHistorySearchRetryCount] = useState(0);
    const [completeStatusSummaryState, setCompleteStatusSummaryState] = useState<{
        key: string;
        summary: ChatStatusSummary;
    } | null>(null);
    const [fullHistorySearchState, setFullHistorySearchState] = useState<FullHistorySearchState | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const fullHistorySearchStateRef = useRef<FullHistorySearchState | null>(null);
    const isNearBottomRef = useRef(true);
    /** 是否跟随底部。用户手势显式脱离，滚回底部区域自动恢复。 */
    const followRef = useRef(true);
    /** 已排期的「读取滚动位置」帧，用于把高频 scroll 事件压到每帧一次。 */
    const bottomStateFrameRef = useRef<number | null>(null);
    /** 已排期的「跟随滚到底」帧，一帧最多滚一次。 */
    const followScrollFrameRef = useRef<number | null>(null);
    /** 上一次结算时的可渲染条数，用于算未读增量。 */
    const renderableCountRef = useRef(0);
    const messageNodeMapRef = useRef<Map<string, HTMLElement>>(new Map());
    const toolAnchorHighlightCleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => () => {
        toolAnchorHighlightCleanupRef.current?.();
    }, []);

    useEffect(() => () => {
        if (bottomStateFrameRef.current !== null) cancelAnimationFrame(bottomStateFrameRef.current);
        if (followScrollFrameRef.current !== null) cancelAnimationFrame(followScrollFrameRef.current);
    }, []);

    /**
     * 转录容器的 `onScroll` 直连本函数。改造前它每个滚动事件同步 `setState` 一次，
     * 一次惯性滚动能触发上百次 pane 级重渲染；现在压到每帧最多读一次布局，
     * 并且值没变就不 setState（React 对同值 bail out）。
     */
    const updateBottomState = useCallback(() => {
        if (bottomStateFrameRef.current !== null) return;

        bottomStateFrameRef.current = requestAnimationFrame(() => {
            bottomStateFrameRef.current = null;
            const scrollEl = scrollRef.current;
            if (!scrollEl) return;

            const nextIsNearBottom = isNearBottomMetrics(scrollEl);
            isNearBottomRef.current = nextIsNearBottom;
            setIsNearBottom(nextIsNearBottom);

            // 回到底部区域 → 自动恢复跟随并清未读。
            if (nextIsNearBottom && !followRef.current) {
                followRef.current = true;
                setUnreadCount(0);
            }
        });
    }, []);

    // 脱离跟随只认用户手势。`scroll` 事件分不清程序滚动与用户滚动，
    // 用它判定会让我们自己的 scrollTo 把自己踢出跟随状态。
    useEffect(() => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return undefined;

        const handleDetachIntent = (event: Event) => {
            if (!followRef.current) return;
            if (!isFollowDetachIntent(event)) return;
            followRef.current = false;
        };

        scrollEl.addEventListener('wheel', handleDetachIntent, {passive: true});
        scrollEl.addEventListener('touchmove', handleDetachIntent, {passive: true});
        scrollEl.addEventListener('keydown', handleDetachIntent);

        return () => {
            scrollEl.removeEventListener('wheel', handleDetachIntent);
            scrollEl.removeEventListener('touchmove', handleDetachIntent);
            scrollEl.removeEventListener('keydown', handleDetachIntent);
        };
    }, []);

    useEffect(() => {
        if (!bindSearchShortcut) return undefined;

        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault();
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [bindSearchShortcut]);

    const hasMessages = messages.length > 0;
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();
    const isSearchingTranscript = normalizedSearchQuery.length > 0;
    const activeSessionKey = useMemo(
        () => view.activeSession ? getSessionSelectionKey(view.activeSession) : null,
        [view.activeSession],
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
    const anchorItems = useMemo<ChatPaneAnchorItem[]>(() => {
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
    /**
     * 供 rAF 回调在**执行时**读取，而不是沿用排期那一刻的闭包值。
     * 合批窗口内 streaming 可能刚翻转（回合开始/结束正好落在同一帧），
     * 用闭包值会在流式起点排出一次平滑动画——正是我们要消掉的那种动画。
     */
    const isStreamingRef = useRef(isStreaming);
    isStreamingRef.current = isStreaming;

    /**
     * 底部跟随。改造前这个 effect 依赖整个 `messages` 且用 `behavior: 'smooth'`，
     * 流式期间每个增量都排一次平滑滚动，动画互相打断成抖动、还追不上底部。
     * 现在：跟随状态由用户手势控制，滚动按帧合批，流式期间用 `instant`。
     */
    useEffect(() => {
        const previousCount = renderableCountRef.current;
        renderableCountRef.current = renderableMessageCount;

        if (!followRef.current) {
            setUnreadCount((currentUnread) => nextUnreadCount({
                following: false,
                previousCount,
                nextCount: renderableMessageCount,
                currentUnread,
            }));
            return;
        }

        setUnreadCount(0);
        if (followScrollFrameRef.current !== null) return;

        followScrollFrameRef.current = requestAnimationFrame(() => {
            followScrollFrameRef.current = null;
            const scrollEl = scrollRef.current;
            // 帧回调期间用户可能已经上滚接管，重新确认后再滚。
            if (!scrollEl || !followRef.current) return;
            scrollEl.scrollTo({
                top: scrollEl.scrollHeight,
                behavior: resolveFollowScrollBehavior(isStreamingRef.current),
            });
        });
    }, [messages, renderableMessageCount]);

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
    const selectedEdit = useMemo<ChatStatusEditSummary | undefined>(() => {
        const allEdits = statusSummary.allEdits;
        if (allEdits.length === 0) return undefined;
        if (!selectedEditKey) return allEdits[0];
        return allEdits.find((edit) => getChatStatusEditKey(edit) === selectedEditKey) ?? allEdits[0];
    }, [selectedEditKey, statusSummary.allEdits]);
    const activeSelectedEditKey = selectedEdit ? getChatStatusEditKey(selectedEdit) : null;
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

    useEffect(() => {
        fullHistorySearchStateRef.current = fullHistorySearchState;
    }, [fullHistorySearchState]);

    useEffect(() => {
        if (!isSearchingTranscript) {
            setFullHistorySearchState(null);
            return;
        }
        if (!isActivePane) return;
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
        isActivePane,
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

    const resetNavigation = useCallback(() => {
        setSearchQuery('');
        setCollapsedAnchorCount(null);
        setActiveAnchorId(null);
        messageNodeMapRef.current.clear();
        isNearBottomRef.current = true;
        setIsNearBottom(true);
        // 切会话/清空后回到跟随态，未读计数与旧会话的条数基线一起清掉。
        followRef.current = true;
        renderableCountRef.current = 0;
        setUnreadCount(0);
    }, []);

    const handleSearchChange = useCallback((value: string) => {
        setSearchQuery(value);
        setActiveAnchorId(null);

        if (value.trim()) {
            // 搜索会把视口带到顶部，这是明确的「我要自己看」，退出跟随。
            followRef.current = false;
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
        if (!isActivePane) return;
        void expandActiveSessionHistory();
    }, [expandActiveSessionHistory, isActivePane]);

    const handleSelectStatusTool = useCallback((tool: ChatStatusToolSummary) => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;

        const anchor = findToolAnchorElement(scrollEl, tool.toolId);
        if (!anchor) return;

        // 跳转到历史工具卡片同样是「我要自己看」：不退出跟随的话，
        // 下一条流式增量会立刻把视口拽回底部。
        followRef.current = false;
        anchor.scrollIntoView({behavior: 'smooth', block: 'center'});
        anchor.focus({preventScroll: true});
        toolAnchorHighlightCleanupRef.current = highlightTranscriptToolAnchor(anchor, {
            previousCleanup: toolAnchorHighlightCleanupRef.current,
        });
        updateBottomState();
    }, [updateBottomState]);

    const handleSelectedEditChange = useCallback((edit: ChatStatusEditSummary) => {
        setSelectedEditKey(getChatStatusEditKey(edit));
    }, []);

    const scrollToBottom = useCallback(() => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;

        scrollEl.scrollTo({top: scrollEl.scrollHeight, behavior: 'smooth'});
        isNearBottomRef.current = true;
        setIsNearBottom(true);
        followRef.current = true;
        setUnreadCount(0);
    }, []);

    const scrollToTop = useCallback(() => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;

        scrollEl.scrollTo({top: 0, behavior: 'smooth'});
        isNearBottomRef.current = false;
        setIsNearBottom(false);
        followRef.current = false;
    }, []);

    return {
        tabKey,
        messages,
        provider: view.provider,
        currentCwd: view.currentCwd,
        error: view.error,
        hasMessages,
        isStreaming,
        activeRequestId: view.activeRequestId,
        searchQuery,
        searchInputRef,
        handleSearchChange,
        searchSourceMessages,
        fullHistorySearchStatus,
        handleRetryFullHistorySearch,
        scrollRef,
        isNearBottom,
        unreadCount,
        updateBottomState,
        scrollToBottom,
        scrollToTop,
        hasEarlierServerHistory,
        isLoadingEarlierServerHistory,
        handleLoadEarlierServerHistory,
        anchorItems,
        anchorCount,
        activeAnchorId,
        setActiveAnchorId,
        activeAnchorLabel,
        messageNodeMapRef,
        handleMessageNodeRef,
        setCollapsedAnchorCount,
        statusSummary,
        inputStatusSummary,
        renderableMessageCount,
        activeSelectedEditKey,
        handleSelectedEditChange,
        handleSelectStatusTool,
        resetNavigation,
    };
}
