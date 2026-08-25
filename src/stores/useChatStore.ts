import {create} from 'zustand';
import {useShallow} from 'zustand/react/shallow';
import {invoke} from '@tauri-apps/api/core';
import {listen, type UnlistenFn} from '@tauri-apps/api/event';
import {
    ChatAttachment,
    ChatDaemonEvent,
    ChatDoneEvent,
    ChatMessage,
    ChatMessageEvent,
    ChatProvider,
    ChatRole,
    ChatStreamEvent,
    ContentBlock,
    DaemonLogEntry,
    ImageBlock,
    MessageRaw,
    QueuedChatMessage,
    SubagentMessageEvent,
    TokenUsage,
} from '../types/chat';
import {
    type ChatSessionLoadMetrics,
    getSessionSelectionKey,
    type SessionMeta,
    type UnifiedSessionMessage,
    type UnifiedSessionMessageWindow,
} from '../types/session';
import {AskUserQuestionRequest, PlanApprovalRequest, ToolPermissionRequest,} from '../types/permission';
import type {ChatProviderId, PermissionMode, ReasoningEffort,} from '../components/chat/composer/constants';
import {apply1MContextSuffix, reasoningLevelsFor, strip1MContextSuffix,} from '../components/chat/composer/constants';
import {extractCompactBoundaryInfo, getContentBlocksFromRaw, isProtocolContextText, mergeRawChatMessage, TOOL_RESULT_CONTENT} from '../utils/chatMessageFlow';
import {
    type ChatTurnStopOutcome,
    notifyChatTurnStopped,
    prepareChatTurnStoppedNotificationPermission,
} from '../utils/desktopNotification';
import {CHAT_DAEMON_READY_TIMEOUT_ERROR_KEY} from '../utils/chatDaemonStatus';
import {CHAT_MODEL_SELECTION_KEY_PREFIX, getDefaultChatModelId,} from '../utils/chatModels';
import {getNextTabAfterClose} from '../utils/chatUiBehavior';
import {showToast} from '../components/common/ToastContainer';

const DRAFT_KEY_PREFIX = 'ccg-chat-draft:';
const REASONING_KEY = 'ccg-chat-reasoning';
const LONG_CONTEXT_KEY = 'ccg-chat-long-context';
const HANDOFF_CONTEXT_MAX_MESSAGES = 24;
const HANDOFF_CONTEXT_MAX_CHARS = 12_000;
const ATTACHMENT_ONLY_MESSAGE = 'Please analyze the attached image(s).';
const SESSION_HISTORY_CACHE_LIMIT = 8;
const STOPPED_REQUEST_NOTIFICATION_LIMIT = 64;
const RETIRED_REQUEST_OWNERSHIP_LIMIT = 128;
const SESSION_HISTORY_FIRST_PAINT_LIMIT = 120;
const SESSION_HISTORY_FULL_MAP_CHUNK_SIZE = 250;
/** 用户主动中止一轮回复时写入 assistant 消息的 error 标记（UI 据此区分中止与失败）。 */
export const STOPPED_OUTPUT_ERROR = '已停止输出';

/**
 * 发送本身失败（未建立流）时的即时反馈：消息流里的错误块可能在视口外
 * （用户上滚或失败发生在后台侧聊），toast 保证失败不静默。
 */
function toastSendFailure(error: unknown): void {
    const detail = String(error).trim().replace(/\s+/g, ' ');
    const clipped = detail.length > 160 ? `${detail.slice(0, 159)}…` : detail;
    showToast(clipped ? `发送失败: ${clipped}` : '发送失败', 'error', 5000);
}
const DEFAULT_PERMISSION_SESSION_ID = 'default';
const CHAT_DAEMON_READY_TIMEOUT_MS = 15_000;
const DAEMON_LOG_LIMIT = 500;
let daemonLogSeq = 0;
const stoppedRequestNotifications = new Set<string>();
const retiredRequestIds = new Set<string>();
const requestTabKeys = new Map<string, string>();
const pendingSendOwners = new Map<string, {tabKey: string; assistantMessageId: string}>();
/**
 * 已被 [BLOCK_RESET] 或工具消息「封口」的流式 assistant 消息 id 集合。
 * 一旦封口，下一段 [CONTENT_DELTA] 文本必须在 raw.message.content 末尾开启
 * 一个新的 text block，而不是续写上一段文本块，从而保留 text→tool→text 的源顺序。
 */
const sealedStreamingTextSegments = new Set<string>();
let daemonReadyTimeout: ReturnType<typeof setTimeout> | null = null;

function clearDaemonReadyTimeout(): void {
    if (!daemonReadyTimeout) return;
    clearTimeout(daemonReadyTimeout);
    daemonReadyTimeout = null;
}

function scheduleDaemonReadyTimeout(
    get: () => ChatState,
    set: (state: Partial<ChatState>) => void,
): void {
    clearDaemonReadyTimeout();
    daemonReadyTimeout = setTimeout(() => {
        daemonReadyTimeout = null;
        const state = get();
        if (state.daemonReady) return;

        if (state.daemonStatus !== 'starting') {
            // 启动窗口内被其它 daemon 事件改过状态（如 stderr 日志行）。这里不覆盖
            // 已有的诊断信息，但**必须**解除重连锁——否则 reconnectDaemon 的入口守卫
            // `if (get().daemonReconnecting) return` 会让重连按钮永久失效，
            // 一直停在「重连中…」。
            if (state.daemonReconnecting) {
                set({daemonReconnecting: false});
            }
            return;
        }

        set({
            daemonReady: false,
            daemonStatus: 'error',
            daemonReconnecting: false,
            error: CHAT_DAEMON_READY_TIMEOUT_ERROR_KEY,
        });
    }, CHAT_DAEMON_READY_TIMEOUT_MS);
    (daemonReadyTimeout as {unref?: () => void}).unref?.();
}

function pushDaemonLog(logs: DaemonLogEntry[], payload: ChatDaemonEvent): DaemonLogEntry[] {
    daemonLogSeq += 1;
    const entry: DaemonLogEntry = {
        id: daemonLogSeq,
        timestamp: Date.now(),
        event: payload.event,
        message: payload.message ?? null,
        provider: payload.provider ?? null,
    };
    const next = [...logs, entry];
    if (next.length > DAEMON_LOG_LIMIT) {
        next.splice(0, next.length - DAEMON_LOG_LIMIT);
    }
    return next;
}

function permissionSessionId(
    request: AskUserQuestionRequest | PlanApprovalRequest | ToolPermissionRequest,
): string {
    const sessionId = request.sessionId?.trim();
    return sessionId || DEFAULT_PERMISSION_SESSION_ID;
}

function clonePermissionRequest<T extends AskUserQuestionRequest | PlanApprovalRequest | ToolPermissionRequest>(
    request: T,
): T {
    return {...request};
}

function enqueuePermissionRequest<T extends AskUserQuestionRequest | PlanApprovalRequest | ToolPermissionRequest>(
    pending: T | null,
    queue: T[],
    responseInFlightRequestId: string | null,
    request: T,
): { pending: T | null; queue: T[] } {
    if (
        pending?.requestId === request.requestId
        || responseInFlightRequestId === request.requestId
        || queue.some((item) => item.requestId === request.requestId)
    ) {
        return {pending, queue};
    }

    if (pending || responseInFlightRequestId || queue.length > 0) {
        return {pending, queue: [...queue, request]};
    }

    return {pending: request, queue};
}

function nextPermissionRequest<T extends AskUserQuestionRequest | PlanApprovalRequest | ToolPermissionRequest>(
    queue: T[],
): { pending: T | null; queue: T[] } {
    const [pending = null, ...rest] = queue;
    return {pending, queue: rest};
}

function loadDraft(provider: ChatProviderId): string {
    try {
        return localStorage.getItem(DRAFT_KEY_PREFIX + provider) ?? '';
    } catch {
        return '';
    }
}

function defaultModel(provider: ChatProviderId): string {
    try {
        const saved = localStorage.getItem(CHAT_MODEL_SELECTION_KEY_PREFIX + provider);
        if (saved) return strip1MContextSuffix(saved);
    } catch {
        // ignore
    }
    return getDefaultChatModelId(provider);
}

function loadReasoning(): ReasoningEffort {
    try {
        const saved = localStorage.getItem(REASONING_KEY) as ReasoningEffort | null;
        if (saved) return saved;
    } catch {
        // ignore
    }
    return 'high';
}

function loadLongContextEnabled(): boolean {
    try {
        const saved = localStorage.getItem(LONG_CONTEXT_KEY);
        if (saved === 'false') return false;
        if (saved === 'true') return true;
    } catch {
        // ignore
    }
    return true;
}

function imageBlockFromAttachment(attachment: ChatAttachment): ImageBlock | null {
    const hasData = Boolean(attachment.data?.trim());
    const hasPath = Boolean(attachment.path?.trim());
    if (!hasData && !hasPath) return null;

    const block: ImageBlock = {
        type: 'image',
        media_type: attachment.mediaType,
        fileName: attachment.fileName,
    };

    if (hasData && attachment.data) {
        block.data = attachment.data;
        block.source = {
            type: 'base64',
            media_type: attachment.mediaType,
            data: attachment.data,
        };
    } else if (hasPath && attachment.path) {
        block.path = attachment.path;
        block.source = {
            type: 'file',
            media_type: attachment.mediaType,
            path: attachment.path,
        };
    }

    return block;
}

function buildUserRawMessage(text: string, attachments: ChatAttachment[]): MessageRaw | undefined {
    const blocks: ContentBlock[] = [];
    const trimmed = text.trim();
    if (trimmed) {
        blocks.push({type: 'text', text: trimmed});
    }

    for (const attachment of attachments) {
        const imageBlock = imageBlockFromAttachment(attachment);
        if (imageBlock) blocks.push(imageBlock);
    }

    if (blocks.length === 0) return undefined;
    return {
        type: 'user',
        timestamp: new Date().toISOString(),
        message: {
            content: blocks,
        },
    };
}

function notifyStoppedRequestOnce(
    requestId: string | null | undefined,
    outcome: ChatTurnStopOutcome,
    provider: ChatProvider,
    detail?: string | null,
): void {
    if (!requestId) return;
    if (stoppedRequestNotifications.has(requestId)) return;

    stoppedRequestNotifications.add(requestId);
    while (stoppedRequestNotifications.size > STOPPED_REQUEST_NOTIFICATION_LIMIT) {
        const oldest = stoppedRequestNotifications.values().next().value;
        if (!oldest) break;
        stoppedRequestNotifications.delete(oldest);
    }

    notifyChatTurnStopped({
        outcome,
        provider,
        ...(detail ? {detail} : {}),
    });
}

function retireRequestOwnership(requestId: string | null | undefined): void {
    if (!requestId) return;
    requestTabKeys.delete(requestId);
    requestActivityAt.delete(requestId);
    retiredRequestIds.add(requestId);
    while (retiredRequestIds.size > RETIRED_REQUEST_OWNERSHIP_LIMIT) {
        const oldest = retiredRequestIds.values().next().value;
        if (!oldest) break;
        retiredRequestIds.delete(oldest);
    }
}

/**
 * 每个进行中请求最近一次收到 daemon 输出的时间（ms）。
 * 供卡死提示（StreamStallHint）轮询，不进 zustand 避免高频 set。
 */
const requestActivityAt = new Map<string, number>();

function noteRequestActivity(requestId: string | null | undefined): void {
    if (!requestId) return;
    requestActivityAt.set(requestId, Date.now());
}

export function getRequestActivityAt(requestId: string | null | undefined): number | null {
    if (!requestId) return null;
    return requestActivityAt.get(requestId) ?? null;
}

function retirePendingSendsForTab(tabKey: string | null | undefined): void {
    if (!tabKey) return;
    for (const [messageId, owner] of pendingSendOwners) {
        if (owner.tabKey === tabKey) {
            pendingSendOwners.delete(messageId);
        }
    }
}

function getLastAssistantTextPreview(messages: ChatMessage[]): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== 'assistant') continue;

        const rawTextBlocks = message.raw?.message.content
            .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
            .map((block) => block.text.trim())
            .filter(Boolean);
        const rawText = rawTextBlocks?.[rawTextBlocks.length - 1];
        const fallbackText = message.content.trim();
        const preview = (rawText || fallbackText).replace(/\s+/g, ' ').trim();
        if (preview) return preview;
    }

    return null;
}

type ChatTabStatus = 'idle' | 'loading' | 'running' | 'queued' | 'error';

export interface ChatSessionTab {
    key: string;
    messages: ChatMessage[];
    provider: ChatProvider;
    permissionMode: PermissionMode;
    model: string;
    reasoningEffort: ReasoningEffort;
    draft: string;
    longContextEnabled: boolean;
    contextTokens: number;
    contextMaxTokens: number | null;
    activeRequestId: string | null;
    sessionId: string | null;
    currentCwd: string | null;
    activeSession: SessionMeta | null;
    pendingSessionKey: string | null;
    lastSessionLoadMetrics: ChatSessionLoadMetrics | null;
    handoffContextProvider: ChatProvider | null;
    status: ChatTabStatus;
    error: string | null;
    /**
     * 后台完成回合后的未读标记：回合结束时该 tab 既非中心活跃 tab、
     * 也非 dock 当前可见侧聊（dockChatTabKey）时置 true；用户聚焦后清除。
     */
    unread?: boolean;
    /**
     * tab 归属的界面位置。缺省（undefined）= 中心会话标签条；
     * `'side'` = 右侧 dock 的侧边聊天，**不出现在中心标签条里**。
     *
     * 侧聊与中心会话共用 `openTabs` 这一个池（会话状态、并发发送、未读都靠它），
     * 但它们在界面上属于两个不同的容器。缺这个标记时，每开一个侧聊，中心标签条
     * 就会多一个「新对话」——用户看到的是同一次点击在两处各加了一个标签。
     */
    surface?: 'side';
    /** 子代理(Task)实时轨迹：parentToolUseId(= 父 Task 工具块 id) → 子代理消息列表。 */
    subagentRuns: Record<string, ChatMessage[]>;
    /** 忙时排队的待发消息，回合成功结束后按序自动发送。 */
    queuedMessages: QueuedChatMessage[];
    createdAt: number;
    updatedAt: number;
}

interface ChatState {
    messages: ChatMessage[];
    /** 子代理(Task)实时轨迹：parentToolUseId → 子代理消息列表（activeTab 投影）。 */
    subagentRuns: Record<string, ChatMessage[]>;
    /** 忙时排队的待发消息（activeTab 投影）。 */
    queuedMessages: QueuedChatMessage[];
    /** 当前 provider */
    provider: ChatProvider;
    /**
     * 权限模式。'default' 下工具调用会触发权限请求；在权限审批 UI 完成前
     * （后续任务），纯文本对话用 'default' 即可，涉及工具的复杂任务可临时用
     * 'bypassPermissions'（自动放行，请仅在信任的工作目录使用）。
     */
    permissionMode: PermissionMode;
    /** 当前选中的模型 id（按 provider 维度持久化） */
    model: string;
    /** 推理强度（reasoning effort） */
    reasoningEffort: ReasoningEffort;
    /** 输入框草稿（按 provider 维度持久化，跨页面保留） */
    draft: string;
    /** Claude 1M 上下文开关，发送时临时映射为模型 `[1m]` suffix。 */
    longContextEnabled: boolean;
    /** 累计上下文 token 数（用于用量环估算） */
    contextTokens: number;
    /** 上下文窗口上限（由 sidecar [USAGE] 推送，缺省时回退静态表） */
    contextMaxTokens: number | null;
    /** daemon 是否就绪 */
    daemonReady: boolean;
    /** 最近一次 daemon 生命周期消息（诊断用） */
    daemonStatus: string | null;
    /** 用户手动触发 daemon 恢复后的前端等待态 */
    daemonReconnecting: boolean;
    /** daemon 诊断日志缓冲（debug 模式查看，含 stderr / sdk 加载错误等） */
    daemonLogs: DaemonLogEntry[];
    /** 当前进行中的 requestId */
    activeRequestId: string | null;
    /** 当前会话 id（由 daemon 的 SESSION_ID 回填） */
    sessionId: string | null;
    /** 当前会话关联的工作目录，供 @ 文件补全和 daemon cwd 使用 */
    currentCwd: string | null;
    /** 当前从历史中载入的会话元信息 */
    activeSession: SessionMeta | null;
    /** 当前正在切换/加载中的历史会话 key */
    pendingSessionKey: string | null;
    /** 最近一次历史会话加载的性能诊断，仅用于状态面板展示 */
    lastSessionLoadMetrics: ChatSessionLoadMetrics | null;
    /** provider 切换后，下一次无原生 session 的发送需要携带的历史来源 */
    handoffContextProvider: ChatProvider | null;
    /** 事件监听器是否已注册 */
    initialized: boolean;
    error: string | null;
    /** 待审批的 AskUserQuestion 请求（弹窗） */
    pendingAskUserQuestion: AskUserQuestionRequest | null;
    pendingAskUserQuestionQueue: AskUserQuestionRequest[];
    askUserQuestionResponseInFlightRequestId: string | null;
    /** 待审批的 PlanApproval 请求（弹窗） */
    pendingPlanApproval: PlanApprovalRequest | null;
    pendingPlanApprovalQueue: PlanApprovalRequest[];
    planApprovalResponseInFlightRequestId: string | null;
    /** 待审批的普通工具权限请求（弹窗） */
    pendingToolPermission: ToolPermissionRequest | null;
    pendingToolPermissionQueue: ToolPermissionRequest[];
    toolPermissionResponseInFlightRequestId: string | null;
    /** 被用户拒绝的工具调用 ID 集合 */
    deniedToolIds: Set<string>;
    /** 已打开的聊天 tab。顶层 transcript 字段始终是 activeTab 的投影。 */
    openTabs: ChatSessionTab[];
    /** 当前可见 tab key。 */
    activeTabKey: string | null;
    /** 右侧 dock 当前可见的侧边聊天 tab key（背景 tab，不进 activeTabKey）。 */
    dockChatTabKey: string | null;
    /** Provider 表配置变更后，下一次空闲/发送前需要重启 daemon 读取新配置。 */
    providerConfigDirty: boolean;

    init: () => Promise<void>;
    reconnectDaemon: () => Promise<void>;
    clearDaemonLogs: () => void;
    addDeniedTool: (toolId: string) => void;
    clearDeniedTools: () => void;
    setProvider: (p: ChatProvider) => void;
    setPermissionMode: (m: PermissionMode) => void;
    setModel: (id: string) => void;
    setLongContextEnabled: (enabled: boolean) => void;
    setReasoningEffort: (e: ReasoningEffort) => void;
    setDraft: (text: string) => void;
    setCurrentCwd: (cwd: string | null) => void;
    send: (text: string, opts?: {
        cwd?: string;
        model?: string;
        attachments?: ChatAttachment[];
        displayText?: string;
    }) => Promise<boolean>;
    /** 向指定 tab 发送（侧边聊天并发发送）；现有 send 等价于向活跃 tab 发送。 */
    sendInTab: (tabKey: string, text: string, opts?: {
        cwd?: string;
        model?: string;
        attachments?: ChatAttachment[];
        displayText?: string;
    }) => Promise<boolean>;
    /** 设置指定 tab 的输入草稿（侧聊草稿存于 tab 快照，不写全局 localStorage）。 */
    setTabDraft: (tabKey: string, text: string) => void;
    /** 把消息加入指定 tab 的待发队列（回合进行中时由 send/sendInTab 自动调用）。 */
    queueMessageInTab: (tabKey: string, text: string, attachments?: ChatAttachment[]) => void;
    /** 从指定 tab 的待发队列移除一条消息。 */
    removeQueuedMessage: (tabKey: string, id: string) => void;
    /** 更新指定 tab 的会话配置（provider/model/权限/推理/1M）；流式进行中为 no-op。 */
    updateTabConfig: (
        tabKey: string,
        config: Partial<Pick<ChatSessionTab, 'provider' | 'model' | 'permissionMode' | 'reasoningEffort' | 'longContextEnabled'>>,
    ) => void;
    loadSession: (session: SessionMeta) => Promise<void>;
    loadActiveSessionFullHistory: () => Promise<ChatMessage[] | null>;
    expandActiveSessionHistory: () => Promise<void>;
    focusTab: (key: string) => void;
    closeTab: (key: string) => void;
    closeOtherTabs: (key: string) => void;
    closeAllTabs: () => void;
    /** 新建一个独立侧边聊天 tab（背景，不切换中心活跃 tab），返回其 key。 */
    openSideChat: (opts?: {cwd?: string | null}) => string;
    /** 关闭指定侧边聊天 tab；若是当前可见侧聊则清空 dockChatTabKey。 */
    closeSideChat: (key: string) => void;
    /** 同步 dock 当前可见的侧聊 tab（null=dock 未显示侧聊）；置为可见即视为已读。 */
    setDockChatTabKey: (key: string | null) => void;
    /**
     * 重发指定 tab（null=全局活跃投影）最后一条用户消息（失败回复的「重新发送」）。
     * 无用户消息、消息含附件（无法可靠还原）、或该 tab 仍在回合中时返回 false。
     */
    retryLastUserMessage: (tabKey?: string | null) => Promise<boolean>;
    /**
     * 回退到指定 user 消息重来（消息级 rewind/fork，仅 Claude）：
     * fork 会话文件在该消息处截断 → 本地 transcript 同步截断 → 原文回填草稿；
     * `restoreFiles` 时先经 daemon `claude.rewindFiles` 把工作区文件恢复到该时点。
     * 目标消息缺 uuid、tab 在回合中、或 provider 不支持时返回 false。
     */
    rewindToMessage: (
        tabKey: string | null,
        messageId: string,
        opts?: {restoreFiles?: boolean},
    ) => Promise<boolean>;
    markProviderConfigDirty: () => Promise<void>;
    startNewSession: (cwd?: string | null) => Promise<void>;
    abort: () => Promise<void>;
    clear: () => Promise<void>;
    answerAskUserQuestion: (requestId: string, answers: Record<string, string>) => Promise<void>;
    answerToolPermission: (requestId: string, allow: boolean) => Promise<void>;
    approvePlan: (requestId: string, approved: boolean, targetMode: string) => Promise<void>;
}

let unlisteners: UnlistenFn[] = [];
let latestSessionLoadToken = 0;
let latestChatTurnToken = 0;
const sessionHistoryCache = new Map<string, ChatMessage[]>();

function nowMs(): number {
    return Date.now();
}

function newId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDraftTabKey(): string {
    return `draft:${newId()}`;
}

function createTabFromState(
    key: string,
    state: ChatState,
    overrides: Partial<ChatSessionTab> = {},
): ChatSessionTab {
    const now = overrides.updatedAt ?? overrides.createdAt ?? 0;
    return {
        key,
        messages: state.messages,
        provider: state.provider,
        permissionMode: state.permissionMode,
        model: state.model,
        reasoningEffort: state.reasoningEffort,
        draft: state.draft,
        longContextEnabled: state.longContextEnabled,
        contextTokens: state.contextTokens,
        contextMaxTokens: state.contextMaxTokens,
        activeRequestId: state.activeRequestId,
        sessionId: state.sessionId,
        currentCwd: state.currentCwd,
        activeSession: state.activeSession,
        pendingSessionKey: state.pendingSessionKey,
        lastSessionLoadMetrics: state.lastSessionLoadMetrics,
        handoffContextProvider: state.handoffContextProvider,
        status: hasActiveChatTurn(state) ? 'running' : 'idle',
        error: state.error,
        subagentRuns: state.subagentRuns,
        queuedMessages: state.queuedMessages,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

function createEmptyTabFromState(
    state: ChatState,
    cwd?: string | null,
    timestamp = nowMs(),
    key = createDraftTabKey(),
): ChatSessionTab {
    return {
        key,
        messages: [],
        provider: state.provider,
        permissionMode: state.permissionMode,
        model: state.model,
        reasoningEffort: state.reasoningEffort,
        draft: '',
        longContextEnabled: state.longContextEnabled,
        contextTokens: 0,
        contextMaxTokens: null,
        activeRequestId: null,
        sessionId: null,
        currentCwd: cwd ?? state.currentCwd,
        activeSession: null,
        pendingSessionKey: null,
        lastSessionLoadMetrics: null,
        handoffContextProvider: null,
        status: 'idle',
        error: null,
        subagentRuns: {},
        queuedMessages: [],
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function projectTabToState(tab: ChatSessionTab): Partial<ChatState> {
    return {
        messages: tab.messages,
        subagentRuns: tab.subagentRuns,
        queuedMessages: tab.queuedMessages,
        provider: tab.provider,
        permissionMode: tab.permissionMode,
        model: tab.model,
        reasoningEffort: tab.reasoningEffort,
        draft: tab.draft,
        longContextEnabled: tab.longContextEnabled,
        contextTokens: tab.contextTokens,
        contextMaxTokens: tab.contextMaxTokens,
        activeRequestId: tab.activeRequestId,
        sessionId: tab.sessionId,
        currentCwd: tab.currentCwd,
        activeSession: tab.activeSession,
        pendingSessionKey: tab.pendingSessionKey,
        lastSessionLoadMetrics: tab.lastSessionLoadMetrics,
        handoffContextProvider: tab.handoffContextProvider,
        error: tab.error,
    };
}

/**
 * 该 tab 是否属于右侧 dock 的侧边聊天（而非中心会话标签条）。
 *
 * 中心标签条的渲染与「关闭其它/全部」都必须按这个判定排除侧聊：
 * 前者否则会让一次侧聊点击在两处各加一个标签，后者否则会把 dock 里正在用的
 * 侧聊 tab 一起清掉，留下指向不存在 tab 的空面板。
 */
export function isSideChatTab(tab: ChatSessionTab): boolean {
    return tab.surface === 'side';
}

/** 中心会话标签条应当显示的 tab（排除 dock 侧聊）。 */
export function selectCenterTabs(tabs: ChatSessionTab[]): ChatSessionTab[] {
    return tabs.filter((tab) => !isSideChatTab(tab));
}

function upsertTab(tabs: ChatSessionTab[], tab: ChatSessionTab): ChatSessionTab[] {
    const index = tabs.findIndex((item) => item.key === tab.key);
    if (index < 0) return [...tabs, tab];
    const next = [...tabs];
    next[index] = tab;
    return next;
}

function removeTab(tabs: ChatSessionTab[], key: string): ChatSessionTab[] {
    return tabs.filter((tab) => tab.key !== key);
}

function getActiveTabKey(state: ChatState): string {
    return state.activeTabKey ?? createDraftTabKey();
}

function currentTopLevelTab(state: ChatState): ChatSessionTab {
    const key = getActiveTabKey(state);
    const existing = state.openTabs.find((tab) => tab.key === key);
    return createTabFromState(key, state, existing ? {
        createdAt: existing.createdAt,
    } : {});
}

function saveActiveProjection(state: ChatState): ChatSessionTab[] {
    return upsertTab(state.openTabs, currentTopLevelTab(state));
}

function requestTargetTabKey(state: ChatState, requestId: string | null | undefined): string | null {
    if (!requestId) return null;
    return requestTabKeys.get(requestId)
        ?? state.openTabs.find((tab) => tab.activeRequestId === requestId)?.key
        ?? (state.activeRequestId === requestId ? state.activeTabKey : null);
}

function requestTargetTab(state: ChatState, requestId: string | null | undefined): ChatSessionTab | null {
    const targetKey = requestTargetTabKey(state, requestId);
    if (!targetKey) return null;
    if (state.activeTabKey === targetKey) return currentTopLevelTab(state);
    return state.openTabs.find((tab) => tab.key === targetKey) ?? null;
}

function updateRequestTabState(
    state: ChatState,
    requestId: string,
    updater: (tab: ChatSessionTab) => ChatSessionTab,
): Partial<ChatState> {
    const targetKey = requestTargetTabKey(state, requestId);
    if (!targetKey && state.activeRequestId === requestId) {
        const legacy = createTabFromState(createDraftTabKey(), state);
        const updated = updater(legacy);
        return projectTabToState(updated);
    }
    if (!targetKey) return {};

    const tabs = saveActiveProjection(state);
    const target = tabs.find((tab) => tab.key === targetKey);
    if (!target) return {};

    const updated = {
        ...updater(target),
        updatedAt: nowMs(),
    };
    const openTabs = upsertTab(tabs, updated);
    if (state.activeTabKey !== targetKey) {
        return {openTabs};
    }

    return {
        openTabs,
        ...projectTabToState(updated),
    };
}

function updateTabStateByKey(
    state: ChatState,
    tabKey: string,
    updater: (tab: ChatSessionTab) => ChatSessionTab,
): Partial<ChatState> {
    const tabs = saveActiveProjection(state);
    const target = tabs.find((tab) => tab.key === tabKey);
    if (!target) return {};

    const updated = {
        ...updater(target),
        updatedAt: nowMs(),
    };
    const openTabs = upsertTab(tabs, updated);
    if (state.activeTabKey !== tabKey) {
        return {openTabs};
    }

    return {
        openTabs,
        ...projectTabToState(updated),
    };
}

function applyActiveTabProjection(
    state: ChatState,
    partial: Partial<ChatState>,
    tabOverrides: Partial<ChatSessionTab> = {},
): Partial<ChatState> {
    const activeKey = state.activeTabKey;
    if (!activeKey) return partial;

    const nextState = {
        ...state,
        ...partial,
    } as ChatState;
    const existing = state.openTabs.find((tab) => tab.key === activeKey);
    const tab = createTabFromState(activeKey, nextState, {
        createdAt: existing?.createdAt ?? nowMs(),
        status: hasActiveChatTurn(nextState) ? 'running' : 'idle',
        ...tabOverrides,
    });

    return {
        ...partial,
        openTabs: upsertTab(saveActiveProjection(state), tab),
    };
}

function saveProjectionBeforeSwitch(state: ChatState): ChatSessionTab[] {
    if (state.activeTabKey) return saveActiveProjection(state);
    if (
        state.messages.length > 0
        || state.activeRequestId
        || state.sessionId
        || state.activeSession
        || state.draft.trim().length > 0
    ) {
        const key = createDraftTabKey();
        return upsertTab(state.openTabs, createTabFromState(key, state));
    }
    return state.openTabs;
}

/**
 * 回合成功结束后按序发送该 tab 排队中的下一条消息。
 * 出队与发送分离：先原子出队，再延迟一拍走 sendInTab（让 done 的状态更新先落地）；
 * 若期间 tab 又进入回合，sendInTab 的忙时检查会把消息重新入队，不会丢失。
 */
function drainQueuedMessagesForTab(tabKey: string | null): void {
    if (!tabKey) return;
    const state = useChatStore.getState();
    const tab = tabKey === state.activeTabKey
        ? currentTopLevelTab(state)
        : state.openTabs.find((item) => item.key === tabKey);
    if (!tab || tab.queuedMessages.length === 0) return;
    if (hasActiveTabTurn(tab)) return;

    const [next] = tab.queuedMessages;
    useChatStore.setState((current) => updateTabStateByKey(current, tabKey, (item) => ({
        ...item,
        queuedMessages: item.queuedMessages.slice(1),
    })));
    setTimeout(() => {
        void useChatStore.getState().sendInTab(tabKey, next.text, {attachments: next.attachments});
    }, 50);
}

const REWIND_FILES_TIMEOUT_MS = 30_000;

/**
 * 经 daemon `claude.rewindFiles`（SDK 文件 checkpoint）把工作区文件恢复到目标
 * user 消息时点。结果 JSON 以该请求的 stream line 传回，done 事件收尾；此处
 * 独立监听这一 requestId（store 的常规监听器因无 tab 归属会忽略这些事件）。
 */
async function rewindFilesViaDaemon(
    sessionId: string,
    userMessageUuid: string,
    cwd: string | null,
): Promise<void> {
    const streamLines: ChatStreamEvent[] = [];
    const doneEvents: ChatDoneEvent[] = [];
    let evaluate: (() => void) | null = null;
    // 先注册监听再发请求，避免 daemon 响应先于监听器就绪。
    const unStream = await listen<ChatStreamEvent>('chat://stream', (event) => {
        streamLines.push(event.payload);
        evaluate?.();
    });
    const unDone = await listen<ChatDoneEvent>('chat://done', (event) => {
        doneEvents.push(event.payload);
        evaluate?.();
    });
    try {
        const requestId = await invoke<string>('chat_send', {
            provider: 'claude',
            command: 'rewindFiles',
            params: {
                sessionId,
                userMessageId: userMessageUuid,
                cwd: cwd ?? undefined,
            },
        });
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const timer = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error('rewind files timeout'));
            }, REWIND_FILES_TIMEOUT_MS);
            evaluate = () => {
                if (settled) return;
                const done = doneEvents.find((event) => event.requestId === requestId);
                if (!done) return;
                settled = true;
                window.clearTimeout(timer);
                // rewindFiles 内部 catch 错误后仍正常完成（done.success=true），
                // 真实结果在最后一条 JSON line 的 success 字段里。
                let result: {success: boolean; error?: string} | null = null;
                for (const line of streamLines) {
                    if (line.requestId !== requestId || line.kind !== 'line') continue;
                    const text = line.text.trim();
                    if (!text.startsWith('{')) continue;
                    try {
                        const parsed = JSON.parse(text) as {success?: unknown; error?: unknown};
                        if (typeof parsed.success === 'boolean') {
                            result = {
                                success: parsed.success,
                                error: typeof parsed.error === 'string' ? parsed.error : undefined,
                            };
                        }
                    } catch {
                        // 非结果 JSON 行，忽略
                    }
                }
                const success = result ? result.success : done.success;
                if (success) {
                    resolve();
                } else {
                    reject(new Error(result?.error ?? done.error ?? 'rewind files failed'));
                }
            };
            evaluate();
        });
    } finally {
        unStream();
        unDone();
    }
}

function isTextBlock(block: ContentBlock): block is Extract<ContentBlock, { type: 'text' }> {
    return block.type === 'text';
}

/**
 * 把流式文本增量按「源顺序」并入 assistant 的 raw.message.content。
 *
 * - 若末尾块是一个仍处于「开启」状态的 text block，则续写该块（同一段连续文本）。
 * - 若末尾块不是开启中的 text block（被 [BLOCK_RESET] 封口、或被后到的工具块
 *   占据），则在数组末尾开启一个新的 text block，使其落在它真实到达的位置
 *   （通常紧跟在前一个工具块之后），从而保留 text→tool→text 的交错顺序。
 *
 * raw.message.content 是渲染顺序的唯一真相；扁平的 message.content 字符串仅用于
 * 复制/预览与无 raw 时的回退，不再决定渲染顺序。
 */
function appendStreamingTextToRaw(
    messageId: string,
    raw: MessageRaw | undefined,
    delta: string,
): MessageRaw {
    const base: MessageRaw = raw && raw.type === 'assistant'
        ? raw
        : {type: 'assistant', message: {content: []}};
    const blocks = [...base.message.content];
    const lastBlock = blocks[blocks.length - 1];
    const sealed = sealedStreamingTextSegments.has(messageId);

    if (!sealed && lastBlock && isTextBlock(lastBlock)) {
        // 续写当前开启中的文本段。
        blocks[blocks.length - 1] = {...lastBlock, text: lastBlock.text + delta};
    } else {
        // 开启一个新的文本段（封口后或紧跟工具块之后），落在末尾的真实到达位置。
        blocks.push({type: 'text', text: delta});
        sealedStreamingTextSegments.delete(messageId);
    }

    return {
        ...base,
        type: 'assistant',
        message: {
            ...base.message,
            content: blocks,
        },
    };
}

/**
 * 在 [BLOCK_RESET] 到达时封口当前流式 assistant 消息的开启中文本段，
 * 使下一段 [CONTENT_DELTA] 文本开启一个新的 text block。
 */
function sealStreamingTextSegment(get: () => ChatState): void {
    const messages = get().messages;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant' && messages[i].streaming) {
            sealedStreamingTextSegments.add(messages[i].id);
            while (sealedStreamingTextSegments.size > RETIRED_REQUEST_OWNERSHIP_LIMIT) {
                const oldest = sealedStreamingTextSegments.values().next().value;
                if (!oldest) break;
                sealedStreamingTextSegments.delete(oldest);
            }
            return;
        }
    }
}

function clearStreamingTextSegment(messageId: string | null | undefined): void {
    if (!messageId) return;
    sealedStreamingTextSegments.delete(messageId);
}

function hasStreamingAssistant(messages: ChatMessage[]): boolean {
    return messages.some((message) => message.role === 'assistant' && message.streaming);
}

function hasActiveChatTurn(state: ChatState): boolean {
    return Boolean(state.activeRequestId) || hasStreamingAssistant(state.messages);
}

function hasActiveTabTurn(tab: ChatSessionTab): boolean {
    return Boolean(tab.activeRequestId) || hasStreamingAssistant(tab.messages);
}

function hasAnyActiveChatTurn(state: ChatState): boolean {
    if (hasActiveChatTurn(state)) return true;
    return state.openTabs.some((tab) => tab.key !== state.activeTabKey && hasActiveTabTurn(tab));
}

function appendToStreamingAssistantMessages(
    messages: ChatMessage[],
    delta: string,
): ChatMessage[] {
    const nextMessages = [...messages];
    for (let i = nextMessages.length - 1; i >= 0; i--) {
        if (nextMessages[i].role === 'assistant' && nextMessages[i].streaming) {
            const content = nextMessages[i].content + delta;
            nextMessages[i] = {
                ...nextMessages[i],
                content,
                raw: appendStreamingTextToRaw(nextMessages[i].id, nextMessages[i].raw, delta),
            };
            break;
        }
    }
    return nextMessages;
}

// ============================================================
// 流式增量合批
// ============================================================

/**
 * 是否把 `[CONTENT_DELTA]` 合批到一帧内提交。置 false 走逐条 `set()` 的旧路径，
 * 作为出问题时的一键回滚开关。
 */
const CHAT_STREAM_COALESCE = true;

/**
 * 只覆盖本文件实际使用的 updater 形态；`set` 接受更宽的入参，可直接传入。
 */
type ChatStateUpdater = (updater: (state: ChatState) => ChatState | Partial<ChatState>) => void;

/**
 * 每个进行中请求已到达但尚未提交的文本增量。
 *
 * daemon 每收到一截模型输出就发一行 `[CONTENT_DELTA]`，快模型下每秒可达数十次。
 * 逐条 `set()` 会让整棵订阅树按同样频率重渲染；这里按帧合并成一次提交。
 * 缓冲最多存活一帧，无需额外清理。
 */
const pendingStreamDeltas = new Map<string, string>();
let pendingStreamFlushHandle: number | null = null;

function cancelPendingStreamFlush(): void {
    if (pendingStreamFlushHandle === null) return;
    cancelAnimationFrame(pendingStreamFlushHandle);
    pendingStreamFlushHandle = null;
}

function applyStreamDelta(set: ChatStateUpdater, requestId: string, delta: string): void {
    set((state) => updateRequestTabState(state, requestId, (tab) => ({
        ...tab,
        messages: appendToStreamingAssistantMessages(tab.messages, delta),
        status: 'running',
    })));
}

/**
 * 排空增量缓冲。省略 `requestId` 时排空全部。
 *
 * **保序契约**：任何会读或改 transcript 的后续事件（`[BLOCK_RESET]` 封口、
 * `[USAGE]`、`chat://message`、`chat://done`、中止）都必须先调用本函数，
 * 否则缓冲中的文本会越过这些事件、落到错误的内容块里。
 */
function flushPendingStreamDeltas(set: ChatStateUpdater, requestId?: string): void {
    if (pendingStreamDeltas.size === 0) return;

    if (requestId !== undefined) {
        const buffered = pendingStreamDeltas.get(requestId);
        if (buffered === undefined) return;
        pendingStreamDeltas.delete(requestId);
        if (pendingStreamDeltas.size === 0) cancelPendingStreamFlush();
        if (buffered) applyStreamDelta(set, requestId, buffered);
        return;
    }

    const buffered = [...pendingStreamDeltas.entries()];
    pendingStreamDeltas.clear();
    cancelPendingStreamFlush();
    buffered.forEach(([id, delta]) => {
        if (delta) applyStreamDelta(set, id, delta);
    });
}

function queueStreamDelta(set: ChatStateUpdater, requestId: string, delta: string): void {
    // 合批的意义是「一帧只提交一次」。没有 requestAnimationFrame 的环境（Node 测试、
    // SSR）本就没有帧可对齐，直接同步提交，语义与旧路径完全一致。
    if (!CHAT_STREAM_COALESCE || typeof requestAnimationFrame !== 'function') {
        applyStreamDelta(set, requestId, delta);
        return;
    }

    pendingStreamDeltas.set(requestId, (pendingStreamDeltas.get(requestId) ?? '') + delta);
    if (pendingStreamFlushHandle !== null) return;

    pendingStreamFlushHandle = requestAnimationFrame(() => {
        pendingStreamFlushHandle = null;
        flushPendingStreamDeltas(set);
    });
}

function addUsageToStreamingAssistantMessages(
    messages: ChatMessage[],
    usage: TokenUsage,
): ChatMessage[] {
    const nextMessages = [...messages];
    for (let i = nextMessages.length - 1; i >= 0; i--) {
        if (nextMessages[i].role === 'assistant' && nextMessages[i].streaming) {
            nextMessages[i] = { ...nextMessages[i], usage };
            break;
        }
    }
    return nextMessages;
}

function finishStreamingAssistantMessages(
    messages: ChatMessage[],
    success: boolean,
    error?: string | null,
): ChatMessage[] {
    return messages.map((m) => {
        if (m.role === 'assistant' && m.streaming) {
            clearStreamingTextSegment(m.id);
            return {
                ...m,
                streaming: false,
                error: success ? m.error : error || '执行失败',
                durationMs: Date.now() - m.createdAt,
            };
        }
        return m;
    });
}

function stopStreamingAssistantMessages(
    messages: ChatMessage[],
    error = STOPPED_OUTPUT_ERROR,
): ChatMessage[] {
    return messages.map((message) => (
        message.role === 'assistant' && message.streaming
            ? {
                ...message,
                streaming: false,
                error: message.error ?? error,
                durationMs: Date.now() - message.createdAt,
            }
            : message
    ));
}

function shouldAcceptRequestEvent(state: ChatState, requestId: string | null | undefined): boolean {
    if (!requestId) return false;
    if (retiredRequestIds.has(requestId)) return false;
    if (requestTargetTab(state, requestId)) return true;
    if (state.activeRequestId) return state.activeRequestId === requestId;
    return hasStreamingAssistant(state.messages);
}

function bindPendingRequestIfNeeded(
    set: (state: Partial<ChatState>) => void,
    state: ChatState,
    requestId: string,
): void {
    if (retiredRequestIds.has(requestId)) return;
    if (requestTabKeys.has(requestId)) return;

    const activeKey = state.activeTabKey;
    if (activeKey && !state.activeRequestId && hasStreamingAssistant(state.messages)) {
        requestTabKeys.set(requestId, activeKey);
        set(updateTabStateByKey(state, activeKey, (tab) => ({
            ...tab,
            activeRequestId: requestId,
            status: 'running',
        })));
        return;
    }

    const pendingTab = state.openTabs.find((tab) => !tab.activeRequestId && hasStreamingAssistant(tab.messages));
    if (pendingTab) {
        requestTabKeys.set(requestId, pendingTab.key);
        set(updateTabStateByKey(state, pendingTab.key, (tab) => ({
            ...tab,
            activeRequestId: requestId,
            status: 'running',
        })));
    }
}

function isChatProvider(providerId: string): providerId is ChatProvider {
    return providerId === 'claude' || providerId === 'codex';
}

function normalizeHistoryRole(role: string): ChatRole {
    const normalized = role.toLowerCase();
    if (normalized === 'user' || normalized === 'assistant' || normalized === 'system') {
        return normalized;
    }
    return 'system';
}

function mapHistoryMessage(
    session: SessionMeta,
    message: UnifiedSessionMessage,
    index: number,
): ChatMessage {
    const parsedTime = message.ts ? Date.parse(message.ts) : NaN;
    const createdAt = Number.isFinite(parsedTime)
        ? parsedTime
        : session.createdAt + index;

    // 历史里的上下文压缩边界 → 压缩分隔条（不携带 raw，无内容块可渲染）
    const compact = extractCompactBoundaryInfo(message.raw);
    if (compact) {
        return {
            id: `history-${session.providerId}-${session.sessionId}-${index}`,
            role: 'system',
            content: '',
            compact,
            createdAt,
        };
    }

    const role = isProtocolContextText(message.content)
        ? 'system'
        : normalizeHistoryRole(message.role);

    return {
        id: `history-${session.providerId}-${session.sessionId}-${index}`,
        role,
        content: message.content,
        raw: message.raw ?? undefined,
        createdAt,
    };
}

function mapHistoryMessages(
    session: SessionMeta,
    messages: UnifiedSessionMessage[],
    startIndex = 0,
): ChatMessage[] {
    return messages.map((message, offset) => mapHistoryMessage(session, message, startIndex + offset));
}

function deferSessionHistoryMapChunk(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

async function mapHistoryMessagesInChunks(
    session: SessionMeta,
    messages: UnifiedSessionMessage[],
    startIndex = 0,
): Promise<ChatMessage[]> {
    const mapped: ChatMessage[] = [];
    for (let index = 0; index < messages.length; index += SESSION_HISTORY_FULL_MAP_CHUNK_SIZE) {
        if (index > 0) {
            await deferSessionHistoryMapChunk();
        }
        mapped.push(...mapHistoryMessages(
            session,
            messages.slice(index, index + SESSION_HISTORY_FULL_MAP_CHUNK_SIZE),
            startIndex + index,
        ));
    }
    return mapped;
}

function getSessionHistoryCacheKey(session: SessionMeta): string {
    return [
        session.providerId,
        session.sourcePath,
        session.sessionId,
        session.lastActiveAt,
    ].join('::');
}

function getCachedSessionHistory(session: SessionMeta): ChatMessage[] | null {
    const key = getSessionHistoryCacheKey(session);
    const cached = sessionHistoryCache.get(key);
    if (!cached) return null;

    sessionHistoryCache.delete(key);
    sessionHistoryCache.set(key, cached);
    return cached;
}

function rememberSessionHistory(session: SessionMeta, messages: ChatMessage[]): void {
    const key = getSessionHistoryCacheKey(session);
    sessionHistoryCache.delete(key);
    sessionHistoryCache.set(key, messages);

    while (sessionHistoryCache.size > SESSION_HISTORY_CACHE_LIMIT) {
        const oldestKey = sessionHistoryCache.keys().next().value;
        if (!oldestKey) break;
        sessionHistoryCache.delete(oldestKey);
    }
}

function getSessionHistoryDisplayWindow(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length <= SESSION_HISTORY_FIRST_PAINT_LIMIT) return messages;
    return messages.slice(messages.length - SESSION_HISTORY_FIRST_PAINT_LIMIT);
}

function createSessionLoadMetrics(session: SessionMeta, startedAt: number): ChatSessionLoadMetrics {
    return {
        sessionKey: getSessionSelectionKey(session),
        providerId: session.providerId as ChatProvider,
        sourcePath: session.sourcePath,
        cacheHit: false,
        status: 'loading',
        startedAt,
        completedAt: null,
        elapsedMs: null,
        windowMessageCount: 0,
        totalMessageCount: null,
        fullMessageCount: null,
        windowLoadMs: null,
        windowMapMs: null,
        fullLoadMs: null,
        fullMapMs: null,
        error: null,
    };
}

function finishSessionLoadMetrics(
    metrics: ChatSessionLoadMetrics,
    completedAt: number,
    status: ChatSessionLoadMetrics['status'],
    error: string | null = null,
): ChatSessionLoadMetrics {
    return {
        ...metrics,
        status,
        completedAt,
        elapsedMs: completedAt - metrics.startedAt,
        error,
    };
}

export function clearChatSessionHistoryCache(): void {
    sessionHistoryCache.clear();
    requestTabKeys.clear();
    pendingSendOwners.clear();
    retiredRequestIds.clear();
    stoppedRequestNotifications.clear();
    sealedStreamingTextSegments.clear();
}

function getLoadedSessionState(
    session: SessionMeta,
    provider: ChatProvider,
    messages: ChatMessage[],
    state: ChatState,
): Partial<ChatState> {
    const model = defaultModel(provider);
    const levels = reasoningLevelsFor(provider, model);

    return {
        messages,
        provider,
        model,
        draft: loadDraft(provider),
        reasoningEffort: levels.some((level) => level.id === state.reasoningEffort)
            ? state.reasoningEffort
            : (levels[levels.length - 1]?.id ?? 'high'),
        sessionId: session.sessionId,
        currentCwd: session.projectDir,
        activeSession: session,
        pendingSessionKey: null,
        handoffContextProvider: null,
        activeRequestId: null,
        contextTokens: 0,
        contextMaxTokens: null,
        error: null,
    };
}

function isActiveSessionLoadCurrent(
    state: ChatState,
    session: SessionMeta,
    loadToken: number,
): boolean {
    if (loadToken !== latestSessionLoadToken) return false;
    if (!state.activeSession) return false;
    return getSessionSelectionKey(state.activeSession) === getSessionSelectionKey(session);
}

function hasHandoffContent(message: ChatMessage): boolean {
    if (message.streaming || message.error) return false;
    if (message.role !== 'user' && message.role !== 'assistant') return false;
    const content = message.content.trim();
    return content.length > 0
        && content !== TOOL_RESULT_CONTENT
        && !isProtocolContextText(content);
}

function roleLabel(role: ChatRole): string {
    if (role === 'assistant') return 'Assistant';
    if (role === 'system') return 'System';
    return 'User';
}

function trimToMaxChars(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(text.length - maxChars);
}

function buildProviderHandoffMessage(
    userMessage: string,
    messages: ChatMessage[],
    sourceProvider: ChatProvider,
    targetProvider: ChatProvider,
): string {
    const transcript = messages
        .filter(hasHandoffContent)
        .slice(-HANDOFF_CONTEXT_MAX_MESSAGES)
        .map((message) => `${roleLabel(message.role)}: ${message.content.trim()}`)
        .join('\n\n');

    if (!transcript.trim()) return userMessage;

    const boundedTranscript = trimToMaxChars(transcript, HANDOFF_CONTEXT_MAX_CHARS);

    return [
        `<previous-conversation-context source-provider="${sourceProvider}" target-provider="${targetProvider}">`,
        `The visible chat history below came from the ${sourceProvider} provider before the user switched to ${targetProvider}.`,
        'Treat it as prior conversation context and continue from it. Do not mention this wrapper unless it is directly relevant.',
        '',
        boundedTranscript,
        '</previous-conversation-context>',
        '',
        userMessage,
    ].join('\n');
}

async function abortActiveRequestIfNeeded(
    get: () => ChatState,
    set: (state: Partial<ChatState>) => void,
): Promise<string | null> {
    const state = get();
    const requestId = state.activeRequestId;
    if (!hasActiveChatTurn(state)) return null;

    latestChatTurnToken += 1;

    let abortError: string | null = null;
    try {
        await invoke('chat_abort');
    } catch (e) {
        abortError = String(e);
        set({ error: abortError });
    }
    retireRequestOwnership(requestId);
    set({ activeRequestId: null });
    return abortError;
}

/**
 * 把一条子代理 raw 消息合并进 subagentRuns[parentToolUseId]。复用主转录的
 * mergeRawChatMessage（已能合并 assistant 快照 / tool_result / user），返回新对象。
 */
function mergeSubagentRun(
    runs: Record<string, ChatMessage[]>,
    parentToolUseId: string,
    raw: MessageRaw,
): Record<string, ChatMessage[]> {
    if (!parentToolUseId) return runs;
    const existing = runs[parentToolUseId] ?? [];
    const merged = mergeRawChatMessage(existing, raw, {createId: newId, now: Date.now});
    return {...runs, [parentToolUseId]: merged};
}

export const useChatStore = create<ChatState>((set, get) => ({
    messages: [],
    subagentRuns: {},
    queuedMessages: [],
    provider: 'claude',
    permissionMode: 'default',
    model: defaultModel('claude'),
    reasoningEffort: loadReasoning(),
    draft: loadDraft('claude'),
    longContextEnabled: loadLongContextEnabled(),
    contextTokens: 0,
    contextMaxTokens: null,
    daemonReady: false,
    daemonStatus: null,
    daemonReconnecting: false,
    daemonLogs: [],
    activeRequestId: null,
    sessionId: null,
    currentCwd: null,
    activeSession: null,
    pendingSessionKey: null,
    lastSessionLoadMetrics: null,
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

    init: async () => {
        if (get().initialized) return;
        clearDaemonReadyTimeout();
        set({
            initialized: true,
            daemonReady: false,
            daemonStatus: 'starting',
            daemonReconnecting: false,
            error: null,
        });

        // 清理可能的旧监听器（热重载场景）
        unlisteners.forEach((u) => u());
        unlisteners = [];

        const streamUn = await listen<ChatStreamEvent>('chat://stream', (event) => {
            const { requestId, text } = event.payload;
            const stateBeforeStream = get();
            if (!shouldAcceptRequestEvent(stateBeforeStream, requestId)) return;
            bindPendingRequestIfNeeded(set, stateBeforeStream, requestId);
            noteRequestActivity(requestId);

            // 解析 daemon 的标签化输出。daemon stdout 每行都带标签前缀，
            // 只有 [CONTENT_DELTA] 是真正要显示的回复文本，其余（[DEBUG]、
            // [LIFECYCLE]、[MESSAGE]、[MESSAGE_START] 等）是协议/诊断信息，
            // 不应渲染到消息气泡里。参考 jcc-gui 的 ClaudeStreamAdapter。

            // [SESSION_ID]：保存会话 ID，供后续消息延续上下文。
            if (text.startsWith('[SESSION_ID]') || text.startsWith('[THREAD_ID]')) {
                const marker = text.startsWith('[THREAD_ID]') ? '[THREAD_ID]' : '[SESSION_ID]';
                const sid = text.slice(marker.length).trim();
                if (sid) {
                    flushPendingStreamDeltas(set, requestId);
                    set((state) => updateRequestTabState(state, requestId, (tab) => ({
                        ...tab,
                        sessionId: sid,
                        handoffContextProvider: null,
                    })));
                }
                return;
            }

            // [CONTENT_DELTA]：JSON 编码的文本增量，追加到当前流式消息。
            // 走帧合批：同一帧内的多截增量合成一次 set，见 queueStreamDelta。
            if (text.startsWith('[CONTENT_DELTA]')) {
                const payload = text.slice('[CONTENT_DELTA]'.length).trim();
                let delta = payload;
                try {
                    delta = JSON.parse(payload) as string;
                } catch {
                    // 非 JSON，按原文处理
                }
                queueStreamDelta(set, requestId, delta);
                return;
            }

            // [CONTENT]：非流式模式的完整文本块（直接追加）。
            // 与增量共用同一缓冲，保证两者的相对顺序。
            if (text.startsWith('[CONTENT]')) {
                const content = text.slice('[CONTENT]'.length).trim();
                queueStreamDelta(set, requestId, content);
                return;
            }

            // [USAGE]：本轮 token 用量，保存到当前流式 assistant 消息。
            if (text.startsWith('[USAGE]')) {
                const payload = text.slice('[USAGE]'.length).trim();
                try {
                    const usage = JSON.parse(payload) as TokenUsage;
                    flushPendingStreamDeltas(set, requestId);
                    set((state) => updateRequestTabState(state, requestId, (tab) => {
                        // 上下文 token ≈ 本轮输入(含缓存) + 输出，作为用量环的估算值。
                        const contextTokens =
                            (usage.input_tokens || 0) +
                            (usage.cache_read_input_tokens || 0) +
                            (usage.cache_creation_input_tokens || 0) +
                            (usage.output_tokens || 0);
                        // sidecar 推送的真实上下文窗口（按 1M/200K 状态）；
                        // 缺省时保留 null，由前端回退静态表。
                        const nextMax = typeof usage.max_tokens === 'number'
                            && Number.isFinite(usage.max_tokens)
                            && usage.max_tokens > 0
                            ? usage.max_tokens
                            : tab.contextMaxTokens;
                        return {
                            ...tab,
                            messages: addUsageToStreamingAssistantMessages(tab.messages, usage),
                            contextTokens,
                            contextMaxTokens: nextMax,
                        };
                    }));
                } catch {
                    // 忽略解析失败
                }
                return;
            }

            // [BLOCK_RESET]：daemon 在每次 message_start（每轮 tool_use 循环迭代）
            // 发出，标记一个内容块边界。封口当前流式 assistant 的开启中文本段，
            // 使下一段 [CONTENT_DELTA] 文本开启新的 text block，保留交错源顺序。
            if (text.startsWith('[BLOCK_RESET]')) {
                // 必须先排空缓冲：封口发生在缓冲文本之后的话，这一段会被算进
                // 下一个内容块，交错顺序就错了。
                flushPendingStreamDeltas(set, requestId);
                sealStreamingTextSegment(get);
                return;
            }

            // 其余标签行（[DEBUG]/[LIFECYCLE]/[MESSAGE]/[MESSAGE_START]/
            // [STREAM_START]/[STREAM_END] 等）忽略，
            // 不渲染为消息内容。[MESSAGE] 由 chat://message 事件单独处理。
        });

        const doneUn = await listen<ChatDoneEvent>('chat://done', (event) => {
            const { requestId, success, error } = event.payload;
            const stateBeforeDone = get();
            if (!shouldAcceptRequestEvent(stateBeforeDone, requestId)) return;
            bindPendingRequestIfNeeded(set, stateBeforeDone, requestId);
            // 回合收尾前排空缓冲：否则最后一帧的文本会落在 streaming 标志清掉之后，
            // 追加不到任何消息上（appendToStreamingAssistantMessages 只认流式消息）。
            flushPendingStreamDeltas(set, requestId);
            const targetBeforeDone = requestTargetTab(get(), requestId) ?? stateBeforeDone;
            // retire 会清 requestTabKeys，可见性判定所需的目标 key 要先取。
            const targetTabKeyBeforeDone = requestTargetTabKey(get(), requestId);
            notifyStoppedRequestOnce(
                requestId,
                success ? 'success' : 'error',
                targetBeforeDone.provider,
                success ? getLastAssistantTextPreview(targetBeforeDone.messages) : error,
            );
            retireRequestOwnership(requestId);

            set((state) => {
                // 回合结束时用户没在看这个 tab（非中心活跃、非 dock 可见侧聊）→ 未读。
                const viewed = !targetTabKeyBeforeDone
                    || targetTabKeyBeforeDone === state.activeTabKey
                    || targetTabKeyBeforeDone === state.dockChatTabKey;
                return {
                    ...updateRequestTabState(state, requestId, (tab) => ({
                        ...tab,
                        activeRequestId: null,
                        status: success ? 'idle' : 'error',
                        error: success ? tab.error : error || '执行失败',
                        messages: finishStreamingAssistantMessages(tab.messages, success, error),
                        unread: viewed ? tab.unread : true,
                    })),
                };
            });
            // 本轮成功结束 → 自动发送该 tab 排队中的下一条消息。
            if (success) {
                drainQueuedMessagesForTab(targetTabKeyBeforeDone ?? get().activeTabKey);
            }
        });

        const daemonUn = await listen<ChatDaemonEvent>('chat://daemon', (event) => {
            const { event: name, message } = event.payload;
            const daemonLogs = pushDaemonLog(get().daemonLogs, event.payload);
            if (name === 'ready') {
                clearDaemonReadyTimeout();
                set({ daemonReady: true, daemonStatus: 'ready', daemonReconnecting: false, daemonLogs });
            } else if (name === 'shutdown') {
                clearDaemonReadyTimeout();
                set({ daemonReady: false, daemonStatus: 'shutdown', daemonReconnecting: false, daemonLogs });
            } else {
                // 非生命周期事件（daemon 的 stderr 日志行等）不能顶掉 'starting'。
                // 顶掉之后 ready 超时的守卫会走「状态已不是 starting」的早退分支，
                // 于是既不报超时也不解锁重连——node 启动时随便一行 deprecation 警告
                // 就足以让守护进程状态永久卡住。日志本身仍进 daemonLogs 可查。
                set((state) => ({
                    daemonStatus: state.daemonStatus === 'starting'
                        ? state.daemonStatus
                        : (message ? `${name}: ${message}` : name),
                    daemonLogs,
                }));
            }
        });

        const askUserUn = await listen<AskUserQuestionRequest>('permission://ask-user-question', (event) => {
            set((state) => {
                const next = enqueuePermissionRequest(
                    state.pendingAskUserQuestion,
                    state.pendingAskUserQuestionQueue,
                    state.askUserQuestionResponseInFlightRequestId,
                    event.payload,
                );
                return {
                    pendingAskUserQuestion: next.pending,
                    pendingAskUserQuestionQueue: next.queue,
                };
            });
        });

        const planApprovalUn = await listen<PlanApprovalRequest>('permission://plan-approval', (event) => {
            set((state) => {
                const next = enqueuePermissionRequest(
                    state.pendingPlanApproval,
                    state.pendingPlanApprovalQueue,
                    state.planApprovalResponseInFlightRequestId,
                    event.payload,
                );
                return {
                    pendingPlanApproval: next.pending,
                    pendingPlanApprovalQueue: next.queue,
                };
            });
        });

        const toolPermissionUn = await listen<ToolPermissionRequest>('permission://tool', (event) => {
            set((state) => {
                const next = enqueuePermissionRequest(
                    state.pendingToolPermission,
                    state.pendingToolPermissionQueue,
                    state.toolPermissionResponseInFlightRequestId,
                    event.payload,
                );
                return {
                    pendingToolPermission: next.pending,
                    pendingToolPermissionQueue: next.queue,
                };
            });
        });

        // 监听 chat://message 事件（工具调用可视化）
        const messageUn = await listen<ChatMessageEvent>('chat://message', (event) => {
            try {
                const { requestId } = event.payload;
                const stateBeforeMessage = get();
                if (!shouldAcceptRequestEvent(stateBeforeMessage, requestId)) return;
                bindPendingRequestIfNeeded(set, stateBeforeMessage, requestId);
                noteRequestActivity(requestId);
                // 工具卡片与正文共处一条 transcript，先排空缓冲保证先后顺序。
                flushPendingStreamDeltas(set, requestId);
                const raw = JSON.parse(event.payload.json) as MessageRaw;

                // 子代理消息(带 parent_tool_use_id)不进主 transcript，
                // 路由到对应 Task 卡片的 subagentRuns（兼容旧 daemon 仍以 [MESSAGE] 形式发出的情况）。
                const parentToolUseId = raw.parent_tool_use_id?.trim();
                if (parentToolUseId) {
                    set((state) => updateRequestTabState(state, requestId, (tab) => ({
                        ...tab,
                        subagentRuns: mergeSubagentRun(tab.subagentRuns, parentToolUseId, raw),
                    })));
                    return;
                }

                // system 消息不进常规合并：compact_boundary 渲染为压缩分隔条，
                // 其余子类型（init/status 等）不进 transcript。
                if (raw.type === 'system') {
                    const compact = extractCompactBoundaryInfo(raw);
                    if (compact) {
                        const compactMessage: ChatMessage = {
                            id: newId(),
                            role: 'system',
                            content: '',
                            compact,
                            createdAt: Date.now(),
                        };
                        set((state) => updateRequestTabState(state, requestId, (tab) => ({
                            ...tab,
                            messages: [...tab.messages, compactMessage],
                        })));
                    }
                    return;
                }

                set((state) => {
                    return updateRequestTabState(state, requestId, (tab) => {
                        const messages = mergeRawChatMessage(tab.messages, raw, {
                            createId: newId,
                            now: Date.now,
                        });
                        return {
                            ...tab,
                            messages,
                        };
                    });
                });
            } catch (e) {
                console.error('[useChatStore] Failed to parse MESSAGE:', e);
            }
        });

        // 子代理(Task)消息走专用通道，按 parentToolUseId 路由进对应卡片的 subagentRuns。
        const subagentMessageUn = await listen<SubagentMessageEvent>('chat://subagent-message', (event) => {
            try {
                const { requestId, parentToolUseId } = event.payload;
                const trimmedParent = parentToolUseId?.trim();
                if (!trimmedParent) return;
                noteRequestActivity(requestId);
                const stateBeforeMessage = get();
                if (!shouldAcceptRequestEvent(stateBeforeMessage, requestId)) return;
                bindPendingRequestIfNeeded(set, stateBeforeMessage, requestId);
                const raw = JSON.parse(event.payload.json) as MessageRaw;
                set((state) => updateRequestTabState(state, requestId, (tab) => ({
                    ...tab,
                    subagentRuns: mergeSubagentRun(tab.subagentRuns, trimmedParent, raw),
                })));
            } catch (e) {
                console.error('[useChatStore] Failed to parse SUBAGENT_MESSAGE:', e);
            }
        });

        unlisteners = [streamUn, doneUn, daemonUn, askUserUn, planApprovalUn, toolPermissionUn, messageUn, subagentMessageUn];

        // 预热 daemon（懒启动也可，但提前启动可减少首条消息延迟）
        try {
            await invoke('chat_start_daemon');
            if (!get().daemonReady && get().daemonStatus === 'starting') {
                scheduleDaemonReadyTimeout(get, set);
            }
        } catch (e) {
            set({
                daemonReady: false,
                daemonStatus: 'error',
                daemonReconnecting: false,
                error: String(e),
            });
        }
    },

    reconnectDaemon: async () => {
        if (get().daemonReconnecting) return;
        clearDaemonReadyTimeout();
        set({
            daemonReady: false,
            daemonStatus: 'starting',
            daemonReconnecting: true,
            error: null,
        });
        try {
            await invoke('chat_start_daemon');
            scheduleDaemonReadyTimeout(get, set);
        } catch (e) {
            clearDaemonReadyTimeout();
            set({
                daemonReady: false,
                daemonStatus: 'error',
                daemonReconnecting: false,
                error: String(e),
            });
        }
    },

    setProvider: (p) => {
        const currentProvider = get().provider;
        latestSessionLoadToken += 1;
        // 如果 provider 没有变化，不重新加载草稿
        if (currentProvider === p) {
            set((state) => applyActiveTabProjection(state, {
                provider: p,
                pendingSessionKey: null,
                lastSessionLoadMetrics: null,
            }));
            return;
        }

        // 切换 provider 时同步切换持久化的模型与草稿，并校正推理档位。
        const provider = p as ChatProviderId;
        const model = defaultModel(provider);
        const levels = reasoningLevelsFor(provider, model);
        set((state) => ({
            ...applyActiveTabProjection(state, {
                provider: p,
                model,
                draft: loadDraft(provider),
                sessionId: null,
                activeSession: null,
                pendingSessionKey: null,
                lastSessionLoadMetrics: null,
                handoffContextProvider: state.messages.some(hasHandoffContent) ? currentProvider : null,
                reasoningEffort: levels.some((l) => l.id === state.reasoningEffort)
                    ? state.reasoningEffort
                    : (levels[levels.length - 1]?.id ?? 'high'),
            }),
        }));
    },

    setPermissionMode: (m) => {
        set((state) => applyActiveTabProjection(state, {permissionMode: m}));
    },

    setModel: (id) => {
        const baseModel = strip1MContextSuffix(id);
        try {
            localStorage.setItem(CHAT_MODEL_SELECTION_KEY_PREFIX + get().provider, baseModel);
        } catch {
            // ignore
        }
        // 切模型后校正推理档位（避免停留在新模型不支持的档）。
        const levels = reasoningLevelsFor(get().provider as ChatProviderId, baseModel);
        set((state) => ({
            ...applyActiveTabProjection(state, {
                model: baseModel,
                reasoningEffort: levels.some((l) => l.id === state.reasoningEffort)
                    ? state.reasoningEffort
                    : (levels[levels.length - 1]?.id ?? 'high'),
            }),
        }));
    },

    setLongContextEnabled: (enabled) => {
        try {
            localStorage.setItem(LONG_CONTEXT_KEY, String(enabled));
        } catch {
            // ignore
        }
        set((state) => applyActiveTabProjection(state, {longContextEnabled: enabled}));
    },

    setReasoningEffort: (e) => {
        try {
            localStorage.setItem(REASONING_KEY, e);
        } catch {
            // ignore
        }
        set((state) => applyActiveTabProjection(state, {reasoningEffort: e}));
    },

    setDraft: (text) => {
        try {
            localStorage.setItem(DRAFT_KEY_PREFIX + get().provider, text);
        } catch {
            // ignore
        }
        set((state) => applyActiveTabProjection(state, {draft: text}));
    },

    setCurrentCwd: (cwd) => {
        const normalizedCwd = cwd?.trim() || null;
        const state = get();
        const currentNormalized = state.currentCwd?.trim() || null;
        if (currentNormalized === normalizedCwd) return;

        // 当前 tab 已经绑定历史会话、或已有消息 / 进行中的请求时，切换工作目录
        // 等同于开启该目录下的新会话上下文，而不是把旧会话内容留在新目录下。
        const hasLoadedConversation = Boolean(state.activeSession)
            || state.messages.length > 0
            || Boolean(state.pendingSessionKey)
            || Boolean(state.activeRequestId);

        if (hasLoadedConversation) {
            latestSessionLoadToken += 1;
            set((current) => {
                const newTab = createEmptyTabFromState(current, normalizedCwd);
                return {
                    openTabs: upsertTab(saveProjectionBeforeSwitch(current), newTab),
                    activeTabKey: newTab.key,
                    ...projectTabToState(newTab),
                };
            });
            return;
        }

        set((current) => applyActiveTabProjection(current, {currentCwd: normalizedCwd}));
    },

    send: async (text, opts) => {
        const trimmed = text.trim();
        const attachments = opts?.attachments?.filter((attachment) => (
            attachment.fileName.trim().length > 0
        )) ?? [];
        const hasAttachments = attachments.length > 0;
        if (!trimmed && !hasAttachments) return false;
        // 回合进行中：不打断，入队等待本轮结束后自动发送（对标 queue follow-ups）。
        const busyState = get();
        if (busyState.activeTabKey && hasActiveChatTurn(busyState)) {
            get().queueMessageInTab(busyState.activeTabKey, trimmed, attachments);
            return true;
        }
        latestSessionLoadToken += 1;
        prepareChatTurnStoppedNotificationPermission();

        const messageText = trimmed || ATTACHMENT_ONLY_MESSAGE;
        const stateBeforeSend = get();
        const tabKey = stateBeforeSend.pendingSessionKey
            ? createDraftTabKey()
            : (stateBeforeSend.activeTabKey ?? createDraftTabKey());
        const sendState = stateBeforeSend.pendingSessionKey
            ? {
                ...stateBeforeSend,
                messages: [],
                sessionId: null,
                activeSession: null,
                pendingSessionKey: null,
                lastSessionLoadMetrics: null,
                contextTokens: 0,
                contextMaxTokens: null,
                handoffContextProvider: null,
            }
            : stateBeforeSend;
        const outboundMessage = sendState.handoffContextProvider
            && sendState.handoffContextProvider !== sendState.provider
            && !sendState.sessionId
            ? buildProviderHandoffMessage(
                messageText,
                sendState.messages,
                sendState.handoffContextProvider,
                sendState.provider,
            )
            : messageText;
        const displayText = opts?.displayText?.trim() || messageText;

        const userMsg: ChatMessage = {
            id: newId(),
            role: 'user',
            content: displayText,
            raw: buildUserRawMessage(trimmed, attachments),
            createdAt: Date.now(),
        };
        const assistantMsg: ChatMessage = {
            id: newId(),
            role: 'assistant',
            content: '',
            streaming: true,
            createdAt: Date.now(),
        };
        set((state) => ({
            ...applyActiveTabProjection(
                {
                    ...state,
                    activeTabKey: tabKey,
                    provider: sendState.provider,
                    permissionMode: sendState.permissionMode,
                    model: sendState.model,
                    reasoningEffort: sendState.reasoningEffort,
                    draft: sendState.draft,
                    longContextEnabled: sendState.longContextEnabled,
                    messages: sendState.messages,
                    sessionId: sendState.sessionId,
                    activeSession: sendState.activeSession,
                    pendingSessionKey: sendState.pendingSessionKey,
                    lastSessionLoadMetrics: sendState.lastSessionLoadMetrics,
                    contextTokens: sendState.contextTokens,
                    contextMaxTokens: sendState.contextMaxTokens,
                    handoffContextProvider: sendState.handoffContextProvider,
                },
                {
                    messages: [...sendState.messages, userMsg, assistantMsg],
                    error: null,
                    draft: '',
                    pendingSessionKey: null,
                    lastSessionLoadMetrics: null,
                    activeTabKey: tabKey,
                },
                {status: 'running'},
            ),
            activeTabKey: tabKey,
            messages: [...sendState.messages, userMsg, assistantMsg],
            provider: sendState.provider,
            permissionMode: sendState.permissionMode,
            model: sendState.model,
            reasoningEffort: sendState.reasoningEffort,
            longContextEnabled: sendState.longContextEnabled,
            sessionId: sendState.sessionId,
            currentCwd: sendState.currentCwd,
            activeSession: sendState.activeSession,
            activeRequestId: sendState.activeRequestId,
            contextTokens: sendState.contextTokens,
            contextMaxTokens: sendState.contextMaxTokens,
            handoffContextProvider: sendState.handoffContextProvider,
            error: null,
            draft: '',
            pendingSessionKey: null,
            lastSessionLoadMetrics: null,
        }));
        pendingSendOwners.set(assistantMsg.id, {tabKey, assistantMessageId: assistantMsg.id});
        // 发送即清空持久化草稿。
        try {
            localStorage.removeItem(DRAFT_KEY_PREFIX + stateBeforeSend.provider);
        } catch {
            // ignore
        }

        const {
            provider,
            sessionId,
            permissionMode,
            model,
            longContextEnabled,
            reasoningEffort,
            currentCwd,
        } = sendState;
        const requestedModel = opts?.model ?? model;
        const effectiveModel = provider === 'claude'
            ? apply1MContextSuffix(requestedModel, longContextEnabled)
            : requestedModel;
        const params: Record<string, unknown> = {
            message: outboundMessage,
            sessionId: provider === 'claude' ? (sessionId ?? undefined) : undefined,
            threadId: provider === 'codex' ? (sessionId ?? undefined) : undefined,
            cwd: opts?.cwd ?? currentCwd ?? undefined,
            model: effectiveModel,
            permissionMode,
            reasoningEffort,
            streaming: true,
        };

        if (hasAttachments) {
            params.attachments = provider === 'codex'
                ? attachments.map((attachment) => (
                    attachment.path
                        ? { type: 'local_image', path: attachment.path }
                        : attachment
                ))
                : attachments;
        }

        try {
            if (get().providerConfigDirty) {
                await invoke('chat_restart_daemon');
                set({
                    providerConfigDirty: false,
                    daemonReady: false,
                    daemonStatus: 'starting',
                    daemonReconnecting: false,
                    error: null,
                });
                scheduleDaemonReadyTimeout(get, set);
            }
            const requestId = await invoke<string>('chat_send', {
                provider,
                command: provider === 'claude' && hasAttachments ? 'sendWithAttachments' : 'send',
                params,
            });
            const owner = pendingSendOwners.get(assistantMsg.id);
            pendingSendOwners.delete(assistantMsg.id);
            const ownerTab = owner
                ? get().openTabs.find((tab) => tab.key === owner.tabKey)
                : null;
            if (!owner || !ownerTab?.messages.some((message) => (
                message.id === owner.assistantMessageId && message.role === 'assistant' && message.streaming
            ))) {
                retireRequestOwnership(requestId);
                return true;
            }
            requestTabKeys.set(requestId, tabKey);
            noteRequestActivity(requestId);
            set((state) => updateRequestTabState(state, requestId, (tab) => ({
                ...tab,
                activeRequestId: requestId,
                status: 'running',
                error: null,
            })));
            return true;
        } catch (e) {
            pendingSendOwners.delete(assistantMsg.id);
            toastSendFailure(e);
            notifyStoppedRequestOnce(
                `send-error:${assistantMsg.id}`,
                'error',
                provider,
                String(e),
            );
            set((state) => updateTabStateByKey(state, tabKey, (tab) => ({
                ...tab,
                error: String(e),
                status: 'error',
                messages: tab.messages.map((m) =>
                    m.id === assistantMsg.id
                        ? { ...m, streaming: false, error: String(e) }
                        : m,
                ),
            })));
            return false;
        }
    },

    sendInTab: async (tabKey, text, opts) => {
        const trimmed = text.trim();
        const attachments = opts?.attachments?.filter((attachment) => (
            attachment.fileName.trim().length > 0
        )) ?? [];
        const hasAttachments = attachments.length > 0;
        if (!trimmed && !hasAttachments) return false;

        const tab = get().openTabs.find((item) => item.key === tabKey);
        if (!tab) return false;

        // 回合进行中：入队等待本轮结束后自动发送。活跃 tab 的实时状态在顶层投影。
        const liveTab = tabKey === get().activeTabKey ? currentTopLevelTab(get()) : tab;
        if (hasActiveTabTurn(liveTab)) {
            get().queueMessageInTab(tabKey, trimmed, attachments);
            return true;
        }

        prepareChatTurnStoppedNotificationPermission();
        const messageText = trimmed || ATTACHMENT_ONLY_MESSAGE;
        const displayText = opts?.displayText?.trim() || messageText;
        const outboundMessage = tab.handoffContextProvider
            && tab.handoffContextProvider !== tab.provider
            && !tab.sessionId
            ? buildProviderHandoffMessage(
                messageText,
                tab.messages,
                tab.handoffContextProvider,
                tab.provider,
            )
            : messageText;

        const userMsg: ChatMessage = {
            id: newId(),
            role: 'user',
            content: displayText,
            raw: buildUserRawMessage(trimmed, attachments),
            createdAt: Date.now(),
        };
        const assistantMsg: ChatMessage = {
            id: newId(),
            role: 'assistant',
            content: '',
            streaming: true,
            createdAt: Date.now(),
        };

        set((state) => updateTabStateByKey(state, tabKey, (current) => ({
            ...current,
            messages: [...current.messages, userMsg, assistantMsg],
            draft: '',
            error: null,
            status: 'running',
            pendingSessionKey: null,
        })));
        pendingSendOwners.set(assistantMsg.id, {tabKey, assistantMessageId: assistantMsg.id});

        const requestedModel = opts?.model ?? tab.model;
        const effectiveModel = tab.provider === 'claude'
            ? apply1MContextSuffix(requestedModel, tab.longContextEnabled)
            : requestedModel;
        const params: Record<string, unknown> = {
            message: outboundMessage,
            sessionId: tab.provider === 'claude' ? (tab.sessionId ?? undefined) : undefined,
            threadId: tab.provider === 'codex' ? (tab.sessionId ?? undefined) : undefined,
            cwd: opts?.cwd ?? tab.currentCwd ?? undefined,
            model: effectiveModel,
            permissionMode: tab.permissionMode,
            reasoningEffort: tab.reasoningEffort,
            streaming: true,
        };
        if (hasAttachments) {
            params.attachments = tab.provider === 'codex'
                ? attachments.map((attachment) => (
                    attachment.path
                        ? { type: 'local_image', path: attachment.path }
                        : attachment
                ))
                : attachments;
        }

        try {
            if (get().providerConfigDirty) {
                await invoke('chat_restart_daemon');
                set({
                    providerConfigDirty: false,
                    daemonReady: false,
                    daemonStatus: 'starting',
                    daemonReconnecting: false,
                    error: null,
                });
                scheduleDaemonReadyTimeout(get, set);
            }
            const requestId = await invoke<string>('chat_send', {
                provider: tab.provider,
                command: tab.provider === 'claude' && hasAttachments ? 'sendWithAttachments' : 'send',
                params,
            });
            const owner = pendingSendOwners.get(assistantMsg.id);
            pendingSendOwners.delete(assistantMsg.id);
            const ownerTab = owner
                ? get().openTabs.find((item) => item.key === owner.tabKey)
                : null;
            if (!owner || !ownerTab?.messages.some((message) => (
                message.id === owner.assistantMessageId && message.role === 'assistant' && message.streaming
            ))) {
                retireRequestOwnership(requestId);
                return true;
            }
            requestTabKeys.set(requestId, tabKey);
            noteRequestActivity(requestId);
            set((state) => updateRequestTabState(state, requestId, (current) => ({
                ...current,
                activeRequestId: requestId,
                status: 'running',
                error: null,
            })));
            return true;
        } catch (e) {
            pendingSendOwners.delete(assistantMsg.id);
            toastSendFailure(e);
            notifyStoppedRequestOnce(
                `send-error:${assistantMsg.id}`,
                'error',
                tab.provider,
                String(e),
            );
            set((state) => updateTabStateByKey(state, tabKey, (current) => ({
                ...current,
                error: String(e),
                status: 'error',
                messages: current.messages.map((m) =>
                    m.id === assistantMsg.id
                        ? { ...m, streaming: false, error: String(e) }
                        : m,
                ),
            })));
            return false;
        }
    },

    setTabDraft: (tabKey, text) => {
        set((state) => {
            const tab = tabKey === state.activeTabKey
                ? currentTopLevelTab(state)
                : state.openTabs.find((item) => item.key === tabKey);
            // 草稿未变时 no-op：composer 的编辑器同步 effect 会回写当前文本，
            // 无条件写入会造成 渲染→写 store→再渲染 的循环。
            if (!tab || tab.draft === text) return {};
            return updateTabStateByKey(state, tabKey, (current) => ({...current, draft: text}));
        });
    },

    queueMessageInTab: (tabKey, text, attachments) => {
        const trimmed = text.trim();
        const safeAttachments = attachments?.filter((attachment) => attachment.fileName.trim().length > 0) ?? [];
        if (!trimmed && safeAttachments.length === 0) return;
        const item: QueuedChatMessage = {
            id: newId(),
            text: trimmed,
            attachments: safeAttachments.length > 0 ? safeAttachments : undefined,
            queuedAt: Date.now(),
        };
        set((state) => updateTabStateByKey(state, tabKey, (current) => ({
            ...current,
            queuedMessages: [...current.queuedMessages, item],
            draft: '',
        })));
    },

    removeQueuedMessage: (tabKey, id) => {
        set((state) => updateTabStateByKey(state, tabKey, (current) => ({
            ...current,
            queuedMessages: current.queuedMessages.filter((item) => item.id !== id),
        })));
    },

    updateTabConfig: (tabKey, config) => {
        set((state) => {
            const tab = tabKey === state.activeTabKey
                ? currentTopLevelTab(state)
                : state.openTabs.find((item) => item.key === tabKey);
            // 流式进行中锁定配置变更（与活跃 tab 守卫一致）。
            if (!tab || tab.activeRequestId || tab.messages.some((m) => m.streaming)) return {};
            return updateTabStateByKey(state, tabKey, (current) => ({...current, ...config}));
        });
    },

    loadSession: async (session) => {
        if (!isChatProvider(session.providerId)) {
            set({
                error: `Unsupported chat provider: ${session.providerId}`,
                lastSessionLoadMetrics: null,
            });
            return;
        }
        const provider = session.providerId;

        const pendingSessionKey = getSessionSelectionKey(session);
        const currentState = get();
        const isCurrentSession = currentState.activeSession
            ? getSessionSelectionKey(currentState.activeSession) === pendingSessionKey
            : false;
        // 只有当前会话仍有进行中的回合时才跳过重载，避免打断正在进行的流式输出。
        // 其余情况（包括重开「刚实时跑过、已结束」的当前会话）都走正常加载路径：
        // 缓存命中提供磁盘顺序的完整历史，窗口路径从磁盘重读 ≤120 条尾窗，
        // 二者都通过 getLoadedSessionState 用磁盘/缓存的源顺序重建 messages，
        // 修复实时合并遗留的「文本簇 + 工具簇」聚类转录。
        if (isCurrentSession && hasActiveChatTurn(currentState)) {
            return;
        }

        const tabKey = `session:${pendingSessionKey}`;
        const loadToken = ++latestSessionLoadToken;
        const startedAt = nowMs();
        const baseMetrics = createSessionLoadMetrics(session, startedAt);
        set((state) => ({
            openTabs: upsertTab(
                saveProjectionBeforeSwitch(state),
                {
                    ...createEmptyTabFromState(state, session.projectDir, startedAt, tabKey),
                    key: tabKey,
                    provider,
                    model: defaultModel(provider),
                    draft: loadDraft(provider),
                    sessionId: session.sessionId,
                    currentCwd: session.projectDir,
                    activeSession: session,
                    pendingSessionKey,
                    lastSessionLoadMetrics: baseMetrics,
                    status: 'loading',
                    updatedAt: startedAt,
                },
            ),
            activeTabKey: tabKey,
            messages: [],
            provider,
            model: defaultModel(provider),
            draft: loadDraft(provider),
            sessionId: session.sessionId,
            currentCwd: session.projectDir,
            activeSession: session,
            activeRequestId: null,
            pendingSessionKey,
            error: null,
            lastSessionLoadMetrics: baseMetrics,
            handoffContextProvider: null,
            contextTokens: 0,
            contextMaxTokens: null,
        }));

        try {
            const cachedHistory = getCachedSessionHistory(session);
            if (cachedHistory) {
                if (loadToken !== latestSessionLoadToken) {
                    return;
                }
                const displayHistory = getSessionHistoryDisplayWindow(cachedHistory);
                const completedAt = nowMs();
                const cacheMetrics = finishSessionLoadMetrics(
                    {
                        ...baseMetrics,
                        cacheHit: true,
                        windowMessageCount: displayHistory.length,
                        totalMessageCount: cachedHistory.length,
                        fullMessageCount: cachedHistory.length,
                    },
                    completedAt,
                    'complete',
                );
                set((state) => ({
                    ...updateTabStateByKey(state, tabKey, (tab) => ({
                        ...tab,
                        ...createTabFromState(tabKey, {
                            ...state,
                            ...getLoadedSessionState(session, provider, displayHistory, state),
                        } as ChatState),
                        lastSessionLoadMetrics: cacheMetrics,
                        error: null,
                        status: 'idle',
                    })),
                    lastSessionLoadMetrics: cacheMetrics,
                    error: null,
                }));
                return;
            }

            const windowLoadStartedAt = nowMs();
            const historyWindow = await invoke<UnifiedSessionMessageWindow>('get_unified_session_message_window', {
                providerId: session.providerId,
                sourcePath: session.sourcePath,
                tailLimit: SESSION_HISTORY_FIRST_PAINT_LIMIT,
            });
            const windowLoadedAt = nowMs();
            if (loadToken !== latestSessionLoadToken) {
                return;
            }

            const mappedHistoryWindow = mapHistoryMessages(
                session,
                historyWindow.messages,
                historyWindow.startIndex,
            );
            const windowMappedAt = nowMs();
            const windowStatus: ChatSessionLoadMetrics['status'] = historyWindow.complete ? 'complete' : 'windowed';
            const windowMetrics: ChatSessionLoadMetrics = {
                ...baseMetrics,
                status: windowStatus,
                completedAt: windowMappedAt,
                elapsedMs: windowMappedAt - baseMetrics.startedAt,
                windowMessageCount: historyWindow.messages.length,
                totalMessageCount: historyWindow.totalCount,
                fullMessageCount: historyWindow.complete ? mappedHistoryWindow.length : null,
                windowLoadMs: windowLoadedAt - windowLoadStartedAt,
                windowMapMs: windowMappedAt - windowLoadedAt,
            };
            set((state) => ({
                ...updateTabStateByKey(state, tabKey, (tab) => ({
                    ...tab,
                    ...createTabFromState(tabKey, {
                        ...state,
                        ...getLoadedSessionState(session, provider, mappedHistoryWindow, state),
                    } as ChatState),
                    lastSessionLoadMetrics: windowMetrics,
                    error: null,
                    status: 'idle',
                })),
                lastSessionLoadMetrics: windowMetrics,
                error: null,
            }));

            if (historyWindow.complete) {
                rememberSessionHistory(session, mappedHistoryWindow);
            }
        } catch (e) {
            if (loadToken !== latestSessionLoadToken) {
                return;
            }
            const errorText = String(e);
            const currentMetrics = get().lastSessionLoadMetrics;
            const metricsForError = currentMetrics?.sessionKey === baseMetrics.sessionKey
                ? currentMetrics
                : baseMetrics;
            const errorMetrics = finishSessionLoadMetrics(
                metricsForError,
                nowMs(),
                'error',
                errorText,
            );
            set((state) => ({
                ...updateTabStateByKey(state, tabKey, (tab) => ({
                    ...tab,
                    error: errorText,
                    pendingSessionKey: null,
                    lastSessionLoadMetrics: errorMetrics,
                    status: 'error',
                })),
                error: errorText,
                pendingSessionKey: null,
                lastSessionLoadMetrics: errorMetrics,
            }));
        }
    },

    loadActiveSessionFullHistory: async () => {
        const stateBeforeLoad = get();
        const session = stateBeforeLoad.activeSession;
        if (!session || !isChatProvider(session.providerId)) {
            return null;
        }

        const loadToken = latestSessionLoadToken;
        const sessionKey = getSessionSelectionKey(session);
        const startedAt = nowMs();
        const currentMetrics = stateBeforeLoad.lastSessionLoadMetrics?.sessionKey === sessionKey
            ? stateBeforeLoad.lastSessionLoadMetrics
            : createSessionLoadMetrics(session, startedAt);
        const cachedHistory = getCachedSessionHistory(session);

        if (cachedHistory) {
            if (!isActiveSessionLoadCurrent(get(), session, loadToken)) {
                return null;
            }
            const completedAt = nowMs();
            const displayHistory = getSessionHistoryDisplayWindow(cachedHistory);
            const cacheMetrics = finishSessionLoadMetrics(
                {
                    ...currentMetrics,
                    cacheHit: true,
                    windowMessageCount: displayHistory.length,
                    totalMessageCount: cachedHistory.length,
                    fullMessageCount: cachedHistory.length,
                    fullLoadMs: currentMetrics.fullLoadMs ?? 0,
                    fullMapMs: currentMetrics.fullMapMs ?? 0,
                    error: null,
                },
                completedAt,
                'complete',
            );
            set({lastSessionLoadMetrics: cacheMetrics, error: null});
            return cachedHistory;
        }

        const fullLoadStartedAt = nowMs();
        set({
            lastSessionLoadMetrics: {
                ...currentMetrics,
                status: 'loading',
                completedAt: null,
                elapsedMs: null,
                error: null,
            },
            error: null,
        });

        try {
            const history = await invoke<UnifiedSessionMessage[]>('get_unified_session_messages', {
                providerId: session.providerId,
                sourcePath: session.sourcePath,
            });
            const fullLoadedAt = nowMs();
            if (!isActiveSessionLoadCurrent(get(), session, loadToken)) {
                return null;
            }

            const mappedHistory = await mapHistoryMessagesInChunks(session, history);
            const fullMappedAt = nowMs();
            if (!isActiveSessionLoadCurrent(get(), session, loadToken)) {
                return null;
            }

            rememberSessionHistory(session, mappedHistory);
            const displayHistory = getSessionHistoryDisplayWindow(mappedHistory);
            const fullMetrics = finishSessionLoadMetrics(
                {
                    ...currentMetrics,
                    cacheHit: false,
                    windowMessageCount: displayHistory.length,
                    totalMessageCount: history.length,
                    fullMessageCount: mappedHistory.length,
                    fullLoadMs: fullLoadedAt - fullLoadStartedAt,
                    fullMapMs: fullMappedAt - fullLoadedAt,
                    error: null,
                },
                fullMappedAt,
                'complete',
            );
            set({lastSessionLoadMetrics: fullMetrics, error: null});
            return mappedHistory;
        } catch (e) {
            if (!isActiveSessionLoadCurrent(get(), session, loadToken)) {
                return null;
            }
            const errorText = String(e);
            const errorMetrics = finishSessionLoadMetrics(
                currentMetrics,
                nowMs(),
                'error',
                errorText,
            );
            set({lastSessionLoadMetrics: errorMetrics, error: errorText});
            return null;
        }
    },

    expandActiveSessionHistory: async () => {
        const stateBeforeLoad = get();
        const session = stateBeforeLoad.activeSession;
        if (!session || !isChatProvider(session.providerId)) {
            return;
        }
        // 仅在仍处于「窗口模式」时扩展；其它状态意味着已是完整历史或正在加载。
        if (stateBeforeLoad.lastSessionLoadMetrics?.status !== 'windowed') {
            return;
        }

        const loadToken = latestSessionLoadToken;
        const sessionKey = getSessionSelectionKey(session);
        const startedAt = nowMs();
        const currentMetrics = stateBeforeLoad.lastSessionLoadMetrics?.sessionKey === sessionKey
            ? stateBeforeLoad.lastSessionLoadMetrics
            : createSessionLoadMetrics(session, startedAt);

        const applyFullHistory = (mappedHistory: ChatMessage[]): void => {
            rememberSessionHistory(session, mappedHistory);
        };

        const cachedHistory = getCachedSessionHistory(session);
        if (cachedHistory) {
            if (!isActiveSessionLoadCurrent(get(), session, loadToken)) {
                return;
            }
            applyFullHistory(cachedHistory);
            const completedAt = nowMs();
            const cacheMetrics = finishSessionLoadMetrics(
                {
                    ...currentMetrics,
                    cacheHit: true,
                    windowMessageCount: cachedHistory.length,
                    totalMessageCount: cachedHistory.length,
                    fullMessageCount: cachedHistory.length,
                    fullLoadMs: currentMetrics.fullLoadMs ?? 0,
                    fullMapMs: currentMetrics.fullMapMs ?? 0,
                    error: null,
                },
                completedAt,
                'complete',
            );
            set({messages: cachedHistory, lastSessionLoadMetrics: cacheMetrics, error: null});
            return;
        }

        const fullLoadStartedAt = nowMs();
        set({
            lastSessionLoadMetrics: {
                ...currentMetrics,
                status: 'loading',
                completedAt: null,
                elapsedMs: null,
                error: null,
            },
            error: null,
        });

        try {
            const history = await invoke<UnifiedSessionMessage[]>('get_unified_session_messages', {
                providerId: session.providerId,
                sourcePath: session.sourcePath,
            });
            const fullLoadedAt = nowMs();
            if (!isActiveSessionLoadCurrent(get(), session, loadToken)) {
                return;
            }

            const mappedHistory = await mapHistoryMessagesInChunks(session, history);
            const fullMappedAt = nowMs();
            if (!isActiveSessionLoadCurrent(get(), session, loadToken)) {
                return;
            }

            applyFullHistory(mappedHistory);
            const fullMetrics = finishSessionLoadMetrics(
                {
                    ...currentMetrics,
                    cacheHit: false,
                    windowMessageCount: mappedHistory.length,
                    totalMessageCount: history.length,
                    fullMessageCount: mappedHistory.length,
                    fullLoadMs: fullLoadedAt - fullLoadStartedAt,
                    fullMapMs: fullMappedAt - fullLoadedAt,
                    error: null,
                },
                fullMappedAt,
                'complete',
            );
            set({messages: mappedHistory, lastSessionLoadMetrics: fullMetrics, error: null});
        } catch (e) {
            if (!isActiveSessionLoadCurrent(get(), session, loadToken)) {
                return;
            }
            // 失败时保留当前窗口化的可见消息，仅记录错误并维持 windowed 状态以便重试。
            const errorText = String(e);
            const errorMetrics = finishSessionLoadMetrics(
                {
                    ...currentMetrics,
                    status: 'windowed',
                },
                nowMs(),
                'windowed',
                errorText,
            );
            set({lastSessionLoadMetrics: errorMetrics, error: errorText});
        }
    },

    focusTab: (key) => {
        set((state) => {
            const tabs = saveActiveProjection(state);
            const target = tabs.find((tab) => tab.key === key);
            if (!target) return {};

            // 聚焦即已读。
            const focused = target.unread ? {...target, unread: false} : target;
            return {
                openTabs: focused === target ? tabs : upsertTab(tabs, focused),
                activeTabKey: key,
                ...projectTabToState(focused),
            };
        });
    },

    closeTab: (key) => {
        set((state) => {
            const tabs = saveActiveProjection(state);
            const remainingTabs = removeTab(tabs, key);
            const nextActiveKey = getNextTabAfterClose({
                // 焦点回退只在中心 tab 里挑：dock 侧聊不该被提到中心来当活跃会话。
                tabs: selectCenterTabs(tabs),
                closingKey: key,
                activeKey: state.activeTabKey,
            });

            if (!nextActiveKey) {
                const emptyTab = createEmptyTabFromState(state);
                return {
                    // 中心已无 tab，但 dock 里的侧聊要留着。
                    openTabs: remainingTabs.filter(isSideChatTab),
                    activeTabKey: null,
                    ...projectTabToState(emptyTab),
                };
            }

            const nextActiveTab = remainingTabs.find((tab) => tab.key === nextActiveKey);
            if (!nextActiveTab) return {openTabs: remainingTabs};

            return {
                openTabs: remainingTabs,
                activeTabKey: nextActiveKey,
                ...projectTabToState(nextActiveTab),
            };
        });
    },

    closeOtherTabs: (key) => {
        set((state) => {
            const tabs = saveActiveProjection(state);
            const targetTab = tabs.find((tab) => tab.key === key);
            if (!targetTab) return {};

            return {
                // 「关闭其它标签页」是中心标签条的动作，不该顺手清掉 dock 里的侧聊
                // ——那会让侧聊面板变成指向不存在 tab 的空壳。
                openTabs: [targetTab, ...tabs.filter((tab) => isSideChatTab(tab) && tab.key !== key)],
                activeTabKey: targetTab.key,
                ...projectTabToState(targetTab),
            };
        });
    },

    closeAllTabs: () => {
        set((state) => {
            const tabs = saveActiveProjection(state);
            const emptyTab = createEmptyTabFromState(state, state.currentCwd);
            return {
                openTabs: tabs.filter(isSideChatTab),
                activeTabKey: null,
                ...projectTabToState(emptyTab),
            };
        });
    },

    openSideChat: (opts) => {
        const state = get();
        const sideTab: ChatSessionTab = {
            ...createEmptyTabFromState(state, opts?.cwd ?? state.currentCwd),
            // 标记归属，否则中心标签条会把它当成一个「新对话」一起显示出来。
            surface: 'side',
        };
        set((s) => ({
            openTabs: upsertTab(s.openTabs, sideTab),
            dockChatTabKey: sideTab.key,
        }));
        return sideTab.key;
    },

    closeSideChat: (key) => {
        retirePendingSendsForTab(key);
        // 侧聊 tab 与中心会话共用 openTabs 池，可能已被用户在中心 tab 条聚焦为
        // 活跃 tab；此时按中心关闭语义走焦点回退，避免 activeTabKey 悬空。
        if (get().activeTabKey === key) {
            get().closeTab(key);
        } else {
            set((state) => ({
                openTabs: removeTab(state.openTabs, key),
            }));
        }
        set((state) => ({
            dockChatTabKey: state.dockChatTabKey === key ? null : state.dockChatTabKey,
        }));
    },

    setDockChatTabKey: (key) => {
        set((state) => {
            if (state.dockChatTabKey === key) return {};
            // 侧聊变为 dock 可见即视为已读。
            const openTabs = key
                ? state.openTabs.map((tab) => (tab.key === key && tab.unread ? {...tab, unread: false} : tab))
                : state.openTabs;
            return {dockChatTabKey: key, openTabs};
        });
    },

    retryLastUserMessage: async (tabKey) => {
        const state = get();
        const key = tabKey ?? null;
        const source = !key || key === state.activeTabKey
            ? state
            : state.openTabs.find((tab) => tab.key === key);
        if (!source) return false;
        // 该 tab 仍有进行中的回合时不重发，避免连点造成并发混乱。
        if (source.activeRequestId) return false;

        const lastUser = [...source.messages].reverse().find((message) => message.role === 'user');
        if (!lastUser) return false;
        const blocks = getContentBlocksFromRaw(lastUser.raw);
        // 图片附件无法从历史消息可靠还原（临时文件可能已清理），不自动重发。
        if (blocks.some((block) => block.type === 'image' || block.type === 'input_image')) {
            return false;
        }
        // 优先取原始发送文本（content 可能是增强后的展示文本）。
        const rawText = blocks
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n')
            .trim();
        const text = rawText || lastUser.content.trim();
        if (!text) return false;

        if (key && key !== state.activeTabKey) {
            return get().sendInTab(key, text);
        }
        return get().send(text);
    },

    rewindToMessage: async (tabKey, messageId, opts) => {
        const state = get();
        const key = tabKey ?? state.activeTabKey;
        if (!key) return false;
        const tab = key === state.activeTabKey
            ? currentTopLevelTab(state)
            : state.openTabs.find((item) => item.key === key);
        if (!tab) return false;
        // 仅 Claude 支持（会话文件截断 + SDK checkpoint 都是 Claude 侧机制）。
        if (tab.provider !== 'claude') return false;
        if (hasActiveTabTurn(tab)) return false;
        const sessionId = tab.sessionId?.trim();
        if (!sessionId) return false;

        const index = tab.messages.findIndex((message) => message.id === messageId);
        if (index < 0) return false;
        const target = tab.messages[index];
        const targetUuid = target.raw?.uuid?.trim();
        if (target.role !== 'user' || !targetUuid) return false;

        try {
            if (opts?.restoreFiles) {
                // 文件恢复要在 fork 前做：checkpoint 挂在原会话上。
                await rewindFilesViaDaemon(sessionId, targetUuid, tab.currentCwd);
            }
            const fork = await invoke<{forkedSessionId: string; forkedSourcePath: string}>(
                'chat_fork_claude_session',
                {
                    sessionId,
                    messageUuid: targetUuid,
                    sourcePath: tab.activeSession?.sourcePath ?? null,
                },
            );
            // 原始发送文本回填草稿，便于修改后重发。
            const blocks = getContentBlocksFromRaw(target.raw);
            const rawText = blocks
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('\n')
                .trim();
            const draftText = rawText || target.content.trim();

            set((current) => updateTabStateByKey(current, key, (item) => ({
                ...item,
                messages: item.messages.slice(0, index),
                sessionId: fork.forkedSessionId,
                activeSession: item.activeSession
                    ? {
                        ...item.activeSession,
                        sessionId: fork.forkedSessionId,
                        sourcePath: fork.forkedSourcePath,
                    }
                    : null,
                draft: draftText,
                status: 'idle',
                error: null,
            })));
            return true;
        } catch (e) {
            set((current) => updateTabStateByKey(current, key, (item) => ({
                ...item,
                error: String(e),
            })));
            return false;
        }
    },

    markProviderConfigDirty: async () => {
        const currentState = get();
        if (hasAnyActiveChatTurn(currentState)) {
            set({providerConfigDirty: true});
            return;
        }

        set({
            providerConfigDirty: true,
            daemonReady: false,
            daemonStatus: 'starting',
            daemonReconnecting: false,
            error: null,
        });
        try {
            await invoke('chat_restart_daemon');
            set({
                providerConfigDirty: false,
                daemonReconnecting: false,
            });
            scheduleDaemonReadyTimeout(get, set);
        } catch (e) {
            set({
                providerConfigDirty: true,
                daemonReady: false,
                daemonStatus: 'error',
                daemonReconnecting: false,
                error: String(e),
            });
        }
    },

    startNewSession: async (cwd) => {
        latestSessionLoadToken += 1;
        set((state) => ({
            ...(() => {
                const newTab = createEmptyTabFromState(state, cwd);
                return {
                    openTabs: upsertTab(saveProjectionBeforeSwitch(state), newTab),
                    activeTabKey: newTab.key,
                    ...projectTabToState(newTab),
                };
            })(),
        }));
    },

    abort: async () => {
        // 中止会清掉 streaming 标志，缓冲里的文本此后就无处可去——先落盘，
        // 再读状态，这样通知里的预览文本也是完整的。
        flushPendingStreamDeltas(set);
        const stateBeforeAbort = get();
        const { activeRequestId, provider, messages } = stateBeforeAbort;
        if (hasActiveChatTurn(stateBeforeAbort)) {
            latestChatTurnToken += 1;
        }
        prepareChatTurnStoppedNotificationPermission();

        try {
            await invoke('chat_abort');
            notifyStoppedRequestOnce(
                activeRequestId,
                'aborted',
                provider,
                getLastAssistantTextPreview(messages),
            );
        } catch (e) {
            set({ error: String(e) });
        }
        retireRequestOwnership(activeRequestId);
        set((state) => ({
            ...applyActiveTabProjection(
                state,
                {
                    activeRequestId: null,
                    messages: stopStreamingAssistantMessages(state.messages),
                },
                {status: 'idle', activeRequestId: null},
            ),
        }));
    },

    clear: async () => {
        latestSessionLoadToken += 1;
        retirePendingSendsForTab(get().activeTabKey);
        const abortError = await abortActiveRequestIfNeeded(get, set);
        set((state) => {
            const partial: Partial<ChatState> = {
                messages: [],
                sessionId: null,
                activeSession: null,
                pendingSessionKey: null,
                lastSessionLoadMetrics: null,
                handoffContextProvider: null,
                error: abortError,
                contextTokens: 0,
                contextMaxTokens: null,
                queuedMessages: [],
            };
            return applyActiveTabProjection(state, partial, {status: 'idle'});
        });
    },

    answerAskUserQuestion: async (requestId, answers) => {
        const pending = get().pendingAskUserQuestion;
        if (pending?.requestId !== requestId) return;
        set({ pendingAskUserQuestion: null, askUserQuestionResponseInFlightRequestId: requestId });
        try {
            await invoke('permission_respond_ask_user_question', {
                requestId,
                sessionId: permissionSessionId(pending),
                answers,
            });
            set((state) => {
                if (state.pendingAskUserQuestion) {
                    return {askUserQuestionResponseInFlightRequestId: null};
                }
                const next = nextPermissionRequest(state.pendingAskUserQuestionQueue);
                return {
                    pendingAskUserQuestion: next.pending,
                    pendingAskUserQuestionQueue: next.queue,
                    askUserQuestionResponseInFlightRequestId: null,
                };
            });
        } catch (e) {
            set((state) => ({
                error: String(e),
                pendingAskUserQuestion: state.pendingAskUserQuestion ?? clonePermissionRequest(pending),
                askUserQuestionResponseInFlightRequestId: null,
            }));
        }
    },

    answerToolPermission: async (requestId, allow) => {
        const pending = get().pendingToolPermission;
        if (pending?.requestId !== requestId) return;
        set({ pendingToolPermission: null, toolPermissionResponseInFlightRequestId: requestId });
        try {
            await invoke('permission_respond_tool', {
                requestId,
                sessionId: permissionSessionId(pending),
                allow,
            });
            set((state) => {
                if (state.pendingToolPermission) {
                    return {toolPermissionResponseInFlightRequestId: null};
                }
                const next = nextPermissionRequest(state.pendingToolPermissionQueue);
                return {
                    pendingToolPermission: next.pending,
                    pendingToolPermissionQueue: next.queue,
                    toolPermissionResponseInFlightRequestId: null,
                };
            });
        } catch (e) {
            set((state) => ({
                error: String(e),
                pendingToolPermission: state.pendingToolPermission ?? clonePermissionRequest(pending),
                toolPermissionResponseInFlightRequestId: null,
            }));
        }
    },

    approvePlan: async (requestId, approved, targetMode) => {
        const pending = get().pendingPlanApproval;
        if (pending?.requestId !== requestId) return;
        set({ pendingPlanApproval: null, planApprovalResponseInFlightRequestId: requestId });
        try {
            await invoke('permission_respond_plan_approval', {
                requestId,
                sessionId: permissionSessionId(pending),
                approved,
                targetMode,
                message: null,
            });
            set((state) => {
                if (state.pendingPlanApproval) {
                    return {planApprovalResponseInFlightRequestId: null};
                }
                const next = nextPermissionRequest(state.pendingPlanApprovalQueue);
                return {
                    pendingPlanApproval: next.pending,
                    pendingPlanApprovalQueue: next.queue,
                    planApprovalResponseInFlightRequestId: null,
                };
            });
        } catch (e) {
            set((state) => ({
                error: String(e),
                pendingPlanApproval: state.pendingPlanApproval ?? clonePermissionRequest(pending),
                planApprovalResponseInFlightRequestId: null,
            }));
        }
    },

    addDeniedTool: (toolId) =>
        set((state) => ({
            deniedToolIds: new Set(state.deniedToolIds).add(toolId),
        })),

    clearDeniedTools: () => set({ deniedToolIds: new Set() }),

    clearDaemonLogs: () => set({ daemonLogs: [] }),
}));

/** 指定 tab 的会话切片（供 `<ChatPane tabKey>` 主/侧共用）。 */
export interface ChatTabView {
    key: string;
    messages: ChatMessage[];
    provider: ChatProvider;
    permissionMode: PermissionMode;
    model: string;
    reasoningEffort: ReasoningEffort;
    draft: string;
    longContextEnabled: boolean;
    contextTokens: number;
    contextMaxTokens: number | null;
    activeRequestId: string | null;
    sessionId: string | null;
    currentCwd: string | null;
    activeSession: SessionMeta | null;
    pendingSessionKey: string | null;
    lastSessionLoadMetrics: ChatSessionLoadMetrics | null;
    subagentRuns: Record<string, ChatMessage[]>;
    error: string | null;
    isStreaming: boolean;
    queuedMessages: QueuedChatMessage[];
}

/**
 * 读取指定 tab 的会话切片。活跃 tab 走顶层投影、背景 tab 读 `openTabs[key]`；
 * 用 `useShallow` 浅比较避免无谓重渲染。tabKey 为空或 tab 不存在返回 null。
 */
export function useChatTab(tabKey: string | null): ChatTabView | null {
    return useChatStore(useShallow((state): ChatTabView | null => {
        if (!tabKey) return null;
        const source: ChatState | ChatSessionTab | undefined =
            tabKey === state.activeTabKey
                ? state
                : state.openTabs.find((tab) => tab.key === tabKey);
        if (!source) return null;
        return {
            key: tabKey,
            messages: source.messages,
            provider: source.provider,
            permissionMode: source.permissionMode,
            model: source.model,
            reasoningEffort: source.reasoningEffort,
            draft: source.draft,
            longContextEnabled: source.longContextEnabled,
            contextTokens: source.contextTokens,
            contextMaxTokens: source.contextMaxTokens,
            activeRequestId: source.activeRequestId,
            sessionId: source.sessionId,
            currentCwd: source.currentCwd,
            activeSession: source.activeSession,
            pendingSessionKey: source.pendingSessionKey,
            lastSessionLoadMetrics: source.lastSessionLoadMetrics,
            subagentRuns: source.subagentRuns,
            error: source.error,
            isStreaming: source.messages.some((message) => message.streaming),
            queuedMessages: source.queuedMessages,
        };
    }));
}
