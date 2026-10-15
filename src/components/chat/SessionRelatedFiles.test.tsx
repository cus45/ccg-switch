// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionRelatedFiles from './SessionRelatedFiles';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback?: string) => fallback ?? _key,
    }),
}));

describe('SessionRelatedFiles', () => {
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

    it('renders null when files list is empty', async () => {
        await act(async () => {
            root?.render(createElement(SessionRelatedFiles, { files: [], onOpenFile: () => undefined }));
        });

        expect(container?.querySelector('.session-related-files-bar')).toBeNull();
    });

    it('renders unique files with additions and deletions and handles click', async () => {
        const handleOpen = vi.fn();
        await act(async () => {
            root?.render(
                createElement(SessionRelatedFiles, {
                    files: [
                        { path: 'src/App.tsx', additions: 10, deletions: 2 },
                        { path: 'src/App.tsx', additions: 5, deletions: 0 },
                        { path: 'src/components/ToolCallCard.tsx', additions: 30, deletions: 0 },
                    ],
                    onOpenFile: handleOpen,
                })
            );
        });

        expect(container?.textContent).toContain('App.tsx');
        expect(container?.textContent).toContain('ToolCallCard.tsx');

        const buttons = container?.querySelectorAll('button') ?? [];
        const appButton = Array.from(buttons).find((b) => b.textContent?.includes('App.tsx'));
        expect(appButton).toBeDefined();

        await act(async () => {
            appButton?.click();
        });

        expect(handleOpen).toHaveBeenCalledWith('src/App.tsx');
    });

    it('toggles collapse state when header button is clicked', async () => {
        await act(async () => {
            root?.render(
                createElement(SessionRelatedFiles, {
                    files: [{ path: 'src/main.ts' }],
                    onOpenFile: () => undefined,
                })
            );
        });

        expect(container?.textContent).toContain('main.ts');
        const toggleButton = container?.querySelector('button');

        await act(async () => {
            toggleButton?.click();
        });

        expect(container?.textContent).not.toContain('main.ts');
    });
});
