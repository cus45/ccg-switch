// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {ChatMessage} from '../types/chat';
import {useChatStore} from './useChatStore';

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

vi.mock('../utils/desktopNotification', () => ({
    notifyChatTurnStopped: vi.fn(),
    prepareChatTurnStoppedNotificationPermission: vi.fn(),
}));

type Listeners = Record<string, (event: {payload: unknown}) => void>;

/** 每个用例用独立 requestId：done/abort 会把 id 标记为已退役，复用会被后续用例的事件守卫拒掉。 */
let requestSeq = 0;
let requestId = '';

function streamingTranscript(): ChatMessage[] {
    return [
        {id: 'user-1', role: 'user', content: '提问', createdAt: 100},
        {id: 'assistant-1', role: 'assistant', content: '', streaming: true, createdAt: 101},
    ];
}

async function setupListeners(): Promise<Listeners> {
    requestSeq += 1;
    requestId = `request-coalesce-${requestSeq}`;
    const listeners: Listeners = {};
    tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: {payload: unknown}) => void) => {
        listeners[eventName] = callback;
        return vi.fn();
    });
    tauriMocks.invoke.mockResolvedValue(undefined);

    await useChatStore.getState().init();
    useChatStore.setState({
        provider: 'claude',
        activeRequestId: requestId,
        messages: streamingTranscript(),
    });

    return listeners;
}

function emitStream(listeners: Listeners, text: string): void {
    listeners['chat://stream']?.({payload: {requestId, kind: 'line', text}});
}

function emitDelta(listeners: Listeners, delta: string): void {
    emitStream(listeners, `[CONTENT_DELTA] ${JSON.stringify(delta)}`);
}

/** 等一帧，让 requestAnimationFrame 排期的合批提交落地。 */
function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function assistantContent(): string {
    return useChatStore.getState().messages[1].content;
}

describe('流式增量合批', () => {
    beforeEach(() => {
        tauriMocks.invoke.mockReset();
        tauriMocks.listen.mockClear();
        // init() 对 initialized 做幂等守卫；不复位就只有第一个用例能装上监听器。
        useChatStore.setState({
            initialized: false,
            activeRequestId: null,
            openTabs: [],
            activeTabKey: null,
            dockChatTabKey: null,
            messages: [],
        });
    });

    it('同一帧内的多截增量合并为一次提交，且内容完整', async () => {
        const listeners = await setupListeners();
        const before = useChatStore.getState().messages;

        emitDelta(listeners, '你');
        emitDelta(listeners, '好');
        emitDelta(listeners, '世界');

        // 尚未跨帧：transcript 还是同一个数组引用，订阅方一次都没被惊动
        expect(useChatStore.getState().messages).toBe(before);

        await nextFrame();

        expect(assistantContent()).toBe('你好世界');
    });

    it('BLOCK_RESET 之前先排空缓冲，文本不会越过内容块边界', async () => {
        const listeners = await setupListeners();

        emitDelta(listeners, '第一段');
        // 同帧内紧跟封口：缓冲必须先落到第一个内容块里
        emitStream(listeners, '[BLOCK_RESET]');
        emitDelta(listeners, '第二段');
        await nextFrame();

        expect(assistantContent()).toBe('第一段第二段');

        const raw = useChatStore.getState().messages[1].raw as
            | {message?: {content?: Array<{type: string; text?: string}>}}
            | undefined;
        const textBlocks = (raw?.message?.content ?? []).filter((block) => block.type === 'text');

        expect(textBlocks.map((block) => block.text)).toEqual(['第一段', '第二段']);
    });

    it('USAGE 之前先排空缓冲，用量落在已提交的文本上', async () => {
        const listeners = await setupListeners();

        emitDelta(listeners, '统计前的文本');
        emitStream(
            listeners,
            '[USAGE] {"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}',
        );

        // USAGE 分支同步 flush，无需等帧
        expect(assistantContent()).toBe('统计前的文本');
        expect(useChatStore.getState().messages[1].usage).toMatchObject({output_tokens: 20});
    });

    it('回合结束前排空缓冲，最后一帧的文本不会丢失', async () => {
        const listeners = await setupListeners();

        emitDelta(listeners, '收尾文本');
        listeners['chat://done']?.({payload: {requestId, success: true}});

        expect(assistantContent()).toBe('收尾文本');
        expect(useChatStore.getState().messages[1].streaming).toBeFalsy();
    });

    it('中止前排空缓冲，已到达的文本得以保留', async () => {
        const listeners = await setupListeners();

        emitDelta(listeners, '被中止前的文本');
        await useChatStore.getState().abort();

        expect(assistantContent()).toBe('被中止前的文本');
    });
});
