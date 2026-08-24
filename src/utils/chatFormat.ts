/**
 * 对话模块的展示格式化与回合活动派生。
 *
 * 抽出来的原因：耗时/token 的格式化此前只存在于 MessageMeta 内部，
 * 「工作中」指示器和回合收尾条需要同一套写法，复制三份必然走形。
 */

import type {ContentBlock, ToolResultBlock, ToolUseBlock} from '../types/chat';

/** 秒表格式：`m:ss`，超过一小时补成 `h:mm:ss`。 */
export function formatDurationClock(durationMs: number): string {
    const seconds = Math.max(0, Math.floor(durationMs / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    }
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

/**
 * 人读耗时：一分钟内保留一位小数（`12.3s`），更长走 `1m 05s`。
 * 回合收尾条用这个而不是秒表格式——「用了多久」比「计时到哪」更好读。
 */
export function formatDurationHuman(durationMs: number): string {
    const safeMs = Math.max(0, durationMs);
    if (safeMs < 60_000) {
        return `${(safeMs / 1000).toFixed(1)}s`;
    }

    const totalSeconds = Math.floor(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) {
        return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    }

    const hours = Math.floor(minutes / 60);
    return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** `1234` → `1.2K`，`1234567` → `1.2M`。 */
export function formatTokenCount(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return String(count);
}

export interface TurnActivity {
    /** 正在执行（已发出但还没回结果）的工具名；null 表示当前在生成文本。 */
    activeToolName: string | null;
    /** 本条消息里已拿到结果的工具调用数。 */
    completedToolCount: number;
    /** 本条消息里的工具调用总数。 */
    totalToolCount: number;
}

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
    return block.type === 'tool_use';
}

/**
 * 从流式消息的内容块推导「现在到底在干什么」。
 *
 * 等待期此前是个黑箱：界面只说「正在生成回复」，而实际可能卡在一个跑了两分钟的
 * Bash 上。最后一个没有对应 tool_result 的 tool_use 就是当前在跑的工具。
 */
export function resolveTurnActivity(
    blocks: ContentBlock[],
    findToolResult: (toolId: string) => ToolResultBlock | null | undefined,
): TurnActivity {
    let activeToolName: string | null = null;
    let completedToolCount = 0;
    let totalToolCount = 0;

    for (let index = blocks.length - 1; index >= 0; index -= 1) {
        const block = blocks[index];
        if (!isToolUseBlock(block)) continue;

        totalToolCount += 1;
        if (findToolResult(block.id)) {
            completedToolCount += 1;
        } else if (!activeToolName) {
            // 倒序扫描，第一个无结果的就是最新发起的那个。
            activeToolName = block.name;
        }
    }

    return {activeToolName, completedToolCount, totalToolCount};
}
