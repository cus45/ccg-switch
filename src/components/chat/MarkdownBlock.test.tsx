import {describe, expect, it} from 'vitest';
import {containsMathSyntax, getMarkdownCodeCopyLabels} from './MarkdownBlock';

describe('MarkdownBlock', () => {
    it('keeps code-copy labels readable when i18n keys are unavailable', () => {
        const labels = getMarkdownCodeCopyLabels((key) => key);

        expect(labels.copyCodeLabel).toBe('Copy code');
        expect(labels.copiedCodeLabel).toBe('Copied code');
    });

    it('uses translated code-copy labels when i18n provides them', () => {
        const labels = getMarkdownCodeCopyLabels((key) => {
            if (key === 'chat.markdown.copyCode') return '复制代码';
            if (key === 'chat.markdown.copiedCode') return '已复制代码';
            return key;
        });

        expect(labels.copyCodeLabel).toBe('复制代码');
        expect(labels.copiedCodeLabel).toBe('已复制代码');
    });
});

describe('containsMathSyntax', () => {
    it('detects block and inline math', () => {
        expect(containsMathSyntax('公式：$$\\frac{a}{b}$$')).toBe(true);
        expect(containsMathSyntax('质能方程 $E=mc^2$ 很有名')).toBe(true);
    });

    it('does not treat currency amounts as math', () => {
        expect(containsMathSyntax('价格 $5 和 $10 都可以')).toBe(false);
        expect(containsMathSyntax('总计 $1,200')).toBe(false);
        expect(containsMathSyntax('no dollars here')).toBe(false);
    });
});
