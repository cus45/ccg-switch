// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Provider} from '../types/provider';
import ProvidersPage from './ProvidersPage';

(
    globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
).IS_REACT_ACT_ENVIRONMENT = true;

const providerState = vi.hoisted(() => ({
    providers: [] as Provider[],
    hasLoaded: true,
    loading: false,
    loadAllProviders: vi.fn(),
    switchProvider: vi.fn(),
    deleteProvider: vi.fn(),
    moveProvider: vi.fn(),
    addProvider: vi.fn(),
}));

vi.mock('../stores/useProviderStore', () => ({
    useProviderStore: () => providerState,
}));

vi.mock('../hooks/useHealthCheck', () => ({
    useHealthCheck: () => ({
        statuses: {},
        checkSingle: vi.fn(),
        checkBatch: vi.fn(),
        isAnyChecking: false,
    }),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    initReactI18next: {
        type: '3rdParty',
        init: () => undefined,
    },
    useTranslation: () => ({
        t: (key: string, options?: Record<string, string>) => {
            const translations: Record<string, string> = {
                'providers.title': 'Providers',
                'providers.importExportScope': 'Provider config files',
                'providers.export_config': 'Export',
                'providers.import_config': 'Import',
                'providers.health_check': 'Health check',
                'providers.add_btn': 'Add',
                'providers.search_placeholder': 'Search providers',
                'providers.filter_all': 'All',
                'providers.table_view': 'Table view',
                'providers.card_view': 'Card view',
                'providers.active_badge': 'Active',
                'providers.health_check_single': 'Check health',
                'providers.codexModel': 'Codex Model',
                'providers.modelLabel': 'Model',
                'providers.defaultModel': 'Default',
                'common.refresh': 'Refresh',
            };
            const translated = translations[key] ?? key;
            return Object.entries(options ?? {}).reduce(
                (text, [name, value]) => text.split(`{{${name}}}`).join(value),
                translated,
            );
        },
    }),
}));

function createProvider(id: string, appType: Provider['appType']): Provider {
    return {
        id,
        name: `${appType} provider`,
        appType,
        apiKey: `${appType}-key`,
        url: `https://${appType}.example.com`,
        inFailoverQueue: false,
        isActive: false,
        createdAt: '2026-06-24T00:00:00.000Z',
    };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
    if (root) {
        await act(async () => {
            root?.unmount();
        });
    }
    container?.remove();
    root = null;
    container = null;
    providerState.providers = [];
    providerState.loadAllProviders.mockClear();
    providerState.switchProvider.mockClear();
    providerState.deleteProvider.mockClear();
    providerState.moveProvider.mockClear();
    providerState.addProvider.mockClear();
});

describe('ProvidersPage', () => {
    it('uses provider brand icons in filter options and config shortcuts', () => {
        providerState.providers = [
            createProvider('claude-1', 'claude'),
            createProvider('codex-1', 'codex'),
            createProvider('gemini-1', 'gemini'),
        ];

        const html = renderToStaticMarkup(<ProvidersPage />);

        expect(html).toContain('provider-filter-dropdown');
        expect(html).not.toContain('<select');
        expect(html).toContain('data-provider-filter-option="claude"');
        expect(html).toContain('data-provider-filter-option="codex"');
        expect(html).toContain('data-provider-filter-option="gemini"');
        expect(html).toContain('data-provider-config-shortcut="claude"');
        expect(html).toContain('data-provider-config-shortcut="codex"');
        expect(html).toContain('data-provider-config-shortcut="gemini"');
        expect((html.match(/data-provider-brand-icon="claude"/g) ?? []).length).toBeGreaterThanOrEqual(2);
        expect((html.match(/data-provider-brand-icon="codex"/g) ?? []).length).toBeGreaterThanOrEqual(2);
        expect((html.match(/data-provider-brand-icon="gemini"/g) ?? []).length).toBeGreaterThanOrEqual(2);
        expect(html).not.toContain('bg-orange-400');
        expect(html).not.toContain('bg-emerald-400');
        expect(html).not.toContain('bg-blue-400');
    });

    it('shows Codex cards with a single Codex model row', () => {
        const claudeProvider = createProvider('claude-1', 'claude');
        claudeProvider.defaultSonnetModel = 'claude-sonnet-4-6';
        claudeProvider.defaultOpusModel = 'claude-opus-4-8';
        const codexProvider = createProvider('codex-1', 'codex');
        codexProvider.defaultSonnetModel = 'gpt-5.2-codex';
        codexProvider.defaultOpusModel = 'stale-claude-opus';
        providerState.providers = [claudeProvider, codexProvider];

        const wrapper = document.createElement('div');
        wrapper.innerHTML = renderToStaticMarkup(<ProvidersPage />);
        const claudeModels = wrapper.querySelector('[data-provider-model-config="claude"]');
        const codexModels = wrapper.querySelector('[data-provider-model-config="codex"]');

        expect(claudeModels?.textContent).toContain('Sonnet');
        expect(claudeModels?.textContent).toContain('Opus');
        expect(codexModels?.textContent).toContain('Model');
        expect(codexModels?.textContent).not.toContain('Codex Model');
        expect(codexModels?.textContent).toContain('gpt-5.2-codex');
        expect(codexModels?.textContent).not.toContain('Sonnet');
        expect(codexModels?.textContent).not.toContain('Opus');
        expect(codexModels?.textContent).not.toContain('Haiku');
        expect(codexModels?.textContent).not.toContain('Thinking');
        expect(codexModels?.textContent).not.toContain('stale-claude-opus');
    });

    it('uses provider brand icons in table app cells', async () => {
        providerState.providers = [
            createProvider('claude-1', 'claude'),
            createProvider('codex-1', 'codex'),
            createProvider('gemini-1', 'gemini'),
        ];
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        await act(async () => {
            root?.render(<ProvidersPage />);
        });

        const tableButton = container.querySelector<HTMLButtonElement>('button[title="Table view"]');
        expect(tableButton).toBeInstanceOf(HTMLButtonElement);

        await act(async () => {
            tableButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
        });

        expect(container.innerHTML).toContain('data-provider-table-app="claude"');
        expect(container.innerHTML).toContain('data-provider-table-app="codex"');
        expect(container.innerHTML).toContain('data-provider-table-app="gemini"');
        expect((container.innerHTML.match(/data-provider-brand-icon="claude"/g) ?? []).length).toBeGreaterThanOrEqual(2);
        expect((container.innerHTML.match(/data-provider-brand-icon="codex"/g) ?? []).length).toBeGreaterThanOrEqual(2);
        expect((container.innerHTML.match(/data-provider-brand-icon="gemini"/g) ?? []).length).toBeGreaterThanOrEqual(2);
        expect(container.innerHTML).not.toContain('background-color:#D97706');
        expect(container.innerHTML).not.toContain('background-color:#059669');
        expect(container.innerHTML).not.toContain('background-color:#2563EB');
    });

    it('closes the provider filter dropdown after selecting an option', async () => {
        providerState.providers = [
            createProvider('claude-1', 'claude'),
            createProvider('codex-1', 'codex'),
        ];
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        await act(async () => {
            root?.render(<ProvidersPage />);
        });

        const filterDropdown = container.querySelector<HTMLDetailsElement>('.provider-filter-dropdown');
        const codexOption = container.querySelector<HTMLButtonElement>('[data-provider-filter-option="codex"]');
        expect(filterDropdown).toBeInstanceOf(HTMLDetailsElement);
        expect(codexOption).toBeInstanceOf(HTMLButtonElement);
        filterDropdown!.open = true;

        await act(async () => {
            codexOption?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
        });

        expect(filterDropdown!.open).toBe(false);
        expect(filterDropdown?.querySelector('summary')?.getAttribute('title')).toBe('Codex');
    });
});
