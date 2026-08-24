// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import MarkdownBlock from './MarkdownBlock';

vi.mock('dompurify', () => ({
    default: {
        sanitize: (html: string) => html,
    },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

(
    globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
).IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

function render(content: string, isStreaming: boolean): HTMLDivElement {
    if (!activeContainer) {
        activeContainer = document.createElement('div');
        document.body.appendChild(activeContainer);
        activeRoot = createRoot(activeContainer);
    }

    act(() => {
        activeRoot!.render(<MarkdownBlock content={content} isStreaming={isStreaming} />);
    });

    return activeContainer;
}

afterEach(() => {
    if (activeRoot) {
        const root = activeRoot;
        act(() => root.unmount());
    }
    activeContainer?.remove();
    activeRoot = null;
    activeContainer = null;
});

const FIVE_BLOCKS = '第一段\n\n第二段\n\n第三段\n\n第四段\n\n第五段';

describe('MarkdownBlock 增量渲染', () => {
    it('流式期间按块切分为多个 fragment', () => {
        const container = render(FIVE_BLOCKS, true);

        expect(container.querySelectorAll('.markdown-fragment')).toHaveLength(5);
    });

    it('完成态收敛为单一 fragment', () => {
        const container = render(FIVE_BLOCKS, false);

        expect(container.querySelectorAll('.markdown-fragment')).toHaveLength(1);
        expect(container.querySelectorAll('p')).toHaveLength(5);
    });

    it('追加文本不重建冻结块的 DOM 节点（选区因此不会丢失）', () => {
        const container = render(FIVE_BLOCKS, true);
        const frozenParagraphs = Array.from(container.querySelectorAll('p')).slice(0, 3);

        expect(frozenParagraphs).toHaveLength(3);

        render(`${FIVE_BLOCKS}\n\n第六段`, true);
        const nextParagraphs = Array.from(container.querySelectorAll('p'));

        // 前三块已冻结：必须是同一批 DOM 实例，而不是重建出来的新节点
        frozenParagraphs.forEach((paragraph, index) => {
            expect(nextParagraphs[index]).toBe(paragraph);
            expect(paragraph.isConnected).toBe(true);
        });
        expect(nextParagraphs).toHaveLength(6);
    });

    it('逐字追加尾部块时冻结块依然保持同一实例', () => {
        const container = render(FIVE_BLOCKS, true);
        const firstParagraph = container.querySelector('p');

        for (const suffix of ['扩', '扩写', '扩写中']) {
            render(`${FIVE_BLOCKS}${suffix}`, true);
            expect(container.querySelector('p')).toBe(firstParagraph);
        }
    });

    it('未闭合的代码块在流式期间被补全，不吞掉后续内容', () => {
        const container = render('前言\n\n```ts\nconst a = 1;', true);

        expect(container.querySelectorAll('pre')).toHaveLength(1);
        expect(container.textContent).toContain('前言');
        expect(container.textContent).toContain('const a = 1;');
    });

    it('代码块被包上语言标签头栏与复制按钮', () => {
        const container = render('```ts\nconst a = 1;\n```', false);
        const frame = container.querySelector('.code-block-frame');

        expect(frame).not.toBeNull();
        expect(frame?.querySelector('.code-block-lang')?.textContent).toBe('ts');
        expect(frame?.querySelector('.copy-button')).not.toBeNull();
    });
});
