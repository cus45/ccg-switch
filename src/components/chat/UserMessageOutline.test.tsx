// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserMessageOutline from './UserMessageOutline';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback?: string) => fallback ?? _key,
    }),
}));

describe('UserMessageOutline', () => {
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

    it('renders null when anchors list is empty', async () => {
        await act(async () => {
            root?.render(createElement(UserMessageOutline, { anchors: [], onSelectAnchor: () => undefined }));
        });

        expect(container?.firstChild).toBeNull();
    });

    it('renders anchor button with count badge and opens popover on click', async () => {
        const handleSelect = vi.fn();
        const anchors = [
            { id: 'turn-1', label: 'First user prompt', sequence: 1, total: 2 },
            { id: 'turn-2', label: 'Second user prompt', sequence: 2, total: 2 },
        ];

        await act(async () => {
            root?.render(
                createElement(UserMessageOutline, {
                    anchors,
                    activeAnchorId: 'turn-1',
                    onSelectAnchor: handleSelect,
                })
            );
        });

        expect(container?.textContent).toContain('2');

        const triggerButton = container?.querySelector('button');
        expect(triggerButton).toBeDefined();

        // Click to open popover
        await act(async () => {
            triggerButton?.click();
        });

        expect(container?.textContent).toContain('First user prompt');
        expect(container?.textContent).toContain('Second user prompt');

        // Click an item in the outline
        const turnButtons = container?.querySelectorAll('[role="dialog"] button') ?? [];
        const secondTurnButton = Array.from(turnButtons).find((b) => b.textContent?.includes('Second user prompt'));
        expect(secondTurnButton).toBeDefined();

        await act(async () => {
            (secondTurnButton as HTMLButtonElement | undefined)?.click();
        });

        expect(handleSelect).toHaveBeenCalledWith('turn-2');
    });
});
