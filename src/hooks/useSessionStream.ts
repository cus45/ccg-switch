import { useEffect, useMemo, useRef } from 'react';
import type { ChatMessage, ToolResultBlock } from '../types/chat';
import type { TimelineItem, ToolCall, ToolCallStatus, UseSessionStreamResult } from '../types/timeline';
import {
    getContentBlocksFromRaw,
    getRenderableContentBlocks,
    isCompactSummaryMessage,
    shouldRenderChatMessage,
    TOOL_RESULT_CONTENT,
} from '../utils/chatMessageFlow';
import { getToolType } from '../types/tools';

/**
 * 从消息列表中收集所有的 tool_result 结果块，用于匹配 tool_use
 */
export function collectToolResultsMap(messages: ChatMessage[]): Map<string, ToolResultBlock> {
    const results = new Map<string, ToolResultBlock>();
    for (const msg of messages) {
        const blocks = getContentBlocksFromRaw(msg.raw);
        for (const block of blocks) {
            if (block.type === 'tool_result' && block.tool_use_id && !results.has(block.tool_use_id)) {
                results.set(block.tool_use_id, block);
            }
        }
    }
    return results;
}

/**
 * 将 ChatMessage[] 平铺并解析为高性能时间线单元 TimelineItem[]
 * 遵循 mindfs 的流式状态机设计：
 * 1. 稳定的 key，保证流式增量追加时 DOM 节点测量稳定、不闪烁
 * 2. 自动配对 tool_use 与 tool_result，推导运行/成功/失败状态
 * 3. 独立提取 thinking 块，以便按需折叠和测高
 * 4. 识别 compact boundary 上下文压缩条
 */
export function buildTimelineFromMessages(messages: ChatMessage[]): TimelineItem[] {
    const timeline: TimelineItem[] = [];
    const toolResults = collectToolResultsMap(messages);

    for (let msgIdx = 0; msgIdx < messages.length; msgIdx += 1) {
        const message = messages[msgIdx];

        if (!shouldRenderChatMessage(message)) {
            continue;
        }

        // 1. 系统消息（特别是 compact boundary 标记）
        if (message.role === 'system') {
            if (message.compact) {
                timeline.push({
                    id: `compact:${message.id}`,
                    type: 'compact',
                    info: message.compact,
                    messageId: message.id,
                    timestamp: message.createdAt,
                });
            }
            continue;
        }

        // 2. 用户消息
        if (message.role === 'user') {
            timeline.push({
                id: `user:${message.id}`,
                type: 'user_text',
                content: message.content,
                timestamp: message.createdAt,
                message,
                attachments: message.raw?.message?.content?.filter((b) => b.type === 'image') as unknown as never,
                isCompactSummary: isCompactSummaryMessage(message),
            });
            continue;
        }

        // 3. 助手消息
        if (message.role === 'assistant') {
            const rawBlocks = getRenderableContentBlocks(message.raw);
            const isStreaming = Boolean(message.streaming);

            // 若无结构化 raw content blocks，退化为单一的 assistant_text（例如纯文本流）
            if (rawBlocks.length === 0) {
                if (message.content.length > 0 || isStreaming || message.error) {
                    timeline.push({
                        id: `assistant:${message.id}:0`,
                        type: 'assistant_text',
                        content: message.content,
                        timestamp: message.createdAt,
                        durationMs: message.durationMs,
                        tokenUsage: message.usage,
                        isStreaming,
                        message,
                        isLastSegment: true,
                    });
                }
                continue;
            }

            let segmentIndex = 0;
            let thoughtIndex = 0;
            const assistantSegments: Extract<TimelineItem, { type: 'assistant_text' }>[] = [];

            for (let blockIdx = 0; blockIdx < rawBlocks.length; blockIdx += 1) {
                const block = rawBlocks[blockIdx];

                if (block.type === 'thinking') {
                    timeline.push({
                        id: `thought:${message.id}:${thoughtIndex}`,
                        type: 'thought',
                        content: block.thinking,
                        isStreaming,
                        messageId: message.id,
                        timestamp: message.createdAt,
                    });
                    thoughtIndex += 1;
                } else if (block.type === 'tool_use') {
                    const result = toolResults.get(block.id) ?? null;
                    let status: ToolCallStatus = 'running';

                    if (result) {
                        status = result.is_error ? 'failed' : 'complete';
                    } else if (!isStreaming) {
                        // 若整轮已结束但无 result，落为 complete 避免一直转圈（除非是交互式待办）
                        status = 'complete';
                    }

                    const normalizedName = (block.name || '').toLowerCase();
                    let kind: ToolCall['kind'] = getToolType(block.name);
                    if (normalizedName === 'askuserquestion' || normalizedName === 'ask_user') {
                        kind = 'ask_user';
                    } else if (normalizedName === 'task' || normalizedName === 'agent') {
                        kind = 'task';
                    }

                    const toolCall: ToolCall = {
                        callId: block.id,
                        name: block.name,
                        kind,
                        input: block.input ?? {},
                        result,
                        status,
                        isError: Boolean(result?.is_error),
                    };

                    timeline.push({
                        id: `tool:${block.id}`,
                        type: 'tool',
                        toolCall,
                        messageId: message.id,
                        timestamp: message.createdAt,
                    });
                } else if (block.type === 'text') {
                    const item: Extract<TimelineItem, { type: 'assistant_text' }> = {
                        id: `assistant:${message.id}:${segmentIndex}`,
                        type: 'assistant_text',
                        content: block.text,
                        timestamp: message.createdAt,
                        durationMs: message.durationMs,
                        tokenUsage: message.usage,
                        isStreaming,
                        message,
                        isLastSegment: false,
                    };
                    segmentIndex += 1;
                    assistantSegments.push(item);
                    timeline.push(item);
                }
            }

            // 若 rawBlocks 仅有 tools/thoughts 而无 text，但 message.content 包含汇总文字
            if (assistantSegments.length === 0 && message.content && message.content !== TOOL_RESULT_CONTENT) {
                const item: Extract<TimelineItem, { type: 'assistant_text' }> = {
                    id: `assistant:${message.id}:${segmentIndex}`,
                    type: 'assistant_text',
                    content: message.content,
                    timestamp: message.createdAt,
                    durationMs: message.durationMs,
                    tokenUsage: message.usage,
                    isStreaming,
                    message,
                    isLastSegment: true,
                };
                assistantSegments.push(item);
                timeline.push(item);
            } else if (assistantSegments.length > 0) {
                // 将该轮最后一个 assistant_text 片段标记为 isLastSegment: true，供渲染耗时/token
                assistantSegments[assistantSegments.length - 1].isLastSegment = true;
            }
        }
    }

    return timeline;
}

/**
 * 监听会话消息并输出解析后的流式时间线
 */
export function useSessionStream(messages: ChatMessage[]): UseSessionStreamResult {
    const timeline = useMemo(() => buildTimelineFromMessages(messages), [messages]);
    const isStreaming = useMemo(() => messages.some((m) => Boolean(m.streaming)), [messages]);
    const streamVersionRef = useRef(0);

    useEffect(() => {
        streamVersionRef.current += 1;
    }, [timeline, isStreaming]);

    return {
        timeline,
        isStreaming,
        streamVersion: streamVersionRef.current,
    };
}
