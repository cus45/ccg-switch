// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useChatStore} from './useChatStore';
import {CHAT_DAEMON_READY_TIMEOUT_ERROR_KEY} from '../utils/chatDaemonStatus';

const tauriMocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    listen: vi.fn(async (_eventName: string, _callback: (event: {payload: unknown}) => void) => vi.fn()),
}));

vi.mock('@tauri-apps/api/core', () => ({invoke: tauriMocks.invoke}));
vi.mock('@tauri-apps/api/event', () => ({listen: tauriMocks.listen}));
vi.mock('../utils/desktopNotification', () => ({
    notifyChatTurnStopped: vi.fn(),
    prepareChatTurnStoppedNotificationPermission: vi.fn(),
}));

type Listeners = Record<string, (event: {payload: unknown}) => void>;

const READY_TIMEOUT_MS = 15_000;

async function setup(): Promise<Listeners> {
    const listeners: Listeners = {};
    tauriMocks.listen.mockImplementation(async (eventName: string, callback: (event: {payload: unknown}) => void) => {
        listeners[eventName] = callback;
        return vi.fn();
    });
    tauriMocks.invoke.mockResolvedValue(undefined);

    useChatStore.setState({initialized: false, daemonLogs: []});
    await useChatStore.getState().init();

    return listeners;
}

function emitDaemon(listeners: Listeners, event: string, message?: string): void {
    listeners['chat://daemon']?.({payload: {event, message}});
}

beforeEach(() => {
    vi.useFakeTimers();
    tauriMocks.invoke.mockReset();
    tauriMocks.listen.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('守护进程启动状态机', () => {
    it('ready 事件把状态推到就绪并解除重连锁', async () => {
        const listeners = await setup();

        emitDaemon(listeners, 'ready');
        const state = useChatStore.getState();

        expect(state.daemonReady).toBe(true);
        expect(state.daemonStatus).toBe('ready');
        expect(state.daemonReconnecting).toBe(false);
    });

    // 回归：daemon 启动时随便一行 stderr（node 的 deprecation 警告之类）原来会把
    // daemonStatus 从 'starting' 顶掉，导致 ready 超时的守卫走早退分支。
    it('启动期间的 stderr 日志不顶掉 starting 状态', async () => {
        const listeners = await setup();

        expect(useChatStore.getState().daemonStatus).toBe('starting');

        emitDaemon(listeners, 'stderr', '(node:1234) DeprecationWarning: punycode');

        expect(useChatStore.getState().daemonStatus).toBe('starting');
        // 日志本身仍然留痕，可在状态面板里查
        expect(useChatStore.getState().daemonLogs.length).toBeGreaterThan(0);
    });

    it('已就绪之后的普通事件仍然更新状态文本', async () => {
        const listeners = await setup();
        emitDaemon(listeners, 'ready');

        emitDaemon(listeners, 'stderr', 'boom');

        expect(useChatStore.getState().daemonStatus).toBe('stderr: boom');
    });

    it('一直不就绪时报出 ready 超时', async () => {
        await setup();

        await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS + 10);
        const state = useChatStore.getState();

        expect(state.daemonStatus).toBe('error');
        expect(state.error).toBe(CHAT_DAEMON_READY_TIMEOUT_ERROR_KEY);
        expect(state.daemonReconnecting).toBe(false);
    });

    // 回归：超时守卫早退时不解除重连锁 → reconnectDaemon 的入口守卫
    // `if (get().daemonReconnecting) return` 让重连按钮永久失效，一直停在「重连中…」。
    it('启动窗口内状态被改过时，超时仍然解除重连锁', async () => {
        await setup();
        tauriMocks.invoke.mockResolvedValue(undefined);

        const reconnect = useChatStore.getState().reconnectDaemon();
        await vi.advanceTimersByTimeAsync(0);
        await reconnect;

        expect(useChatStore.getState().daemonReconnecting).toBe(true);

        // 绕过 stderr 的保护，直接模拟「启动窗口内状态已不是 starting」
        useChatStore.setState({daemonStatus: 'exit: code 1'});

        await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS + 10);

        expect(useChatStore.getState().daemonReconnecting).toBe(false);
        // 不覆盖已有诊断信息
        expect(useChatStore.getState().daemonStatus).toBe('exit: code 1');
    });

    it('解除重连锁后可以再次发起重连', async () => {
        await setup();
        tauriMocks.invoke.mockResolvedValue(undefined);

        await useChatStore.getState().reconnectDaemon();
        useChatStore.setState({daemonStatus: 'exit: code 1'});
        await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS + 10);

        tauriMocks.invoke.mockClear();
        await useChatStore.getState().reconnectDaemon();

        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_start_daemon');
    });
});
