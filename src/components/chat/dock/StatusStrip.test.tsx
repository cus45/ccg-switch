import {describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import StatusStrip from './StatusStrip';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

const baseProps = {
    daemonIndicatorClass: 'bg-success',
    daemonStatusText: 'Ready',
    contextPercentage: 25,
    contextUsedTokens: 50000,
    contextMaxTokens: 200000,
    provider: 'claude',
    messageCount: 3,
    daemonReady: true,
};

describe('StatusStrip', () => {
    it('renders the compact daemon status and context usage', () => {
        const html = renderToStaticMarkup(<StatusStrip {...baseProps} />);

        expect(html).toContain('Ready');
        expect(html).toContain('bg-success');
        expect(html).toContain('25%');
    });

    it('keeps the diagnostics drawer collapsed by default with a readable toggle', () => {
        const html = renderToStaticMarkup(<StatusStrip {...baseProps} />);

        expect(html).toContain('aria-expanded="false"');
        expect(html).toMatch(/Show diagnostics|查看诊断/);
        expect(html).not.toMatch(/Hide diagnostics|收起诊断/);
    });
});
