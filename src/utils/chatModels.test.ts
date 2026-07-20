import {describe, expect, it} from 'vitest';
import type {Provider} from '../types/provider';
import {
    buildChatModelList,
    ensureChatModelInList,
    getChatModelRefreshSource,
    loadStoredChatModels,
    parseStoredChatModels,
    storeFetchedChatModels,
} from './chatModels';

function provider(overrides: Partial<Provider>): Provider {
    return {
        id: 'provider-1',
        name: 'Provider',
        appType: 'claude',
        apiKey: 'test-key',
        inFailoverQueue: false,
        isActive: true,
        createdAt: '2026-06-19T00:00:00.000Z',
        ...overrides,
    };
}

describe('chat model list helpers', () => {
    it('puts active provider model configuration before fallback models and dedupes ids', () => {
        const models = buildChatModelList('claude', [
            provider({
                defaultSonnetModel: 'claude-sonnet-provider-20260601',
                defaultOpusModel: 'claude-opus-provider-20260601',
                defaultHaikuModel: 'claude-haiku-provider-20260601',
            }),
            provider({
                id: 'inactive-provider',
                isActive: false,
                defaultSonnetModel: 'claude-sonnet-inactive-20260601',
            }),
        ]);

        expect(models.slice(0, 3).map((model) => model.id)).toEqual([
            'claude-sonnet-provider-20260601',
            'claude-opus-provider-20260601',
            'claude-haiku-provider-20260601',
        ]);
        expect(models.some((model) => model.id === 'claude-opus-4-8')).toBe(true);
        expect(models.filter((model) => model.id === 'claude-sonnet-provider-20260601')).toHaveLength(1);
    });

    it('merges stored custom models ahead of fallback models', () => {
        const storage = new Map<string, string>();
        storage.set(
            'ccg-chat-custom-models:codex',
            JSON.stringify([
                'gpt-5.2-codex-custom',
                {id: 'gpt-5.2-codex-max', label: 'GPT Custom Max', description: 'Custom routing'},
            ]),
        );

        const models = buildChatModelList('codex', [], {
            storage: {
                getItem: (key) => storage.get(key) ?? null,
            },
        });

        expect(models.slice(0, 2).map((model) => model.id)).toEqual([
            'gpt-5.2-codex-custom',
            'gpt-5.2-codex-max',
        ]);
        expect(models[1]?.label).toBe('GPT Custom Max');
        expect(models.some((model) => model.id === 'gpt-5.5')).toBe(true);
        expect(models.some((model) => model.id === 'gpt-5.4')).toBe(true);
        expect(models.some((model) => model.id === 'gpt-5.2-codex')).toBe(true);
        expect(models.some((model) => model.id === 'gpt-5.6-sol')).toBe(true);
    });

    it('ignores malformed stored custom models instead of breaking fallback models', () => {
        const storage = {
            getItem: () => '[{"id":""},{"label":"missing id"},42]',
        };

        expect(loadStoredChatModels('claude', storage)).toEqual([]);
        expect(buildChatModelList('claude', [], {storage})[0]?.id).toBe('claude-opus-4-8');
    });

    it('keeps the current selected model visible even when it is not in dynamic sources', () => {
        const models = ensureChatModelInList(
            buildChatModelList('codex', []),
            'gpt-5-codex-from-session',
        );

        expect(models[0]).toMatchObject({
            id: 'gpt-5-codex-from-session',
            label: 'gpt-5-codex-from-session',
        });
    });

    it('parses string and object custom model shapes', () => {
        expect(parseStoredChatModels(JSON.stringify([
            'claude-custom-string',
            {id: 'claude-custom-object', label: 'Custom Object', description: 'From config'},
        ]))).toEqual([
            {id: 'claude-custom-string', label: 'claude-custom-string', description: undefined},
            {id: 'claude-custom-object', label: 'Custom Object', description: 'From config'},
        ]);
    });

    it('finds the active provider refresh source with trimmed url and api key', () => {
        expect(getChatModelRefreshSource('claude', [
            provider({
                isActive: false,
                url: 'https://inactive.example.com',
                apiKey: 'inactive-key',
            }),
            provider({
                id: 'active-provider',
                name: 'Active Claude',
                url: ' https://api.example.com/ ',
                apiKey: ' test-key ',
            }),
        ])).toEqual({
            providerName: 'Active Claude',
            url: 'https://api.example.com/',
            apiKey: 'test-key',
        });
    });

    it('returns no refresh source when the provider is missing url or api key', () => {
        expect(getChatModelRefreshSource('codex', [
            provider({
                appType: 'codex',
                url: 'https://api.example.com',
                apiKey: '   ',
            }),
        ])).toBeNull();
    });

    it('stores fetched model ids under the provider cache key and dispatches a storage event', () => {
        const writes = new Map<string, string>();
        const dispatched: Array<{type: string; detail?: {key?: string}}> = [];
        const stored = storeFetchedChatModels('codex', [
            ' gpt-5.6-codex ',
            '',
            'gpt-5.6-codex',
            'gpt-5.7',
        ], {
            storage: {
                getItem: () => null,
                setItem: (key, value) => writes.set(key, value),
            },
            eventTarget: {
                dispatchEvent: (event) => {
                    dispatched.push({
                        type: event.type,
                        detail: (event as CustomEvent<{key?: string}>).detail,
                    });
                    return true;
                },
            },
        });

        expect(stored).toBe(2);
        expect(writes.get('ccg-chat-custom-models:codex')).toBe(JSON.stringify([
            'gpt-5.6-codex',
            'gpt-5.7',
        ]));
        expect(dispatched).toEqual([
            {
                type: 'localStorageChange',
                detail: {key: 'ccg-chat-custom-models:codex'},
            },
        ]);
    });
});
