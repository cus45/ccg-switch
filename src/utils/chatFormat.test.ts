import {describe, expect, it} from 'vitest';
import type {ContentBlock, ToolResultBlock} from '../types/chat';
import {
    formatDurationClock,
    formatDurationHuman,
    formatTokenCount,
    resolveTurnActivity,
} from './chatFormat';

describe('formatDurationClock', () => {
    it.each([
        [0, '0:00'],
        [1_000, '0:01'],
        [61_000, '1:01'],
        [3_600_000, '1:00:00'],
        [3_723_000, '1:02:03'],
    ])('%i ms → %s', (ms, expected) => {
        expect(formatDurationClock(ms)).toBe(expected);
    });

    it('负数按 0 处理', () => {
        expect(formatDurationClock(-5_000)).toBe('0:00');
    });
});

describe('formatDurationHuman', () => {
    it.each([
        [0, '0.0s'],
        [12_340, '12.3s'],
        [59_900, '59.9s'],
        [60_000, '1m 00s'],
        [125_000, '2m 05s'],
        [3_900_000, '1h 05m'],
    ])('%i ms → %s', (ms, expected) => {
        expect(formatDurationHuman(ms)).toBe(expected);
    });
});

describe('formatTokenCount', () => {
    it.each([
        [0, '0'],
        [999, '999'],
        [1_234, '1.2K'],
        [1_234_567, '1.2M'],
    ])('%i → %s', (count, expected) => {
        expect(formatTokenCount(count)).toBe(expected);
    });
});

describe('resolveTurnActivity', () => {
    const toolUse = (id: string, name: string): ContentBlock => ({
        type: 'tool_use',
        id,
        name,
        input: {},
    } as ContentBlock);
    const result = (id: string): ToolResultBlock => ({
        type: 'tool_result',
        tool_use_id: id,
        content: 'ok',
    } as ToolResultBlock);

    it('没有工具调用时无活动工具', () => {
        const activity = resolveTurnActivity(
            [{type: 'text', text: '普通回复'} as ContentBlock],
            () => null,
        );

        expect(activity).toEqual({activeToolName: null, completedToolCount: 0, totalToolCount: 0});
    });

    it('最后一个没有结果的工具就是正在跑的那个', () => {
        const blocks = [toolUse('t1', 'Read'), toolUse('t2', 'Bash')];
        const results = new Map([['t1', result('t1')]]);

        const activity = resolveTurnActivity(blocks, (id) => results.get(id) ?? null);

        expect(activity).toEqual({activeToolName: 'Bash', completedToolCount: 1, totalToolCount: 2});
    });

    it('全部有结果时说明已回到文本生成', () => {
        const blocks = [toolUse('t1', 'Read'), toolUse('t2', 'Bash')];

        const activity = resolveTurnActivity(blocks, (id) => result(id));

        expect(activity).toEqual({activeToolName: null, completedToolCount: 2, totalToolCount: 2});
    });

    it('多个未完成时取最新发起的那个', () => {
        const blocks = [toolUse('t1', 'Read'), toolUse('t2', 'Grep'), toolUse('t3', 'Edit')];

        const activity = resolveTurnActivity(blocks, () => null);

        expect(activity.activeToolName).toBe('Edit');
        expect(activity.completedToolCount).toBe(0);
        expect(activity.totalToolCount).toBe(3);
    });
});
