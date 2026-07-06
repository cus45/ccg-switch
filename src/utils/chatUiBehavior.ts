export const COMPOSER_MIN_HEIGHT = 44;
export const COMPOSER_DEFAULT_MAX_HEIGHT = 120;
export const COMPOSER_MAX_HEIGHT = 320;
export const VISIBLE_MESSAGE_WINDOW = 15;
export const REVEAL_PAGE_SIZE = 30;
export const AUTO_REVEAL_SCROLL_THRESHOLD = 48;
export const CONVERSATION_PANE_MIN_WIDTH = 380;
export const CONVERSATION_PANE_MAX_WIDTH = 960;
export const DIFF_PANE_MIN_WIDTH = 360;
export const DIFF_PANE_MAX_WIDTH = 920;
export const STATUS_PANE_MIN_WIDTH = 260;
export const STATUS_PANE_MAX_WIDTH = 520;

export interface TranscriptRevealState {
    transcriptKey: string;
    revealedCount: number;
}

interface ChatSessionSelectionInput {
    sessionKey: string;
    activeSessionKey: string | null;
    pendingSessionKey: string | null;
}

interface ChatTabCandidate {
    key: string;
    updatedAt: number;
}

interface NextTabAfterCloseInput {
    tabs: ChatTabCandidate[];
    closingKey: string;
    activeKey: string | null;
}

interface CompleteChatStatusSummaryInput {
    messageCount: number;
    isSearching: boolean;
    sessionLoadStatus?: 'loading' | 'windowed' | 'complete' | 'error' | null;
}

interface FullHistorySearchIntentInput {
    isSearching: boolean;
    activeSessionKey: string | null;
    sessionLoadStatus?: 'loading' | 'windowed' | 'complete' | 'error' | null;
    fullHistorySearchSessionKey?: string | null;
    fullHistorySearchStatus?: 'loading' | 'complete' | 'error' | null;
}

export function shouldIgnoreChatSessionSelection({
    sessionKey,
    activeSessionKey,
    pendingSessionKey,
}: ChatSessionSelectionInput): boolean {
    return sessionKey === pendingSessionKey || (!pendingSessionKey && sessionKey === activeSessionKey);
}

export function getNextTabAfterClose({
    tabs,
    closingKey,
    activeKey,
}: NextTabAfterCloseInput): string | null {
    if (activeKey && activeKey !== closingKey && tabs.some((tab) => tab.key === activeKey)) {
        return activeKey;
    }

    const remainingTabs = tabs
        .filter((tab) => tab.key !== closingKey)
        .sort((left, right) => right.updatedAt - left.updatedAt);

    return remainingTabs[0]?.key ?? null;
}

export function shouldBuildCompleteChatStatusSummary({
    messageCount,
    isSearching,
    sessionLoadStatus,
}: CompleteChatStatusSummaryInput): boolean {
    return messageCount > 0 && !isSearching && sessionLoadStatus !== 'windowed';
}

export function shouldRequestFullHistoryForSearch({
    isSearching,
    activeSessionKey,
    sessionLoadStatus,
    fullHistorySearchSessionKey,
    fullHistorySearchStatus,
}: FullHistorySearchIntentInput): boolean {
    if (!isSearching || !activeSessionKey || sessionLoadStatus !== 'windowed') return false;
    if (fullHistorySearchSessionKey !== activeSessionKey) return true;
    return fullHistorySearchStatus !== 'loading' && fullHistorySearchStatus !== 'complete';
}

export function clampComposerHeight(
    height: number,
    minHeight = COMPOSER_MIN_HEIGHT,
    maxHeight = COMPOSER_MAX_HEIGHT,
): number {
    return Math.min(maxHeight, Math.max(minHeight, Math.round(height)));
}

export function getComposerHeightFromDrag(
    startHeight: number,
    startClientY: number,
    currentClientY: number,
): number {
    return clampComposerHeight(startHeight + startClientY - currentClientY);
}

export function clampPaneSize(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function clampPaneResizeDelta(
    delta: number,
    leftStart: number,
    rightStart: number,
    leftMin: number,
    leftMax: number,
    rightMin: number,
    rightMax: number,
): number {
    const minDelta = Math.max(leftMin - leftStart, rightStart - rightMax);
    const maxDelta = Math.min(leftMax - leftStart, rightStart - rightMin);
    return clampPaneSize(delta, minDelta, maxDelta);
}

export interface PaneResizeResult {
    leftWidth: number;
    rightWidth: number;
}

export function getPaneWidthsAfterResize(
    delta: number,
    leftStart: number,
    rightStart: number,
    leftMin: number,
    leftMax: number,
    rightMin: number,
    rightMax: number,
): PaneResizeResult {
    const clampedDelta = clampPaneResizeDelta(
        delta,
        leftStart,
        rightStart,
        leftMin,
        leftMax,
        rightMin,
        rightMax,
    );

    return {
        leftWidth: Math.round(leftStart + clampedDelta),
        rightWidth: Math.round(rightStart - clampedDelta),
    };
}

interface DiffPaneReopenControlInput {
    diffPaneCollapsed: boolean;
    hasSelectedEdit: boolean;
}

interface DiffPaneReopenLabelInput {
    displayPath?: string | null;
    translate: (key: string, options?: Record<string, unknown>) => string;
}

export type PaneResizeHandleEdge = 'conversation-diff' | 'diff-status' | 'conversation-status';
export type ChatTopChromeAction = 'sdk-manage' | 'clear-chat' | 'sdk-install';
export type ChatNavigationControl =
    | 'search-placeholder'
    | 'clear-search'
    | 'anchor-rail'
    | 'current-anchor'
    | 'scroll-to-top'
    | 'scroll-to-bottom'
    | 'jump-to-message';
export type ChatComposerToolbarControl =
    | 'provider'
    | 'mode'
    | 'model'
    | 'reasoning'
    | 'long-context'
    | 'long-context-enabled'
    | 'long-context-disabled'
    | 'long-context-unavailable'
    | 'models-refresh'
    | 'models-refreshing'
    | 'models-loading'
    | 'enhance'
    | 'send'
    | 'stop';
export type ChatComposerInputControl =
    | 'attach'
    | 'remove-attachment'
    | 'collapse-panel'
    | 'expand-panel'
    | 'resize-composer'
    | 'placeholder'
    | 'completion-empty'
    | 'completion-menu'
    | 'completion-loading'
    | 'drop-file'
    | 'history-hint';
export type ChatComposerPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export type ChatComposerReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ChatComposerOptionTextField = 'label' | 'description';

interface PaneResizeHandleLabelInput {
    edge: PaneResizeHandleEdge;
    translate: (key: string) => string;
}

interface ChatTopChromeActionLabelInput {
    action: ChatTopChromeAction;
    translate: (key: string) => string;
}

interface ChatNavigationControlLabelInput {
    control: ChatNavigationControl;
    index?: number;
    translate: (key: string, options?: Record<string, unknown>) => string;
}

interface ChatComposerToolbarLabelInput {
    control: ChatComposerToolbarControl;
    translate: (key: string) => string;
}

interface ChatComposerInputLabelInput {
    control: ChatComposerInputControl;
    translate: (key: string) => string;
}

interface ChatComposerModeTextInput {
    mode: ChatComposerPermissionMode;
    field: ChatComposerOptionTextField;
    translate: (key: string) => string;
}

interface ChatComposerReasoningTextInput {
    effort: ChatComposerReasoningEffort;
    field: ChatComposerOptionTextField;
    translate: (key: string) => string;
}

interface SdkMissingBannerTextInput {
    sdkName?: string | null;
    translate: (key: string, options?: Record<string, unknown>) => string;
}

const PANE_RESIZE_HANDLE_LABELS: Record<PaneResizeHandleEdge, { key: string; fallback: string }> = {
    'conversation-diff': {
        key: 'chat.layout.resizeConversationDiff',
        fallback: 'Resize conversation and diff panes',
    },
    'diff-status': {
        key: 'chat.layout.resizeDiffStatus',
        fallback: 'Resize diff and right panes',
    },
    'conversation-status': {
        key: 'chat.layout.resizeConversationStatus',
        fallback: 'Resize conversation and right panes',
    },
};

const CHAT_TOP_CHROME_ACTION_LABELS: Record<ChatTopChromeAction, { key: string; fallback: string }> = {
    'sdk-manage': {
        key: 'chat.sdk.manage',
        fallback: 'Manage SDKs',
    },
    'clear-chat': {
        key: 'chat.clear',
        fallback: 'Clear chat',
    },
    'sdk-install': {
        key: 'chat.sdk.install',
        fallback: 'Install SDK',
    },
};

const CHAT_NAVIGATION_CONTROL_LABELS: Record<Exclude<ChatNavigationControl, 'jump-to-message'>, {
    key: string;
    fallback: string;
}> = {
    'search-placeholder': {
        key: 'chat.layout.searchPlaceholder',
        fallback: 'Search this conversation',
    },
    'clear-search': {
        key: 'chat.layout.clearSearch',
        fallback: 'Clear search',
    },
    'anchor-rail': {
        key: 'chat.layout.anchorRail',
        fallback: 'Message timeline',
    },
    'current-anchor': {
        key: 'chat.layout.currentAnchor',
        fallback: 'Current message',
    },
    'scroll-to-top': {
        key: 'chat.layout.scrollToTop',
        fallback: 'Scroll to top',
    },
    'scroll-to-bottom': {
        key: 'chat.layout.scrollToBottom',
        fallback: 'Scroll to bottom',
    },
};

const CHAT_COMPOSER_TOOLBAR_LABELS: Record<ChatComposerToolbarControl, { key: string; fallback: string }> = {
    provider: {
        key: 'chat.providerLabel',
        fallback: 'AI provider',
    },
    mode: {
        key: 'chat.modeLabel',
        fallback: 'Permission mode',
    },
    model: {
        key: 'chat.modelLabel',
        fallback: 'Model',
    },
    reasoning: {
        key: 'chat.reasoningLabel',
        fallback: 'Reasoning effort',
    },
    'long-context': {
        key: 'chat.longContext.label',
        fallback: '1M context',
    },
    'long-context-enabled': {
        key: 'chat.longContext.enabledTitle',
        fallback: 'Use 1M context window',
    },
    'long-context-disabled': {
        key: 'chat.longContext.disabledTitle',
        fallback: 'Use standard 200K context window',
    },
    'long-context-unavailable': {
        key: 'chat.longContext.unavailableTitle',
        fallback: '1M context is not available for this model',
    },
    'models-refresh': {
        key: 'chat.modelsRefresh',
        fallback: 'Refresh models',
    },
    'models-refreshing': {
        key: 'chat.modelsRefreshing',
        fallback: 'Refreshing models...',
    },
    'models-loading': {
        key: 'chat.modelsLoading',
        fallback: 'Loading models...',
    },
    enhance: {
        key: 'chat.enhancePrompt',
        fallback: 'Enhance prompt',
    },
    send: {
        key: 'chat.send',
        fallback: 'Send',
    },
    stop: {
        key: 'chat.stop',
        fallback: 'Stop',
    },
};

const CHAT_COMPOSER_INPUT_LABELS: Record<ChatComposerInputControl, { key: string; fallback: string }> = {
    attach: {
        key: 'chat.attach',
        fallback: 'Add attachment',
    },
    'remove-attachment': {
        key: 'chat.removeAttachment',
        fallback: 'Remove attachment',
    },
    'collapse-panel': {
        key: 'chat.collapsePanel',
        fallback: 'Collapse status panel',
    },
    'expand-panel': {
        key: 'chat.expandPanel',
        fallback: 'Expand status panel',
    },
    'resize-composer': {
        key: 'chat.resizeComposer',
        fallback: 'Drag to resize the input',
    },
    placeholder: {
        key: 'chat.richPlaceholder',
        fallback: 'Type a message... @ to reference files, # for subagents, ! for presets. Enter to send, Shift+Enter for newline',
    },
    'completion-empty': {
        key: 'chat.completion.empty',
        fallback: 'No matches',
    },
    'completion-menu': {
        key: 'chat.completion.label',
        fallback: 'Completion suggestions',
    },
    'completion-loading': {
        key: 'chat.completion.loading',
        fallback: 'Loading suggestions...',
    },
    'drop-file': {
        key: 'chat.dropFileHint',
        fallback: 'Drop to attach image',
    },
    'history-hint': {
        key: 'chat.historyHint',
        fallback: 'Press Up to restore the previous input, Down to return to an empty draft',
    },
};

const CHAT_COMPOSER_MODE_TEXT: Record<ChatComposerPermissionMode, Record<ChatComposerOptionTextField, {
    key: string;
    fallback: string;
}>> = {
    default: {
        label: {
            key: 'chat.modes.default.label',
            fallback: 'Default Mode',
        },
        description: {
            key: 'chat.modes.default.description',
            fallback: 'Requires manual confirmation for each operation',
        },
    },
    acceptEdits: {
        label: {
            key: 'chat.modes.acceptEdits.label',
            fallback: 'Agent Mode',
        },
        description: {
            key: 'chat.modes.acceptEdits.description',
            fallback: 'Auto-accept file creation/editing, fewer confirmations',
        },
    },
    plan: {
        label: {
            key: 'chat.modes.plan.label',
            fallback: 'Plan Mode',
        },
        description: {
            key: 'chat.modes.plan.description',
            fallback: 'Read-only tools only, generates plan for user approval',
        },
    },
    bypassPermissions: {
        label: {
            key: 'chat.modes.bypassPermissions.label',
            fallback: 'Auto Mode',
        },
        description: {
            key: 'chat.modes.bypassPermissions.description',
            fallback: 'Fully automated, bypasses all permission checks',
        },
    },
};

const CHAT_COMPOSER_REASONING_TEXT: Record<ChatComposerReasoningEffort, Record<ChatComposerOptionTextField, {
    key: string;
    fallback: string;
}>> = {
    low: {
        label: {
            key: 'chat.reasoning.low.label',
            fallback: 'Low',
        },
        description: {
            key: 'chat.reasoning.low.description',
            fallback: 'Quick responses with basic reasoning',
        },
    },
    medium: {
        label: {
            key: 'chat.reasoning.medium.label',
            fallback: 'Medium',
        },
        description: {
            key: 'chat.reasoning.medium.description',
            fallback: 'Balanced thinking with moderate token savings',
        },
    },
    high: {
        label: {
            key: 'chat.reasoning.high.label',
            fallback: 'High',
        },
        description: {
            key: 'chat.reasoning.high.description',
            fallback: 'Deep reasoning for complex tasks',
        },
    },
    xhigh: {
        label: {
            key: 'chat.reasoning.xhigh.label',
            fallback: 'XHigh',
        },
        description: {
            key: 'chat.reasoning.xhigh.description',
            fallback: 'Extra deep reasoning for demanding tasks',
        },
    },
    max: {
        label: {
            key: 'chat.reasoning.max.label',
            fallback: 'Max',
        },
        description: {
            key: 'chat.reasoning.max.description',
            fallback: 'Maximum reasoning depth',
        },
    },
};

export function shouldShowDiffPaneReopenControl({
    diffPaneCollapsed,
    hasSelectedEdit,
}: DiffPaneReopenControlInput): boolean {
    return diffPaneCollapsed && hasSelectedEdit;
}

export function getDiffPaneReopenLabel({
    displayPath,
    translate,
}: DiffPaneReopenLabelInput): string {
    const trimmedPath = displayPath?.trim();
    const key = trimmedPath ? 'chat.layout.expandDiffPanelForFile' : 'chat.layout.expandDiffPanel';
    const fallback = trimmedPath ? `Open file diff: ${trimmedPath}` : 'Open file diff panel';
    const translated = translate(key, trimmedPath ? {file: trimmedPath} : undefined);

    return translated && translated !== key ? translated : fallback;
}

export function getPaneResizeHandleLabel({edge, translate}: PaneResizeHandleLabelInput): string {
    const label = PANE_RESIZE_HANDLE_LABELS[edge];
    const translated = translate(label.key);

    return translated && translated !== label.key ? translated : label.fallback;
}

export function getChatTopChromeActionLabel({
    action,
    translate,
}: ChatTopChromeActionLabelInput): string {
    const label = CHAT_TOP_CHROME_ACTION_LABELS[action];
    const translated = translate(label.key);

    return translated && translated !== label.key ? translated : label.fallback;
}

export function getChatNavigationControlLabel({
    control,
    index,
    translate,
}: ChatNavigationControlLabelInput): string {
    if (control === 'jump-to-message') {
        const key = 'chat.layout.jumpToMessage';
        const safeIndex = typeof index === 'number' && Number.isFinite(index) ? index : 0;
        const translated = translate(key, {index: safeIndex});

        return translated && translated !== key ? translated : `Jump to message ${safeIndex}`;
    }

    const label = CHAT_NAVIGATION_CONTROL_LABELS[control];
    const translated = translate(label.key);

    return translated && translated !== label.key ? translated : label.fallback;
}

export function getChatComposerToolbarLabel({
    control,
    translate,
}: ChatComposerToolbarLabelInput): string {
    const label = CHAT_COMPOSER_TOOLBAR_LABELS[control];
    const translated = translate(label.key);

    return translated && translated !== label.key ? translated : label.fallback;
}

export function getChatComposerInputLabel({
    control,
    translate,
}: ChatComposerInputLabelInput): string {
    const label = CHAT_COMPOSER_INPUT_LABELS[control];
    const translated = translate(label.key);

    return translated && translated !== label.key ? translated : label.fallback;
}

export function getChatComposerModeText({
    mode,
    field,
    translate,
}: ChatComposerModeTextInput): string {
    const label = CHAT_COMPOSER_MODE_TEXT[mode][field];
    const translated = translate(label.key);

    return translated && translated !== label.key ? translated : label.fallback;
}

export function getChatComposerReasoningText({
    effort,
    field,
    translate,
}: ChatComposerReasoningTextInput): string {
    const label = CHAT_COMPOSER_REASONING_TEXT[effort][field];
    const translated = translate(label.key);

    return translated && translated !== label.key ? translated : label.fallback;
}

export function getSdkMissingBannerText({
    sdkName,
    translate,
}: SdkMissingBannerTextInput): string {
    const key = 'chat.sdk.missingBanner';
    const displayName = sdkName?.trim() || 'SDK';
    const translated = translate(key, {name: displayName});

    return translated && translated !== key
        ? translated
        : `${displayName} is not installed yet. Install it to start chatting.`;
}

interface DiffPaneFocusTarget {
    focus: (options?: FocusOptions) => void;
}

interface QueueDiffPaneFocusOptions {
    matchMedia?: (query: string) => Pick<MediaQueryList, 'matches'>;
    requestAnimationFrame?: (callback: () => void) => unknown;
}

const DESKTOP_DIFF_PANE_MEDIA_QUERY = '(min-width: 1280px)';

export function queueDiffPaneFocusAfterOpen(
    getTarget: () => DiffPaneFocusTarget | null | undefined,
    {
        matchMedia = typeof window !== 'undefined' ? window.matchMedia?.bind(window) : undefined,
        requestAnimationFrame = typeof window !== 'undefined'
            ? window.requestAnimationFrame?.bind(window)
            : undefined,
    }: QueueDiffPaneFocusOptions = {},
): boolean {
    if (typeof matchMedia !== 'function' || !matchMedia(DESKTOP_DIFF_PANE_MEDIA_QUERY).matches) {
        return false;
    }
    if (typeof requestAnimationFrame !== 'function') return false;

    requestAnimationFrame(() => {
        getTarget()?.focus({preventScroll: true});
    });
    return true;
}

export type ActivePermissionDialog =
    | 'ask-user-question'
    | 'plan-approval'
    | 'tool-permission'
    | null;

interface ActivePermissionDialogInput {
    hasAskUserQuestion?: boolean;
    askUserQuestionTimestamp?: string | null;
    hasPlanApproval?: boolean;
    planApprovalTimestamp?: string | null;
    hasToolPermission?: boolean;
    toolPermissionTimestamp?: string | null;
}

const PERMISSION_DIALOG_PRIORITY: Record<Exclude<ActivePermissionDialog, null>, number> = {
    'ask-user-question': 0,
    'plan-approval': 1,
    'tool-permission': 2,
};

function parsePermissionTimestamp(timestamp: string | null | undefined): number {
    if (!timestamp) return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * 权限请求是否应路由到 dock 当前可见的侧聊面板就地弹出。
 *
 * 仅当请求的 sessionId 与可见侧聊 tab 的 sessionId 均非空且一致时成立；
 * 其余情况（无 sessionId 的新会话、后台侧聊、主聊天）一律回退中心弹窗，
 * 保证请求永远有处可答。
 */
export function shouldRoutePermissionToSideChat({
    requestSessionId,
    sideChatSessionId,
}: {
    requestSessionId?: string | null;
    sideChatSessionId?: string | null;
}): boolean {
    const request = requestSessionId?.trim();
    const sideChat = sideChatSessionId?.trim();
    return Boolean(request && sideChat && request === sideChat);
}

function isPermissionDialogCandidatePresent(
    hasCandidate: boolean | undefined,
    timestamp: string | null | undefined,
): boolean {
    return hasCandidate ?? (timestamp !== null && timestamp !== undefined);
}

export function getActivePermissionDialog({
    hasAskUserQuestion,
    askUserQuestionTimestamp,
    hasPlanApproval,
    planApprovalTimestamp,
    hasToolPermission,
    toolPermissionTimestamp,
}: ActivePermissionDialogInput): ActivePermissionDialog {
    const candidates: Array<{
        type: Exclude<ActivePermissionDialog, null>;
        timestamp: number;
        priority: number;
    }> = [];

    if (isPermissionDialogCandidatePresent(hasAskUserQuestion, askUserQuestionTimestamp)) {
        candidates.push({
            type: 'ask-user-question',
            timestamp: parsePermissionTimestamp(askUserQuestionTimestamp),
            priority: PERMISSION_DIALOG_PRIORITY['ask-user-question'],
        });
    }
    if (isPermissionDialogCandidatePresent(hasPlanApproval, planApprovalTimestamp)) {
        candidates.push({
            type: 'plan-approval',
            timestamp: parsePermissionTimestamp(planApprovalTimestamp),
            priority: PERMISSION_DIALOG_PRIORITY['plan-approval'],
        });
    }
    if (isPermissionDialogCandidatePresent(hasToolPermission, toolPermissionTimestamp)) {
        candidates.push({
            type: 'tool-permission',
            timestamp: parsePermissionTimestamp(toolPermissionTimestamp),
            priority: PERMISSION_DIALOG_PRIORITY['tool-permission'],
        });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
        if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
        return b.priority - a.priority;
    });

    return candidates[0].type;
}

interface CollapsedMessageWindowInput {
    filteredCount: number;
    revealedCount: number;
    isSearching: boolean;
}

interface CollapsedMessageWindowResult {
    totalEarlierMessages: number;
    collapsedCount: number;
    nextRevealCount: number;
    visibleStartIndex: number;
}

interface ManualRevealWindowInput {
    remainingHiddenCount: number;
    revealedCount: number;
    pageSize?: number;
}

interface AutoRevealEarlierMessagesInput {
    scrollTop: number;
    collapsedCount: number;
    isSearching: boolean;
    revealPending: boolean;
    threshold?: number;
}

export function getManualRevealWindow({
    remainingHiddenCount,
    revealedCount,
    pageSize = REVEAL_PAGE_SIZE,
}: ManualRevealWindowInput): Omit<CollapsedMessageWindowResult, 'visibleStartIndex'> {
    const safeRemainingHiddenCount = Math.max(0, Math.floor(remainingHiddenCount));
    const safeRevealedCount = Math.max(0, Math.floor(revealedCount));

    return {
        totalEarlierMessages: safeRemainingHiddenCount + safeRevealedCount,
        collapsedCount: safeRemainingHiddenCount,
        nextRevealCount: safeRemainingHiddenCount > 0
            ? Math.min(Math.max(0, Math.floor(pageSize)), safeRemainingHiddenCount)
            : 0,
    };
}

export function shouldAutoRevealEarlierMessages({
    scrollTop,
    collapsedCount,
    isSearching,
    revealPending,
    threshold = AUTO_REVEAL_SCROLL_THRESHOLD,
}: AutoRevealEarlierMessagesInput): boolean {
    if (isSearching || revealPending || collapsedCount <= 0) {
        return false;
    }

    return Math.max(0, Math.floor(scrollTop)) <= Math.max(0, Math.floor(threshold));
}

interface LoadEarlierServerHistoryInput {
    scrollTop: number;
    collapsedCount: number;
    isSearching: boolean;
    hasEarlierServerHistory: boolean;
    isLoadingEarlierServerHistory: boolean;
    threshold?: number;
}

/**
 * 当内存窗口里的折叠消息已全部展开（collapsedCount === 0），但磁盘上仍有更早的
 * 历史（hasEarlierServerHistory）时，滚动到顶部应触发一次完整历史加载，而不是停下。
 */
export function shouldLoadEarlierServerHistory({
    scrollTop,
    collapsedCount,
    isSearching,
    hasEarlierServerHistory,
    isLoadingEarlierServerHistory,
    threshold = AUTO_REVEAL_SCROLL_THRESHOLD,
}: LoadEarlierServerHistoryInput): boolean {
    if (isSearching || isLoadingEarlierServerHistory || !hasEarlierServerHistory) {
        return false;
    }
    if (collapsedCount > 0) {
        return false;
    }

    return Math.max(0, Math.floor(scrollTop)) <= Math.max(0, Math.floor(threshold));
}

export function getEffectiveRevealedCount(
    state: TranscriptRevealState,
    transcriptKey: string,
): number {
    return state.transcriptKey === transcriptKey ? state.revealedCount : 0;
}

interface ServerExpansionRevealInput {
    prevLastMessageId: string | null;
    prevTranscriptKey: string | null;
    prevMessagesLength: number;
    prevVisibleRenderableCount: number;
    nextLastMessageId: string | null;
    nextTranscriptKey: string;
    nextMessagesLength: number;
    pageSize?: number;
    visibleWindow?: number;
}

export interface ServerExpansionRevealResult {
    isServerExpansion: boolean;
    revealState: TranscriptRevealState | null;
}

/**
 * 检测「服务端补全历史」式的前置扩展：会话未切换（最后一条消息 id 不变），
 * 但消息数量增长且第一条消息 id 改变（更早的历史被前置插入）。
 *
 * 命中时返回迁移后的 reveal 状态：keyed 到新的 transcriptKey，并把之前可见的
 * 全部消息保留可见，再额外多揭示一页（REVEAL_PAGE_SIZE）较早的消息，使用户
 * 扩展后立刻能在原内容上方看到更早历史，而不是被甩回最近的窗口尾部。
 *
 * 未命中（首次挂载、会话切换、纯追加新消息）时返回 isServerExpansion = false，
 * 由调用方走原有的「重置到尾部」逻辑。
 */
export function getRevealStateAfterServerExpansion({
    prevLastMessageId,
    prevTranscriptKey,
    prevMessagesLength,
    prevVisibleRenderableCount,
    nextLastMessageId,
    nextTranscriptKey,
    nextMessagesLength,
    pageSize = REVEAL_PAGE_SIZE,
    visibleWindow = VISIBLE_MESSAGE_WINDOW,
}: ServerExpansionRevealInput): ServerExpansionRevealResult {
    const noExpansion: ServerExpansionRevealResult = {
        isServerExpansion: false,
        revealState: null,
    };

    if (prevMessagesLength <= 0 || !prevLastMessageId || !prevTranscriptKey) {
        return noExpansion;
    }
    // 会话切换：最后一条消息 id 改变（或缺失），不属于前置扩展。
    if (!nextLastMessageId || nextLastMessageId !== prevLastMessageId) {
        return noExpansion;
    }
    // 第一条消息未变 / 数量未增长，不是真正的前置扩展。
    if (nextTranscriptKey === prevTranscriptKey || nextMessagesLength <= prevMessagesLength) {
        return noExpansion;
    }

    const safePageSize = Math.max(0, Math.floor(pageSize));
    const safeWindow = Math.max(0, Math.floor(visibleWindow));
    const safePrevVisible = Math.max(0, Math.floor(prevVisibleRenderableCount));
    // 让扩展后的请求窗口 = 之前可见数量 + 一页，从而保留全部旧可见消息并多露出一页更早内容。
    const revealedCount = Math.max(0, safePrevVisible + safePageSize - safeWindow);

    return {
        isServerExpansion: true,
        revealState: {
            transcriptKey: nextTranscriptKey,
            revealedCount,
        },
    };
}

export function getClampedRevealState(
    state: TranscriptRevealState,
    transcriptKey: string,
    totalEarlierMessages: number,
): TranscriptRevealState {
    const revealedCount = Math.min(
        getEffectiveRevealedCount(state, transcriptKey),
        totalEarlierMessages,
    );

    if (state.transcriptKey === transcriptKey && state.revealedCount === revealedCount) {
        return state;
    }

    return {transcriptKey, revealedCount};
}

export function getNextRevealState(
    state: TranscriptRevealState,
    transcriptKey: string,
    totalEarlierMessages: number,
    pageSize = REVEAL_PAGE_SIZE,
): TranscriptRevealState {
    return {
        transcriptKey,
        revealedCount: Math.min(
            totalEarlierMessages,
            getEffectiveRevealedCount(state, transcriptKey) + pageSize,
        ),
    };
}

export function getCollapsedMessageWindow({
    filteredCount,
    revealedCount,
    isSearching,
}: CollapsedMessageWindowInput): CollapsedMessageWindowResult {
    const totalEarlierMessages = Math.max(0, filteredCount - VISIBLE_MESSAGE_WINDOW);
    const collapsedCount = isSearching
        ? 0
        : Math.max(0, totalEarlierMessages - Math.min(revealedCount, totalEarlierMessages));

    return {
        totalEarlierMessages,
        collapsedCount,
        nextRevealCount: collapsedCount > 0 ? Math.min(REVEAL_PAGE_SIZE, collapsedCount) : 0,
        visibleStartIndex: isSearching ? 0 : collapsedCount,
    };
}

interface ScrollPreserveInput {
    previousScrollTop: number;
    previousScrollHeight: number;
    nextScrollHeight: number;
}

export function getScrollTopAfterPrepend({
    previousScrollTop,
    previousScrollHeight,
    nextScrollHeight,
}: ScrollPreserveInput): number {
    return Math.max(0, previousScrollTop + nextScrollHeight - previousScrollHeight);
}

export const TOOL_ANCHOR_JUMP_HIGHLIGHT_CLASS = 'chat-tool-anchor-jump-highlight';
export const TOOL_ANCHOR_JUMP_HIGHLIGHT_DURATION_MS = 1400;

interface HighlightableToolAnchor {
    classList: Pick<DOMTokenList, 'add' | 'remove'>;
    dataset: DOMStringMap;
}

interface HighlightTranscriptToolAnchorOptions {
    durationMs?: number;
    previousCleanup?: (() => void) | null;
    setTimeoutFn?: (handler: () => void, timeout: number) => unknown;
    clearTimeoutFn?: (handle: unknown) => void;
}

export function highlightTranscriptToolAnchor(
    anchor: HighlightableToolAnchor,
    {
        durationMs = TOOL_ANCHOR_JUMP_HIGHLIGHT_DURATION_MS,
        previousCleanup,
        setTimeoutFn = (handler, timeout) => globalThis.setTimeout(handler, timeout),
        clearTimeoutFn = (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
    }: HighlightTranscriptToolAnchorOptions = {},
): () => void {
    previousCleanup?.();

    let cleaned = false;
    let timeoutHandle: unknown = null;
    const clearHighlight = () => {
        anchor.classList.remove(TOOL_ANCHOR_JUMP_HIGHLIGHT_CLASS);
        delete anchor.dataset.chatToolJumpHighlighted;
    };

    clearHighlight();
    anchor.classList.add(TOOL_ANCHOR_JUMP_HIGHLIGHT_CLASS);
    anchor.dataset.chatToolJumpHighlighted = 'true';

    timeoutHandle = setTimeoutFn(() => {
        if (cleaned) return;
        cleaned = true;
        clearHighlight();
    }, durationMs);

    return () => {
        if (cleaned) return;
        cleaned = true;
        if (timeoutHandle !== null) {
            clearTimeoutFn(timeoutHandle);
        }
        clearHighlight();
    };
}
