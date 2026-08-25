import {describe, expect, it} from 'vitest';
import {resolveDraftHistoryNavigation} from './ChatComposer';

function nav(overrides: Partial<Parameters<typeof resolveDraftHistoryNavigation>[0]> = {}) {
    return resolveDraftHistoryNavigation({
        direction: 'previous',
        historyLength: 3,
        cursor: null,
        text: '',
        caretOffset: 0,
        ...overrides,
    });
}

describe('resolveDraftHistoryNavigation', () => {
    it('没有历史时不接管按键', () => {
        expect(nav({historyLength: 0})).toEqual({kind: 'ignore'});
    });

    it('空草稿时上箭头回到最近一条', () => {
        expect(nav()).toEqual({kind: 'apply', index: 2});
    });

    it('用户自己写了草稿时不接管，方向键归光标移动', () => {
        expect(nav({text: '我在写东西', caretOffset: 5})).toEqual({kind: 'ignore'});
    });

    // 回归：原判定只看「草稿为空」，而回填历史本身就把草稿填满了，
    // 于是第二次上箭头被拒——上箭头历史只能回退一步。
    it('已在浏览历史时可以继续往前翻', () => {
        expect(nav({cursor: 2, text: '第三条', caretOffset: 3})).toEqual({kind: 'apply', index: 1});
        expect(nav({cursor: 1, text: '第二条', caretOffset: 3})).toEqual({kind: 'apply', index: 0});
    });

    it('翻到最早一条后吞掉按键，不让光标跳走也不越界', () => {
        expect(nav({cursor: 0, text: '第一条', caretOffset: 3})).toEqual({kind: 'consume'});
    });

    it('下箭头逐条回到更近的历史', () => {
        expect(nav({direction: 'next', cursor: 0, text: '第一条', caretOffset: 3}))
            .toEqual({kind: 'apply', index: 1});
    });

    it('下箭头翻过最新一条后回到空草稿', () => {
        expect(nav({direction: 'next', cursor: 2, text: '第三条', caretOffset: 3}))
            .toEqual({kind: 'apply', index: null});
    });

    it('未在浏览历史时下箭头不接管', () => {
        expect(nav({direction: 'next'})).toEqual({kind: 'ignore'});
    });

    describe('多行草稿里方向键先归光标移动', () => {
        const multiline = '第一行\n第二行\n第三行';
        const secondLineCaret = 5; // 落在「第二行」中间

        it('光标不在首行时上箭头不翻历史', () => {
            expect(nav({cursor: 1, text: multiline, caretOffset: secondLineCaret}))
                .toEqual({kind: 'ignore'});
        });

        it('光标已在首行时上箭头翻历史', () => {
            expect(nav({cursor: 1, text: multiline, caretOffset: 1}))
                .toEqual({kind: 'apply', index: 0});
        });

        it('光标不在末行时下箭头不翻历史', () => {
            expect(nav({direction: 'next', cursor: 1, text: multiline, caretOffset: secondLineCaret}))
                .toEqual({kind: 'ignore'});
        });

        it('光标已在末行时下箭头翻历史', () => {
            expect(nav({
                direction: 'next',
                cursor: 1,
                text: multiline,
                caretOffset: multiline.length,
            })).toEqual({kind: 'apply', index: 2});
        });
    });
});
