/**
 * 一轮回复里的「中间步骤」折叠。
 *
 * 一次复杂任务的回合常有几十个工具调用，改造前它们在转录里全部平铺，正文被
 * 冲散、滚动距离被拉长，用户想找的往往只是「开头做了什么」和「最后做了什么」。
 * 这里把中间的工具条目折成一枚可展开的 chip。
 *
 * 折叠只作用于工具类条目：文本、思考、图片一律保留可见，否则会把真正要读的
 * 内容藏起来。
 */

import type {GroupedBlock} from './toolGrouping';

/** 工具类条目超过这个数才值得折叠。 */
export const TOOL_STEP_FOLD_THRESHOLD = 8;
/** 折叠时保留的开头 / 结尾工具条目数。 */
export const TOOL_STEP_KEEP_HEAD = 2;
export const TOOL_STEP_KEEP_TAIL = 3;

export interface ToolStepFoldPlan {
    /** 需要隐藏的 groupedBlocks 下标。 */
    hiddenIndices: Set<number>;
    /** chip 插入位置（第一个被隐藏条目的下标）；null 表示不折叠。 */
    chipAtIndex: number | null;
    /** 被折叠的工具条目数，用于 chip 文案。 */
    foldedCount: number;
}

const EMPTY_PLAN: ToolStepFoldPlan = {
    hiddenIndices: new Set(),
    chipAtIndex: null,
    foldedCount: 0,
};

function isToolEntry(entry: GroupedBlock): boolean {
    if (entry.type === 'group') return true;
    return entry.block.type === 'tool_use';
}

/**
 * 计算折叠方案。
 *
 * @param groupedBlocks `groupToolBlocks` 的输出。
 * @param expanded 用户是否已点开；true 时返回空方案（全部可见）。
 */
export function planToolStepFold(
    groupedBlocks: GroupedBlock[],
    expanded: boolean,
): ToolStepFoldPlan {
    if (expanded) return EMPTY_PLAN;

    const toolIndices: number[] = [];
    groupedBlocks.forEach((entry, index) => {
        if (isToolEntry(entry)) toolIndices.push(index);
    });

    if (toolIndices.length <= TOOL_STEP_FOLD_THRESHOLD) return EMPTY_PLAN;

    const hidden = toolIndices.slice(TOOL_STEP_KEEP_HEAD, toolIndices.length - TOOL_STEP_KEEP_TAIL);
    if (hidden.length === 0) return EMPTY_PLAN;

    return {
        hiddenIndices: new Set(hidden),
        chipAtIndex: hidden[0],
        foldedCount: hidden.length,
    };
}
