// @vitest-environment jsdom
import {act, createElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {createInstance} from 'i18next';
import {I18nextProvider} from 'react-i18next';
import type {ChatSessionTab} from '../../stores/useChatStore';
import ChatSessionTabs from './ChatSessionTabs';
import {afterEach, describe, expect, it, vi} from 'vitest';

(
    globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
).IS_REACT_ACT_ENVIRONMENT = true;

function createKeyOnlyI18n() {
    const instance = createInstance();
    instance.init({
        lng: 'en',
        fallbackLng: false,
        resources: {},
        initImmediate: false,
        interpolation: {escapeValue: false},
    });
    return instance;
}

function createTab(overrides: Partial<ChatSessionTab>): ChatSessionTab {
    return {
        key: 'draft:1',
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
        currentCwd: 'C:/workspace/ccg-switch',
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
        ...overrides,
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
});

describe('ChatSessionTabs', () => {
    it('renders opened sessions as browser-like tabs with status and close controls', () => {
        const html = renderToStaticMarkup(createElement(
            I18nextProvider,
            {i18n: createKeyOnlyI18n()},
            createElement(ChatSessionTabs, {
                tabs: [
                    createTab({
                        key: 'session:claude',
                        provider: 'claude',
                        activeSession: {
                            providerId: 'claude',
                            sessionId: 'claude-session',
                            title: 'Claude work',
                            summary: null,
                            projectDir: 'C:/workspace/ccg-switch',
                            createdAt: 1,
                            lastActiveAt: 2,
                            sourcePath: 'C:/sessions/claude.jsonl',
                            resumeCommand: null,
                        },
                        status: 'running',
                        activeRequestId: 'request-1',
                    }),
                    createTab({
                        key: 'draft:codex',
                        provider: 'codex',
                        currentCwd: 'C:/workspace/other',
                        status: 'idle',
                    }),
                ],
                activeTabKey: 'session:claude',
                onFocusTab: () => undefined,
                onCloseTab: () => undefined,
                onCloseOtherTabs: () => undefined,
                onCloseAllTabs: () => undefined,
            }),
        ));

        expect(html).toContain('role="tablist"');
        expect(html).toContain('role="tab"');
        expect(html).toContain('aria-selected="true"');
        expect(html).toContain('data-chat-provider-icon="claude"');
        expect(html).toContain('data-chat-provider-icon="codex"');
        expect(html).toContain('Claude work');
        expect(html).toContain('ccg-switch');
        expect(html).toContain('Running');
        expect(html).toContain('New chat');
        expect(html).toContain('Close tab');
        expect(html).not.toContain('chat.sessionTabs.');
    });

    it('keeps many tabs in a compressed single row without horizontal scroll chrome', () => {
        const tabs = Array.from({length: 12}, (_, index) => createTab({
            key: `session:${index}`,
            activeSession: {
                providerId: index % 2 === 0 ? 'claude' : 'codex',
                sessionId: `session-${index}`,
                title: `Long conversation ${index}`,
                summary: null,
                projectDir: `C:/workspace/project-${index}`,
                createdAt: index,
                lastActiveAt: index,
                sourcePath: `C:/sessions/${index}.jsonl`,
                resumeCommand: null,
            },
            status: index === 1 ? 'running' : 'idle',
        }));

        const html = renderToStaticMarkup(createElement(
            I18nextProvider,
            {i18n: createKeyOnlyI18n()},
            createElement(ChatSessionTabs, {
                tabs,
                activeTabKey: 'session:0',
                onFocusTab: () => undefined,
                onCloseTab: () => undefined,
                onCloseOtherTabs: () => undefined,
                onCloseAllTabs: () => undefined,
            }),
        ));

        expect(html).toContain('chat-session-tabs-strip');
        expect(html).toContain('overflow-hidden');
        expect(html).toContain('max-w-56');
        expect(html).toContain('w-44');
        expect(html).not.toContain('flex-1 basis-0');
        expect(html).not.toContain('overflow-x-auto');
        expect(html).not.toContain('shrink-0 items-center gap-1.5 rounded-t-md border px-2 text-xs');
        // 工作中的 tab 用旋转 loading 指示（lucide Loader2 + animate-spin）。
        expect(html).toContain('animate-spin');
        expect(html).not.toContain('>Running<');
    });

    it('opens a right-click menu for closing other tabs or all tabs', async () => {
        const closeOtherTabs = vi.fn();
        const closeAllTabs = vi.fn();
        container = document.createElement('div');
        document.body.appendChild(container);
        const rendered = container;
        root = createRoot(container);

        await act(async () => {
            root?.render(createElement(
                I18nextProvider,
                {i18n: createKeyOnlyI18n()},
                createElement(ChatSessionTabs, {
                    tabs: [
                        createTab({key: 'session:a'}),
                        createTab({key: 'session:b'}),
                    ],
                    activeTabKey: 'session:a',
                    onFocusTab: () => undefined,
                    onCloseTab: () => undefined,
                    onCloseOtherTabs: closeOtherTabs,
                    onCloseAllTabs: closeAllTabs,
                }),
            ));
        });

        const tab = rendered.querySelector('[data-chat-session-tab-key="session:a"]');
        expect(tab).toBeInstanceOf(HTMLElement);

        await act(async () => {
            tab?.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 24,
                clientY: 32,
            }));
        });

        const closeOtherButton = rendered.querySelector('[data-chat-session-tab-menu-action="close-others"]');
        const closeAllButton = rendered.querySelector('[data-chat-session-tab-menu-action="close-all"]');
        expect(closeOtherButton).toBeInstanceOf(HTMLButtonElement);
        expect(closeAllButton).toBeInstanceOf(HTMLButtonElement);
        expect(rendered.textContent).toContain('Close other tabs');
        expect(rendered.textContent).toContain('Close all tabs');

        await act(async () => {
            closeOtherButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
        });
        expect(closeOtherTabs).toHaveBeenCalledWith('session:a');

        await act(async () => {
            tab?.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 24,
                clientY: 32,
            }));
        });
        await act(async () => {
            rendered.querySelector('[data-chat-session-tab-menu-action="close-all"]')
                ?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
        });
        expect(closeAllTabs).toHaveBeenCalledTimes(1);
    });
});
