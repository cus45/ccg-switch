import {describe, expect, it} from 'vitest';
import {
    BOTTOM_FOLLOW_THRESHOLD,
    getDistanceFromBottom,
    isFollowDetachIntent,
    isNearBottom,
    nextUnreadCount,
    resolveFollowScrollBehavior,
} from './chatScrollFollow';

function metrics(scrollTop: number, scrollHeight = 2000, clientHeight = 600) {
    return {scrollTop, scrollHeight, clientHeight};
}

describe('getDistanceFromBottom', () => {
    it('底部对齐时距离为 0', () => {
        expect(getDistanceFromBottom(metrics(1400))).toBe(0);
    });

    it('顶部时距离等于可滚动高度', () => {
        expect(getDistanceFromBottom(metrics(0))).toBe(1400);
    });
});

describe('isNearBottom', () => {
    it('阈值以内算在底部区域', () => {
        expect(isNearBottom(metrics(1400 - (BOTTOM_FOLLOW_THRESHOLD - 1)))).toBe(true);
    });

    it('刚好等于阈值不算（严格小于）', () => {
        expect(isNearBottom(metrics(1400 - BOTTOM_FOLLOW_THRESHOLD))).toBe(false);
    });

    it('内容不足一屏时恒为 true', () => {
        expect(isNearBottom(metrics(0, 400, 600))).toBe(true);
    });
});

describe('isFollowDetachIntent', () => {
    it('滚轮上滚是脱离意图', () => {
        expect(isFollowDetachIntent({type: 'wheel', deltaY: -120})).toBe(true);
    });

    it('滚轮下滚不是脱离意图', () => {
        expect(isFollowDetachIntent({type: 'wheel', deltaY: 120})).toBe(false);
    });

    it('触摸拖动一律视为接管', () => {
        expect(isFollowDetachIntent({type: 'touchmove'})).toBe(true);
    });

    it.each(['PageUp', 'ArrowUp', 'Home'])('%s 是脱离意图', (key) => {
        expect(isFollowDetachIntent({type: 'keydown', key})).toBe(true);
    });

    it.each(['PageDown', 'ArrowDown', 'End', 'a'])('%s 不是脱离意图', (key) => {
        expect(isFollowDetachIntent({type: 'keydown', key})).toBe(false);
    });

    it('scroll 事件永远不算（分不清程序滚动与用户滚动）', () => {
        expect(isFollowDetachIntent({type: 'scroll'})).toBe(false);
    });
});

describe('resolveFollowScrollBehavior', () => {
    it('流式期间不用平滑滚动，避免动画互相打断', () => {
        expect(resolveFollowScrollBehavior(true)).toBe('instant');
    });

    it('非流式用平滑滚动', () => {
        expect(resolveFollowScrollBehavior(false)).toBe('smooth');
    });
});

describe('nextUnreadCount', () => {
    it('跟随中恒为 0', () => {
        expect(nextUnreadCount({following: true, previousCount: 3, nextCount: 9, currentUnread: 5})).toBe(0);
    });

    it('脱离跟随后累加新增条数', () => {
        expect(nextUnreadCount({following: false, previousCount: 3, nextCount: 6, currentUnread: 2})).toBe(5);
    });

    it('条数不变时保持原值', () => {
        expect(nextUnreadCount({following: false, previousCount: 6, nextCount: 6, currentUnread: 2})).toBe(2);
    });

    it('条数减少（切会话/清空）不倒扣', () => {
        expect(nextUnreadCount({following: false, previousCount: 20, nextCount: 3, currentUnread: 4})).toBe(4);
    });
});
