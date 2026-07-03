// @vitest-environment jsdom
import {act, createElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const tauriMocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    listen: vi.fn(async (_eventName: string, _callback: (event: {payload: unknown}) => void) => vi.fn()),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: tauriMocks.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: tauriMocks.listen,
}));

vi.mock('../../../utils/desktopNotification', () => ({
    notifyChatTurnStopped: vi.fn(),
    prepareChatTurnStoppedNotificationPermission: vi.fn(),
}));

import {useChatStore} from '../../../stores/useChatStore';
import {type ComposerChatBinding, useComposerChatBinding} from './useComposerChatBinding';

(
    globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
).IS_REACT_ACT_ENVIRONMENT = true;

const captured: ComposerChatBinding[] = [];

function Probe({tabKey}: {tabKey: string}) {
    captured.push(useComposerChatBinding(tabKey));
    return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderProbe(tabKey: string) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(createElement(Probe, {tabKey}));
    });
}

beforeEach(() => {
    captured.length = 0;
    useChatStore.setState({
        activeTabKey: 'main-tab',
        messages: [],
        draft: '',
        openTabs: [],
        dockChatTabKey: null,
    });
});

afterEach(async () => {
    if (root) {
        await act(async () => {
            root!.unmount();
        });
        root = null;
    }
    container?.remove();
    container = null;
});

describe('useComposerChatBinding (tab 作用域)', () => {
    // 回归：tab 动作若每轮渲染重建，ChatComposer 依赖 setDraft 的编辑器同步
    // effect 会 重跑→写 store→再渲染 无限循环（Maximum update depth exceeded）。
    it('keeps tab action identities stable across store-driven re-renders', async () => {
        const sideKey = useChatStore.getState().openSideChat();
        await renderProbe(sideKey);
        const first = captured[captured.length - 1];

        await act(async () => {
            first.setDraft('hello');
        });

        const latest = captured[captured.length - 1];
        expect(latest.draft).toBe('hello');
        expect(latest.setDraft).toBe(first.setDraft);
        expect(latest.send).toBe(first.send);
        expect(latest.setProvider).toBe(first.setProvider);
        expect(latest.setModel).toBe(first.setModel);
        expect(latest.readDraft()).toBe('hello');
    });

    it('setDraft with unchanged text keeps the openTabs snapshot reference', async () => {
        const sideKey = useChatStore.getState().openSideChat();
        await renderProbe(sideKey);
        const binding = captured[captured.length - 1];

        await act(async () => {
            binding.setDraft('same');
        });
        const before = useChatStore.getState().openTabs;
        await act(async () => {
            binding.setDraft('same');
        });

        expect(useChatStore.getState().openTabs).toBe(before);
    });
});
