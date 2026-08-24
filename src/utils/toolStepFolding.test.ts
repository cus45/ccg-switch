import {describe, expect, it} from 'vitest';
import type {ContentBlock, ToolUseBlock} from '../types/chat';
import type {GroupedBlock} from './toolGrouping';
import {
    planToolStepFold,
    TOOL_STEP_FOLD_THRESHOLD,
    TOOL_STEP_KEEP_HEAD,
    TOOL_STEP_KEEP_TAIL,
} from './toolStepFolding';

function toolEntry(index: number): GroupedBlock {
    return {
        type: 'single',
        originalIndex: index,
        block: {type: 'tool_use', id: `t${index}`, name: 'Read', input: {}} as ContentBlock,
    };
}

function textEntry(index: number): GroupedBlock {
    return {
        type: 'single',
        originalIndex: index,
        block: {type: 'text', text: `段落 ${index}`} as ContentBlock,
    };
}

function groupEntry(index: number): GroupedBlock {
    return {
        type: 'group',
        toolType: 'read',
        startIndex: index,
        blocks: [{type: 'tool_use', id: `g${index}`, name: 'Read', input: {}} as ToolUseBlock],
    };
}

function toolEntries(count: number): GroupedBlock[] {
    return Array.from({length: count}, (_, index) => toolEntry(index));
}

describe('planToolStepFold', () => {
    it('工具条目未超阈值时不折叠', () => {
        const plan = planToolStepFold(toolEntries(TOOL_STEP_FOLD_THRESHOLD), false);

        expect(plan.chipAtIndex).toBeNull();
        expect(plan.foldedCount).toBe(0);
        expect(plan.hiddenIndices.size).toBe(0);
    });

    it('超过阈值时折叠中间部分，保留首尾', () => {
        const total = TOOL_STEP_FOLD_THRESHOLD + 5;
        const plan = planToolStepFold(toolEntries(total), false);

        expect(plan.foldedCount).toBe(total - TOOL_STEP_KEEP_HEAD - TOOL_STEP_KEEP_TAIL);
        expect(plan.chipAtIndex).toBe(TOOL_STEP_KEEP_HEAD);
        // 开头保留
        for (let index = 0; index < TOOL_STEP_KEEP_HEAD; index += 1) {
            expect(plan.hiddenIndices.has(index)).toBe(false);
        }
        // 结尾保留
        for (let index = total - TOOL_STEP_KEEP_TAIL; index < total; index += 1) {
            expect(plan.hiddenIndices.has(index)).toBe(false);
        }
    });

    it('已展开时一律不折叠', () => {
        const plan = planToolStepFold(toolEntries(TOOL_STEP_FOLD_THRESHOLD + 10), true);

        expect(plan.chipAtIndex).toBeNull();
        expect(plan.hiddenIndices.size).toBe(0);
    });

    it('文本块永不被折叠，即使夹在中间', () => {
        const entries: GroupedBlock[] = [
            ...toolEntries(4),
            textEntry(100),
            ...Array.from({length: 8}, (_, index) => toolEntry(200 + index)),
        ];
        const textIndex = entries.findIndex(
            (entry) => entry.type === 'single' && entry.block.type === 'text',
        );

        const plan = planToolStepFold(entries, false);

        expect(plan.foldedCount).toBeGreaterThan(0);
        expect(plan.hiddenIndices.has(textIndex)).toBe(false);
    });

    it('分组条目也算作一个工具步骤', () => {
        const entries: GroupedBlock[] = Array.from(
            {length: TOOL_STEP_FOLD_THRESHOLD + 3},
            (_, index) => (index % 2 === 0 ? groupEntry(index) : toolEntry(index)),
        );

        const plan = planToolStepFold(entries, false);

        expect(plan.foldedCount).toBe(entries.length - TOOL_STEP_KEEP_HEAD - TOOL_STEP_KEEP_TAIL);
    });

    it('没有工具条目时不折叠', () => {
        const plan = planToolStepFold([textEntry(0), textEntry(1)], false);

        expect(plan.chipAtIndex).toBeNull();
    });
});
