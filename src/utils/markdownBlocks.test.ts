import {describe, expect, it} from 'vitest';
import {splitMarkdownBlocks, UNSTABLE_TAIL_BLOCKS} from './markdownBlocks';

describe('splitMarkdownBlocks', () => {
    it('空内容不产生块', () => {
        expect(splitMarkdownBlocks('')).toEqual([]);
        expect(splitMarkdownBlocks('   \n\n  \n')).toEqual([]);
    });

    it('按空行切分段落', () => {
        const blocks = splitMarkdownBlocks('第一段\n\n第二段\n\n第三段');

        expect(blocks.map((block) => block.text.trim())).toEqual(['第一段', '第二段', '第三段']);
    });

    it('块文本拼接后等于原文（跳过首块前的空白）', () => {
        const source = '\n\n开头\n\n中间\n\n结尾\n';
        const blocks = splitMarkdownBlocks(source);

        expect(blocks.map((block) => block.text).join('')).toBe(source.slice(Number(blocks[0].key)));
    });

    it('未闭合 fence 吞到文末，永远是最后一块且不冻结', () => {
        const blocks = splitMarkdownBlocks('前言\n\n```ts\nconst a = 1;\n\nconst b = 2;');

        expect(blocks).toHaveLength(2);
        expect(blocks[1].text).toContain('const b = 2;');
        expect(blocks[1].frozen).toBe(false);
    });

    it('闭合 fence 自成一块，其后内容即使无空行也属下一块', () => {
        const blocks = splitMarkdownBlocks('```js\ncode\n```\n紧跟的段落\n\nA\n\nB');

        expect(blocks[0].text).toContain('```js');
        expect(blocks[0].text).toContain('```\n');
        expect(blocks[1].text.trim()).toBe('紧跟的段落');
    });

    it('波浪号 fence 与反引号 fence 不互相闭合', () => {
        const blocks = splitMarkdownBlocks('~~~\n```\n还在块里\n~~~\n\n之后');

        expect(blocks[0].text).toContain('还在块里');
        expect(blocks[1].text.trim()).toBe('之后');
    });

    it('info string 含反引号的行不算开 fence', () => {
        const blocks = splitMarkdownBlocks('``` `inline` \n\n下一段');

        // 不是 fence 起始 → 空行照常切块
        expect(blocks).toHaveLength(2);
        expect(blocks[1].text.trim()).toBe('下一段');
    });

    it(`只冻结倒数 ${UNSTABLE_TAIL_BLOCKS} 块之前的块`, () => {
        const blocks = splitMarkdownBlocks('A\n\nB\n\nC\n\nD\n\nE');

        expect(blocks.map((block) => block.frozen)).toEqual([true, true, true, false, false]);
    });

    it('块数不超过尾部余量时全部不冻结', () => {
        expect(splitMarkdownBlocks('A\n\nB').every((block) => !block.frozen)).toBe(true);
    });

    it('追加文本不改变已冻结块的 key 与文本（冻结不变性）', () => {
        const base = 'A 段\n\n```ts\nconst x = 1;\n```\n\nC 段\n\nD 段';
        const frozenSnapshot = splitMarkdownBlocks(base)
            .filter((block) => block.frozen)
            .map((block) => `${block.key}:${block.text}`);

        // 逐字符追加，模拟流式；每一步的冻结块必须是上一步的超集前缀
        let grown = base;
        for (const chunk of ['\n', '\nE', ' 段', '\n\nF 段', '\n\n```py\nprint(1)\n```']) {
            grown += chunk;
            const nextFrozen = splitMarkdownBlocks(grown)
                .filter((block) => block.frozen)
                .map((block) => `${block.key}:${block.text}`);

            expect(nextFrozen.slice(0, frozenSnapshot.length)).toEqual(frozenSnapshot);
        }
    });

    it('key 是源码绝对起始偏移', () => {
        const source = 'AB\n\nCD';
        const blocks = splitMarkdownBlocks(source);

        expect(blocks[0].key).toBe('0');
        expect(source.slice(Number(blocks[1].key))).toBe('CD');
    });
});
