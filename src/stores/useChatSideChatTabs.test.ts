import {beforeEach, describe, expect, it, vi} from 'vitest';
import {isSideChatTab, selectCenterTabs, useChatStore} from './useChatStore';

vi.mock('@tauri-apps/api/core', () => ({invoke: vi.fn()}));
vi.mock('@tauri-apps/api/event', () => ({listen: vi.fn(async () => vi.fn())}));
vi.mock('../utils/desktopNotification', () => ({
    notifyChatTurnStopped: vi.fn(),
    prepareChatTurnStoppedNotificationPermission: vi.fn(),
}));

function reset() {
    useChatStore.setState({
        openTabs: [],
        activeTabKey: null,
        dockChatTabKey: null,
        messages: [],
        currentCwd: 'C:/workspace/main',
        initialized: false,
    });
}

/** 造一个中心 tab（走 focusTab 之外的最短路径：直接塞进 openTabs）。 */
function seedCenterTab(key: string) {
    const store = useChatStore.getState();
    const existing = store.openTabs;
    useChatStore.setState({
        openTabs: [
            ...existing,
            {
                key,
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
                currentCwd: 'C:/workspace/main',
                activeSession: null,
                pendingSessionKey: null,
                lastSessionLoadMetrics: null,
                handoffContextProvider: null,
                status: 'idle',
                error: null,
                subagentRuns: {},
                queuedMessages: [],
                createdAt: 1,
                updatedAt: 1,
            },
        ],
    });
}

describe('侧边聊天与中心会话标签的归属隔离', () => {
    beforeEach(reset);

    it('openSideChat 建出的 tab 标记为 side', () => {
        const key = useChatStore.getState().openSideChat();
        const tab = useChatStore.getState().openTabs.find((item) => item.key === key);

        expect(tab).toBeDefined();
        expect(isSideChatTab(tab!)).toBe(true);
    });

    // 回归：改造前每点一次侧边聊天，中心「会话标签」条也会多出一个「新对话」——
    // 同一次点击在 dock 和中心两处各加了一个标签。
    it('侧聊不出现在中心会话标签条里', () => {
        seedCenterTab('center-1');
        useChatStore.getState().openSideChat();
        useChatStore.getState().openSideChat();
        useChatStore.getState().openSideChat();

        const {openTabs} = useChatStore.getState();

        expect(openTabs).toHaveLength(4);
        expect(selectCenterTabs(openTabs).map((tab) => tab.key)).toEqual(['center-1']);
    });

    it('关闭其它标签页不会清掉 dock 里的侧聊', () => {
        seedCenterTab('center-1');
        seedCenterTab('center-2');
        const sideKey = useChatStore.getState().openSideChat();

        useChatStore.getState().closeOtherTabs('center-1');
        const {openTabs} = useChatStore.getState();

        expect(selectCenterTabs(openTabs).map((tab) => tab.key)).toEqual(['center-1']);
        expect(openTabs.some((tab) => tab.key === sideKey)).toBe(true);
    });

    it('关闭全部标签页不会清掉 dock 里的侧聊', () => {
        seedCenterTab('center-1');
        const sideKey = useChatStore.getState().openSideChat();

        useChatStore.getState().closeAllTabs();
        const {openTabs} = useChatStore.getState();

        expect(selectCenterTabs(openTabs)).toEqual([]);
        expect(openTabs.map((tab) => tab.key)).toEqual([sideKey]);
        expect(useChatStore.getState().activeTabKey).toBeNull();
    });

    it('关掉最后一个中心 tab 时侧聊仍然保留', () => {
        seedCenterTab('center-1');
        useChatStore.setState({activeTabKey: 'center-1'});
        const sideKey = useChatStore.getState().openSideChat();

        useChatStore.getState().closeTab('center-1');
        const {openTabs, activeTabKey} = useChatStore.getState();

        expect(activeTabKey).toBeNull();
        expect(openTabs.map((tab) => tab.key)).toEqual([sideKey]);
    });

    it('焦点回退不会把侧聊提到中心当活跃会话', () => {
        seedCenterTab('center-1');
        useChatStore.setState({activeTabKey: 'center-1'});
        useChatStore.getState().openSideChat();

        useChatStore.getState().closeTab('center-1');

        expect(useChatStore.getState().activeTabKey).toBeNull();
    });

    it('closeSideChat 只移除该侧聊，中心 tab 不受影响', () => {
        seedCenterTab('center-1');
        const sideKey = useChatStore.getState().openSideChat();

        useChatStore.getState().closeSideChat(sideKey);
        const {openTabs, dockChatTabKey} = useChatStore.getState();

        expect(openTabs.map((tab) => tab.key)).toEqual(['center-1']);
        expect(dockChatTabKey).toBeNull();
    });
});
