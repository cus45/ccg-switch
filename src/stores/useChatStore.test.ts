import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {ChatMessage, MessageRaw} from '../types/chat';
import {
    getSessionSelectionKey,
    type SessionMeta,
    type UnifiedSessionMessage,
    type UnifiedSessionMessageWindow,
} from '../types/session';
import {findToolResult, getRenderableContentBlocks} from '../utils/chatMessageFlow';
import {CHAT_DAEMON_READY_TIMEOUT_ERROR_KEY} from '../utils/chatDaemonStatus';
import {buildChatStatusSummary} from '../utils/chatStatusSummary';
import {CHAT_MODEL_SELECTION_KEY_PREFIX} from '../utils/chatModels';
import {clearChatSessionHistoryCache, useChatStore} from './useChatStore';

const tauriMocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    listen: vi.fn(async (_eventName: string, _callback: (event: { payload: unknown }) => void) => vi.fn()),
}));

const notificationMocks = vi.hoisted(() => ({
    notifyChatTurnStopped: vi.fn(),
    prepareChatTurnStoppedNotificationPermission: vi.fn(),
}));

const localStorageEntries = new Map<string, string>();
const localStorageMock: Storage = {
    get length() {
        return localStorageEntries.size;
    },
    clear: vi.fn(() => {
        localStorageEntries.clear();
    }),
    getItem: vi.fn((key: string) => localStorageEntries.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(localStorageEntries.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
        localStorageEntries.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
        localStorageEntries.set(key, value);
    }),
};

vi.mock('@tauri-apps/api/core', () => ({
    invoke: tauriMocks.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: tauriMocks.listen,
}));

vi.mock('../utils/desktopNotification', () => ({
    notifyChatTurnStopped: notificationMocks.notifyChatTurnStopped,
    prepareChatTurnStoppedNotificationPermission: notificationMocks.prepareChatTurnStoppedNotificationPermission,
}));

const activeMessages: ChatMessage[] = [
    {
        id: 'u1',
        role: 'user',
        content: 'hello',
        createdAt: 100,
    },
    {
        id: 'a1',
        role: 'assistant',
        content: 'streaming',
        streaming: true,
        createdAt: 101,
    },
];

const loadedSession: SessionMeta = {
    providerId: 'codex',
    sessionId: 'session-1',
    title: 'Loaded session',
    summary: null,
    projectDir: 'C:/guodevelop/ccg-switch',
    createdAt: 1_786_000_000_000,
    lastActiveAt: 1_786_000_100_000,
    sourcePath: 'C:/Users/Administrator/.codex/sessions/session-1.jsonl',
    resumeCommand: 'codex resume session-1',
};

const claudeSession: SessionMeta = {
    providerId: 'claude',
    sessionId: 'claude-session-1',
    title: 'Claude session',
    summary: null,
    projectDir: 'C:/guodevelop/ccg-switch',
    createdAt: 1_786_000_000_000,
    lastActiveAt: 1_786_000_100_000,
    sourcePath: 'C:/Users/Administrator/.claude/projects/project/session.jsonl',
    resumeCommand: 'claude --resume claude-session-1',
};

function resetStore() {
    useChatStore.setState({
        messages: [],
        provider: 'claude',
        permissionMode: 'default',
        model: 'claude-opus-4-8',
        reasoningEffort: 'high',
        draft: '',
        longContextEnabled: true,
        contextTokens: 0,
        contextMaxTokens: null,
        daemonReady: false,
        daemonStatus: null,
        daemonReconnecting: false,
        activeRequestId: null,
        sessionId: null,
        currentCwd: null,
        activeSession: null,
        pendingSessionKey: null,
        handoffContextProvider: null,
        initialized: false,
        error: null,
        pendingAskUserQuestion: null,
        pendingAskUserQuestionQueue: [],
        askUserQuestionResponseInFlightRequestId: null,
        pendingPlanApproval: null,
        pendingPlanApprovalQueue: [],
        planApprovalResponseInFlightRequestId: null,
        pendingToolPermission: null,
        pendingToolPermissionQueue: [],
        toolPermissionResponseInFlightRequestId: null,
        deniedToolIds: new Set(),
        openTabs: [],
        activeTabKey: null,
        dockChatTabKey: null,
        providerConfigDirty: false,
        lastSessionLoadMetrics: null,
    });
}

function buildTestHistoryWindow(
    messages: UnifiedSessionMessage[],
    startIndex = 0,
    totalCount = messages.length,
    complete = startIndex === 0 && messages.length === totalCount,
): UnifiedSessionMessageWindow {
    return {
        messages,
        startIndex,
        totalCount,
        complete,
    };
}

describe('useChatStore session transitions', () => {
    beforeEach(() => {
        tauriMocks.invoke.mockReset();
        tauriMocks.listen.mockClear();
        notificationMocks.notifyChatTurnStopped.mockClear();
        notificationMocks.prepareChatTurnStoppedNotificationPermission.mockClear();
        vi.stubGlobal('localStorage', localStorageMock);
        localStorageEntries.clear();
        vi.mocked(localStorageMock.getItem).mockClear();
        vi.mocked(localStorageMock.setItem).mockClear();
        vi.mocked(localStorageMock.removeItem).mockClear();
        vi.mocked(localStorageMock.clear).mockClear();
        vi.mocked(localStorageMock.key).mockClear();
        clearChatSessionHistoryCache();
        resetStore();
    });

    it('openSideChat adds an independent background tab inheriting cwd without touching the active tab', () => {
        useChatStore.setState({
            messages: activeMessages,
            currentCwd: 'C:/workspace/main',
            activeTabKey: 'main-tab',
            openTabs: [],
            dockChatTabKey: null,
        });

        const sideKey = useChatStore.getState().openSideChat();
        const state = useChatStore.getState();

        // Center active tab + its projection stay untouched.
        expect(state.activeTabKey).toBe('main-tab');
        expect(state.messages).toBe(activeMessages);
        // A new background side tab is tracked as the visible dock chat.
        expect(state.dockChatTabKey).toBe(sideKey);
        const sideTab = state.openTabs.find((tab) => tab.key === sideKey);
        expect(sideTab).toBeDefined();
        expect(sideTab?.messages).toEqual([]);
        expect(sideTab?.currentCwd).toBe('C:/workspace/main');
        expect(sideTab?.activeRequestId).toBeNull();
    });

    it('openSideChat honors an explicit cwd override', () => {
        useChatStore.setState({currentCwd: 'C:/workspace/main', openTabs: [], dockChatTabKey: null});

        const sideKey = useChatStore.getState().openSideChat({cwd: 'C:/workspace/side'});
        const sideTab = useChatStore.getState().openTabs.find((tab) => tab.key === sideKey);

        expect(sideTab?.currentCwd).toBe('C:/workspace/side');
    });

    it('closeSideChat removes the side tab and clears the visible dock chat key', () => {
        useChatStore.setState({currentCwd: null, openTabs: [], dockChatTabKey: null});
        const sideKey = useChatStore.getState().openSideChat();
        expect(useChatStore.getState().openTabs).toHaveLength(1);

        useChatStore.getState().closeSideChat(sideKey);
        const state = useChatStore.getState();

        expect(state.openTabs.find((tab) => tab.key === sideKey)).toBeUndefined();
        expect(state.dockChatTabKey).toBeNull();
    });

    it('closeSideChat falls back to center-close semantics when the side tab was promoted to active', () => {
        useChatStore.setState({currentCwd: 'C:/workspace/main', openTabs: [], activeTabKey: null, dockChatTabKey: null});
        const sideKey = useChatStore.getState().openSideChat();
        // 用户在中心会话 tab 条聚焦了这个侧聊 tab。
        useChatStore.getState().focusTab(sideKey);
        expect(useChatStore.getState().activeTabKey).toBe(sideKey);

        useChatStore.getState().closeSideChat(sideKey);
        const state = useChatStore.getState();

        expect(state.openTabs.find((tab) => tab.key === sideKey)).toBeUndefined();
        // activeTabKey 不悬空：要么回退到其它 tab，要么被清空重建空会话。
        expect(state.activeTabKey === sideKey).toBe(false);
        if (state.activeTabKey !== null) {
            expect(state.openTabs.some((tab) => tab.key === state.activeTabKey)).toBe(true);
        }
        expect(state.dockChatTabKey).toBeNull();
    });

    it('sendInTab streams into the side tab and routes its request without disturbing the active center tab', async () => {
        useChatStore.setState({
            messages: activeMessages,
            activeTabKey: 'main-tab',
            currentCwd: 'C:/workspace/main',
            provider: 'claude',
            model: 'claude-opus-4-8',
            openTabs: [],
            dockChatTabKey: null,
        });
        const sideKey = useChatStore.getState().openSideChat();
        tauriMocks.invoke.mockResolvedValueOnce('req-side-1');

        const ok = await useChatStore.getState().sendInTab(sideKey, 'hi side');

        expect(ok).toBe(true);
        const state = useChatStore.getState();
        // Active center tab + its top-level projection stay untouched.
        expect(state.activeTabKey).toBe('main-tab');
        expect(state.messages).toBe(activeMessages);
        expect(state.activeRequestId).toBeNull();
        // The side tab received the optimistic pair and the routed request id.
        const side = state.openTabs.find((tab) => tab.key === sideKey);
        expect(side?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
        expect(side?.activeRequestId).toBe('req-side-1');
        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_send', expect.objectContaining({provider: 'claude'}));
    });

    it('sendInTab returns false for an unknown tab', async () => {
        useChatStore.setState({openTabs: [], dockChatTabKey: null});

        const ok = await useChatStore.getState().sendInTab('missing-tab', 'hi');

        expect(ok).toBe(false);
    });

    it('setTabDraft updates only the target tab draft, not the active tab', () => {
        useChatStore.setState({
            activeTabKey: 'main-tab',
            messages: activeMessages,
            draft: 'main draft',
            openTabs: [],
            dockChatTabKey: null,
        });
        const sideKey = useChatStore.getState().openSideChat();

        useChatStore.getState().setTabDraft(sideKey, 'side draft');

        const state = useChatStore.getState();
        expect(state.draft).toBe('main draft');
        expect(state.openTabs.find((tab) => tab.key === sideKey)?.draft).toBe('side draft');
    });

    it('updateTabConfig changes an idle tab but is a no-op while that tab is streaming', () => {
        useChatStore.setState({activeTabKey: 'main-tab', messages: [], openTabs: [], dockChatTabKey: null});
        const sideKey = useChatStore.getState().openSideChat();

        useChatStore.getState().updateTabConfig(sideKey, {model: 'claude-haiku-4-5-20251001'});
        expect(useChatStore.getState().openTabs.find((tab) => tab.key === sideKey)?.model)
            .toBe('claude-haiku-4-5-20251001');

        useChatStore.setState((state) => ({
            openTabs: state.openTabs.map((tab) => tab.key === sideKey
                ? {...tab, messages: [{id: 'a', role: 'assistant', content: '', streaming: true, createdAt: 1}] as ChatMessage[]}
                : tab),
        }));
        useChatStore.getState().updateTabConfig(sideKey, {model: 'claude-opus-4-8'});
        expect(useChatStore.getState().openTabs.find((tab) => tab.key === sideKey)?.model)
            .toBe('claude-haiku-4-5-20251001');
    });

    it('marks daemon warmup failure as a recoverable error during init', async () => {
        tauriMocks.invoke.mockRejectedValueOnce(new Error('warmup failed'));

        await useChatStore.getState().init();

        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_start_daemon');
        expect(useChatStore.getState()).toMatchObject({
            initialized: true,
            daemonReady: false,
            daemonStatus: 'error',
            daemonReconnecting: false,
            error: 'Error: warmup failed',
        });
    });

    it('marks daemon warmup as a recoverable error when ready never arrives during init', async () => {
        vi.useFakeTimers();
        try {
            tauriMocks.invoke.mockResolvedValue(undefined);

            await useChatStore.getState().init();

            expect(useChatStore.getState()).toMatchObject({
                initialized: true,
                daemonReady: false,
                daemonStatus: 'starting',
                daemonReconnecting: false,
                error: null,
            });

            await vi.runOnlyPendingTimersAsync();

            expect(useChatStore.getState()).toMatchObject({
                daemonReady: false,
                daemonStatus: 'error',
                daemonReconnecting: false,
                error: CHAT_DAEMON_READY_TIMEOUT_ERROR_KEY,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps daemon reconnect pending after start succeeds until the ready event arrives', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        let resolveStart: (() => void) | undefined;
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        const startResults = [
            Promise.resolve(),
            new Promise<void>((resolve) => {
                resolveStart = resolve;
            }),
        ];
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'chat_start_daemon') return startResults.shift() ?? Promise.resolve();
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().init();

        const reconnectPromise = useChatStore.getState().reconnectDaemon();

        expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, 'chat_start_daemon');
        expect(useChatStore.getState()).toMatchObject({
            daemonReady: false,
            daemonStatus: 'starting',
            daemonReconnecting: true,
            error: null,
        });

        resolveStart?.();
        await reconnectPromise;

        expect(useChatStore.getState()).toMatchObject({
            daemonReady: false,
            daemonStatus: 'starting',
            daemonReconnecting: true,
            error: null,
        });

        listeners['chat://daemon']?.({payload: {event: 'ready'}});

        expect(useChatStore.getState()).toMatchObject({
            daemonReady: true,
            daemonStatus: 'ready',
            daemonReconnecting: false,
            error: null,
        });
    });

    it('clears daemon reconnecting when shutdown arrives before ready', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().init();
        await useChatStore.getState().reconnectDaemon();

        expect(useChatStore.getState()).toMatchObject({
            daemonReady: false,
            daemonStatus: 'starting',
            daemonReconnecting: true,
            error: null,
        });

        listeners['chat://daemon']?.({payload: {event: 'shutdown'}});

        expect(useChatStore.getState()).toMatchObject({
            daemonReady: false,
            daemonStatus: 'shutdown',
            daemonReconnecting: false,
            error: null,
        });
    });

    it('marks daemon reconnect as a recoverable error when ready never arrives', async () => {
        vi.useFakeTimers();
        try {
            tauriMocks.invoke.mockResolvedValue(undefined);

            await useChatStore.getState().reconnectDaemon();

            expect(useChatStore.getState()).toMatchObject({
                daemonReady: false,
                daemonStatus: 'starting',
                daemonReconnecting: true,
                error: null,
            });

            await vi.runOnlyPendingTimersAsync();

            expect(useChatStore.getState()).toMatchObject({
                daemonReady: false,
                daemonStatus: 'error',
                daemonReconnecting: false,
                error: CHAT_DAEMON_READY_TIMEOUT_ERROR_KEY,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps daemon offline and exposes the error when reconnect fails', async () => {
        useChatStore.setState({
            daemonReady: false,
            daemonStatus: 'shutdown',
        });
        tauriMocks.invoke.mockRejectedValueOnce(new Error('spawn failed'));

        await useChatStore.getState().reconnectDaemon();

        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_start_daemon');
        expect(useChatStore.getState()).toMatchObject({
            daemonReady: false,
            daemonStatus: 'error',
            daemonReconnecting: false,
            error: 'Error: spawn failed',
        });
    });

    it('starts a new session without aborting the running request', async () => {
        useChatStore.setState({
            messages: activeMessages,
            activeRequestId: 'request-1',
            sessionId: 'old-session',
            activeSession: loadedSession,
            currentCwd: 'C:/old-project',
            contextTokens: 42,
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().startNewSession('C:/new-project');

        expect(tauriMocks.invoke).not.toHaveBeenCalledWith('chat_abort');
        expect(useChatStore.getState()).toMatchObject({
            messages: [],
            sessionId: null,
            activeSession: null,
            currentCwd: 'C:/new-project',
            activeRequestId: null,
            contextTokens: 0,
            error: null,
        });
    });

    it('keeps a running request alive when starting a new session even if abort would fail', async () => {
        useChatStore.setState({
            messages: activeMessages,
            activeRequestId: 'request-1',
            sessionId: 'old-session',
            activeSession: loadedSession,
            currentCwd: 'C:/old-project',
            contextTokens: 42,
        });
        tauriMocks.invoke.mockRejectedValueOnce(new Error('daemon offline'));

        await useChatStore.getState().startNewSession('C:/new-project');

        expect(tauriMocks.invoke).not.toHaveBeenCalledWith('chat_abort');
        expect(useChatStore.getState()).toMatchObject({
            messages: [],
            sessionId: null,
            activeSession: null,
            currentCwd: 'C:/new-project',
            activeRequestId: null,
            contextTokens: 0,
            error: null,
        });
        expect(useChatStore.getState().openTabs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                activeRequestId: 'request-1',
                status: 'running',
            }),
        ]));
    });

    it('keeps abort failure visible after clearing the current chat', async () => {
        useChatStore.setState({
            messages: activeMessages,
            activeRequestId: 'request-1',
            sessionId: 'old-session',
            activeSession: loadedSession,
            currentCwd: 'C:/old-project',
            contextTokens: 42,
        });
        tauriMocks.invoke.mockRejectedValueOnce(new Error('abort rejected'));

        await useChatStore.getState().clear();

        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_abort');
        expect(useChatStore.getState()).toMatchObject({
            messages: [],
            sessionId: null,
            activeSession: null,
            pendingSessionKey: null,
            activeRequestId: null,
            contextTokens: 0,
            error: 'Error: abort rejected',
        });
    });

    it('loads a history session without aborting the running request', async () => {
        const history: UnifiedSessionMessage[] = [
            {
                role: 'user',
                content: 'resume this task',
                ts: '2026-06-17T08:00:00.000Z',
            },
            {
                role: 'assistant',
                content: 'history loaded',
                ts: '2026-06-17T08:00:01.000Z',
            },
        ];
        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') return buildTestHistoryWindow(history);
            if (command === 'get_unified_session_messages') return history;
            throw new Error(`Unexpected command: ${command}`);
        });
        useChatStore.setState({
            messages: activeMessages,
            activeRequestId: 'request-1',
            sessionId: 'old-session',
            currentCwd: 'C:/old-project',
        });

        await useChatStore.getState().loadSession(loadedSession);

        expect(tauriMocks.invoke).not.toHaveBeenCalledWith('chat_abort');
        expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, 'get_unified_session_message_window', {
            providerId: 'codex',
            sourcePath: loadedSession.sourcePath,
            tailLimit: 120,
        });
        expect(useChatStore.getState()).toMatchObject({
            provider: 'codex',
            sessionId: loadedSession.sessionId,
            currentCwd: loadedSession.projectDir,
            activeSession: loadedSession,
            pendingSessionKey: null,
            activeRequestId: null,
            contextTokens: 0,
            error: null,
        });
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
            'resume this task',
            'history loaded',
        ]);
    });

    it('does not keep an empty startup draft tab when opening a history session', async () => {
        const history: UnifiedSessionMessage[] = [
            {
                role: 'user',
                content: 'open real session',
                ts: '2026-06-17T08:00:00.000Z',
            },
        ];
        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') return buildTestHistoryWindow(history);
            if (command === 'get_unified_session_messages') return history;
            throw new Error(`Unexpected command: ${command}`);
        });
        useChatStore.setState({
            currentCwd: 'C:/guodevelop/ccg-switch',
        });

        await useChatStore.getState().loadSession(loadedSession);

        expect(useChatStore.getState().openTabs).toHaveLength(1);
        expect(useChatStore.getState().openTabs[0]).toEqual(expect.objectContaining({
            activeSession: loadedSession,
            sessionId: loadedSession.sessionId,
        }));
        expect(useChatStore.getState().openTabs[0].activeSession).not.toBeNull();
    });

    it('switches the empty draft workspace without creating a fake tab', () => {
        useChatStore.setState({
            messages: [],
            draft: '',
            currentCwd: null,
            activeSession: null,
            sessionId: null,
            openTabs: [],
            activeTabKey: null,
        });

        useChatStore.getState().setCurrentCwd(' C:/workspace/new-project ');

        expect(useChatStore.getState()).toMatchObject({
            currentCwd: 'C:/workspace/new-project',
            activeSession: null,
            sessionId: null,
            messages: [],
        });
        expect(useChatStore.getState().openTabs).toHaveLength(0);
        expect(useChatStore.getState().activeTabKey).toBeNull();
    });

    it('opens a fresh conversation when switching workspace from a loaded session', () => {
        const loadedSession = {
            providerId: 'claude' as const,
            sessionId: 'loaded-session',
            title: 'Loaded session',
            summary: null,
            projectDir: 'C:/workspace/old-project',
            createdAt: 1,
            lastActiveAt: 2,
            sourcePath: 'C:/sessions/loaded-session.jsonl',
            resumeCommand: null,
        };
        useChatStore.setState({
            messages: [{id: 'm1', role: 'user', content: 'old message', createdAt: 1}],
            draft: '',
            currentCwd: 'C:/workspace/old-project',
            activeSession: loadedSession,
            sessionId: loadedSession.sessionId,
            openTabs: [],
            activeTabKey: null,
        });

        useChatStore.getState().setCurrentCwd('C:/workspace/new-project');

        expect(useChatStore.getState()).toMatchObject({
            currentCwd: 'C:/workspace/new-project',
            activeSession: null,
            sessionId: null,
            messages: [],
        });
    });

    it('keeps a non-empty startup draft tab when opening a history session', async () => {
        const history: UnifiedSessionMessage[] = [
            {
                role: 'assistant',
                content: 'loaded response',
                ts: '2026-06-17T08:00:00.000Z',
            },
        ];
        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') return buildTestHistoryWindow(history);
            if (command === 'get_unified_session_messages') return history;
            throw new Error(`Unexpected command: ${command}`);
        });
        useChatStore.setState({
            currentCwd: 'C:/guodevelop/ccg-switch',
            draft: 'keep this prompt',
        });

        await useChatStore.getState().loadSession(loadedSession);

        expect(useChatStore.getState().openTabs).toHaveLength(2);
        expect(useChatStore.getState().openTabs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                activeSession: null,
                draft: 'keep this prompt',
            }),
            expect.objectContaining({
                activeSession: loadedSession,
                sessionId: loadedSession.sessionId,
            }),
        ]));
    });

    it('loads a history session without surfacing abort errors from another running tab', async () => {
        const history: UnifiedSessionMessage[] = [
            {
                role: 'assistant',
                content: 'history still loads',
                ts: '2026-06-17T08:00:01.000Z',
            },
        ];
        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') return buildTestHistoryWindow(history);
            if (command === 'get_unified_session_messages') return history;
            throw new Error(`Unexpected command: ${command}`);
        });
        useChatStore.setState({
            messages: activeMessages,
            activeRequestId: 'request-1',
            sessionId: 'old-session',
            currentCwd: 'C:/old-project',
        });

        await useChatStore.getState().loadSession(loadedSession);

        expect(tauriMocks.invoke).not.toHaveBeenCalledWith('chat_abort');
        expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, 'get_unified_session_message_window', {
            providerId: 'codex',
            sourcePath: loadedSession.sourcePath,
            tailLimit: 120,
        });
        expect(useChatStore.getState()).toMatchObject({
            provider: 'codex',
            sessionId: loadedSession.sessionId,
            currentCwd: loadedSession.projectDir,
            activeSession: loadedSession,
            pendingSessionKey: null,
            activeRequestId: null,
            error: null,
        });
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
            'history still loads',
        ]);
        expect(useChatStore.getState().openTabs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                activeRequestId: 'request-1',
                status: 'running',
            }),
        ]));
    });

    it('keeps the previous streaming assistant running when history loading fails', async () => {
        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') throw new Error('history unreadable');
            if (command === 'get_unified_session_messages') return [];
            throw new Error(`Unexpected command: ${command}`);
        });
        useChatStore.setState({
            messages: activeMessages,
            activeRequestId: 'request-1',
            sessionId: 'old-session',
            currentCwd: 'C:/old-project',
        });

        await useChatStore.getState().loadSession(loadedSession);

        expect(tauriMocks.invoke).not.toHaveBeenCalledWith('chat_abort');
        expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, 'get_unified_session_message_window', {
            providerId: 'codex',
            sourcePath: loadedSession.sourcePath,
            tailLimit: 120,
        });
        expect(useChatStore.getState()).toMatchObject({
            activeRequestId: null,
            activeSession: loadedSession,
            pendingSessionKey: null,
            error: 'Error: history unreadable',
        });
        expect(useChatStore.getState().openTabs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                activeRequestId: 'request-1',
                status: 'running',
                messages: activeMessages,
            }),
        ]));
    });

    it('marks the selected history session as pending while loading', async () => {
        let resolveHistory: ((value: UnifiedSessionMessageWindow) => void) | null = null;
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'get_unified_session_message_window') {
                return new Promise<UnifiedSessionMessageWindow>((resolve) => {
                    resolveHistory = resolve;
                });
            }
            if (command === 'get_unified_session_messages') return Promise.resolve([]);
            throw new Error(`Unexpected command: ${command}`);
        });

        const loadPromise = useChatStore.getState().loadSession(loadedSession);
        await Promise.resolve();

        expect(useChatStore.getState()).toMatchObject({
            pendingSessionKey: getSessionSelectionKey(loadedSession),
            error: null,
        });

        expect(resolveHistory).not.toBeNull();
        resolveHistory!(buildTestHistoryWindow([
            {
                role: 'assistant',
                content: 'loaded later',
                ts: '2026-06-17T08:00:02.000Z',
            },
        ]));
        await loadPromise;

        expect(useChatStore.getState()).toMatchObject({
            activeSession: loadedSession,
            pendingSessionKey: null,
        });
    });

    it('reloads disk-ordered history when reopening a settled active session', async () => {
        // 实时跑过后遗留在屏幕上的「聚类」转录（文本簇在前、工具块在后）。
        const clusteredLiveMessages: ChatMessage[] = [
            {id: 'live-user', role: 'user', content: 'do the work', createdAt: 100},
            {
                id: 'live-assistant',
                role: 'assistant',
                content: 'text1\ntext2',
                raw: {
                    type: 'assistant',
                    message: {
                        content: [
                            {type: 'text', text: 'text1\ntext2'},
                            {type: 'tool_use', id: 'tool-a', name: 'Read', input: {file_path: 'a.ts'}},
                            {type: 'tool_use', id: 'tool-b', name: 'Read', input: {file_path: 'b.ts'}},
                        ],
                    },
                },
                createdAt: 101,
            },
        ];
        // 磁盘上顺序正确（交错）的历史。
        const diskHistory: UnifiedSessionMessage[] = [
            {role: 'user', content: 'do the work', ts: '2026-06-17T08:00:00.000Z'},
            {role: 'assistant', content: 'text1', ts: '2026-06-17T08:00:01.000Z'},
            {role: 'assistant', content: 'text2', ts: '2026-06-17T08:00:02.000Z'},
        ];
        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') return buildTestHistoryWindow(diskHistory);
            if (command === 'get_unified_session_messages') return diskHistory;
            throw new Error(`Unexpected command: ${command}`);
        });

        useChatStore.setState({
            provider: 'codex',
            sessionId: loadedSession.sessionId,
            activeSession: loadedSession,
            currentCwd: loadedSession.projectDir,
            activeRequestId: null,
            messages: clusteredLiveMessages,
        });

        await useChatStore.getState().loadSession(loadedSession);

        expect(tauriMocks.invoke).toHaveBeenCalledWith(
            'get_unified_session_message_window',
            expect.objectContaining({sourcePath: loadedSession.sourcePath}),
        );
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
            'do the work',
            'text1',
            'text2',
        ]);
        expect(useChatStore.getState()).toMatchObject({
            activeSession: loadedSession,
            pendingSessionKey: null,
        });
    });

    it('does not reload the active session while a turn is still streaming', async () => {
        const streamingMessages: ChatMessage[] = [
            {id: 'live-user', role: 'user', content: 'do the work', createdAt: 100},
            {id: 'live-assistant', role: 'assistant', content: 'partial', streaming: true, createdAt: 101},
        ];

        useChatStore.setState({
            provider: 'codex',
            sessionId: loadedSession.sessionId,
            activeSession: loadedSession,
            currentCwd: loadedSession.projectDir,
            activeRequestId: 'request-streaming',
            messages: streamingMessages,
        });

        await useChatStore.getState().loadSession(loadedSession);

        expect(tauriMocks.invoke).not.toHaveBeenCalled();
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
            'do the work',
            'partial',
        ]);
        expect(useChatStore.getState()).toMatchObject({
            activeSession: loadedSession,
            activeRequestId: 'request-streaming',
        });
    });

    it('reuses cached history for the same session metadata', async () => {
        const history: UnifiedSessionMessage[] = [
            {
                role: 'assistant',
                content: 'cached history',
                ts: '2026-06-17T08:00:03.000Z',
            },
        ];
        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') return buildTestHistoryWindow(history);
            if (command === 'get_unified_session_messages') return history;
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().loadSession(loadedSession);
        useChatStore.setState({
            messages: [],
            sessionId: null,
            activeSession: null,
            currentCwd: null,
        });
        await useChatStore.getState().loadSession(loadedSession);

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState()).toMatchObject({
            activeSession: loadedSession,
            pendingSessionKey: null,
        });
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
            'cached history',
        ]);
    });

    it('records session load metrics for cache hits', async () => {
        const history: UnifiedSessionMessage[] = [
            {
                role: 'assistant',
                content: 'cached metrics history',
                ts: '2026-06-17T08:00:03.000Z',
            },
        ];
        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') return buildTestHistoryWindow(history);
            if (command === 'get_unified_session_messages') return history;
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().loadSession(loadedSession);
        useChatStore.setState({
            messages: [],
            sessionId: null,
            activeSession: null,
            currentCwd: null,
            lastSessionLoadMetrics: null,
        });
        await useChatStore.getState().loadSession(loadedSession);

        const metrics = (useChatStore.getState() as {
            lastSessionLoadMetrics?: {
                cacheHit: boolean;
                status: string;
                providerId: string;
                fullMessageCount: number | null;
                totalMessageCount: number | null;
            } | null;
        }).lastSessionLoadMetrics;

        expect(metrics).toMatchObject({
            cacheHit: true,
            status: 'complete',
            providerId: 'codex',
            fullMessageCount: 1,
            totalMessageCount: 1,
        });
    });

    it('reuses cached large history without hydrating the full message array', async () => {
        const history: UnifiedSessionMessage[] = Array.from({length: 5000}, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `large history ${index}`,
            ts: new Date(1_786_000_000_000 + index).toISOString(),
        }));
        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') {
                return buildTestHistoryWindow(history.slice(-120), 4880, history.length, false);
            }
            if (command === 'get_unified_session_messages') return history;
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().loadSession(loadedSession);
        expect(useChatStore.getState().messages).toHaveLength(120);
        expect(useChatStore.getState().messages[0]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-4880`,
            content: 'large history 4880',
        });

        useChatStore.setState({
            messages: [],
            sessionId: null,
            activeSession: null,
            currentCwd: null,
        });
        await useChatStore.getState().loadSession(loadedSession);

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
        expect(useChatStore.getState().messages).toHaveLength(120);
        expect(useChatStore.getState().messages[0]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-4880`,
            role: 'user',
            content: 'large history 4880',
        });
        expect(useChatStore.getState().messages[119]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-4999`,
            role: 'assistant',
            content: 'large history 4999',
        });
    });

    it('paints a large history session from a recent window without loading the full transcript', async () => {
        const fullHistory: UnifiedSessionMessage[] = Array.from({length: 5000}, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `first paint history ${index}`,
            ts: new Date(1_786_000_000_000 + index).toISOString(),
        }));
        const windowHistory = fullHistory.slice(-120);
        let resolveWindow: ((value: {
            messages: UnifiedSessionMessage[];
            startIndex: number;
            totalCount: number;
            complete: boolean;
        }) => void) | null = null;

        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'get_unified_session_message_window') {
                return new Promise((resolve) => {
                    resolveWindow = resolve;
                });
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        const loadPromise = useChatStore.getState().loadSession(loadedSession);
        await Promise.resolve();

        expect(resolveWindow).not.toBeNull();
        resolveWindow!({
            messages: windowHistory,
            startIndex: 4880,
            totalCount: fullHistory.length,
            complete: false,
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(useChatStore.getState()).toMatchObject({
            activeSession: loadedSession,
            pendingSessionKey: null,
            provider: 'codex',
            sessionId: loadedSession.sessionId,
        });
        expect(useChatStore.getState().messages).toHaveLength(120);
        expect(useChatStore.getState().messages[0]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-4880`,
            content: 'first paint history 4880',
        });
        await loadPromise;

        const finalMessages = useChatStore.getState().messages;
        expect(finalMessages).toHaveLength(120);
        expect(finalMessages[0]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-4880`,
            content: 'first paint history 4880',
        });
        expect(finalMessages[119]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-4999`,
            content: 'first paint history 4999',
        });

        useChatStore.setState({
            messages: [],
            sessionId: null,
            activeSession: null,
            currentCwd: null,
        });
        resolveWindow = null;
        const secondLoadPromise = useChatStore.getState().loadSession(loadedSession);
        await Promise.resolve();

        expect(resolveWindow).not.toBeNull();
        resolveWindow!({
            messages: windowHistory,
            startIndex: 4880,
            totalCount: fullHistory.length,
            complete: false,
        });
        await Promise.resolve();
        await Promise.resolve();
        await secondLoadPromise;

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
        expect(useChatStore.getState().messages).toHaveLength(120);
        expect(useChatStore.getState().messages[0]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-4880`,
            content: 'first paint history 4880',
        });
        expect(useChatStore.getState().messages[119]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-4999`,
            content: 'first paint history 4999',
        });
    });

    it('keeps incomplete large history windowed without an automatic full-history request', async () => {
        vi.useFakeTimers();
        const fullHistory: UnifiedSessionMessage[] = Array.from({length: 5000}, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `windowed history ${index}`,
            ts: new Date(1_786_000_000_000 + index).toISOString(),
        }));
        let resolveWindow: ((value: UnifiedSessionMessageWindow) => void) | null = null;
        let resolveFull: ((value: UnifiedSessionMessage[]) => void) | null = null;

        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'get_unified_session_message_window') {
                return new Promise<UnifiedSessionMessageWindow>((resolve) => {
                    resolveWindow = resolve;
                });
            }
            if (command === 'get_unified_session_messages') {
                return new Promise<UnifiedSessionMessage[]>((resolve) => {
                    resolveFull = resolve;
                });
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        try {
            const loadPromise = useChatStore.getState().loadSession(loadedSession);
            let loadSettled = false;
            void loadPromise.then(() => {
                loadSettled = true;
            });
            await Promise.resolve();

            expect(resolveWindow).not.toBeNull();
            resolveWindow!(buildTestHistoryWindow(fullHistory.slice(-120), 4880, fullHistory.length, false));
            await Promise.resolve();
            await Promise.resolve();
            await vi.runOnlyPendingTimersAsync();
            await Promise.resolve();

            expect(loadSettled).toBe(true);
            expect(resolveFull).toBeNull();
            expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
            expect(tauriMocks.invoke).not.toHaveBeenCalledWith('get_unified_session_messages', {
                providerId: loadedSession.providerId,
                sourcePath: loadedSession.sourcePath,
            });
            expect(useChatStore.getState().messages).toHaveLength(120);
            expect(useChatStore.getState().messages[0]).toMatchObject({
                id: `history-codex-${loadedSession.sessionId}-4880`,
                content: 'windowed history 4880',
            });
            expect(useChatStore.getState().lastSessionLoadMetrics).toMatchObject({
                status: 'windowed',
                windowMessageCount: 120,
                totalMessageCount: 5000,
                fullMessageCount: null,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('loads full history only for an explicit search intent without hydrating visible messages', async () => {
        const fullHistory: UnifiedSessionMessage[] = Array.from({length: 240}, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `explicit full history ${index}`,
            ts: new Date(1_786_000_000_000 + index).toISOString(),
        }));

        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') {
                return buildTestHistoryWindow(fullHistory.slice(-120), 120, fullHistory.length, false);
            }
            if (command === 'get_unified_session_messages') {
                return fullHistory;
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().loadSession(loadedSession);

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().messages).toHaveLength(120);
        expect(useChatStore.getState().messages[0]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-120`,
            content: 'explicit full history 120',
        });

        const fullMessages = await useChatStore.getState().loadActiveSessionFullHistory();

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
        expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, 'get_unified_session_messages', {
            providerId: loadedSession.providerId,
            sourcePath: loadedSession.sourcePath,
        });
        expect(fullMessages).toHaveLength(240);
        expect(fullMessages?.[0]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-0`,
            content: 'explicit full history 0',
        });
        expect(fullMessages?.[239]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-239`,
            content: 'explicit full history 239',
        });
        expect(useChatStore.getState().messages).toHaveLength(120);
        expect(useChatStore.getState().messages[0]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-120`,
            content: 'explicit full history 120',
        });
        expect(useChatStore.getState().lastSessionLoadMetrics).toMatchObject({
            status: 'complete',
            windowMessageCount: 120,
            totalMessageCount: 240,
            fullMessageCount: 240,
            cacheHit: false,
        });

        useChatStore.setState({
            messages: [],
            sessionId: null,
            activeSession: null,
            currentCwd: null,
            lastSessionLoadMetrics: null,
        });
        await useChatStore.getState().loadSession(loadedSession);

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
        expect(useChatStore.getState().messages).toHaveLength(120);
        expect(useChatStore.getState().messages[0]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-120`,
            content: 'explicit full history 120',
        });
        expect(useChatStore.getState().lastSessionLoadMetrics).toMatchObject({
            status: 'complete',
            cacheHit: true,
            fullMessageCount: 240,
        });
    });

    it('expands a windowed session into the full transcript and caches it', async () => {
        const fullHistory: UnifiedSessionMessage[] = Array.from({length: 240}, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `expand history ${index}`,
            ts: new Date(1_786_000_000_000 + index).toISOString(),
        }));

        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') {
                return buildTestHistoryWindow(fullHistory.slice(-120), 120, fullHistory.length, false);
            }
            if (command === 'get_unified_session_messages') {
                return fullHistory;
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().loadSession(loadedSession);
        expect(useChatStore.getState().messages).toHaveLength(120);
        expect(useChatStore.getState().lastSessionLoadMetrics).toMatchObject({status: 'windowed'});

        await useChatStore.getState().expandActiveSessionHistory();

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
        expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, 'get_unified_session_messages', {
            providerId: loadedSession.providerId,
            sourcePath: loadedSession.sourcePath,
        });
        expect(useChatStore.getState().messages).toHaveLength(240);
        expect(useChatStore.getState().messages[0]).toMatchObject({
            id: `history-codex-${loadedSession.sessionId}-0`,
            content: 'expand history 0',
        });
        expect(useChatStore.getState().lastSessionLoadMetrics).toMatchObject({
            status: 'complete',
            fullMessageCount: 240,
            cacheHit: false,
        });

        // A second expand reuses the cached complete history without another backend read.
        await useChatStore.getState().expandActiveSessionHistory();
        expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
    });

    it('drops a late expansion result after the session-load token advances', async () => {
        const fullHistory: UnifiedSessionMessage[] = Array.from({length: 240}, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `late expand history ${index}`,
            ts: new Date(1_786_000_000_000 + index).toISOString(),
        }));
        let resolveFull: ((value: UnifiedSessionMessage[]) => void) | null = null;

        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'get_unified_session_message_window') {
                return Promise.resolve(buildTestHistoryWindow(fullHistory.slice(-120), 120, fullHistory.length, false));
            }
            if (command === 'get_unified_session_messages') {
                return new Promise<UnifiedSessionMessage[]>((resolve) => {
                    resolveFull = resolve;
                });
            }
            if (command === 'chat_abort') return Promise.resolve(undefined);
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().loadSession(loadedSession);
        expect(useChatStore.getState().messages).toHaveLength(120);

        const expandPromise = useChatStore.getState().expandActiveSessionHistory();
        await Promise.resolve();
        expect(resolveFull).not.toBeNull();

        // User starts a brand-new session before the expansion resolves -> token advances.
        await useChatStore.getState().startNewSession(null);

        resolveFull!(fullHistory);
        await expandPromise;

        // The late full-history result must not overwrite the new (empty) transcript.
        expect(useChatStore.getState().messages).toHaveLength(0);
        expect(useChatStore.getState().activeSession).toBeNull();
    });

    it('keeps the windowed transcript and records an error when expansion fails', async () => {
        const fullHistory: UnifiedSessionMessage[] = Array.from({length: 240}, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `failing expand history ${index}`,
            ts: new Date(1_786_000_000_000 + index).toISOString(),
        }));

        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'get_unified_session_message_window') {
                return Promise.resolve(buildTestHistoryWindow(fullHistory.slice(-120), 120, fullHistory.length, false));
            }
            if (command === 'get_unified_session_messages') {
                return Promise.reject(new Error('history unreadable'));
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().loadSession(loadedSession);
        expect(useChatStore.getState().messages).toHaveLength(120);

        await useChatStore.getState().expandActiveSessionHistory();

        // Visible window is preserved, status stays windowed so the user can retry, error is recorded.
        expect(useChatStore.getState().messages).toHaveLength(120);
        expect(useChatStore.getState().lastSessionLoadMetrics).toMatchObject({status: 'windowed'});
        expect(useChatStore.getState().error).toBe('Error: history unreadable');
    });

    it('records window timings for a large history session without full-stage noise', async () => {
        const fullHistory: UnifiedSessionMessage[] = Array.from({length: 5000}, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `metrics history ${index}`,
            ts: new Date(1_786_000_000_000 + index).toISOString(),
        }));
        const windowHistory = fullHistory.slice(-120);
        let resolveWindow: ((value: UnifiedSessionMessageWindow) => void) | null = null;
        const nowValues = [1000, 1010, 1050, 1057];
        const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
            const next = nowValues.shift();
            return next ?? 1057;
        });

        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'get_unified_session_message_window') {
                return new Promise<UnifiedSessionMessageWindow>((resolve) => {
                    resolveWindow = resolve;
                });
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        try {
            const loadPromise = useChatStore.getState().loadSession(loadedSession);
            await Promise.resolve();

            expect(resolveWindow).not.toBeNull();
            resolveWindow!(buildTestHistoryWindow(windowHistory, 4880, fullHistory.length, false));
            await Promise.resolve();
            await Promise.resolve();

            const windowMetrics = (useChatStore.getState() as {
                lastSessionLoadMetrics?: {
                    status: string;
                    cacheHit: boolean;
                    completedAt: number | null;
                    elapsedMs: number | null;
                    windowMessageCount: number;
                    totalMessageCount: number | null;
                    fullMessageCount: number | null;
                    windowLoadMs: number | null;
                    windowMapMs: number | null;
                    fullLoadMs: number | null;
                    fullMapMs: number | null;
                } | null;
            }).lastSessionLoadMetrics;

            expect(windowMetrics).toMatchObject({
                status: 'windowed',
                cacheHit: false,
                completedAt: 1057,
                elapsedMs: 57,
                windowMessageCount: 120,
                totalMessageCount: 5000,
                fullMessageCount: null,
                windowLoadMs: 40,
                windowMapMs: 7,
                fullLoadMs: null,
                fullMapMs: null,
            });
            await loadPromise;
            expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
            expect(useChatStore.getState().messages).toHaveLength(120);
            expect(useChatStore.getState().messages[0]).toMatchObject({
                id: `history-codex-${loadedSession.sessionId}-4880`,
                content: 'metrics history 4880',
            });
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('does not let a late full history load overwrite a new prompt after window first-paint', async () => {
        const fullHistory: UnifiedSessionMessage[] = Array.from({length: 5000}, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `stale full history ${index}`,
            ts: new Date(1_786_000_000_000 + index).toISOString(),
        }));
        let resolveWindow: ((value: {
            messages: UnifiedSessionMessage[];
            startIndex: number;
            totalCount: number;
            complete: boolean;
        }) => void) | null = null;
        let resolveFull: ((value: UnifiedSessionMessage[]) => void) | null = null;

        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'get_unified_session_message_window') {
                return new Promise((resolve) => {
                    resolveWindow = resolve;
                });
            }
            if (command === 'get_unified_session_messages') {
                return new Promise((resolve) => {
                    resolveFull = resolve;
                });
            }
            if (command === 'chat_send') {
                return Promise.resolve('request-after-window-history');
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        const loadPromise = useChatStore.getState().loadSession(loadedSession);
        await Promise.resolve();

        expect(resolveWindow).not.toBeNull();
        resolveWindow!({
            messages: fullHistory.slice(-120),
            startIndex: 4880,
            totalCount: fullHistory.length,
            complete: false,
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(useChatStore.getState().messages[0].content).toBe('stale full history 4880');

        await useChatStore.getState().send('continue after first paint');

        expect(useChatStore.getState()).toMatchObject({
            activeRequestId: 'request-after-window-history',
            pendingSessionKey: null,
        });

        await loadPromise;
        expect(resolveFull).toBeNull();
        expect(tauriMocks.invoke).not.toHaveBeenCalledWith('get_unified_session_messages', {
            providerId: loadedSession.providerId,
            sourcePath: loadedSession.sourcePath,
        });

        expect(useChatStore.getState()).toMatchObject({
            activeRequestId: 'request-after-window-history',
            activeSession: loadedSession,
            sessionId: loadedSession.sessionId,
        });
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
            ...fullHistory.slice(-120).map((message) => message.content),
            'continue after first paint',
            '',
        ]);
    });

    it('reloads cached sessions when lastActiveAt changes', async () => {
        const updatedSession: SessionMeta = {
            ...loadedSession,
            lastActiveAt: loadedSession.lastActiveAt + 1,
        };
        let loadCount = 0;
        tauriMocks.invoke.mockImplementation(async (command: string, args?: { sourcePath?: string }) => {
            if (command === 'get_unified_session_message_window' && args?.sourcePath === loadedSession.sourcePath) {
                loadCount += 1;
                return buildTestHistoryWindow([
                    {
                        role: 'assistant',
                        content: loadCount === 1 ? 'initial history' : 'updated history',
                        ts: '2026-06-17T08:00:03.000Z',
                    },
                ] satisfies UnifiedSessionMessage[]);
            }
            if (command === 'get_unified_session_messages') return [];
            throw new Error(`Unexpected call: ${JSON.stringify(args)}`);
        });

        await useChatStore.getState().loadSession(loadedSession);
        useChatStore.setState({
            messages: [],
            sessionId: null,
            activeSession: null,
            currentCwd: null,
        });
        await useChatStore.getState().loadSession(updatedSession);

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
        expect(useChatStore.getState().activeSession).toBe(updatedSession);
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
            'updated history',
        ]);
    });

    it('ignores stale history loads when a newer session selection finishes later', async () => {
        const newerSession: SessionMeta = {
            ...claudeSession,
            sessionId: 'claude-session-2',
            title: 'Claude session 2',
            sourcePath: 'C:/Users/Administrator/.claude/projects/project/session-2.jsonl',
            resumeCommand: 'claude --resume claude-session-2',
        };
        let resolveFirst: ((value: UnifiedSessionMessageWindow) => void) | null = null;
        let resolveSecond: ((value: UnifiedSessionMessageWindow) => void) | null = null;

        tauriMocks.invoke.mockImplementation((command: string, args?: { sourcePath?: string }) => {
            if (command === 'get_unified_session_message_window' && args?.sourcePath === loadedSession.sourcePath) {
                return new Promise<UnifiedSessionMessageWindow>((resolve) => {
                    resolveFirst = resolve;
                });
            }
            if (command === 'get_unified_session_message_window' && args?.sourcePath === newerSession.sourcePath) {
                return new Promise<UnifiedSessionMessageWindow>((resolve) => {
                    resolveSecond = resolve;
                });
            }
            if (command === 'get_unified_session_messages') return Promise.resolve([]);
            throw new Error(`Unexpected call: ${JSON.stringify(args)}`);
        });

        const firstLoad = useChatStore.getState().loadSession(loadedSession);
        const secondLoad = useChatStore.getState().loadSession(newerSession);
        await Promise.resolve();

        expect(useChatStore.getState().pendingSessionKey).toBe(getSessionSelectionKey(newerSession));

        expect(resolveSecond).not.toBeNull();
        resolveSecond!(buildTestHistoryWindow([
            {
                role: 'assistant',
                content: 'newer history',
                ts: '2026-06-17T08:00:03.000Z',
            },
        ]));
        await secondLoad;

        expect(resolveFirst).not.toBeNull();
        resolveFirst!(buildTestHistoryWindow([
            {
                role: 'assistant',
                content: 'older history',
                ts: '2026-06-17T08:00:04.000Z',
            },
        ]));
        await firstLoad;

        expect(useChatStore.getState()).toMatchObject({
            activeSession: newerSession,
            pendingSessionKey: null,
            provider: 'claude',
            sessionId: newerSession.sessionId,
        });
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['newer history']);
    });

    it('ignores a pending history load after the user sends a new message', async () => {
        let resolveHistory: ((value: UnifiedSessionMessageWindow) => void) | null = null;
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'get_unified_session_message_window') {
                return new Promise<UnifiedSessionMessageWindow>((resolve) => {
                    resolveHistory = resolve;
                });
            }
            if (command === 'get_unified_session_messages') return Promise.resolve([]);
            if (command === 'chat_send') {
                return Promise.resolve('request-after-pending-history');
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        const loadPromise = useChatStore.getState().loadSession(loadedSession);
        await Promise.resolve();
        expect(useChatStore.getState().pendingSessionKey).toBe(getSessionSelectionKey(loadedSession));

        await useChatStore.getState().send('continue with current transcript');

        expect(useChatStore.getState()).toMatchObject({
            activeRequestId: 'request-after-pending-history',
            pendingSessionKey: null,
        });

        expect(resolveHistory).not.toBeNull();
        resolveHistory!(buildTestHistoryWindow([
            {
                role: 'assistant',
                content: 'stale loaded history',
                ts: '2026-06-17T08:00:04.000Z',
            },
        ]));
        await loadPromise;

        expect(useChatStore.getState()).toMatchObject({
            activeRequestId: 'request-after-pending-history',
            activeSession: null,
            sessionId: null,
        });
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
            'continue with current transcript',
            '',
        ]);
    });

    it('preserves structured thinking and tool blocks when loading history', async () => {
        const assistantRaw: MessageRaw = {
            type: 'assistant',
            timestamp: '2026-06-17T08:00:01.000Z',
            message: {
                content: [
                    {type: 'thinking', thinking: 'I need to inspect the file first.'},
                    {
                        type: 'tool_use',
                        id: 'tool-read-1',
                        name: 'Read',
                        input: {file_path: 'src/pages/ChatPage.tsx'},
                    },
                    {type: 'text', text: 'I read the chat page.'},
                ],
            },
        };
        const toolResultRaw: MessageRaw = {
            type: 'user',
            timestamp: '2026-06-17T08:00:02.000Z',
            message: {
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'tool-read-1',
                        content: 'file contents',
                        is_error: false,
                    },
                ],
            },
        };
        const history: UnifiedSessionMessage[] = [
            {
                role: 'assistant',
                content: 'I read the chat page.',
                ts: '2026-06-17T08:00:01.000Z',
                raw: assistantRaw,
            },
            {
                role: 'user',
                content: '[tool_result]',
                ts: '2026-06-17T08:00:02.000Z',
                raw: toolResultRaw,
            },
        ];

        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') return buildTestHistoryWindow(history);
            if (command === 'get_unified_session_messages') return history;
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().loadSession(claudeSession);

        const messages = useChatStore.getState().messages;
        expect(messages[0].content).toBe('I read the chat page.');
        expect(messages[0].raw).toEqual(assistantRaw);
        expect(getRenderableContentBlocks(messages[0].raw).map((block) => block.type)).toEqual([
            'thinking',
            'tool_use',
            'text',
        ]);
        expect(findToolResult(messages, 'tool-read-1', 0)).toMatchObject({
            type: 'tool_result',
            tool_use_id: 'tool-read-1',
            content: 'file contents',
        });
    });

    it('keeps normalized Codex apply_patch history visible to edit summaries', async () => {
        const patchRaw: MessageRaw = {
            type: 'assistant',
            timestamp: '2026-06-17T08:00:01.000Z',
            message: {
                content: [
                    {
                        type: 'tool_use',
                        id: 'call-patch-1',
                        name: 'apply_patch',
                        input: {
                            patch: [
                                '*** Begin Patch',
                                '*** Update File: src/stores/useChatStore.ts',
                                '@@ -1,1 +1,2 @@',
                                ' const oldValue = true;',
                                '+const newValue = true;',
                                '*** Update File: src/components/chat/StatusPanel.tsx',
                                '@@ -2,2 +2,1 @@',
                                '-const stale = true;',
                                ' const keep = true;',
                                '*** End Patch',
                            ].join('\n'),
                        },
                    },
                ],
            },
        };
        const resultRaw: MessageRaw = {
            type: 'user',
            timestamp: '2026-06-17T08:00:02.000Z',
            message: {
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'call-patch-1',
                        content: 'Done!',
                        is_error: false,
                    },
                ],
            },
        };
        const history: UnifiedSessionMessage[] = [
            {
                role: 'assistant',
                content: '',
                ts: '2026-06-17T08:00:01.000Z',
                raw: patchRaw,
            },
            {
                role: 'user',
                content: '[tool_result]',
                ts: '2026-06-17T08:00:02.000Z',
                raw: resultRaw,
            },
        ];
        tauriMocks.invoke.mockImplementation(async (command: string) => {
            if (command === 'get_unified_session_message_window') return buildTestHistoryWindow(history);
            if (command === 'get_unified_session_messages') return history;
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().loadSession(loadedSession);

        const summary = buildChatStatusSummary(useChatStore.getState().messages);
        expect(summary.touchedFileCount).toBe(2);
        expect(summary.totalAdditions).toBe(1);
        expect(summary.totalDeletions).toBe(1);
        expect(summary.recentEdits.map((edit) => edit.displayPath)).toEqual([
            'src/components/chat/StatusPanel.tsx',
            'src/stores/useChatStore.ts',
        ]);
    });

    it('surfaces generic tool permission requests and writes allow responses', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().init();

        listeners['permission://tool']?.({
            payload: {
                requestId: 'perm-1',
                sessionId: 'session-custom',
                toolName: 'mcp__chrome-devtools__new_page',
                inputs: {
                    url: 'https://www.baidu.com',
                },
                timestamp: '2026-06-18T09:00:00.000Z',
                cwd: 'C:/guodevelop/ccg-switch',
            },
        });

        expect(useChatStore.getState().pendingToolPermission).toEqual({
            requestId: 'perm-1',
            sessionId: 'session-custom',
            toolName: 'mcp__chrome-devtools__new_page',
            inputs: {
                url: 'https://www.baidu.com',
            },
            timestamp: '2026-06-18T09:00:00.000Z',
            cwd: 'C:/guodevelop/ccg-switch',
        });

        await useChatStore.getState().answerToolPermission('perm-1', true);

        expect(tauriMocks.invoke).toHaveBeenCalledWith('permission_respond_tool', {
            requestId: 'perm-1',
            sessionId: 'session-custom',
            allow: true,
        });
        expect(useChatStore.getState().pendingToolPermission).toBeNull();
    });

    it('queues generic tool permission requests instead of overwriting the visible pending request', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().init();

        const firstRequest = {
            requestId: 'tool-1',
            sessionId: 'tool-session-1',
            toolName: 'Bash',
            inputs: {command: 'npm test'},
            timestamp: '2026-06-19T08:00:00.000Z',
            cwd: 'C:/guodevelop/ccg-switch',
        };
        const secondRequest = {
            requestId: 'tool-2',
            sessionId: 'tool-session-2',
            toolName: 'Edit',
            inputs: {file_path: 'src/App.tsx'},
            timestamp: '2026-06-19T08:00:01.000Z',
            cwd: 'C:/guodevelop/ccg-switch',
        };

        listeners['permission://tool']?.({payload: firstRequest});
        listeners['permission://tool']?.({payload: secondRequest});

        expect(useChatStore.getState().pendingToolPermission).toEqual(firstRequest);

        await useChatStore.getState().answerToolPermission('tool-1', true);

        expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, 'permission_respond_tool', {
            requestId: 'tool-1',
            sessionId: 'tool-session-1',
            allow: true,
        });
        expect(useChatStore.getState().pendingToolPermission).toEqual(secondRequest);

        await useChatStore.getState().answerToolPermission('tool-2', false);

        expect(tauriMocks.invoke).toHaveBeenNthCalledWith(3, 'permission_respond_tool', {
            requestId: 'tool-2',
            sessionId: 'tool-session-2',
            allow: false,
        });
        expect(useChatStore.getState().pendingToolPermission).toBeNull();
    });

    it('does not re-queue the same tool permission request while its response is being written', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        let resolvePermission: (() => void) | null = null;
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'chat_start_daemon') return Promise.resolve();
            if (command === 'permission_respond_tool') {
                return new Promise<void>((resolve) => {
                    resolvePermission = resolve;
                });
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().init();

        const request = {
            requestId: 'tool-1',
            toolName: 'Bash',
            inputs: {command: 'npm test'},
            timestamp: '2026-06-19T08:00:00.000Z',
            cwd: 'C:/guodevelop/ccg-switch',
        };

        listeners['permission://tool']?.({payload: request});
        const answer = useChatStore.getState().answerToolPermission('tool-1', true);
        await Promise.resolve();
        listeners['permission://tool']?.({payload: request});

        expect(resolvePermission).not.toBeNull();
        resolvePermission!();
        await answer;

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
        expect(useChatStore.getState().pendingToolPermission).toBeNull();
    });

    it('sends desktop notifications when a streaming turn completes or fails', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().init();

        useChatStore.setState({
            provider: 'codex',
            activeRequestId: 'request-success',
            messages: [
                {
                    id: 'assistant-success',
                    role: 'assistant',
                    content: 'streaming fallback',
                    streaming: true,
                    createdAt: 100,
                    raw: {
                        type: 'assistant',
                        message: {
                            content: [
                                {type: 'text', text: 'pre tool note'},
                                {type: 'tool_use', id: 'tool-1', name: 'Read', input: {file_path: 'src/main.ts'}},
                                {type: 'text', text: ' final answer preview '},
                            ],
                        },
                    },
                },
            ],
        });
        listeners['chat://done']?.({
            payload: {
                requestId: 'request-success',
                success: true,
                error: null,
            },
        });

        expect(notificationMocks.notifyChatTurnStopped).toHaveBeenCalledWith({
            outcome: 'success',
            provider: 'codex',
            detail: 'final answer preview',
        });

        useChatStore.setState({
            provider: 'claude',
            activeRequestId: 'request-error',
            messages: [
                {id: 'assistant-error', role: 'assistant', content: '', streaming: true, createdAt: 200},
            ],
        });
        listeners['chat://done']?.({
            payload: {
                requestId: 'request-error',
                success: false,
                error: 'tool failed',
            },
        });

        expect(notificationMocks.notifyChatTurnStopped).toHaveBeenLastCalledWith({
            outcome: 'error',
            provider: 'claude',
            detail: 'tool failed',
        });
    });

    it('deduplicates stopped notifications for the same request id', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().init();

        useChatStore.setState({
            provider: 'codex',
            activeRequestId: 'request-duplicate',
            messages: [
                {id: 'assistant-duplicate', role: 'assistant', content: 'done once', streaming: true, createdAt: 210},
            ],
        });

        listeners['chat://done']?.({
            payload: {
                requestId: 'request-duplicate',
                success: true,
                error: null,
            },
        });
        listeners['chat://done']?.({
            payload: {
                requestId: 'request-duplicate',
                success: true,
                error: null,
            },
        });

        expect(notificationMocks.notifyChatTurnStopped).toHaveBeenCalledTimes(1);
        expect(notificationMocks.notifyChatTurnStopped).toHaveBeenCalledWith({
            outcome: 'success',
            provider: 'codex',
            detail: 'done once',
        });
    });

    it('ignores stale stream, message, and done events from another active request', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().init();

        useChatStore.setState({
            provider: 'claude',
            activeRequestId: 'request-current',
            messages: [
                {id: 'user-current', role: 'user', content: 'current prompt', createdAt: 100},
                {id: 'assistant-current', role: 'assistant', content: '', streaming: true, createdAt: 101},
            ],
        });

        const staleRaw: MessageRaw = {
            type: 'assistant',
            message: {
                content: [
                    {type: 'tool_use', id: 'stale-tool', name: 'Read', input: {file_path: 'stale.ts'}},
                ],
            },
        };

        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-stale',
                kind: 'line',
                text: '[CONTENT_DELTA] "stale text"',
            },
        });
        listeners['chat://message']?.({
            payload: {
                requestId: 'request-stale',
                json: JSON.stringify(staleRaw),
            },
        });
        listeners['chat://done']?.({
            payload: {
                requestId: 'request-stale',
                success: true,
                error: null,
            },
        });

        expect(useChatStore.getState().activeRequestId).toBe('request-current');
        expect(useChatStore.getState().messages[1]).toMatchObject({
            content: '',
            streaming: true,
        });
        expect(useChatStore.getState().messages[1].raw).toBeUndefined();
        expect(notificationMocks.notifyChatTurnStopped).not.toHaveBeenCalled();

        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-current',
                kind: 'line',
                text: '[CONTENT_DELTA] "current text"',
            },
        });
        listeners['chat://message']?.({
            payload: {
                requestId: 'request-current',
                json: JSON.stringify(staleRaw),
            },
        });
        listeners['chat://done']?.({
            payload: {
                requestId: 'request-current',
                success: true,
                error: null,
            },
        });

        expect(useChatStore.getState().activeRequestId).toBeNull();
        const currentAssistantMessage = useChatStore.getState().messages[1];
        expect(currentAssistantMessage).toMatchObject({
            content: 'current text',
            streaming: false,
        });
        expect(getRenderableContentBlocks(currentAssistantMessage.raw).map((block) => block.type)).toEqual([
            'text',
            'tool_use',
        ]);
        expect(notificationMocks.notifyChatTurnStopped).toHaveBeenCalledTimes(1);
    });

    it('stores usage max_tokens from stream events and preserves it for legacy usage payloads', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().init();

        useChatStore.setState({
            provider: 'claude',
            activeRequestId: 'request-usage',
            messages: [
                {id: 'user-usage', role: 'user', content: 'usage prompt', createdAt: 100},
                {id: 'assistant-usage', role: 'assistant', content: '', streaming: true, createdAt: 101},
            ],
        });

        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-usage',
                kind: 'line',
                text: '[USAGE] {"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":25,"cache_read_input_tokens":10,"max_tokens":1000000}',
            },
        });

        expect(useChatStore.getState()).toMatchObject({
            contextTokens: 185,
            contextMaxTokens: 1_000_000,
        });
        expect(useChatStore.getState().messages[1].usage).toMatchObject({
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 25,
            cache_read_input_tokens: 10,
            max_tokens: 1_000_000,
        });

        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-usage',
                kind: 'line',
                text: '[USAGE] {"input_tokens":120,"output_tokens":60,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}',
            },
        });

        expect(useChatStore.getState()).toMatchObject({
            contextTokens: 180,
            contextMaxTokens: 1_000_000,
        });
    });

    it('keeps later streamed assistant text visible after raw tool blocks arrive', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'chat_start_daemon') return Promise.resolve(undefined);
            if (command === 'chat_send') return Promise.resolve('request-live');
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().init();
        const sent = await useChatStore.getState().send('Inspect the render path');

        expect(sent).toBe(true);
        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-live',
                kind: 'line',
                text: '[CONTENT_DELTA] "I will inspect the file.\\n"',
            },
        });
        listeners['chat://message']?.({
            payload: {
                requestId: 'request-live',
                json: JSON.stringify({
                    type: 'assistant',
                    message: {
                        content: [
                            {type: 'tool_use', id: 'tool-read-live', name: 'Read', input: {file_path: 'src/components/chat/MessageItem.tsx'}},
                        ],
                    },
                } satisfies MessageRaw),
            },
        });
        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-live',
                kind: 'line',
                text: '[CONTENT_DELTA] "It contains the raw block render path."',
            },
        });
        listeners['chat://done']?.({
            payload: {
                requestId: 'request-live',
                success: true,
                error: null,
            },
        });

        const assistantMessage = useChatStore.getState().messages[1];
        expect(assistantMessage).toMatchObject({
            content: 'I will inspect the file.\nIt contains the raw block render path.',
            streaming: false,
        });
        const blocks = getRenderableContentBlocks(assistantMessage.raw);
        // 源顺序：text(已说) → tool_use → text(工具后继续说)，不再聚类为单条文本块。
        expect(blocks.map((block) => block.type)).toEqual(['text', 'tool_use', 'text']);
        expect(blocks[0]).toMatchObject({
            type: 'text',
            text: 'I will inspect the file.\n',
        });
        expect(blocks[1]).toMatchObject({
            type: 'tool_use',
            id: 'tool-read-live',
        });
        expect(blocks[2]).toMatchObject({
            type: 'text',
            text: 'It contains the raw block render path.',
        });
    });

    it('routes sub-agent messages (parent_tool_use_id) into subagentRuns, not the main transcript', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'chat_start_daemon') return Promise.resolve(undefined);
            if (command === 'chat_send') return Promise.resolve('request-agent');
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().init();
        const sent = await useChatStore.getState().send('Launch a sub-agent');
        expect(sent).toBe(true);

        // Main assistant spawns a Task tool_use — this stays in the main transcript.
        listeners['chat://message']?.({
            payload: {
                requestId: 'request-agent',
                json: JSON.stringify({
                    type: 'assistant',
                    message: {
                        content: [{
                            type: 'tool_use',
                            id: 'toolu_taskA',
                            name: 'Task',
                            input: {description: 'A', prompt: 'You are sub-agent A'},
                        }],
                    },
                } satisfies MessageRaw),
            },
        });

        // Sub-agent prompt arrives WITH parent_tool_use_id (legacy [MESSAGE] form) — must not leak.
        listeners['chat://message']?.({
            payload: {
                requestId: 'request-agent',
                json: JSON.stringify({
                    type: 'user',
                    parent_tool_use_id: 'toolu_taskA',
                    message: {content: [{type: 'text', text: 'You are sub-agent A. Report your id.'}]},
                } satisfies MessageRaw),
            },
        });

        // Sub-agent reply via the dedicated channel.
        listeners['chat://subagent-message']?.({
            payload: {
                requestId: 'request-agent',
                parentToolUseId: 'toolu_taskA',
                json: JSON.stringify({
                    type: 'assistant',
                    parent_tool_use_id: 'toolu_taskA',
                    message: {content: [{type: 'text', text: 'I am sub-agent A.'}]},
                } satisfies MessageRaw),
            },
        });

        const state = useChatStore.getState();
        const mainText = state.messages.map((message) => message.content).join('\n');
        expect(mainText).not.toContain('You are sub-agent A. Report your id.');
        expect(mainText).not.toContain('I am sub-agent A.');

        const run = state.subagentRuns['toolu_taskA'];
        expect(run).toBeTruthy();
        const runText = run.map((message) => message.content).join('\n');
        expect(runText).toContain('You are sub-agent A. Report your id.');
        expect(runText).toContain('I am sub-agent A.');
    });

    it('deduplicates assistant text raw deltas after streamed content was synced into raw', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'chat_start_daemon') return Promise.resolve(undefined);
            if (command === 'chat_send') return Promise.resolve('request-snapshot');
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().init();
        await useChatStore.getState().send('Inspect the render path');

        const fullText = 'I will inspect the file.\nIt contains the raw block render path.';
        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-snapshot',
                kind: 'line',
                text: '[CONTENT_DELTA] "I will inspect the file.\\n"',
            },
        });
        listeners['chat://message']?.({
            payload: {
                requestId: 'request-snapshot',
                json: JSON.stringify({
                    type: 'assistant',
                    message: {
                        content: [
                            {type: 'tool_use', id: 'tool-read-snapshot', name: 'Read', input: {file_path: 'src/components/chat/MessageItem.tsx'}},
                        ],
                    },
                } satisfies MessageRaw),
            },
        });
        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-snapshot',
                kind: 'line',
                text: '[CONTENT_DELTA] "It contains the raw block render path."',
            },
        });
        listeners['chat://message']?.({
            payload: {
                requestId: 'request-snapshot',
                json: JSON.stringify({
                    type: 'assistant',
                    message: {
                        content: [
                            {type: 'text', text: 'It contains the raw block render path.'},
                        ],
                    },
                } satisfies MessageRaw),
            },
        });
        listeners['chat://done']?.({
            payload: {
                requestId: 'request-snapshot',
                success: true,
                error: null,
            },
        });

        const assistantMessage = useChatStore.getState().messages[1];
        const blocks = getRenderableContentBlocks(assistantMessage.raw);
        // 源顺序保留为 text → tool_use → text；重复的 text raw 快照被去重，
        // 不产生第 4 个重复文本块。
        expect(blocks).toHaveLength(3);
        expect(blocks.map((block) => block.type)).toEqual(['text', 'tool_use', 'text']);
        expect(blocks[0]).toMatchObject({type: 'text', text: 'I will inspect the file.\n'});
        expect(blocks[1]).toMatchObject({type: 'tool_use', id: 'tool-read-snapshot'});
        expect(blocks[2]).toMatchObject({type: 'text', text: 'It contains the raw block render path.'});
        expect(assistantMessage.content).toBe(fullText);
    });

    it('preserves arrival order across BLOCK_RESET for a text -> tool -> text -> tool live turn', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'chat_start_daemon') return Promise.resolve(undefined);
            if (command === 'chat_send') return Promise.resolve('request-interleave');
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().init();
        await useChatStore.getState().send('Do several talk + tool cycles');

        const stream = (text: string) => listeners['chat://stream']?.({
            payload: {requestId: 'request-interleave', kind: 'line', text},
        });
        const toolMessage = (id: string) => listeners['chat://message']?.({
            payload: {
                requestId: 'request-interleave',
                json: JSON.stringify({
                    type: 'assistant',
                    message: {
                        content: [
                            {type: 'tool_use', id, name: 'Read', input: {file_path: `${id}.ts`}},
                        ],
                    },
                } satisfies MessageRaw),
            },
        });

        // text1 -> [BLOCK_RESET] -> tool1 -> text2 -> tool2
        stream('[CONTENT_DELTA] "First I will look."');
        stream('[BLOCK_RESET]');
        toolMessage('tool-1');
        stream('[CONTENT_DELTA] "Now I continue."');
        toolMessage('tool-2');
        listeners['chat://done']?.({
            payload: {requestId: 'request-interleave', success: true, error: null},
        });

        const assistantMessage = useChatStore.getState().messages[1];
        const blocks = getRenderableContentBlocks(assistantMessage.raw);
        expect(blocks.map((block) => block.type)).toEqual(['text', 'tool_use', 'text', 'tool_use']);
        expect(blocks[0]).toMatchObject({type: 'text', text: 'First I will look.'});
        expect(blocks[1]).toMatchObject({type: 'tool_use', id: 'tool-1'});
        expect(blocks[2]).toMatchObject({type: 'text', text: 'Now I continue.'});
        expect(blocks[3]).toMatchObject({type: 'tool_use', id: 'tool-2'});
    });

    it('does not bind a retired request to the next pending turn', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        let resolveSend: ((requestId: string) => void) | null = null;
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'chat_start_daemon') return Promise.resolve(undefined);
            if (command === 'chat_send') {
                return new Promise<string>((resolve) => {
                    resolveSend = resolve;
                });
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().init();

        useChatStore.setState({
            provider: 'claude',
            activeRequestId: 'request-old',
            messages: [
                {id: 'user-old', role: 'user', content: 'old prompt', createdAt: 100},
                {id: 'assistant-old', role: 'assistant', content: 'old answer', streaming: true, createdAt: 101},
            ],
        });

        listeners['chat://done']?.({
            payload: {
                requestId: 'request-old',
                success: true,
                error: null,
            },
        });

        const sendPromise = useChatStore.getState().send('new prompt');
        await Promise.resolve();

        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-old',
                kind: 'line',
                text: '[CONTENT_DELTA] "stale after done"',
            },
        });

        let messages = useChatStore.getState().messages;
        expect(messages[messages.length - 1]).toMatchObject({
            role: 'assistant',
            content: '',
            streaming: true,
        });
        expect(useChatStore.getState().activeRequestId).toBeNull();

        expect(resolveSend).not.toBeNull();
        resolveSend!('request-new');
        await sendPromise;

        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-new',
                kind: 'line',
                text: '[CONTENT_DELTA] "new text"',
            },
        });

        expect(useChatStore.getState().activeRequestId).toBe('request-new');
        messages = useChatStore.getState().messages;
        expect(messages[messages.length - 1]).toMatchObject({
            content: 'new text',
            streaming: true,
        });
    });

    it('does not bind a request id that resolves after the transcript was cleared', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        const pendingSends: Array<(requestId: string) => void> = [];
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'chat_start_daemon') return Promise.resolve(undefined);
            if (command === 'chat_abort') return Promise.resolve(undefined);
            if (command === 'chat_send') {
                return new Promise<string>((resolve) => {
                    pendingSends.push(resolve);
                });
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().init();

        const firstSend = useChatStore.getState().send('first prompt');
        await Promise.resolve();
        expect(useChatStore.getState().messages).toHaveLength(2);

        await useChatStore.getState().clear();
        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_abort');
        expect(useChatStore.getState()).toMatchObject({
            messages: [],
            activeRequestId: null,
        });

        const secondSend = useChatStore.getState().send('second prompt');
        await Promise.resolve();
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
            'second prompt',
            '',
        ]);

        pendingSends[0]?.('request-old');
        await firstSend;
        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-old',
                kind: 'line',
                text: '[CONTENT_DELTA] "old stale text"',
            },
        });

        let messages = useChatStore.getState().messages;
        expect(useChatStore.getState().activeRequestId).toBeNull();
        expect(messages[messages.length - 1]).toMatchObject({
            role: 'assistant',
            content: '',
            streaming: true,
        });

        pendingSends[1]?.('request-new');
        await secondSend;
        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-new',
                kind: 'line',
                text: '[CONTENT_DELTA] "new text"',
            },
        });

        expect(useChatStore.getState().activeRequestId).toBe('request-new');
        messages = useChatStore.getState().messages;
        expect(messages[messages.length - 1]).toMatchObject({
            content: 'new text',
            streaming: true,
        });
    });

    it('updates provider, model, mode, and reasoning for the next turn while a request is active', () => {
        useChatStore.setState({
            activeRequestId: 'request-current',
            provider: 'claude',
            model: 'claude-opus-4-8',
            permissionMode: 'default',
            reasoningEffort: 'high',
            sessionId: 'claude-session',
            activeSession: claudeSession,
            pendingSessionKey: 'pending-session',
        });

        useChatStore.getState().setProvider('codex');
        useChatStore.getState().setModel('gpt-5.2-codex');
        useChatStore.getState().setPermissionMode('bypassPermissions');
        useChatStore.getState().setReasoningEffort('low');

        expect(useChatStore.getState()).toMatchObject({
            activeRequestId: 'request-current',
            provider: 'codex',
            model: 'gpt-5.2-codex',
            permissionMode: 'bypassPermissions',
            reasoningEffort: 'low',
            sessionId: null,
            activeSession: null,
            pendingSessionKey: null,
        });
    });

    it('routes streaming events back to the original tab after switching sessions', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        let resolveSend: ((requestId: string) => void) | null = null;
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'chat_start_daemon') return Promise.resolve(undefined);
            if (command === 'chat_send') {
                return new Promise<string>((resolve) => {
                    resolveSend = resolve;
                });
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        await useChatStore.getState().init();
        useChatStore.setState({
            provider: 'codex',
            model: 'gpt-5.2-codex',
            currentCwd: 'C:/guodevelop/ccg-switch',
        });

        const sendPromise = useChatStore.getState().send('run in the first tab');
        await Promise.resolve();

        const stateWithTabs = useChatStore.getState() as ReturnType<typeof useChatStore.getState> & {
            activeTabKey: string | null;
            focusTab: (key: string) => void;
            openTabs: Array<{key: string; status: string; activeRequestId: string | null}>;
        };
        const originalTabKey = stateWithTabs.activeTabKey;
        expect(originalTabKey).toEqual(expect.any(String));
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
            'run in the first tab',
            '',
        ]);

        await useChatStore.getState().startNewSession('C:/guodevelop/other-project');

        expect(tauriMocks.invoke).not.toHaveBeenCalledWith('chat_abort');
        expect((useChatStore.getState() as typeof stateWithTabs).activeTabKey).not.toBe(originalTabKey);
        expect(useChatStore.getState().messages).toEqual([]);

        expect(resolveSend).not.toBeNull();
        resolveSend!('request-background');
        await sendPromise;

        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-background',
                kind: 'line',
                text: '[CONTENT_DELTA] "background result"',
            },
        });

        expect(useChatStore.getState().messages).toEqual([]);
        const backgroundTab = (useChatStore.getState() as typeof stateWithTabs).openTabs
            .find((tab) => tab.key === originalTabKey);
        expect(backgroundTab).toMatchObject({
            status: 'running',
            activeRequestId: 'request-background',
        });

        (useChatStore.getState() as typeof stateWithTabs).focusTab(originalTabKey!);

        expect(useChatStore.getState()).toMatchObject({
            activeRequestId: 'request-background',
            currentCwd: 'C:/guodevelop/ccg-switch',
        });
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
            'run in the first tab',
            'background result',
        ]);
    });

    it('closes the current tab and focuses the most recently used remaining tab', () => {
        const makeTab = (key: string, content: string, updatedAt: number) => ({
            key,
            messages: [{
                id: `${key}-user`,
                role: 'user' as const,
                content,
                createdAt: updatedAt,
            }],
            provider: 'claude' as const,
            permissionMode: 'default' as const,
            model: 'claude-opus-4-8',
            reasoningEffort: 'high' as const,
            draft: '',
            longContextEnabled: true,
            contextTokens: 0,
            contextMaxTokens: null,
            activeRequestId: null,
            sessionId: key,
            currentCwd: `C:/workspace/${key}`,
            activeSession: null,
            pendingSessionKey: null,
            lastSessionLoadMetrics: null,
            handoffContextProvider: null,
            status: 'idle' as const,
            error: null,
            createdAt: updatedAt,
            updatedAt,
        });
        const tabs = [
            makeTab('session:older', 'older tab', 100),
            makeTab('session:recent', 'recent tab', 300),
            makeTab('session:active', 'active tab', 200),
        ];
        useChatStore.setState({
            openTabs: tabs,
            activeTabKey: 'session:active',
            messages: tabs[2].messages,
            sessionId: tabs[2].sessionId,
            currentCwd: tabs[2].currentCwd,
        } as Partial<ReturnType<typeof useChatStore.getState>>);

        (useChatStore.getState() as ReturnType<typeof useChatStore.getState> & {
            closeTab: (key: string) => void;
        }).closeTab('session:active');

        expect(useChatStore.getState()).toMatchObject({
            activeTabKey: 'session:recent',
            sessionId: 'session:recent',
            currentCwd: 'C:/workspace/session:recent',
        });
        expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['recent tab']);
        expect(useChatStore.getState().openTabs.map((tab) => tab.key)).toEqual([
            'session:older',
            'session:recent',
        ]);
    });

    it('ignores duplicate ask-user-question responses after the pending request is cleared', async () => {
        useChatStore.setState({
            pendingAskUserQuestion: {
                requestId: 'ask-1',
                toolName: 'AskUserQuestion',
                questions: [],
                timestamp: '2026-06-19T08:00:00.000Z',
                cwd: 'C:/guodevelop/ccg-switch',
            },
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().answerAskUserQuestion('ask-1', {});
        await useChatStore.getState().answerAskUserQuestion('ask-1', {});

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
        expect(tauriMocks.invoke).toHaveBeenCalledWith('permission_respond_ask_user_question', {
            requestId: 'ask-1',
            sessionId: 'default',
            answers: {},
        });
        expect(useChatStore.getState().pendingAskUserQuestion).toBeNull();
    });

    it('closes every tab except the requested one and projects that tab', () => {
        useChatStore.setState({
            activeTabKey: 'session:active',
            messages: [{id: 'active-message', role: 'user', content: 'active', createdAt: 1}],
            provider: 'claude',
            currentCwd: 'C:/workspace/active',
            openTabs: [
                {
                    key: 'session:active',
                    subagentRuns: {},
                    messages: [{id: 'active-message', role: 'user', content: 'active', createdAt: 1}],
                    provider: 'claude',
                    permissionMode: 'default',
                    model: 'claude-opus-4-8',
                    reasoningEffort: 'high',
                    draft: '',
                    longContextEnabled: true,
                    contextTokens: 0,
                    contextMaxTokens: null,
                    activeRequestId: null,
                    sessionId: null,
                    currentCwd: 'C:/workspace/active',
                    activeSession: null,
                    pendingSessionKey: null,
                    lastSessionLoadMetrics: null,
                    handoffContextProvider: null,
                    status: 'idle',
                    error: null,
                    createdAt: 1,
                    updatedAt: 1,
                },
                {
                    key: 'session:target',
                    subagentRuns: {},
                    messages: [{id: 'target-message', role: 'user', content: 'target', createdAt: 2}],
                    provider: 'codex',
                    permissionMode: 'bypassPermissions',
                    model: 'gpt-5-codex',
                    reasoningEffort: 'medium',
                    draft: 'target draft',
                    longContextEnabled: false,
                    contextTokens: 10,
                    contextMaxTokens: 400000,
                    activeRequestId: null,
                    sessionId: 'target-session',
                    currentCwd: 'C:/workspace/target',
                    activeSession: loadedSession,
                    pendingSessionKey: null,
                    lastSessionLoadMetrics: null,
                    handoffContextProvider: null,
                    status: 'idle',
                    error: null,
                    createdAt: 2,
                    updatedAt: 8,
                },
                {
                    key: 'session:other',
                    subagentRuns: {},
                    messages: [],
                    provider: 'claude',
                    permissionMode: 'default',
                    model: 'claude-opus-4-8',
                    reasoningEffort: 'high',
                    draft: '',
                    longContextEnabled: true,
                    contextTokens: 0,
                    contextMaxTokens: null,
                    activeRequestId: null,
                    sessionId: null,
                    currentCwd: 'C:/workspace/other',
                    activeSession: null,
                    pendingSessionKey: null,
                    lastSessionLoadMetrics: null,
                    handoffContextProvider: null,
                    status: 'idle',
                    error: null,
                    createdAt: 3,
                    updatedAt: 3,
                },
            ],
        });

        useChatStore.getState().closeOtherTabs('session:target');

        expect(useChatStore.getState().openTabs.map((tab) => tab.key)).toEqual(['session:target']);
        expect(useChatStore.getState()).toMatchObject({
            activeTabKey: 'session:target',
            provider: 'codex',
            model: 'gpt-5-codex',
            draft: 'target draft',
            sessionId: 'target-session',
            currentCwd: 'C:/workspace/target',
        });
        expect(useChatStore.getState().messages).toEqual([
            {id: 'target-message', role: 'user', content: 'target', createdAt: 2},
        ]);
    });

    it('closes all tabs and returns to an empty draft projection', () => {
        useChatStore.setState({
            activeTabKey: 'session:active',
            messages: [{id: 'active-message', role: 'user', content: 'active', createdAt: 1}],
            provider: 'codex',
            model: 'gpt-5-codex',
            draft: 'active draft',
            sessionId: 'active-session',
            currentCwd: 'C:/workspace/active',
            activeSession: loadedSession,
            openTabs: [
                {
                    key: 'session:active',
                    subagentRuns: {},
                    messages: [{id: 'active-message', role: 'user', content: 'active', createdAt: 1}],
                    provider: 'codex',
                    permissionMode: 'default',
                    model: 'gpt-5-codex',
                    reasoningEffort: 'high',
                    draft: 'active draft',
                    longContextEnabled: false,
                    contextTokens: 11,
                    contextMaxTokens: 400000,
                    activeRequestId: null,
                    sessionId: 'active-session',
                    currentCwd: 'C:/workspace/active',
                    activeSession: loadedSession,
                    pendingSessionKey: null,
                    lastSessionLoadMetrics: null,
                    handoffContextProvider: null,
                    status: 'idle',
                    error: null,
                    createdAt: 1,
                    updatedAt: 2,
                },
            ],
        });

        useChatStore.getState().closeAllTabs();

        expect(useChatStore.getState().openTabs).toEqual([]);
        expect(useChatStore.getState()).toMatchObject({
            activeTabKey: null,
            messages: [],
            draft: '',
            sessionId: null,
            activeSession: null,
            pendingSessionKey: null,
            lastSessionLoadMetrics: null,
            handoffContextProvider: null,
            contextTokens: 0,
            contextMaxTokens: null,
        });
        expect(useChatStore.getState().currentCwd).toBe('C:/workspace/active');
    });

    it('ignores concurrent duplicate ask-user-question responses before invoke resolves', async () => {
        let resolvePermission: (() => void) | null = null;
        useChatStore.setState({
            pendingAskUserQuestion: {
                requestId: 'ask-1',
                toolName: 'AskUserQuestion',
                questions: [],
                timestamp: '2026-06-19T08:00:00.000Z',
                cwd: 'C:/guodevelop/ccg-switch',
            },
        });
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'permission_respond_ask_user_question') {
                return new Promise<void>((resolve) => {
                    resolvePermission = resolve;
                });
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        const first = useChatStore.getState().answerAskUserQuestion('ask-1', {});
        const second = useChatStore.getState().answerAskUserQuestion('ask-1', {});
        await Promise.resolve();

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().pendingAskUserQuestion).toBeNull();

        expect(resolvePermission).not.toBeNull();
        resolvePermission!();
        await Promise.all([first, second]);
    });

    it('restores an equivalent fresh ask-user-question request when the response invoke fails', async () => {
        const pendingAskUserQuestion = {
            requestId: 'ask-1',
            toolName: 'AskUserQuestion',
            questions: [],
            timestamp: '2026-06-19T08:00:00.000Z',
            cwd: 'C:/guodevelop/ccg-switch',
        };
        useChatStore.setState({pendingAskUserQuestion});
        tauriMocks.invoke.mockRejectedValue(new Error('ask response write failed'));

        await useChatStore.getState().answerAskUserQuestion('ask-1', {});

        const restored = useChatStore.getState().pendingAskUserQuestion;
        expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().error).toContain('ask response write failed');
        expect(restored).toEqual(pendingAskUserQuestion);
        expect(restored).not.toBe(pendingAskUserQuestion);
    });

    it('queues ask-user-question requests instead of overwriting the visible pending request', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().init();

        const firstRequest = {
            requestId: 'ask-1',
            sessionId: 'ask-session-1',
            toolName: 'AskUserQuestion',
            questions: [],
            timestamp: '2026-06-19T08:00:00.000Z',
            cwd: 'C:/guodevelop/ccg-switch',
        };
        const secondRequest = {
            requestId: 'ask-2',
            sessionId: 'ask-session-2',
            toolName: 'AskUserQuestion',
            questions: [],
            timestamp: '2026-06-19T08:00:01.000Z',
            cwd: 'C:/guodevelop/ccg-switch',
        };

        listeners['permission://ask-user-question']?.({payload: firstRequest});
        listeners['permission://ask-user-question']?.({payload: secondRequest});

        expect(useChatStore.getState().pendingAskUserQuestion).toEqual(firstRequest);

        await useChatStore.getState().answerAskUserQuestion('ask-1', {});

        expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, 'permission_respond_ask_user_question', {
            requestId: 'ask-1',
            sessionId: 'ask-session-1',
            answers: {},
        });
        expect(useChatStore.getState().pendingAskUserQuestion).toEqual(secondRequest);

        await useChatStore.getState().answerAskUserQuestion('ask-2', {});

        expect(tauriMocks.invoke).toHaveBeenNthCalledWith(3, 'permission_respond_ask_user_question', {
            requestId: 'ask-2',
            sessionId: 'ask-session-2',
            answers: {},
        });
        expect(useChatStore.getState().pendingAskUserQuestion).toBeNull();
    });

    it('ignores duplicate tool permission responses after the pending request is cleared', async () => {
        useChatStore.setState({
            pendingToolPermission: {
                requestId: 'tool-1',
                toolName: 'Bash',
                inputs: {command: 'npm test'},
                timestamp: '2026-06-19T08:00:00.000Z',
                cwd: 'C:/guodevelop/ccg-switch',
            },
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().answerToolPermission('tool-1', true);
        await useChatStore.getState().answerToolPermission('tool-1', true);

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
        expect(tauriMocks.invoke).toHaveBeenCalledWith('permission_respond_tool', {
            requestId: 'tool-1',
            sessionId: 'default',
            allow: true,
        });
        expect(useChatStore.getState().pendingToolPermission).toBeNull();
    });

    it('ignores concurrent duplicate tool permission responses before invoke resolves', async () => {
        let resolvePermission: (() => void) | null = null;
        useChatStore.setState({
            pendingToolPermission: {
                requestId: 'tool-1',
                toolName: 'Edit',
                inputs: {file_path: 'src/App.tsx'},
                timestamp: '2026-06-19T08:00:00.000Z',
                cwd: 'C:/guodevelop/ccg-switch',
            },
        });
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'permission_respond_tool') {
                return new Promise<void>((resolve) => {
                    resolvePermission = resolve;
                });
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        const first = useChatStore.getState().answerToolPermission('tool-1', true);
        const second = useChatStore.getState().answerToolPermission('tool-1', true);
        await Promise.resolve();

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().pendingToolPermission).toBeNull();

        expect(resolvePermission).not.toBeNull();
        resolvePermission!();
        await Promise.all([first, second]);
    });

    it('restores an equivalent fresh pending tool permission when the response invoke fails', async () => {
        const pendingToolPermission = {
            requestId: 'tool-1',
            toolName: 'Write',
            inputs: {file_path: 'src/generated.ts'},
            timestamp: '2026-06-19T08:00:00.000Z',
            cwd: 'C:/guodevelop/ccg-switch',
        };
        useChatStore.setState({pendingToolPermission});
        tauriMocks.invoke.mockRejectedValue(new Error('permission write failed'));

        await useChatStore.getState().answerToolPermission('tool-1', false);

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().error).toContain('permission write failed');
        expect(useChatStore.getState().pendingToolPermission).toEqual(pendingToolPermission);
        expect(useChatStore.getState().pendingToolPermission).not.toBe(pendingToolPermission);
    });

    it('ignores duplicate plan approval responses after the pending request is cleared', async () => {
        useChatStore.setState({
            pendingPlanApproval: {
                requestId: 'plan-1',
                sessionId: 'plan-session-1',
                toolName: 'Plan',
                plan: '1. Inspect\n2. Edit\n3. Verify',
                allowedPrompts: [],
                timestamp: '2026-06-19T08:00:00.000Z',
                cwd: 'C:/guodevelop/ccg-switch',
            },
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().approvePlan('plan-1', true, 'default');
        await useChatStore.getState().approvePlan('plan-1', true, 'default');

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
        expect(tauriMocks.invoke).toHaveBeenCalledWith('permission_respond_plan_approval', {
            requestId: 'plan-1',
            sessionId: 'plan-session-1',
            approved: true,
            targetMode: 'default',
            message: null,
        });
        expect(useChatStore.getState().pendingPlanApproval).toBeNull();
    });

    it('ignores concurrent duplicate plan approval responses before invoke resolves', async () => {
        let resolvePermission: (() => void) | null = null;
        useChatStore.setState({
            pendingPlanApproval: {
                requestId: 'plan-1',
                toolName: 'Plan',
                plan: '1. Inspect\n2. Edit\n3. Verify',
                allowedPrompts: [],
                timestamp: '2026-06-19T08:00:00.000Z',
                cwd: 'C:/guodevelop/ccg-switch',
            },
        });
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'permission_respond_plan_approval') {
                return new Promise<void>((resolve) => {
                    resolvePermission = resolve;
                });
            }
            throw new Error(`Unexpected command: ${command}`);
        });

        const first = useChatStore.getState().approvePlan('plan-1', true, 'auto');
        const second = useChatStore.getState().approvePlan('plan-1', true, 'auto');
        await Promise.resolve();

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().pendingPlanApproval).toBeNull();

        expect(resolvePermission).not.toBeNull();
        resolvePermission!();
        await Promise.all([first, second]);
    });

    it('restores an equivalent fresh pending plan approval when the response invoke fails', async () => {
        const pendingPlanApproval = {
            requestId: 'plan-1',
            toolName: 'Plan',
            plan: '1. Inspect\n2. Edit\n3. Verify',
            allowedPrompts: [],
            timestamp: '2026-06-19T08:00:00.000Z',
            cwd: 'C:/guodevelop/ccg-switch',
        };
        useChatStore.setState({pendingPlanApproval});
        tauriMocks.invoke.mockRejectedValue(new Error('plan approval write failed'));

        await useChatStore.getState().approvePlan('plan-1', false, 'default');

        expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().error).toContain('plan approval write failed');
        expect(useChatStore.getState().pendingPlanApproval).toEqual(pendingPlanApproval);
        expect(useChatStore.getState().pendingPlanApproval).not.toBe(pendingPlanApproval);
    });

    it('queues plan approval requests instead of overwriting the visible pending request', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().init();

        const firstRequest = {
            requestId: 'plan-1',
            sessionId: 'plan-session-1',
            toolName: 'Plan',
            plan: '1. Inspect',
            allowedPrompts: [],
            timestamp: '2026-06-19T08:00:00.000Z',
            cwd: 'C:/guodevelop/ccg-switch',
        };
        const secondRequest = {
            requestId: 'plan-2',
            sessionId: 'plan-session-2',
            toolName: 'Plan',
            plan: '1. Verify',
            allowedPrompts: [],
            timestamp: '2026-06-19T08:00:01.000Z',
            cwd: 'C:/guodevelop/ccg-switch',
        };

        listeners['permission://plan-approval']?.({payload: firstRequest});
        listeners['permission://plan-approval']?.({payload: secondRequest});

        expect(useChatStore.getState().pendingPlanApproval).toEqual(firstRequest);

        await useChatStore.getState().approvePlan('plan-1', true, 'default');

        expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, 'permission_respond_plan_approval', {
            requestId: 'plan-1',
            sessionId: 'plan-session-1',
            approved: true,
            targetMode: 'default',
            message: null,
        });
        expect(useChatStore.getState().pendingPlanApproval).toEqual(secondRequest);

        await useChatStore.getState().approvePlan('plan-2', false, 'default');

        expect(tauriMocks.invoke).toHaveBeenNthCalledWith(3, 'permission_respond_plan_approval', {
            requestId: 'plan-2',
            sessionId: 'plan-session-2',
            approved: false,
            targetMode: 'default',
            message: null,
        });
        expect(useChatStore.getState().pendingPlanApproval).toBeNull();
    });

    it('sends a desktop notification when the user aborts a streaming turn', async () => {
        useChatStore.setState({
            provider: 'claude',
            activeRequestId: 'request-abort',
            messages: [
                {id: 'assistant-abort', role: 'assistant', content: 'partial', streaming: true, createdAt: 300},
            ],
        });
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().abort();

        expect(notificationMocks.prepareChatTurnStoppedNotificationPermission).toHaveBeenCalledTimes(1);
        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_abort');
        expect(notificationMocks.notifyChatTurnStopped).toHaveBeenCalledWith({
            outcome: 'aborted',
            provider: 'claude',
            detail: 'partial',
        });
        expect(useChatStore.getState().messages[0]).toMatchObject({
            streaming: false,
            error: '已停止输出',
        });
    });

    it('saves Codex THREAD_ID and resumes Codex turns with threadId', async () => {
        const listeners: Record<string, (event: { payload: unknown }) => void> = {};
        tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
            listeners[eventName] = callback;
            return vi.fn();
        });
        tauriMocks.invoke.mockResolvedValue('request-1');

        await useChatStore.getState().init();

        useChatStore.setState({
            activeRequestId: 'request-1',
            messages: [
                {id: 'user-thread', role: 'user', content: 'start codex thread', createdAt: 100},
                {id: 'assistant-thread', role: 'assistant', content: '', streaming: true, createdAt: 101},
            ],
        });

        listeners['chat://stream']?.({
            payload: {
                requestId: 'request-1',
                kind: 'line',
                text: '[THREAD_ID] codex-thread-1',
            },
        });

        expect(useChatStore.getState().sessionId).toBe('codex-thread-1');

        useChatStore.setState({
            activeRequestId: null,
            messages: [],
            provider: 'codex',
            model: 'gpt-5-codex',
            sessionId: 'codex-thread-1',
            currentCwd: 'C:/guodevelop/ccg-switch',
        });

        await useChatStore.getState().send('continue');

        expect(notificationMocks.prepareChatTurnStoppedNotificationPermission).toHaveBeenCalledTimes(1);
        expect(tauriMocks.invoke).toHaveBeenLastCalledWith('chat_send', {
            provider: 'codex',
            command: 'send',
            params: expect.objectContaining({
                message: 'continue',
                threadId: 'codex-thread-1',
                sessionId: undefined,
            }),
        });
    });

    it('sends Claude requests with a [1m] suffix when long context is enabled', async () => {
        useChatStore.setState({
            provider: 'claude',
            model: 'claude-opus-4-8',
            longContextEnabled: true,
            currentCwd: 'C:/guodevelop/ccg-switch',
        });
        tauriMocks.invoke.mockResolvedValue('request-1');

        await useChatStore.getState().send('use the large context window');

        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_send', {
            provider: 'claude',
            command: 'send',
            params: expect.objectContaining({
                message: 'use the large context window',
                model: 'claude-opus-4-8[1m]',
            }),
        });
    });

    it('sends the base Claude model when long context is disabled', async () => {
        useChatStore.setState({
            provider: 'claude',
            model: 'claude-opus-4-8',
            longContextEnabled: true,
            currentCwd: 'C:/guodevelop/ccg-switch',
        });
        tauriMocks.invoke.mockResolvedValue('request-1');

        useChatStore.getState().setLongContextEnabled(false);
        await useChatStore.getState().send('use the standard context window');

        expect(useChatStore.getState().longContextEnabled).toBe(false);
        expect(localStorage.getItem('ccg-chat-long-context')).toBe('false');
        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_send', {
            provider: 'claude',
            command: 'send',
            params: expect.objectContaining({
                message: 'use the standard context window',
                model: 'claude-opus-4-8',
            }),
        });
    });

    it('does not append [1m] for Claude Haiku even when long context is enabled', async () => {
        useChatStore.setState({
            provider: 'claude',
            model: 'claude-haiku-4-5',
            longContextEnabled: true,
            currentCwd: 'C:/guodevelop/ccg-switch',
        });
        tauriMocks.invoke.mockResolvedValue('request-1');

        await useChatStore.getState().send('quick answer');

        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_send', {
            provider: 'claude',
            command: 'send',
            params: expect.objectContaining({
                message: 'quick answer',
                model: 'claude-haiku-4-5',
            }),
        });
    });

    it('does not apply the Claude 1M suffix to Codex requests', async () => {
        useChatStore.setState({
            provider: 'codex',
            model: 'gpt-5-codex',
            longContextEnabled: true,
            currentCwd: 'C:/guodevelop/ccg-switch',
        });
        tauriMocks.invoke.mockResolvedValue('request-1');

        await useChatStore.getState().send('codex turn');

        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_send', {
            provider: 'codex',
            command: 'send',
            params: expect.objectContaining({
                message: 'codex turn',
                model: 'gpt-5-codex',
            }),
        });
    });

    it('stores selected Claude models without the transient [1m] suffix', () => {
        useChatStore.setState({
            provider: 'claude',
            model: 'claude-opus-4-7',
            longContextEnabled: true,
        });

        useChatStore.getState().setModel('claude-opus-4-8[1m]');

        expect(useChatStore.getState().model).toBe('claude-opus-4-8');
        expect(localStorage.getItem(CHAT_MODEL_SELECTION_KEY_PREFIX + 'claude')).toBe('claude-opus-4-8');
    });

    it('carries visible Claude history into the first Codex turn after provider switch', async () => {
        useChatStore.setState({
            provider: 'claude',
            model: 'claude-opus-4-8',
            sessionId: claudeSession.sessionId,
            activeSession: claudeSession,
            currentCwd: claudeSession.projectDir,
            messages: [
                {
                    id: 'history-protocol-1',
                    role: 'user',
                    content: 'You are Codex, a coding agent based on GPT-5.\n\n# Tools\nTools are grouped by namespace.',
                    createdAt: 99,
                },
                {
                    id: 'history-user-1',
                    role: 'user',
                    content: '请记住项目目标是会话管理对标 cc-gui',
                    createdAt: 100,
                },
                {
                    id: 'history-assistant-1',
                    role: 'assistant',
                    content: '已了解：需要修复历史会话选择和工具块展示。',
                    createdAt: 101,
                },
            ],
        });
        tauriMocks.invoke.mockResolvedValue('request-1');

        useChatStore.getState().setProvider('codex');
        await useChatStore.getState().send('继续实现');

        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_send', {
            provider: 'codex',
            command: 'send',
            params: expect.objectContaining({
                threadId: undefined,
                sessionId: undefined,
                message: expect.stringContaining('请记住项目目标是会话管理对标 cc-gui'),
            }),
        });
        const lastCall = tauriMocks.invoke.mock.calls[tauriMocks.invoke.mock.calls.length - 1];
        const payload = lastCall?.[1] as { params: { message: string } };
        expect(payload.params.message).toContain('已了解：需要修复历史会话选择和工具块展示。');
        expect(payload.params.message).toContain('继续实现');
        expect(payload.params.message).not.toContain('You are Codex');
        expect(payload.params.message).not.toContain('Tools are grouped by namespace');
        const messages = useChatStore.getState().messages;
        expect(messages[messages.length - 2]?.content).toBe('继续实现');
    });

    it('uses Claude attachment command and keeps image payloads out of prompt text', async () => {
        useChatStore.setState({
            provider: 'claude',
            model: 'claude-sonnet-4-6',
            currentCwd: 'C:/guodevelop/ccg-switch',
        });
        tauriMocks.invoke.mockResolvedValue('request-1');

        await useChatStore.getState().send('识别这张图', {
            attachments: [
                {
                    fileName: 'screen.png',
                    mediaType: 'image/png',
                    data: 'iVBORw0KGgo=',
                    size: 64,
                },
            ],
            displayText: '识别这张图\n\n[Image: screen.png]',
        });

        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_send', {
            provider: 'claude',
            command: 'sendWithAttachments',
            params: expect.objectContaining({
                message: '识别这张图',
                attachments: [
                    {
                        fileName: 'screen.png',
                        mediaType: 'image/png',
                        data: 'iVBORw0KGgo=',
                        size: 64,
                    },
                ],
            }),
        });
        const messages = useChatStore.getState().messages;
        expect(messages[messages.length - 2]?.content).toBe('识别这张图\n\n[Image: screen.png]');
        expect(messages[messages.length - 2]?.raw?.message.content).toEqual([
            { type: 'text', text: '识别这张图' },
            {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'iVBORw0KGgo=',
                },
                media_type: 'image/png',
                data: 'iVBORw0KGgo=',
                fileName: 'screen.png',
            },
        ]);
    });

    it('returns false when chat_send fails so the composer can restore pending attachments', async () => {
        useChatStore.setState({
            provider: 'claude',
            model: 'claude-sonnet-4-6',
            currentCwd: 'C:/guodevelop/ccg-switch',
        });
        tauriMocks.invoke.mockRejectedValue(new Error('bridge unavailable'));

        const result = await useChatStore.getState().send('识别这张图', {
            attachments: [
                {
                    fileName: 'screen.png',
                    mediaType: 'image/png',
                    data: 'iVBORw0KGgo=',
                    size: 64,
                },
            ],
            displayText: '识别这张图\n\n[Image: screen.png]',
        });

        expect(result).toBe(false);
        expect(useChatStore.getState().error).toContain('bridge unavailable');
        const messages = useChatStore.getState().messages;
        expect(messages[messages.length - 1]).toMatchObject({
            role: 'assistant',
            streaming: false,
            error: expect.stringContaining('bridge unavailable'),
        });
    });

    it('maps Codex local image paths to SDK local_image attachments', async () => {
        useChatStore.setState({
            provider: 'codex',
            model: 'gpt-5-codex',
            currentCwd: 'C:/guodevelop/ccg-switch',
        });
        tauriMocks.invoke.mockResolvedValue('request-1');

        await useChatStore.getState().send('看下截图', {
            attachments: [
                {
                    fileName: 'screen.png',
                    mediaType: 'image/png',
                    path: 'C:/Users/Administrator/Pictures/screen.png',
                    size: 128,
                },
            ],
        });

        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_send', {
            provider: 'codex',
            command: 'send',
            params: expect.objectContaining({
                message: '看下截图',
                attachments: [
                    {
                        type: 'local_image',
                        path: 'C:/Users/Administrator/Pictures/screen.png',
                    },
                ],
            }),
        });
    });

    it('keeps Codex base64 image payloads when no local path is available', async () => {
        useChatStore.setState({
            provider: 'codex',
            model: 'gpt-5-codex',
            currentCwd: 'C:/guodevelop/ccg-switch',
        });
        tauriMocks.invoke.mockResolvedValue('request-1');

        await useChatStore.getState().send('', {
            attachments: [
                {
                    fileName: 'clipboard.png',
                    mediaType: 'image/png',
                    data: 'iVBORw0KGgo=',
                },
            ],
            displayText: '[Image: clipboard.png]',
        });

        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_send', {
            provider: 'codex',
            command: 'send',
            params: expect.objectContaining({
                message: 'Please analyze the attached image(s).',
                attachments: [
                    {
                        fileName: 'clipboard.png',
                        mediaType: 'image/png',
                        data: 'iVBORw0KGgo=',
                    },
                ],
            }),
        });
        const messages = useChatStore.getState().messages;
        expect(messages[messages.length - 2]?.content).toBe('[Image: clipboard.png]');
        expect(messages[messages.length - 2]?.raw?.message.content).toEqual([
            {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'iVBORw0KGgo=',
                },
                media_type: 'image/png',
                data: 'iVBORw0KGgo=',
                fileName: 'clipboard.png',
            },
        ]);
    });
});
