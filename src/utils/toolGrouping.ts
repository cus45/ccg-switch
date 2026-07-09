import type {ContentBlock, ToolUseBlock} from '../types/chat';
import type {ToolType} from '../types/tools';
import {getToolType} from '../types/tools';
import {collectEditToolItems} from './toolPresentation';

export interface ToolExecutionStatusSource {
  isCompleted: boolean;
  isError: boolean;
}

export interface ToolExecutionStatusSummary {
  completedCount: number;
  errorCount: number;
  pendingCount: number;
}

export interface ToolExecutionStatusLabels {
  success: string;
  failed: string;
  pending: string;
}

export interface ToolGroupBulkActionState {
  allItemsExpanded: boolean;
  noItemsExpanded: boolean;
}

const TOOL_BLOCK_TOGGLE_ACTIVATION_KEYS = new Set(['Enter', ' ']);

/** 分组后的块类型 */
export type GroupedBlock =
  | { type: 'single'; block: ContentBlock; originalIndex: number }
  | { type: 'group'; toolType: ToolType; blocks: ToolUseBlock[]; startIndex: number };

/**
 * 将消息内容块按连续同类型工具分组
 * 规则：普通工具 3+ 个连续同类型工具合并为 GroupBlock；
 * Edit 工具按可见编辑项计数，2+ 个文件/编辑项即合并为列表块。
 *
 * @param blocks 原始内容块数组
 * @returns 分组后的块数组
 */
export function groupToolBlocks(blocks: ContentBlock[]): GroupedBlock[] {
  const result: GroupedBlock[] = [];
  let currentGroup: ToolUseBlock[] = [];
  let currentStartIndex = -1;
  let currentToolType: ToolType | null = null;

  const submitCurrentGroup = () => {
    const shouldGroup = currentToolType === 'edit'
      ? collectEditToolItems(currentGroup, () => null).length >= 2
      : currentGroup.length >= 3;

    if (shouldGroup && currentToolType) {
      // 分组：普通工具 3+；Edit 工具 2+ 可见编辑项
      result.push({
        type: 'group',
        toolType: currentToolType,
        blocks: currentGroup,
        startIndex: currentStartIndex,
      });
    } else {
      // 单独渲染
      currentGroup.forEach((block, idx) => {
        result.push({
          type: 'single',
          block,
          originalIndex: currentStartIndex + idx,
        });
      });
    }
    currentGroup = [];
    currentStartIndex = -1;
    currentToolType = null;
  };

  blocks.forEach((block, index) => {
    if (block.type !== 'tool_use') {
      // 非工具调用：提交当前组，添加当前块
      submitCurrentGroup();
      result.push({
        type: 'single',
        block,
        originalIndex: index,
      });
      return;
    }

    const toolType = getToolType(block.name);

    // todo 计划块始终单独渲染（每次 TodoWrite 都是完整计划快照，分组无意义）
    if (currentToolType === toolType && toolType !== 'generic' && toolType !== 'todo') {
      // 同类型工具，加入当前组
      currentGroup.push(block);
    } else {
      // 不同类型：提交当前组，开始新组
      submitCurrentGroup();
      currentGroup = [block];
      currentStartIndex = index;
      currentToolType = toolType;
    }
  });

  // 提交最后一组
  submitCurrentGroup();

  return result;
}

/**
 * 计算分组的状态（用于 GroupBlock header）
 * @param blocks 工具块数组
 * @param findToolResult 查找工具结果的函数
 * @returns 总状态：'pending' | 'completed' | 'error'
 */
export function getGroupStatus(
  blocks: ToolUseBlock[],
  findToolResult: (toolId: string) => { is_error?: boolean } | null | undefined,
): 'pending' | 'completed' | 'error' {
  let hasError = false;
  let hasPending = false;

  blocks.forEach((block) => {
    const result = findToolResult(block.id);
    if (!result) {
      hasPending = true;
    } else if (result.is_error) {
      hasError = true;
    }
  });

  if (hasError) return 'error';
  if (hasPending) return 'pending';
  return 'completed';
}

export function summarizeToolExecutionStatuses(
  items: readonly ToolExecutionStatusSource[],
): ToolExecutionStatusSummary {
  return items.reduce<ToolExecutionStatusSummary>((summary, item) => {
    if (item.isError) {
      summary.errorCount += 1;
    } else if (item.isCompleted) {
      summary.completedCount += 1;
    } else {
      summary.pendingCount += 1;
    }

    return summary;
  }, {
    completedCount: 0,
    errorCount: 0,
    pendingCount: 0,
  });
}

export function summarizeToolResultStatuses<T extends { id: string }>(
  blocks: readonly T[],
  findToolResult: (toolId: string) => { is_error?: boolean } | null | undefined,
): ToolExecutionStatusSummary {
  return summarizeToolExecutionStatuses(blocks.map((block) => {
    const result = findToolResult(block.id);

    return {
      isCompleted: result !== undefined && result !== null,
      isError: result?.is_error === true,
    };
  }));
}

export function formatToolExecutionStatusSummary(
  summary: ToolExecutionStatusSummary,
  labels: ToolExecutionStatusLabels,
): string {
  const parts: string[] = [];
  if (summary.completedCount > 1) {
    parts.push(`${summary.completedCount} ${labels.success}`);
  } else if (summary.completedCount > 0) {
    parts.push(labels.success);
  }
  if (summary.errorCount > 0) parts.push(`${summary.errorCount} ${labels.failed}`);
  if (summary.pendingCount > 0) parts.push(`${summary.pendingCount} ${labels.pending}`);
  return parts.join(' · ');
}

export function getToolGroupBulkActionState(
  itemCount: number,
  expandedIndices: ReadonlySet<number>,
): ToolGroupBulkActionState {
  const validItemCount = Math.max(0, itemCount);
  const expandedItemCount = Array.from(expandedIndices).filter(
    (index) => index >= 0 && index < validItemCount,
  ).length;

  return {
    allItemsExpanded: validItemCount > 0 && expandedItemCount === validItemCount,
    noItemsExpanded: expandedItemCount === 0,
  };
}

export function getToolGroupExpandedIndices(itemCount: number): Set<number> {
  const validItemCount = Math.max(0, itemCount);

  return new Set(Array.from({length: validItemCount}, (_, index) => index));
}

export function toggleToolGroupExpandedIndex(
  itemCount: number,
  expandedIndices: ReadonlySet<number>,
  index: number,
): Set<number> {
  const validItemCount = Math.max(0, itemCount);
  const nextExpandedIndices = new Set(expandedIndices);

  if (!Number.isInteger(index) || index < 0 || index >= validItemCount) {
    return nextExpandedIndices;
  }

  if (nextExpandedIndices.has(index)) {
    nextExpandedIndices.delete(index);
  } else {
    nextExpandedIndices.add(index);
  }

  return nextExpandedIndices;
}

export function isToolBlockToggleActivationKey(key: string): boolean {
  return TOOL_BLOCK_TOGGLE_ACTIVATION_KEYS.has(key);
}

export const isToolGroupToggleActivationKey = isToolBlockToggleActivationKey;
