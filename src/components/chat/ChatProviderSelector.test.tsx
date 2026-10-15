// @vitest-environment jsdom
import {act, createElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import ChatProviderSelector from './ChatProviderSelector';
import {useProviderStore} from '../../stores/useProviderStore';
import {useChatStore} from '../../stores/useChatStore';
import type {Provider} from '../../types/provider';

(
    globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
).IS_REACT_ACT_ENVIRONMENT = true;

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

vi.mock('../../components/common/ToastContainer', () => ({
    showToast: vi.fn(),
}));

function mockProvider(overrides: Partial<Provider>): Provider {
    return {
        id: 'p-1',
        name: 'Anthropic Official',
        appType: 'claude',
        apiKey: 'sk-test',
        url: 'https://api.anthropic.com',
        inFailoverQueue: false,
        isActive: true,
        createdAt: '2026-10-14T00:00:00.000Z',
        ...overrides,
    };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

describe('ChatProviderSelector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        useProviderStore.setState({
            providers: [
                mockProvider({
                    id: 'p-1',
                    name: 'Anthropic Official',
                    appType: 'claude',
                    isActive: true,
                    url: 'https://api.anthropic.com',
                }),
                mockProvider({
                    id: 'p-2',
                    name: 'DeepSeek V3',
                    appType: 'claude',
                    isActive: false,
                    url: 'https://api.deepseek.com',
                    defaultSonnetModel: 'deepseek-chat',
                }),
                mockProvider({
                    id: 'p-3',
                    name: 'Codex Provider',
                    appType: 'codex',
                    isActive: true,
                }),
            ],
            hasLoaded: true,
            loading: false,
        });
        useChatStore.setState({
            model: 'claude-3-7-sonnet',
        });
    });

    afterEach(async () => {
        if (root) {
            await act(async () => {
                root?.unmount();
            });
        }
        container?.remove();
        root = null;
        container = null;
    });

    it('renders the active provider for the given appType', async () => {
        await act(async () => {
            root?.render(createElement(ChatProviderSelector, {appType: 'claude'}));
        });

        expect(container?.textContent).toContain('Anthropic Official');
    });

    it('opens dropdown and only lists providers matching the appType', async () => {
        await act(async () => {
            root?.render(createElement(ChatProviderSelector, {appType: 'claude'}));
        });

        const trigger = container?.querySelector('[data-testid="chat-provider-selector-trigger"]') as HTMLButtonElement;
        expect(trigger).toBeDefined();

        await act(async () => {
            trigger.click();
        });

        const dropdown = container?.querySelector('[data-testid="chat-provider-dropdown"]');
        expect(dropdown).not.toBeNull();
        expect(dropdown?.textContent).toContain('Anthropic Official');
        expect(dropdown?.textContent).toContain('DeepSeek V3');
        expect(dropdown?.textContent).not.toContain('Codex Provider');
    });

    it('switches provider and auto-updates model if defaultSonnetModel is set', async () => {
        const switchSpy = vi.fn().mockResolvedValue(undefined);
        useProviderStore.setState({
            switchProvider: switchSpy,
        });

        await act(async () => {
            root?.render(createElement(ChatProviderSelector, {appType: 'claude'}));
        });

        const trigger = container?.querySelector('[data-testid="chat-provider-selector-trigger"]') as HTMLButtonElement;
        await act(async () => {
            trigger.click();
        });

        const targetOption = container?.querySelector('[data-testid="chat-provider-option-p-2"]') as HTMLButtonElement;
        expect(targetOption).not.toBeNull();

        await act(async () => {
            targetOption.click();
        });

        expect(switchSpy).toHaveBeenCalledWith('claude', 'p-2');
        expect(useChatStore.getState().model).toBe('deepseek-chat');
    });

    it('disables trigger when disabled prop is true', async () => {
        await act(async () => {
            root?.render(createElement(ChatProviderSelector, {appType: 'claude', disabled: true}));
        });

        const trigger = container?.querySelector('[data-testid="chat-provider-selector-trigger"]') as HTMLButtonElement;
        expect(trigger.disabled).toBe(true);
    });

    it('navigates to /providers when clicking manage button', async () => {
        window.location.hash = '';
        await act(async () => {
            root?.render(createElement(ChatProviderSelector, {appType: 'claude'}));
        });

        const trigger = container?.querySelector('[data-testid="chat-provider-selector-trigger"]') as HTMLButtonElement;
        await act(async () => {
            trigger.click();
        });

        const manageBtn = Array.from(container?.querySelectorAll('button') || []).find((btn) =>
            btn.textContent?.includes('管理服务商与密钥...'),
        );
        expect(manageBtn).toBeDefined();

        await act(async () => {
            manageBtn?.click();
        });

        expect(window.location.hash).toBe('#/providers');
    });
});
