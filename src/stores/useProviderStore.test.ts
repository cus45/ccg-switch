import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {Provider} from '../types/provider';
import type {ChatSessionTab} from './useChatStore';
import {useChatStore} from './useChatStore';
import {useProviderStore} from './useProviderStore';

const tauriMocks = vi.hoisted(() => ({
    invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: tauriMocks.invoke,
}));

function createProvider(overrides: Partial<Provider>): Provider {
    return {
        id: 'provider-1',
        name: 'Provider 1',
        appType: 'claude',
        apiKey: 'test-key',
        url: 'https://example.invalid',
        inFailoverQueue: false,
        isActive: true,
        createdAt: '2026-06-24T00:00:00.000Z',
        ...overrides,
    };
}

describe('useProviderStore', () => {
    beforeEach(() => {
        tauriMocks.invoke.mockReset();
        useProviderStore.setState({
            providers: [],
            hasLoaded: false,
            loading: false,
            error: null,
        });
        useChatStore.setState({
            messages: [],
            activeRequestId: null,
            openTabs: [],
            activeTabKey: null,
            providerConfigDirty: false,
            daemonReady: false,
            daemonStatus: null,
            daemonReconnecting: false,
            error: null,
        });
    });

    it('refreshes the chat daemon after switching a chat provider', async () => {
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'switch_provider') return Promise.resolve(undefined);
            if (command === 'get_all_providers') return Promise.resolve([
                createProvider({id: 'provider-2', name: 'Provider 2'}),
            ]);
            if (command === 'chat_restart_daemon') return Promise.resolve(undefined);
            throw new Error(`Unexpected command: ${command}`);
        });

        await useProviderStore.getState().switchProvider('claude', 'provider-2');

        expect(tauriMocks.invoke).toHaveBeenCalledWith('switch_provider', {
            app: 'claude',
            providerId: 'provider-2',
        });
        expect(tauriMocks.invoke).toHaveBeenCalledWith('chat_restart_daemon');
        expect(tauriMocks.invoke.mock.calls.map(([command]) => command)).toEqual([
            'switch_provider',
            'get_all_providers',
            'chat_restart_daemon',
        ]);
    });

    it('does not restart the chat daemon after switching a non-chat provider', async () => {
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'switch_provider') return Promise.resolve(undefined);
            if (command === 'get_all_providers') return Promise.resolve([
                createProvider({id: 'gemini-provider', appType: 'gemini'}),
            ]);
            throw new Error(`Unexpected command: ${command}`);
        });

        await useProviderStore.getState().switchProvider('gemini', 'gemini-provider');

        expect(tauriMocks.invoke).not.toHaveBeenCalledWith('chat_restart_daemon');
    });

    it('defers chat daemon restart when another tab is still streaming', async () => {
        const runningTab: ChatSessionTab = {
            key: 'session:background',
            subagentRuns: {},
            queuedMessages: [],
            messages: [{
                id: 'assistant-1',
                role: 'assistant',
                content: '',
                streaming: true,
                createdAt: 1,
            }],
            provider: 'claude',
            permissionMode: 'default',
            model: 'claude-opus-4-8',
            reasoningEffort: 'high',
            draft: '',
            longContextEnabled: true,
            contextTokens: 0,
            contextMaxTokens: null,
            activeRequestId: 'request-background',
            sessionId: 'session-background',
            currentCwd: 'C:/workspace/ccg-switch',
            activeSession: null,
            pendingSessionKey: null,
            lastSessionLoadMetrics: null,
            handoffContextProvider: null,
            status: 'running',
            error: null,
            createdAt: 1,
            updatedAt: 1,
        };
        useChatStore.setState({
            openTabs: [runningTab],
            activeTabKey: 'draft:current',
            messages: [],
            activeRequestId: null,
        });
        tauriMocks.invoke.mockImplementation((command: string) => {
            if (command === 'switch_provider') return Promise.resolve(undefined);
            if (command === 'get_all_providers') return Promise.resolve([
                createProvider({id: 'provider-2', name: 'Provider 2'}),
            ]);
            if (command === 'chat_restart_daemon') return Promise.resolve(undefined);
            throw new Error(`Unexpected command: ${command}`);
        });

        await useProviderStore.getState().switchProvider('claude', 'provider-2');

        expect(tauriMocks.invoke).not.toHaveBeenCalledWith('chat_restart_daemon');
        expect(useChatStore.getState().providerConfigDirty).toBe(true);
    });
});
