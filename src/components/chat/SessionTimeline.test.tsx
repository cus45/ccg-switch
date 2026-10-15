// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../types/chat';
import SessionTimeline from './SessionTimeline';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../components/common/ToastContainer', () => ({
    showToast: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`,
    invoke: vi.fn(),
}));

vi.mock('dompurify', () => ({
    default: {
        sanitize: (html: string) => html,
    },
}));

vi.mock('react-i18next', () => ({
    initReactI18next: {
        type: '3rdParty',
        init: () => undefined,
    },
    useTranslation: () => ({
        t: (key: string, optionsOrFallback?: unknown) => {
            if (typeof optionsOrFallback === 'string') {
                return optionsOrFallback;
            }
            if (optionsOrFallback && typeof optionsOrFallback === 'object' && 'count' in optionsOrFallback) {
                return `${key}:${(optionsOrFallback as { count: unknown }).count}`;
            }
            return key;
        },
    }),
}));

describe('SessionTimeline', () => {
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
        if (container) {
            container.remove();
            container = null;
        }
    });

    it('renders empty timeline cleanly without errors', () => {
        act(() => {
            root?.render(createElement(SessionTimeline, { messages: [] }));
        });

        expect(container?.querySelector('.session-timeline')).not.toBeNull();
    });

    it('renders user and assistant messages in flow mode when under threshold', () => {
        const messages: ChatMessage[] = [
            {
                id: 'msg-u1',
                role: 'user',
                content: 'Hello Antigravity',
                createdAt: 1000,
            },
            {
                id: 'msg-a1',
                role: 'assistant',
                content: 'Hello Developer',
                createdAt: 2000,
                durationMs: 250,
            },
        ];

        act(() => {
            root?.render(
                createElement(SessionTimeline, {
                    messages,
                    virtualizedThreshold: 10,
                }),
            );
        });

        expect(container?.textContent).toContain('Hello Antigravity');
        expect(container?.textContent).toContain('Hello Developer');
    });

    it('activates virtualized container when timeline exceeds threshold', () => {
        // Create 15 messages when threshold is 5
        const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
            id: `msg-${i}`,
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Message content ${i}`,
            createdAt: 1000 + i * 100,
        }));

        act(() => {
            root?.render(
                createElement(SessionTimeline, {
                    messages,
                    virtualizedThreshold: 5,
                }),
            );
        });

        const timelineEl = container?.querySelector('.session-timeline');
        expect(timelineEl).not.toBeNull();
    });

    it('renders earlier history load button when hasEarlierServerHistory is true', () => {
        const onLoadEarlier = vi.fn();

        act(() => {
            root?.render(
                createElement(SessionTimeline, {
                    messages: [],
                    hasEarlierServerHistory: true,
                    onLoadEarlierServerHistory: onLoadEarlier,
                }),
            );
        });

        const btn = container?.querySelector('button');
        expect(btn).not.toBeNull();
        expect(btn?.textContent).toContain('Load earlier history from this session');

        act(() => {
            btn?.click();
        });

        expect(onLoadEarlier).toHaveBeenCalledTimes(1);
    });

    it('renders search results header when searchQuery is provided', () => {
        const messages: ChatMessage[] = [
            {
                id: 'msg-1',
                role: 'user',
                content: 'Searchable keyword here',
                createdAt: 1000,
            },
        ];

        act(() => {
            root?.render(
                createElement(SessionTimeline, {
                    messages,
                    searchQuery: 'keyword',
                }),
            );
        });

        expect(container?.textContent).toContain('chat.layout.searchResults');
    });
});
