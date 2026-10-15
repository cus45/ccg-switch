// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatWorkspaceHeader from './ChatWorkspaceHeader';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback?: string) => fallback ?? _key,
    }),
}));

vi.mock('./ChatProviderSelector', () => ({
    default: () => createElement('div', { 'data-testid': 'chat-provider-selector' }),
}));

describe('ChatWorkspaceHeader', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = null;
        }
        container?.remove();
        container = null;
    });

    it('renders project name, git branch, tokens, and action buttons', async () => {
        const handleNewSession = vi.fn();
        const handleClear = vi.fn();
        const handleToggleSidebar = vi.fn();

        await act(async () => {
            root?.render(
                createElement(ChatWorkspaceHeader, {
                    currentCwd: 'C:/guodevelop/ccg-switch',
                    gitBranch: 'main',
                    sessionTitle: 'Feature Chat',
                    sessionSidebarCollapsed: false,
                    onToggleSessionSidebar: handleToggleSidebar,
                    sidebarToggleLabel: 'Collapse session sidebar',
                    contextTokens: 12500,
                    contextMaxTokens: 200000,
                    contextUsagePercentage: 6.25,
                    provider: 'claude',
                    model: 'claude-sonnet-4-6',
                    permissionMode: 'default',
                    daemonStatusText: 'Daemon ready',
                    daemonIndicatorClass: 'bg-success',
                    showDaemonReconnect: false,
                    daemonReconnectLabel: 'Reconnect',
                    daemonReconnectShortLabel: 'Reconnect',
                    daemonReconnecting: false,
                    onReconnectDaemon: () => undefined,
                    hasMessages: true,
                    isStreaming: false,
                    onNewSession: handleNewSession,
                    onClearChat: handleClear,
                    onOpenSdkModal: () => undefined,
                    sdkMissing: false,
                    clearChatLabel: 'Clear Chat',
                    sdkManageLabel: 'Manage SDKs',
                })
            );
        });

        expect(container?.textContent).toContain('ccg-switch');
        expect(container?.textContent).toContain('main');
        expect(container?.textContent).toContain('Feature Chat');
        expect(container?.textContent).toContain('12.5K / 200.0K');
        expect(container?.querySelector('[data-testid="chat-provider-selector"]')).toBeDefined();

        const buttons = container?.querySelectorAll('button') ?? [];
        const clearButton = Array.from(buttons).find((b) => b.getAttribute('aria-label') === 'Clear Chat');
        expect(clearButton).toBeDefined();

        await act(async () => {
            clearButton?.click();
        });
        expect(handleClear).toHaveBeenCalled();
    });
});
