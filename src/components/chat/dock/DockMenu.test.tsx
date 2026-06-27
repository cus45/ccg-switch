import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import DockMenu from './DockMenu';

describe('DockMenu', () => {
    it('always offers the files card with a readable fallback label', () => {
        const html = renderToStaticMarkup(
            <DockMenu isGit={false} onOpenFiles={() => undefined} onOpenReview={() => undefined} />,
        );

        expect(html).toContain('Files');
        expect(html).toContain('Browse the workspace file tree');
    });

    it('hides the review card when the workspace is not a Git repository', () => {
        const html = renderToStaticMarkup(
            <DockMenu isGit={false} onOpenFiles={() => undefined} onOpenReview={() => undefined} />,
        );

        expect(html).not.toContain('Inspect Git working-tree changes');
    });

    it('shows the review card when the workspace is a Git repository', () => {
        const html = renderToStaticMarkup(
            <DockMenu isGit onOpenFiles={() => undefined} onOpenReview={() => undefined} />,
        );

        expect(html).toContain('Review');
        expect(html).toContain('Inspect Git working-tree changes');
    });
});
