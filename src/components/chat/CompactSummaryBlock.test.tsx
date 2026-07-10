import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import CompactSummaryBlock from './CompactSummaryBlock';

const mockUseState = vi.hoisted(() => vi.fn());

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        useState: mockUseState,
    };
});

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => (
            options && 'count' in options ? `${key}:${String(options.count)}` : key
        ),
    }),
}));

// MarkdownBlock 依赖 marked/hljs，摘要卡测试只关心是否透传内容
vi.mock('./MarkdownBlock', () => ({
    default: ({content}: {content: string}) => createElement('div', {'data-testid': 'summary-markdown'}, content),
}));

beforeEach(() => {
    mockUseState.mockReset();
});

function mockComponentState(expanded: boolean) {
    let calls = 0;
    mockUseState.mockImplementation((initial: unknown) => {
        calls += 1;
        // 第 1 个 useState 是 expanded，第 2 个是 copied
        return [calls === 1 ? expanded : initial, vi.fn()];
    });
}

const SUMMARY = 'This session is being continued from a previous conversation. Analysis: 我们完成了三项升级……';

describe('CompactSummaryBlock', () => {
    it('collapsed by default: title + char count + single-line preview, no full body', () => {
        mockComponentState(false);
        const html = renderToStaticMarkup(createElement(CompactSummaryBlock, {content: SUMMARY}));

        expect(html).toContain('Compacted context summary');
        expect(html).toContain(`chat.compactSummary.charCount:${SUMMARY.length}`);
        expect(html).toContain('aria-expanded="false"');
        expect(html).not.toContain('summary-markdown');
    });

    it('expanded: renders full markdown body', () => {
        mockComponentState(true);
        const html = renderToStaticMarkup(createElement(CompactSummaryBlock, {content: SUMMARY}));

        expect(html).toContain('aria-expanded="true"');
        expect(html).toContain('summary-markdown');
        expect(html).toContain('我们完成了三项升级');
    });
});
