import {describe, expect, it} from 'vitest';
import {
    clampComposerHeight,
    COMPOSER_DEFAULT_MAX_HEIGHT,
    COMPOSER_MAX_HEIGHT,
    COMPOSER_MIN_HEIGHT,
    CONVERSATION_PANE_MAX_WIDTH,
    CONVERSATION_PANE_MIN_WIDTH,
    getActivePermissionDialog,
    getChatComposerInputLabel,
    getChatComposerModeText,
    getChatComposerReasoningText,
    getChatComposerToolbarLabel,
    getChatNavigationControlLabel,
    getChatTopChromeActionLabel,
    getClampedRevealState,
    getCollapsedMessageWindow,
    getComposerHeightFromDrag,
    getDiffPaneReopenLabel,
    getEffectiveRevealedCount,
    getManualRevealWindow,
    getNextRevealState,
    getNextTabAfterClose,
    getPaneResizeHandleLabel,
    getPaneWidthsAfterResize,
    shouldRoutePermissionToSideChat,
    getRevealStateAfterServerExpansion,
    getScrollTopAfterPrepend,
    getSdkMissingBannerText,
    highlightTranscriptToolAnchor,
    queueDiffPaneFocusAfterOpen,
    shouldAutoRevealEarlierMessages,
    shouldBuildCompleteChatStatusSummary,
    shouldIgnoreChatSessionSelection,
    shouldLoadEarlierServerHistory,
    shouldRequestFullHistoryForSearch,
    shouldShowDiffPaneReopenControl,
    TOOL_ANCHOR_JUMP_HIGHLIGHT_CLASS,
} from './chatUiBehavior';

describe('chat UI behavior', () => {
    it('clamps composer resize height inside the supported range', () => {
        expect(clampComposerHeight(COMPOSER_MIN_HEIGHT - 20)).toBe(COMPOSER_MIN_HEIGHT);
        expect(clampComposerHeight(COMPOSER_DEFAULT_MAX_HEIGHT)).toBe(COMPOSER_DEFAULT_MAX_HEIGHT);
        expect(clampComposerHeight(COMPOSER_MAX_HEIGHT + 20)).toBe(COMPOSER_MAX_HEIGHT);
    });

    it('resizes the composer upward as the resize handle is dragged upward', () => {
        expect(getComposerHeightFromDrag(120, 300, 260)).toBe(160);
        expect(getComposerHeightFromDrag(120, 300, 360)).toBe(60);
        expect(getComposerHeightFromDrag(120, 300, 500)).toBe(COMPOSER_MIN_HEIGHT);
    });

    it('clamps pane resize deltas so neither side crosses its width limits', () => {
        expect(getPaneWidthsAfterResize(
            240,
            600,
            320,
            CONVERSATION_PANE_MIN_WIDTH,
            CONVERSATION_PANE_MAX_WIDTH,
            260,
            520,
        )).toEqual({
            leftWidth: 660,
            rightWidth: 260,
        });

        expect(getPaneWidthsAfterResize(
            -480,
            600,
            320,
            CONVERSATION_PANE_MIN_WIDTH,
            CONVERSATION_PANE_MAX_WIDTH,
            260,
            520,
        )).toEqual({
            leftWidth: 400,
            rightWidth: 520,
        });
    });

    it('computes collapsed history paging for normal transcript browsing', () => {
        expect(getCollapsedMessageWindow({
            filteredCount: 96,
            revealedCount: 15,
            isSearching: false,
        })).toEqual({
            totalEarlierMessages: 81,
            collapsedCount: 66,
            nextRevealCount: 30,
            visibleStartIndex: 66,
        });
    });

    it('resets revealed history when switching to a different transcript', () => {
        const previousState = {
            transcriptKey: 'session-a-first-message',
            revealedCount: 90,
        };

        expect(getEffectiveRevealedCount(previousState, 'session-b-first-message')).toBe(0);
        expect(getClampedRevealState(previousState, 'session-b-first-message', 35)).toEqual({
            transcriptKey: 'session-b-first-message',
            revealedCount: 0,
        });
    });

    it('keeps paged reveal state inside the same transcript', () => {
        const state = {
            transcriptKey: 'session-a-first-message',
            revealedCount: 30,
        };

        expect(getNextRevealState(state, 'session-a-first-message', 95)).toEqual({
            transcriptKey: 'session-a-first-message',
            revealedCount: 60,
        });
        expect(getClampedRevealState(state, 'session-a-first-message', 20)).toEqual({
            transcriptKey: 'session-a-first-message',
            revealedCount: 20,
        });
    });

    it('keeps manual reveal totals stable when the remaining hidden count is below one page', () => {
        expect(getManualRevealWindow({
            remainingHiddenCount: 16,
            revealedCount: 30,
        })).toEqual({
            totalEarlierMessages: 46,
            collapsedCount: 16,
            nextRevealCount: 16,
        });
    });

    it('advances through a full reveal page and a remaining partial page', () => {
        const initialState = {
            transcriptKey: 'session-a-first-message',
            revealedCount: 0,
        };
        const firstPage = getNextRevealState(initialState, 'session-a-first-message', 46);
        const finalPage = getNextRevealState(firstPage, 'session-a-first-message', 46);

        expect(firstPage).toEqual({
            transcriptKey: 'session-a-first-message',
            revealedCount: 30,
        });
        expect(finalPage).toEqual({
            transcriptKey: 'session-a-first-message',
            revealedCount: 46,
        });
        expect(getManualRevealWindow({
            remainingHiddenCount: 0,
            revealedCount: finalPage.revealedCount,
        })).toEqual({
            totalEarlierMessages: 46,
            collapsedCount: 0,
            nextRevealCount: 0,
        });
    });

    it('only auto-reveals earlier messages when the top threshold is stable and revealable', () => {
        expect(shouldAutoRevealEarlierMessages({
            scrollTop: 0,
            collapsedCount: 16,
            isSearching: false,
            revealPending: false,
        })).toBe(true);
        expect(shouldAutoRevealEarlierMessages({
            scrollTop: 48,
            collapsedCount: 16,
            isSearching: false,
            revealPending: false,
        })).toBe(true);
        expect(shouldAutoRevealEarlierMessages({
            scrollTop: 49,
            collapsedCount: 16,
            isSearching: false,
            revealPending: false,
        })).toBe(false);
        expect(shouldAutoRevealEarlierMessages({
            scrollTop: 0,
            collapsedCount: 0,
            isSearching: false,
            revealPending: false,
        })).toBe(false);
        expect(shouldAutoRevealEarlierMessages({
            scrollTop: 0,
            collapsedCount: 16,
            isSearching: false,
            revealPending: true,
        })).toBe(false);
        expect(shouldAutoRevealEarlierMessages({
            scrollTop: 0,
            collapsedCount: 16,
            isSearching: true,
            revealPending: false,
        })).toBe(false);
    });

    it('bridges scroll-to-top to a full-history load only when the in-window history is exhausted', () => {
        // 内存窗口仍有折叠消息时，先本地展开，不触发服务端加载。
        expect(shouldLoadEarlierServerHistory({
            scrollTop: 0,
            collapsedCount: 12,
            isSearching: false,
            hasEarlierServerHistory: true,
            isLoadingEarlierServerHistory: false,
        })).toBe(false);
        // 折叠消息已展开完且磁盘上还有更早历史，滚动到顶部触发加载。
        expect(shouldLoadEarlierServerHistory({
            scrollTop: 0,
            collapsedCount: 0,
            isSearching: false,
            hasEarlierServerHistory: true,
            isLoadingEarlierServerHistory: false,
        })).toBe(true);
        expect(shouldLoadEarlierServerHistory({
            scrollTop: 48,
            collapsedCount: 0,
            isSearching: false,
            hasEarlierServerHistory: true,
            isLoadingEarlierServerHistory: false,
        })).toBe(true);
        // 超过阈值不触发。
        expect(shouldLoadEarlierServerHistory({
            scrollTop: 49,
            collapsedCount: 0,
            isSearching: false,
            hasEarlierServerHistory: true,
            isLoadingEarlierServerHistory: false,
        })).toBe(false);
        // 没有更早历史 / 正在加载 / 搜索中都不触发。
        expect(shouldLoadEarlierServerHistory({
            scrollTop: 0,
            collapsedCount: 0,
            isSearching: false,
            hasEarlierServerHistory: false,
            isLoadingEarlierServerHistory: false,
        })).toBe(false);
        expect(shouldLoadEarlierServerHistory({
            scrollTop: 0,
            collapsedCount: 0,
            isSearching: false,
            hasEarlierServerHistory: true,
            isLoadingEarlierServerHistory: true,
        })).toBe(false);
        expect(shouldLoadEarlierServerHistory({
            scrollTop: 0,
            collapsedCount: 0,
            isSearching: true,
            hasEarlierServerHistory: true,
            isLoadingEarlierServerHistory: false,
        })).toBe(false);
    });

    it('disables history collapsing while searching so all matches stay visible', () => {
        expect(getCollapsedMessageWindow({
            filteredCount: 96,
            revealedCount: 0,
            isSearching: true,
        })).toEqual({
            totalEarlierMessages: 81,
            collapsedCount: 0,
            nextRevealCount: 0,
            visibleStartIndex: 0,
        });
    });

    it('preserves the visible scroll position after prepending earlier messages', () => {
        expect(getScrollTopAfterPrepend({
            previousScrollTop: 20,
            previousScrollHeight: 1000,
            nextScrollHeight: 1600,
        })).toBe(620);
    });

    it('migrates reveal state when the server prepends the full transcript', () => {
        // 之前窗口可见 45 条（15 默认窗口 + 30 已揭示），服务端补全完整历史后第一条 id 改变、
        // 最后一条 id 不变、长度从 120 增长到 5000。迁移后应保留 45 条可见并多揭示一页（30）。
        const result = getRevealStateAfterServerExpansion({
            prevLastMessageId: 'history-...-4999',
            prevTranscriptKey: 'history-...-4880',
            prevMessagesLength: 120,
            prevVisibleRenderableCount: 45,
            nextLastMessageId: 'history-...-4999',
            nextTranscriptKey: 'history-...-0',
            nextMessagesLength: 5000,
        });

        expect(result.isServerExpansion).toBe(true);
        // 45 之前可见 + 30 一页 - 15 默认窗口 = 60 揭示数（请求窗口 = 15 + 60 = 75 ≥ 之前 45 + 30）。
        expect(result.revealState).toEqual({
            transcriptKey: 'history-...-0',
            revealedCount: 60,
        });
    });

    it('treats a session switch as a reset rather than a server expansion', () => {
        const result = getRevealStateAfterServerExpansion({
            prevLastMessageId: 'session-a-last',
            prevTranscriptKey: 'session-a-first',
            prevMessagesLength: 120,
            prevVisibleRenderableCount: 45,
            nextLastMessageId: 'session-b-last',
            nextTranscriptKey: 'session-b-first',
            nextMessagesLength: 5000,
        });

        expect(result.isServerExpansion).toBe(false);
        expect(result.revealState).toBeNull();
    });

    it('does not treat first mount or pure appends as a server expansion', () => {
        // 首次挂载：没有上一帧快照。
        expect(getRevealStateAfterServerExpansion({
            prevLastMessageId: null,
            prevTranscriptKey: null,
            prevMessagesLength: 0,
            prevVisibleRenderableCount: 0,
            nextLastMessageId: 'history-...-119',
            nextTranscriptKey: 'history-...-0',
            nextMessagesLength: 120,
        })).toEqual({isServerExpansion: false, revealState: null});

        // 纯追加新消息：第一条 id 不变（不是前置扩展），最后一条 id 改变。
        expect(getRevealStateAfterServerExpansion({
            prevLastMessageId: 'history-...-118',
            prevTranscriptKey: 'history-...-0',
            prevMessagesLength: 119,
            prevVisibleRenderableCount: 45,
            nextLastMessageId: 'history-...-119',
            nextTranscriptKey: 'history-...-0',
            nextMessagesLength: 120,
        })).toEqual({isServerExpansion: false, revealState: null});
    });

    it('marks a transcript tool anchor briefly after jumping to it', () => {
        const classes = new Set<string>();
        const dataset: Record<string, string> = {};
        let timeoutHandler: (() => void) | null = null;
        let clearedTimeout: unknown = null;
        let previousCleanupCount = 0;
        const anchor = {
            classList: {
                add: (className: string) => classes.add(className),
                remove: (className: string) => classes.delete(className),
            },
            dataset,
        } as unknown as HTMLElement;

        const cleanup = highlightTranscriptToolAnchor(anchor, {
            durationMs: 650,
            previousCleanup: () => {
                previousCleanupCount += 1;
            },
            setTimeoutFn: (handler, timeout) => {
                expect(timeout).toBe(650);
                timeoutHandler = handler;
                return 'highlight-timeout';
            },
            clearTimeoutFn: (handle) => {
                clearedTimeout = handle;
            },
        });

        expect(previousCleanupCount).toBe(1);
        expect(classes.has(TOOL_ANCHOR_JUMP_HIGHLIGHT_CLASS)).toBe(true);
        expect(dataset.chatToolJumpHighlighted).toBe('true');

        cleanup();
        expect(clearedTimeout).toBe('highlight-timeout');
        expect(classes.has(TOOL_ANCHOR_JUMP_HIGHLIGHT_CLASS)).toBe(false);
        expect(dataset.chatToolJumpHighlighted).toBeUndefined();

        expect(timeoutHandler).toBeTypeOf('function');
        const runTimeout = timeoutHandler as unknown as () => void;
        runTimeout();
        expect(classes.has(TOOL_ANCHOR_JUMP_HIGHLIGHT_CLASS)).toBe(false);
    });

    it('skips complete status summary work for windowed large-history browsing', () => {
        expect(shouldBuildCompleteChatStatusSummary({
            messageCount: 120,
            isSearching: false,
            sessionLoadStatus: 'windowed',
        })).toBe(false);

        expect(shouldBuildCompleteChatStatusSummary({
            messageCount: 120,
            isSearching: false,
            sessionLoadStatus: 'complete',
        })).toBe(true);

        expect(shouldBuildCompleteChatStatusSummary({
            messageCount: 120,
            isSearching: false,
            sessionLoadStatus: null,
        })).toBe(true);

        expect(shouldBuildCompleteChatStatusSummary({
            messageCount: 120,
            isSearching: true,
            sessionLoadStatus: 'complete',
        })).toBe(false);

        expect(shouldBuildCompleteChatStatusSummary({
            messageCount: 0,
            isSearching: false,
            sessionLoadStatus: 'complete',
        })).toBe(false);
    });

    it('requests full history only for active windowed-session search intent', () => {
        expect(shouldRequestFullHistoryForSearch({
            isSearching: true,
            activeSessionKey: 'codex::session',
            sessionLoadStatus: 'windowed',
            fullHistorySearchSessionKey: null,
            fullHistorySearchStatus: null,
        })).toBe(true);

        expect(shouldRequestFullHistoryForSearch({
            isSearching: false,
            activeSessionKey: 'codex::session',
            sessionLoadStatus: 'windowed',
            fullHistorySearchSessionKey: null,
            fullHistorySearchStatus: null,
        })).toBe(false);

        expect(shouldRequestFullHistoryForSearch({
            isSearching: true,
            activeSessionKey: null,
            sessionLoadStatus: 'windowed',
            fullHistorySearchSessionKey: null,
            fullHistorySearchStatus: null,
        })).toBe(false);

        expect(shouldRequestFullHistoryForSearch({
            isSearching: true,
            activeSessionKey: 'codex::session',
            sessionLoadStatus: 'complete',
            fullHistorySearchSessionKey: null,
            fullHistorySearchStatus: null,
        })).toBe(false);

        expect(shouldRequestFullHistoryForSearch({
            isSearching: true,
            activeSessionKey: 'codex::session',
            sessionLoadStatus: 'windowed',
            fullHistorySearchSessionKey: 'codex::session',
            fullHistorySearchStatus: 'loading',
        })).toBe(false);

        expect(shouldRequestFullHistoryForSearch({
            isSearching: true,
            activeSessionKey: 'codex::session',
            sessionLoadStatus: 'windowed',
            fullHistorySearchSessionKey: 'codex::session',
            fullHistorySearchStatus: 'complete',
        })).toBe(false);

        expect(shouldRequestFullHistoryForSearch({
            isSearching: true,
            activeSessionKey: 'codex::session',
            sessionLoadStatus: 'windowed',
            fullHistorySearchSessionKey: 'codex::session',
            fullHistorySearchStatus: 'error',
        })).toBe(true);
    });

    it('shows the global diff reopen affordance only when a collapsed diff can be restored', () => {
        expect(shouldShowDiffPaneReopenControl({
            diffPaneCollapsed: true,
            hasSelectedEdit: true,
        })).toBe(true);

        expect(shouldShowDiffPaneReopenControl({
            diffPaneCollapsed: false,
            hasSelectedEdit: true,
        })).toBe(false);

        expect(shouldShowDiffPaneReopenControl({
            diffPaneCollapsed: true,
            hasSelectedEdit: false,
        })).toBe(false);
    });

    it('keeps the global diff reopen label readable when translations return keys', () => {
        const keyOnlyTranslate = (key: string) => key;

        expect(getDiffPaneReopenLabel({
            displayPath: 'src/components/chat/ChatDiffReviewPane.tsx',
            translate: keyOnlyTranslate,
        })).toBe('Open file diff: src/components/chat/ChatDiffReviewPane.tsx');

        expect(getDiffPaneReopenLabel({
            displayPath: null,
            translate: keyOnlyTranslate,
        })).toBe('Open file diff panel');
    });

    it('keeps pane resize handle labels readable when translations return keys', () => {
        const keyOnlyTranslate = (key: string) => key;

        expect(getPaneResizeHandleLabel({
            edge: 'conversation-diff',
            translate: keyOnlyTranslate,
        })).toBe('Resize conversation and diff panes');

        expect(getPaneResizeHandleLabel({
            edge: 'diff-status',
            translate: keyOnlyTranslate,
        })).toBe('Resize diff and right panes');

        expect(getPaneResizeHandleLabel({
            edge: 'conversation-status',
            translate: keyOnlyTranslate,
        })).toBe('Resize conversation and right panes');
    });

    it('keeps chat top chrome action labels readable when translations return keys', () => {
        const keyOnlyTranslate = (key: string) => key;

        expect(getChatTopChromeActionLabel({
            action: 'sdk-manage',
            translate: keyOnlyTranslate,
        })).toBe('Manage SDKs');

        expect(getChatTopChromeActionLabel({
            action: 'clear-chat',
            translate: keyOnlyTranslate,
        })).toBe('Clear chat');

        expect(getChatTopChromeActionLabel({
            action: 'sdk-install',
            translate: keyOnlyTranslate,
        })).toBe('Install SDK');

        expect(getSdkMissingBannerText({
            sdkName: 'Claude SDK',
            translate: (key) => key,
        })).toBe('Claude SDK is not installed yet. Install it to start chatting.');
    });

    it('activates the most recently used tab after closing the current tab', () => {
        const tabs = [
            {key: 'session:old', updatedAt: 100},
            {key: 'session:recent', updatedAt: 300},
            {key: 'draft:newer', updatedAt: 200},
            {key: 'draft:active', updatedAt: 250},
        ];

        expect(getNextTabAfterClose({
            tabs,
            closingKey: 'draft:active',
            activeKey: 'draft:active',
        })).toBe('session:recent');

        expect(getNextTabAfterClose({
            tabs,
            closingKey: 'session:old',
            activeKey: 'draft:active',
        })).toBe('draft:active');

        expect(getNextTabAfterClose({
            tabs: [{key: 'only', updatedAt: 1}],
            closingKey: 'only',
            activeKey: 'only',
        })).toBeNull();
    });

    it('keeps chat navigation control labels readable when translations return keys', () => {
        const keyOnlyTranslate = (key: string) => key;

        expect(getChatNavigationControlLabel({
            control: 'search-placeholder',
            translate: keyOnlyTranslate,
        })).toBe('Search this conversation');

        expect(getChatNavigationControlLabel({
            control: 'clear-search',
            translate: keyOnlyTranslate,
        })).toBe('Clear search');

        expect(getChatNavigationControlLabel({
            control: 'anchor-rail',
            translate: keyOnlyTranslate,
        })).toBe('Message timeline');

        expect(getChatNavigationControlLabel({
            control: 'current-anchor',
            translate: keyOnlyTranslate,
        })).toBe('Current message');

        expect(getChatNavigationControlLabel({
            control: 'scroll-to-top',
            translate: keyOnlyTranslate,
        })).toBe('Scroll to top');

        expect(getChatNavigationControlLabel({
            control: 'scroll-to-bottom',
            translate: keyOnlyTranslate,
        })).toBe('Scroll to bottom');

        expect(getChatNavigationControlLabel({
            control: 'jump-to-message',
            index: 3,
            translate: (_key, options) => String(options?.index),
        })).toBe('3');

        expect(getChatNavigationControlLabel({
            control: 'jump-to-message',
            index: 3,
            translate: (key) => key,
        })).toBe('Jump to message 3');
    });

    it('keeps chat composer toolbar labels readable when translations return keys', () => {
        const keyOnlyTranslate = (key: string) => key;

        expect(getChatComposerToolbarLabel({
            control: 'provider',
            translate: keyOnlyTranslate,
        })).toBe('AI provider');

        expect(getChatComposerToolbarLabel({
            control: 'mode',
            translate: keyOnlyTranslate,
        })).toBe('Permission mode');

        expect(getChatComposerToolbarLabel({
            control: 'model',
            translate: keyOnlyTranslate,
        })).toBe('Model');

        expect(getChatComposerToolbarLabel({
            control: 'reasoning',
            translate: keyOnlyTranslate,
        })).toBe('Reasoning effort');

        expect(getChatComposerToolbarLabel({
            control: 'models-refresh',
            translate: keyOnlyTranslate,
        })).toBe('Refresh models');

        expect(getChatComposerToolbarLabel({
            control: 'models-refreshing',
            translate: keyOnlyTranslate,
        })).toBe('Refreshing models...');

        expect(getChatComposerToolbarLabel({
            control: 'models-loading',
            translate: keyOnlyTranslate,
        })).toBe('Loading models...');

        expect(getChatComposerToolbarLabel({
            control: 'enhance',
            translate: keyOnlyTranslate,
        })).toBe('Enhance prompt');

        expect(getChatComposerToolbarLabel({
            control: 'send',
            translate: keyOnlyTranslate,
        })).toBe('Send');

        expect(getChatComposerToolbarLabel({
            control: 'stop',
            translate: keyOnlyTranslate,
        })).toBe('Stop');
    });

    it('keeps chat composer mode and reasoning option text readable when translations return keys', () => {
        const keyOnlyTranslate = (key: string) => key;

        expect(getChatComposerModeText({
            mode: 'default',
            field: 'label',
            translate: keyOnlyTranslate,
        })).toBe('Default Mode');

        expect(getChatComposerModeText({
            mode: 'default',
            field: 'description',
            translate: keyOnlyTranslate,
        })).toBe('Requires manual confirmation for each operation');

        expect(getChatComposerModeText({
            mode: 'acceptEdits',
            field: 'label',
            translate: keyOnlyTranslate,
        })).toBe('Agent Mode');

        expect(getChatComposerModeText({
            mode: 'acceptEdits',
            field: 'description',
            translate: keyOnlyTranslate,
        })).toBe('Auto-accept file creation/editing, fewer confirmations');

        expect(getChatComposerModeText({
            mode: 'plan',
            field: 'label',
            translate: keyOnlyTranslate,
        })).toBe('Plan Mode');

        expect(getChatComposerModeText({
            mode: 'plan',
            field: 'description',
            translate: keyOnlyTranslate,
        })).toBe('Read-only tools only, generates plan for user approval');

        expect(getChatComposerModeText({
            mode: 'bypassPermissions',
            field: 'label',
            translate: keyOnlyTranslate,
        })).toBe('Auto Mode');

        expect(getChatComposerModeText({
            mode: 'bypassPermissions',
            field: 'description',
            translate: keyOnlyTranslate,
        })).toBe('Fully automated, bypasses all permission checks');

        expect(getChatComposerReasoningText({
            effort: 'high',
            field: 'label',
            translate: keyOnlyTranslate,
        })).toBe('High');

        expect(getChatComposerReasoningText({
            effort: 'high',
            field: 'description',
            translate: keyOnlyTranslate,
        })).toBe('Deep reasoning for complex tasks');

        expect(getChatComposerReasoningText({
            effort: 'xhigh',
            field: 'label',
            translate: keyOnlyTranslate,
        })).toBe('XHigh');

        expect(getChatComposerReasoningText({
            effort: 'max',
            field: 'description',
            translate: keyOnlyTranslate,
        })).toBe('Maximum reasoning depth');
    });

    it('keeps chat composer input surface labels readable when translations return keys', () => {
        const keyOnlyTranslate = (key: string) => key;

        expect(getChatComposerInputLabel({
            control: 'attach',
            translate: keyOnlyTranslate,
        })).toBe('Add attachment');

        expect(getChatComposerInputLabel({
            control: 'remove-attachment',
            translate: keyOnlyTranslate,
        })).toBe('Remove attachment');

        expect(getChatComposerInputLabel({
            control: 'collapse-panel',
            translate: keyOnlyTranslate,
        })).toBe('Collapse status panel');

        expect(getChatComposerInputLabel({
            control: 'expand-panel',
            translate: keyOnlyTranslate,
        })).toBe('Expand status panel');

        expect(getChatComposerInputLabel({
            control: 'resize-composer',
            translate: keyOnlyTranslate,
        })).toBe('Drag to resize the input');

        expect(getChatComposerInputLabel({
            control: 'placeholder',
            translate: keyOnlyTranslate,
        })).toBe('Type a message... @ to reference files, # for subagents, ! for presets. Enter to send, Shift+Enter for newline');

        expect(getChatComposerInputLabel({
            control: 'completion-empty',
            translate: keyOnlyTranslate,
        })).toBe('No matches');

        expect(getChatComposerInputLabel({
            control: 'completion-menu',
            translate: keyOnlyTranslate,
        })).toBe('Completion suggestions');

        expect(getChatComposerInputLabel({
            control: 'completion-loading',
            translate: keyOnlyTranslate,
        })).toBe('Loading suggestions...');

        expect(getChatComposerInputLabel({
            control: 'drop-file',
            translate: keyOnlyTranslate,
        })).toBe('Drop to attach image');

        expect(getChatComposerInputLabel({
            control: 'history-hint',
            translate: keyOnlyTranslate,
        })).toBe('Press Up to restore the previous input, Down to return to an empty draft');
    });

    it('queues diff pane focus only when the desktop pane is visible', () => {
        const calls: FocusOptions[] = [];
        const target = {
            focus: (options?: FocusOptions) => {
                calls.push(options ?? {});
            },
        };
        const queuedCallbacks: Array<() => void> = [];

        expect(queueDiffPaneFocusAfterOpen(() => target, {
            matchMedia: () => ({matches: true}),
            requestAnimationFrame: (callback) => {
                queuedCallbacks.push(callback);
                return 1;
            },
        })).toBe(true);
        expect(calls).toEqual([]);

        queuedCallbacks[0]();
        expect(calls).toEqual([{preventScroll: true}]);

        expect(queueDiffPaneFocusAfterOpen(() => target, {
            matchMedia: () => ({matches: false}),
            requestAnimationFrame: (callback) => {
                queuedCallbacks.push(callback);
                return 2;
            },
        })).toBe(false);

        expect(queueDiffPaneFocusAfterOpen(() => null, {
            matchMedia: () => ({matches: true}),
            requestAnimationFrame: (callback) => {
                queuedCallbacks.push(callback);
                return 3;
            },
        })).toBe(true);
        queuedCallbacks[1]();
        expect(calls).toEqual([{preventScroll: true}]);
    });

    it('selects a single active permission dialog when multiple blocking requests are pending', () => {
        expect(getActivePermissionDialog({
            askUserQuestionTimestamp: null,
            planApprovalTimestamp: null,
            toolPermissionTimestamp: null,
        })).toBeNull();

        expect(getActivePermissionDialog({
            askUserQuestionTimestamp: '2026-06-19T09:00:00.000Z',
            planApprovalTimestamp: null,
            toolPermissionTimestamp: null,
        })).toBe('ask-user-question');

        expect(getActivePermissionDialog({
            askUserQuestionTimestamp: '2026-06-19T09:00:00.000Z',
            planApprovalTimestamp: '2026-06-19T09:00:05.000Z',
            toolPermissionTimestamp: '2026-06-19T09:00:03.000Z',
        })).toBe('plan-approval');

        expect(getActivePermissionDialog({
            askUserQuestionTimestamp: '2026-06-19T09:00:00.000Z',
            planApprovalTimestamp: '2026-06-19T09:00:00.000Z',
            toolPermissionTimestamp: '2026-06-19T09:00:00.000Z',
        })).toBe('tool-permission');
    });

    it('keeps pending permission dialogs visible even when their timestamp is empty', () => {
        expect(getActivePermissionDialog({
            hasAskUserQuestion: true,
            askUserQuestionTimestamp: '',
            hasPlanApproval: false,
            planApprovalTimestamp: null,
            hasToolPermission: false,
            toolPermissionTimestamp: null,
        })).toBe('ask-user-question');

        expect(getActivePermissionDialog({
            hasAskUserQuestion: false,
            askUserQuestionTimestamp: null,
            hasPlanApproval: true,
            planApprovalTimestamp: '',
            hasToolPermission: true,
            toolPermissionTimestamp: '',
        })).toBe('tool-permission');
    });

    it('allows reselecting the active history session while another session is pending', () => {
        expect(shouldIgnoreChatSessionSelection({
            sessionKey: 'codex::C:/sessions/active.jsonl',
            activeSessionKey: 'codex::C:/sessions/active.jsonl',
            pendingSessionKey: null,
        })).toBe(true);

        expect(shouldIgnoreChatSessionSelection({
            sessionKey: 'codex::C:/sessions/pending.jsonl',
            activeSessionKey: 'codex::C:/sessions/active.jsonl',
            pendingSessionKey: 'codex::C:/sessions/pending.jsonl',
        })).toBe(true);

        expect(shouldIgnoreChatSessionSelection({
            sessionKey: 'codex::C:/sessions/active.jsonl',
            activeSessionKey: 'codex::C:/sessions/active.jsonl',
            pendingSessionKey: 'codex::C:/sessions/pending.jsonl',
        })).toBe(false);
    });
});

describe('shouldRoutePermissionToSideChat', () => {
    it('routes only when both session ids are present and equal', () => {
        expect(shouldRoutePermissionToSideChat({
            requestSessionId: 'session-a',
            sideChatSessionId: 'session-a',
        })).toBe(true);
        expect(shouldRoutePermissionToSideChat({
            requestSessionId: ' session-a ',
            sideChatSessionId: 'session-a',
        })).toBe(true);
    });

    it('falls back to the center modal for missing or mismatched sessions', () => {
        expect(shouldRoutePermissionToSideChat({
            requestSessionId: 'session-a',
            sideChatSessionId: 'session-b',
        })).toBe(false);
        expect(shouldRoutePermissionToSideChat({
            requestSessionId: null,
            sideChatSessionId: 'session-a',
        })).toBe(false);
        expect(shouldRoutePermissionToSideChat({
            requestSessionId: 'session-a',
            sideChatSessionId: null,
        })).toBe(false);
        expect(shouldRoutePermissionToSideChat({
            requestSessionId: '  ',
            sideChatSessionId: '  ',
        })).toBe(false);
    });
});
