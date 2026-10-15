// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCall } from '../../../types/timeline';
import ToolCallCard, { stripAnsi } from './ToolCallCard';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../utils/bridge', () => ({
    copyToClipboard: vi.fn(),
    openFile: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    initReactI18next: {
        type: '3rdParty',
        init: () => undefined,
    },
    useTranslation: () => ({
        t: (key: string, optionsOrFallback?: unknown) => {
            if (typeof optionsOrFallback === 'string') return optionsOrFallback;
            return key;
        },
    }),
}));

describe('stripAnsi', () => {
    it('removes ANSI color codes from terminal output', () => {
        const raw = '\x1b[32mSUCCESS\x1b[0m: built in \x1b[1m12ms\x1b[0m';
        expect(stripAnsi(raw)).toBe('SUCCESS: built in 12ms');
    });
});

describe('ToolCallCard', () => {
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

    it('renders execute/bash tool call with command and exit code badge', () => {
        const toolCall: ToolCall = {
            callId: 'call-bash-1',
            name: 'bash',
            kind: 'bash',
            input: { command: 'cargo test' },
            result: {
                type: 'tool_result',
                tool_use_id: 'call-bash-1',
                content: JSON.stringify({ exit_code: 0, stdout: 'test result: ok. 10 passed' }),
            },
            status: 'complete',
        };

        act(() => {
            root?.render(createElement(ToolCallCard, { toolCall }));
        });

        expect(container?.textContent).toContain('cargo test');
        expect(container?.textContent).toContain('Exit 0');

        // Toggle expand
        const btn = container?.querySelector('button');
        act(() => {
            btn?.click();
        });

        expect(container?.textContent).toContain('Terminal Output');
        expect(container?.textContent).toContain('test result: ok. 10 passed');
    });

    it('renders edit tool call with diff stats badge and toggles diff view', () => {
        const toolCall: ToolCall = {
            callId: 'call-edit-1',
            name: 'edit',
            kind: 'edit',
            input: {
                target_file: 'src/main.rs',
                old_string: 'fn old() {}',
                new_string: 'fn new() {}',
            },
            result: {
                type: 'tool_result',
                tool_use_id: 'call-edit-1',
                content: 'File updated successfully',
            },
            status: 'complete',
        };

        act(() => {
            root?.render(createElement(ToolCallCard, { toolCall }));
        });

        expect(container?.textContent).toContain('src/main.rs');

        // Toggle to open diff preview
        const btn = container?.querySelector('button');
        act(() => {
            btn?.click();
        });

        expect(container?.textContent).toContain('src/main.rs');
        expect(container?.textContent).toContain('Copy');
    });

    it('renders todo items cleanly', () => {
        const toolCall: ToolCall = {
            callId: 'call-todo-1',
            name: 'todowrite',
            kind: 'todo',
            input: {
                todos: [
                    { content: 'Implement Phase 3', status: 'in_progress' },
                    { content: 'Verify tests', status: 'completed' },
                    { content: 'Deploy production', status: 'pending' },
                ],
            },
            status: 'complete',
        };

        act(() => {
            root?.render(createElement(ToolCallCard, { toolCall }));
        });

        const btn = container?.querySelector('button');
        act(() => {
            btn?.click();
        });

        expect(container?.textContent).toContain('Implement Phase 3');
        expect(container?.textContent).toContain('Verify tests');
        expect(container?.textContent).toContain('Deploy production');
    });

    it('memorizes expanded state in viewCache across re-renders', () => {
        const cache = { expanded: new Map<string, boolean>() };
        const toolCall: ToolCall = {
            callId: 'mem-call-1',
            name: 'bash',
            kind: 'bash',
            input: { command: 'echo hello' },
            status: 'complete',
        };

        act(() => {
            root?.render(createElement(ToolCallCard, { toolCall, viewCache: cache }));
        });

        expect(cache.expanded.get('mem-call-1')).toBeUndefined();

        const btn = container?.querySelector('button');
        act(() => {
            btn?.click();
        });

        expect(cache.expanded.get('mem-call-1')).toBe(true);

        // Re-mount new card instance with the same cache
        act(() => {
            root?.render(createElement(ToolCallCard, { toolCall, viewCache: cache }));
        });

        // Should retain expanded state
        expect(container?.textContent).toContain('Command');
    });

    it('automatically expands failed tool calls', () => {
        const toolCall: ToolCall = {
            callId: 'err-call-1',
            name: 'bash',
            kind: 'bash',
            input: { command: 'invalid command' },
            result: {
                type: 'tool_result',
                tool_use_id: 'err-call-1',
                content: JSON.stringify({ exit_code: 127, stderr: 'Command failed with exit code 127' }),
                is_error: true,
            },
            status: 'failed',
            isError: true,
        };

        act(() => {
            root?.render(createElement(ToolCallCard, { toolCall }));
        });

        // Failed card should be expanded by default to expose terminal output
        expect(container?.textContent).toContain('Exit 127');
        expect(container?.textContent).toContain('Command failed with exit code 127');
    });
});
