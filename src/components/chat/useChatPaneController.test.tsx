// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {useChatStore} from '../../stores/useChatStore';
import {useChatPaneController, type ChatPaneController} from './useChatPaneController';

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`,
    invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}));

vi.mock('../../utils/desktopNotification', () => ({
    notifyChatTurnStopped: vi.fn(),
    prepareChatTurnStoppedNotificationPermission: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key}),
}));

(
    globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
).IS_REACT_ACT_ENVIRONMENT = true;

let renderCount = 0;
let controller: ChatPaneController | null = null;

function Harness() {
    const paneController = useChatPaneController({tabKey: null});
    renderCount += 1;
    controller = paneController;

    return (
        <div
            ref={paneController.scrollRef}
            onScroll={paneController.updateBottomState}
            style={{height: '100px', overflowY: 'auto'}}
        >
            content
        </div>
    );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const scrollToMock = vi.fn();

/** tsconfig 的 lib 里没有 Array.prototype.at，用下标取最后一次调用。 */
function lastScrollOptions(): ScrollToOptions | undefined {
    const {calls} = scrollToMock.mock;
    return calls.length > 0 ? (calls[calls.length - 1][0] as ScrollToOptions) : undefined;
}

function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// jsdom 不实现 Element.scrollTo；补个 spy 既让代码跑通，也能断言滚动行为。
Element.prototype.scrollTo = scrollToMock as unknown as Element['scrollTo'];

beforeEach(() => {
    renderCount = 0;
    controller = null;
    scrollToMock.mockClear();
    useChatStore.setState({messages: [], activeTabKey: null, openTabs: []});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root!.render(<Harness />);
    });
});

afterEach(() => {
    if (root) {
        const activeRoot = root;
        act(() => activeRoot.unmount());
    }
    container?.remove();
    root = null;
    container = null;
});

describe('useChatPaneController 滚动跟随', () => {
    it('高频滚动被压到每帧一次，且位置未变时不触发重渲染', async () => {
        const rendersBefore = renderCount;

        // 模拟一次惯性滚动：改造前这里会是 40 次同步 setState + 重渲染
        act(() => {
            for (let i = 0; i < 40; i += 1) {
                controller!.updateBottomState();
            }
        });

        expect(renderCount).toBe(rendersBefore);

        await act(async () => {
            await nextFrame();
        });

        // jsdom 下容器尺寸恒为 0 → isNearBottom 仍是 true，同值 setState 不重渲染
        expect(renderCount).toBe(rendersBefore);
        expect(controller!.isNearBottom).toBe(true);
    });

    it('默认处于跟随态且无未读', () => {
        expect(controller!.isNearBottom).toBe(true);
        expect(controller!.unreadCount).toBe(0);
    });

    it('滚到顶部后脱离跟随，新消息计入未读', async () => {
        act(() => {
            controller!.scrollToTop();
        });

        expect(controller!.isNearBottom).toBe(false);

        await act(async () => {
            useChatStore.setState({
                messages: [
                    {id: 'u1', role: 'user', content: '问', createdAt: 1},
                    {id: 'a1', role: 'assistant', content: '答', createdAt: 2},
                ],
            });
            await nextFrame();
        });

        expect(controller!.unreadCount).toBeGreaterThan(0);
    });

    it('回到底部清零未读并恢复跟随', async () => {
        act(() => {
            controller!.scrollToTop();
        });
        await act(async () => {
            useChatStore.setState({
                messages: [{id: 'a1', role: 'assistant', content: '答', createdAt: 2}],
            });
            await nextFrame();
        });

        expect(controller!.unreadCount).toBeGreaterThan(0);

        await act(async () => {
            controller!.scrollToBottom();
            await nextFrame();
        });

        expect(controller!.unreadCount).toBe(0);
        expect(controller!.isNearBottom).toBe(true);
    });

    it('resetNavigation 清掉未读与跟随基线', async () => {
        act(() => {
            controller!.scrollToTop();
        });
        await act(async () => {
            useChatStore.setState({
                messages: [{id: 'a1', role: 'assistant', content: '答', createdAt: 2}],
            });
            await nextFrame();
        });

        act(() => {
            controller!.resetNavigation();
        });

        expect(controller!.unreadCount).toBe(0);
        expect(controller!.isNearBottom).toBe(true);
    });

    it('流式期间跟随用 instant，避免平滑动画互相打断', async () => {
        await act(async () => {
            useChatStore.setState({
                messages: [
                    {id: 'a1', role: 'assistant', content: '答', streaming: true, createdAt: 2},
                ],
            });
            await nextFrame();
        });

        const streamingScroll = lastScrollOptions();
        expect(streamingScroll).toMatchObject({behavior: 'instant'});
    });

    it('非流式的新消息用平滑滚动', async () => {
        await act(async () => {
            useChatStore.setState({
                messages: [{id: 'a1', role: 'assistant', content: '答', createdAt: 2}],
            });
            await nextFrame();
        });

        const settledScroll = lastScrollOptions();
        expect(settledScroll).toMatchObject({behavior: 'smooth'});
    });

    it('跟随滚动按帧合批：连续多次 messages 更新只滚一次', async () => {
        scrollToMock.mockClear();

        await act(async () => {
            for (let i = 1; i <= 5; i += 1) {
                useChatStore.setState({
                    messages: [{id: 'a1', role: 'assistant', content: '答'.repeat(i), streaming: true, createdAt: 2}],
                });
            }
            await nextFrame();
        });

        expect(scrollToMock).toHaveBeenCalledTimes(1);
    });
});
