// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ContentBlock } from '../types/chat';
import type { UseSessionStreamResult } from '../types/timeline';
import { buildTimelineFromMessages, useSessionStream } from './useSessionStream';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('buildTimelineFromMessages', () => {
    it('should correctly transform pure user and assistant messages', () => {
        const messages: ChatMessage[] = [
            {
                id: 'msg-1',
                role: 'user',
                content: 'Hello AI',
                createdAt: 1000,
            },
            {
                id: 'msg-2',
                role: 'assistant',
                content: 'Hello user, how can I help?',
                createdAt: 2000,
                durationMs: 120,
                usage: {
                    input_tokens: 10,
                    output_tokens: 8,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
            },
        ];

        const timeline = buildTimelineFromMessages(messages);

        expect(timeline).toHaveLength(2);
        expect(timeline[0]).toEqual({
            id: 'user:msg-1',
            type: 'user_text',
            content: 'Hello AI',
            timestamp: 1000,
            message: messages[0],
            attachments: undefined,
            isCompactSummary: false,
        });

        expect(timeline[1]).toEqual({
            id: 'assistant:msg-2:0',
            type: 'assistant_text',
            content: 'Hello user, how can I help?',
            timestamp: 2000,
            durationMs: 120,
            tokenUsage: messages[1].usage,
            isStreaming: false,
            message: messages[1],
            isLastSegment: true,
        });
    });

    it('should parse thinking blocks and tool use blocks with proper results', () => {
        const assistantBlocks: ContentBlock[] = [
            { type: 'thinking', thinking: 'I need to check the files first' },
            {
                type: 'tool_use',
                id: 'call-1',
                name: 'read_file',
                input: { path: 'src/main.rs' },
            },
            { type: 'text', text: 'I examined the file and found the issue.' },
        ];

        const messages: ChatMessage[] = [
            {
                id: 'msg-user',
                role: 'user',
                content: 'Check the file',
                createdAt: 1000,
            },
            {
                id: 'msg-assistant',
                role: 'assistant',
                content: 'I examined the file and found the issue.',
                createdAt: 2000,
                streaming: false,
                raw: {
                    type: 'assistant',
                    message: { content: assistantBlocks },
                },
            },
            {
                id: 'msg-tool-result',
                role: 'user',
                content: '[tool_result]',
                createdAt: 2500,
                raw: {
                    type: 'user',
                    message: {
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: 'call-1',
                                content: 'fn main() {}',
                                is_error: false,
                            },
                        ],
                    },
                },
            },
        ];

        const timeline = buildTimelineFromMessages(messages);

        // msg-tool-result should NOT be rendered as a standalone user message
        expect(timeline).toHaveLength(4);

        // 1. user message
        expect(timeline[0].id).toBe('user:msg-user');
        expect(timeline[0].type).toBe('user_text');

        // 2. thought
        expect(timeline[1].id).toBe('thought:msg-assistant:0');
        expect(timeline[1].type).toBe('thought');
        if (timeline[1].type === 'thought') {
            expect(timeline[1].content).toBe('I need to check the files first');
        }

        // 3. tool call
        expect(timeline[2].id).toBe('tool:call-1');
        expect(timeline[2].type).toBe('tool');
        if (timeline[2].type === 'tool') {
            expect(timeline[2].toolCall.callId).toBe('call-1');
            expect(timeline[2].toolCall.name).toBe('read_file');
            expect(timeline[2].toolCall.kind).toBe('read');
            expect(timeline[2].toolCall.status).toBe('complete');
            expect(timeline[2].toolCall.isError).toBe(false);
            expect(timeline[2].toolCall.result?.content).toBe('fn main() {}');
        }

        // 4. assistant text segment
        expect(timeline[3].id).toBe('assistant:msg-assistant:0');
        expect(timeline[3].type).toBe('assistant_text');
        if (timeline[3].type === 'assistant_text') {
            expect(timeline[3].content).toBe('I examined the file and found the issue.');
            expect(timeline[3].isLastSegment).toBe(true);
        }
    });

    it('should reflect running status when streaming and tool has no result yet', () => {
        const assistantBlocks: ContentBlock[] = [
            {
                type: 'tool_use',
                id: 'call-bash',
                name: 'bash',
                input: { command: 'cargo check' },
            },
        ];

        const messages: ChatMessage[] = [
            {
                id: 'msg-stream',
                role: 'assistant',
                content: '',
                createdAt: 1000,
                streaming: true,
                raw: {
                    type: 'assistant',
                    message: { content: assistantBlocks },
                },
            },
        ];

        const timeline = buildTimelineFromMessages(messages);
        expect(timeline).toHaveLength(1);
        expect(timeline[0].type).toBe('tool');
        if (timeline[0].type === 'tool') {
            expect(timeline[0].toolCall.status).toBe('running');
            expect(timeline[0].toolCall.name).toBe('bash');
            expect(timeline[0].toolCall.kind).toBe('bash');
        }
    });

    it('should reflect failed status when tool_result contains is_error: true', () => {
        const messages: ChatMessage[] = [
            {
                id: 'msg-assistant',
                role: 'assistant',
                content: '',
                createdAt: 1000,
                raw: {
                    type: 'assistant',
                    message: {
                        content: [
                            {
                                type: 'tool_use',
                                id: 'call-err',
                                name: 'bash',
                                input: { command: 'invalid command' },
                            },
                        ],
                    },
                },
            },
            {
                id: 'msg-res',
                role: 'user',
                content: '[tool_result]',
                createdAt: 1500,
                raw: {
                    type: 'user',
                    message: {
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: 'call-err',
                                content: 'command not found',
                                is_error: true,
                            },
                        ],
                    },
                },
            },
        ];

        const timeline = buildTimelineFromMessages(messages);
        expect(timeline).toHaveLength(1);
        expect(timeline[0].type).toBe('tool');
        if (timeline[0].type === 'tool') {
            expect(timeline[0].toolCall.status).toBe('failed');
            expect(timeline[0].toolCall.isError).toBe(true);
        }
    });

    it('should recognize compact boundary markers in system messages', () => {
        const messages: ChatMessage[] = [
            {
                id: 'sys-compact',
                role: 'system',
                content: '',
                createdAt: 1000,
                compact: {
                    trigger: 'auto',
                    preTokens: 180000,
                },
            },
        ];

        const timeline = buildTimelineFromMessages(messages);
        expect(timeline).toHaveLength(1);
        expect(timeline[0].id).toBe('compact:sys-compact');
        expect(timeline[0].type).toBe('compact');
        if (timeline[0].type === 'compact') {
            expect(timeline[0].info.trigger).toBe('auto');
            expect(timeline[0].info.preTokens).toBe(180000);
        }
    });

    it('should filter out internal protocol context messages', () => {
        const messages: ChatMessage[] = [
            {
                id: 'proto-1',
                role: 'user',
                content: '<permissions instructions>...',
                createdAt: 1000,
            },
            {
                id: 'proto-2',
                role: 'user',
                content: '<heartbeat>',
                createdAt: 1100,
            },
            {
                id: 'user-valid',
                role: 'user',
                content: 'Real user question',
                createdAt: 1200,
            },
        ];

        const timeline = buildTimelineFromMessages(messages);
        expect(timeline).toHaveLength(1);
        expect(timeline[0].id).toBe('user:user-valid');
    });
});

describe('useSessionStream', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    it('should return timeline, isStreaming flag, and update streamVersion', () => {
        let latestResult: UseSessionStreamResult | null = null;
        let updateMessages: ((msgs: ChatMessage[]) => void) | null = null;

        function TestProbe() {
            const [messages, setMessages] = useState<ChatMessage[]>([
                {
                    id: 'm1',
                    role: 'user',
                    content: 'Hi',
                    createdAt: 1000,
                },
            ]);
            updateMessages = setMessages;
            const stream = useSessionStream(messages);
            latestResult = stream;
            return createElement('div', null, `items:${stream.timeline.length}`);
        }

        act(() => {
            root?.render(createElement(TestProbe));
        });

        expect(latestResult).not.toBeNull();
        const initialResult = latestResult as unknown as UseSessionStreamResult;
        expect(initialResult.timeline).toHaveLength(1);
        expect(initialResult.isStreaming).toBe(false);

        // Update with streaming assistant message
        act(() => {
            updateMessages?.([
                {
                    id: 'm1',
                    role: 'user',
                    content: 'Hi',
                    createdAt: 1000,
                },
                {
                    id: 'm2',
                    role: 'assistant',
                    content: 'Typing...',
                    createdAt: 2000,
                    streaming: true,
                },
            ]);
        });

        const updatedResult = latestResult as unknown as UseSessionStreamResult;
        expect(updatedResult.timeline).toHaveLength(2);
        expect(updatedResult.isStreaming).toBe(true);
    });
});
