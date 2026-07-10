import {describe, expect, it} from 'vitest';
import type {ChatMessage, MessageRaw} from '../types/chat';
import {
    extractCompactBoundaryInfo,
    findToolResult,
    isCompactSummaryMessage,
    getRenderableContentBlocks,
    mergeRawChatMessage,
    shouldRenderChatMessage,
} from './chatMessageFlow';

const userRaw = (content: MessageRaw['message']['content'], uuid = 'user-uuid'): MessageRaw => ({
    type: 'user',
    uuid,
    message: {content},
});

const assistantRaw = (content: MessageRaw['message']['content']): MessageRaw => ({
    type: 'assistant',
    message: {content},
});

describe('chat message flow', () => {
    it('patches a matching user raw message without losing the original content', () => {
        const messages: ChatMessage[] = [
            {
                id: 'u1',
                role: 'user',
                content: 'read package.json',
                createdAt: 100,
            },
            {
                id: 'a1',
                role: 'assistant',
                content: '',
                streaming: true,
                createdAt: 101,
            },
        ];

        const next = mergeRawChatMessage(messages, userRaw([
            {type: 'text', text: 'read package.json'},
        ]));

        expect(next).toHaveLength(2);
        expect(next[0].content).toBe('read package.json');
        expect(next[0].raw?.uuid).toBe('user-uuid');
    });

    it('appends tool_result as a separate user message instead of overwriting the prompt', () => {
        const messages: ChatMessage[] = [
            {
                id: 'u1',
                role: 'user',
                content: 'read package.json',
                createdAt: 100,
            },
            {
                id: 'a1',
                role: 'assistant',
                content: '',
                raw: assistantRaw([
                    {
                        type: 'tool_use',
                        id: 'tool-1',
                        name: 'Read',
                        input: {file_path: 'package.json'},
                    },
                ]),
                streaming: true,
                createdAt: 101,
            },
        ];

        const next = mergeRawChatMessage(
            messages,
            userRaw([
                {
                    type: 'tool_result',
                    tool_use_id: 'tool-1',
                    content: 'file contents',
                    is_error: false,
                },
            ], 'tool-result-msg'),
            {createId: () => 'generated-tool-result-id', now: () => 200},
        );

        expect(next).toHaveLength(3);
        expect(next[0].content).toBe('read package.json');
        expect(next[2]).toMatchObject({
            id: 'generated-tool-result-id',
            role: 'user',
            content: '[tool_result]',
            createdAt: 200,
        });
        expect(next[2].raw?.message.content[0]).toMatchObject({
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: 'file contents',
        });
    });

    it('finds a tool_result in later messages for an assistant tool_use', () => {
        const messages: ChatMessage[] = [
            {
                id: 'u1',
                role: 'user',
                content: 'read package.json',
                createdAt: 100,
            },
            {
                id: 'a1',
                role: 'assistant',
                content: '',
                raw: assistantRaw([
                    {
                        type: 'tool_use',
                        id: 'tool-1',
                        name: 'Read',
                        input: {file_path: 'package.json'},
                    },
                ]),
                createdAt: 101,
            },
            {
                id: 'u2',
                role: 'user',
                content: '[tool_result]',
                raw: userRaw([
                    {
                        type: 'tool_result',
                        tool_use_id: 'tool-1',
                        content: 'file contents',
                        is_error: false,
                    },
                ], 'tool-result-msg'),
                createdAt: 102,
            },
        ];

        expect(findToolResult(messages, 'tool-1', 1)).toMatchObject({
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: 'file contents',
        });
    });

    it('finds an earlier tool_result when raw events arrive out of order', () => {
        const messages: ChatMessage[] = [
            {
                id: 'u1',
                role: 'user',
                content: 'read package.json',
                createdAt: 100,
            },
            {
                id: 'u2',
                role: 'user',
                content: '[tool_result]',
                raw: userRaw([
                    {
                        type: 'tool_result',
                        tool_use_id: 'tool-early',
                        content: 'early file contents',
                        is_error: false,
                    },
                ], 'early-tool-result-msg'),
                createdAt: 101,
            },
            {
                id: 'a1',
                role: 'assistant',
                content: '',
                raw: assistantRaw([
                    {
                        type: 'tool_use',
                        id: 'tool-early',
                        name: 'Read',
                        input: {file_path: 'package.json'},
                    },
                ]),
                createdAt: 102,
            },
        ];

        expect(findToolResult(messages, 'tool-early', 2)).toMatchObject({
            type: 'tool_result',
            tool_use_id: 'tool-early',
            content: 'early file contents',
        });
    });

    it('merges assistant raw blocks instead of replacing earlier streamed content', () => {
        const messages: ChatMessage[] = [
            {
                id: 'u1',
                role: 'user',
                content: 'inspect the project',
                createdAt: 100,
            },
            {
                id: 'a1',
                role: 'assistant',
                content: 'I will inspect the project.',
                raw: assistantRaw([
                    {type: 'text', text: 'I will inspect the project.'},
                ]),
                streaming: true,
                createdAt: 101,
            },
        ];

        const next = mergeRawChatMessage(messages, assistantRaw([
            {
                type: 'tool_use',
                id: 'tool-1',
                name: 'Read',
                input: {file_path: 'package.json'},
            },
        ]));

        expect(next).toHaveLength(2);
        expect(next[1]).toMatchObject({
            id: 'a1',
            role: 'assistant',
            content: 'I will inspect the project.',
            streaming: true,
            createdAt: 101,
        });
        expect(getRenderableContentBlocks(next[1].raw).map((block) => block.type)).toEqual([
            'text',
            'tool_use',
        ]);
    });

    it('keeps streamed assistant text visible when the first raw event is a tool block', () => {
        const messages: ChatMessage[] = [
            {
                id: 'u1',
                role: 'user',
                content: 'inspect the project',
                createdAt: 100,
            },
            {
                id: 'a1',
                role: 'assistant',
                content: 'I will inspect the project.',
                streaming: true,
                createdAt: 101,
            },
        ];

        const next = mergeRawChatMessage(messages, assistantRaw([
            {
                type: 'tool_use',
                id: 'tool-1',
                name: 'Read',
                input: {file_path: 'package.json'},
            },
        ]));

        expect(getRenderableContentBlocks(next[1].raw).map((block) => block.type)).toEqual([
            'text',
            'tool_use',
        ]);
        expect(getRenderableContentBlocks(next[1].raw)[0]).toMatchObject({
            type: 'text',
            text: 'I will inspect the project.',
        });
    });

    it('does not render assistant messages that have no visible content', () => {
        const message: ChatMessage = {
            id: 'a-empty',
            role: 'assistant',
            content: '',
            raw: assistantRaw([
                {type: 'text', text: '   '},
            ]),
            createdAt: 100,
        };

        expect(getRenderableContentBlocks(message.raw)).toEqual([]);
        expect(shouldRenderChatMessage(message)).toBe(false);
    });

    it('keeps tool_use messages visible but hides internal tool_result user messages', () => {
        const assistantMessage: ChatMessage = {
            id: 'a-tool',
            role: 'assistant',
            content: '',
            raw: assistantRaw([
                {
                    type: 'tool_use',
                    id: 'tool-1',
                    name: 'Bash',
                    input: {command: 'pwd'},
                },
            ]),
            createdAt: 100,
        };
        const toolResultMessage: ChatMessage = {
            id: 'u-tool-result',
            role: 'user',
            content: '[tool_result]',
            raw: userRaw([
                {
                    type: 'tool_result',
                    tool_use_id: 'tool-1',
                    content: 'C:\\guodevelop\\ccg-switch',
                },
            ]),
            createdAt: 101,
        };

        expect(getRenderableContentBlocks(assistantMessage.raw)).toHaveLength(1);
        expect(shouldRenderChatMessage(assistantMessage)).toBe(true);
        expect(shouldRenderChatMessage(toolResultMessage)).toBe(false);
    });

    it('filters image base64 residue text while keeping the image block renderable', () => {
        const raw = userRaw([
            {type: 'text', text: 'arsAAAAASUVORK5CYII='},
            {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'iVBORw0KGgo=',
                },
                fileName: 'screen.png',
            },
            {type: 'text', text: 'QAAAABJR5ErkJggg=='},
        ]);

        const blocks = getRenderableContentBlocks(raw);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('image');
    });

    it('filters Codex image placeholder tags while keeping image and prompt text renderable', () => {
        const raw = userRaw([
            {type: 'text', text: '<image name=[Image #1]>'},
            {
                type: 'input_image',
                image_url: 'file:///C:/Users/Administrator/Pictures/screen.png',
            },
            {type: 'text', text: '</image>'},
            {type: 'text', text: '请看这张截图的问题'},
        ]);

        const blocks = getRenderableContentBlocks(raw);

        expect(blocks.map((block) => block.type)).toEqual(['input_image', 'text']);
        expect(blocks[1]).toMatchObject({
            type: 'text',
            text: '请看这张截图的问题',
        });
    });

    it('merges adjacent text blocks so markdown history keeps document structure', () => {
        const raw = assistantRaw([
            {type: 'text', text: '**上轮进展与阻塞**\n记录里声称完成。'},
            {type: 'text', text: '- **本轮规划**：先定位根因。'},
            {type: 'text', text: '- **验证结果**：保留列表。'},
        ]);

        expect(getRenderableContentBlocks(raw)).toEqual([
            {
                type: 'text',
                text: '**上轮进展与阻塞**\n记录里声称完成。\n\n- **本轮规划**：先定位根因。\n- **验证结果**：保留列表。',
            },
        ]);
    });

    it('keeps non-adjacent base64-like text when a message also has an image', () => {
        const raw = userRaw([
            {type: 'text', text: 'Here is a token-like sample:'},
            {type: 'text', text: 'QAAAABJR5ErkJggg=='},
            {type: 'text', text: 'and the screenshot is below'},
            {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'iVBORw0KGgo=',
                },
                fileName: 'screen.png',
            },
        ]);

        const blocks = getRenderableContentBlocks(raw);

        expect(blocks.map((block) => block.type)).toEqual(['text', 'image']);
        expect(blocks[0]).toMatchObject({
            type: 'text',
            text: 'Here is a token-like sample:\n\nQAAAABJR5ErkJggg==\n\nand the screenshot is below',
        });
    });

    it('does not persist image base64 residue as message content when merging raw user messages', () => {
        const next = mergeRawChatMessage([], userRaw([
            {type: 'text', text: 'arsAAAAASUVORK5CYII='},
            {
                type: 'input_image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'iVBORw0KGgo=',
                },
                fileName: 'screen.png',
            },
            {type: 'text', text: 'QAAAABJR5ErkJggg=='},
        ]), {createId: () => 'u-image', now: () => 100});

        expect(next).toHaveLength(1);
        expect(next[0].content).toBe('');
        expect(getRenderableContentBlocks(next[0].raw)).toHaveLength(1);
    });

    it('does not persist Codex image placeholder tags as message content when merging raw user messages', () => {
        const next = mergeRawChatMessage([], userRaw([
            {type: 'text', text: '<image name=[Image #1]>'},
            {
                type: 'input_image',
                image_url: 'file:///C:/Users/Administrator/Pictures/screen.png',
            },
            {type: 'text', text: '</image>'},
            {type: 'text', text: '截图里的按钮太大了'},
        ]), {createId: () => 'u-image-placeholder', now: () => 100});

        expect(next).toHaveLength(1);
        expect(next[0].content).toBe('截图里的按钮太大了');
        expect(getRenderableContentBlocks(next[0].raw).map((block) => block.type)).toEqual([
            'input_image',
            'text',
        ]);
    });

    it('keeps empty streaming and error messages visible for status feedback', () => {
        expect(shouldRenderChatMessage({
            id: 'a-streaming',
            role: 'assistant',
            content: '',
            streaming: true,
            createdAt: 100,
        })).toBe(true);

        expect(shouldRenderChatMessage({
            id: 'a-error',
            role: 'assistant',
            content: '',
            error: '执行失败',
            createdAt: 101,
        })).toBe(true);
    });

    it('hides protocol context messages even when history marks them as user text', () => {
        const message: ChatMessage = {
            id: 'system-like-user',
            role: 'user',
            content: 'Filesystem sandboxing defines which files can be read or written. Approval policy is currently never.',
            raw: userRaw([
                {
                    type: 'text',
                    text: 'Filesystem sandboxing defines which files can be read or written. Approval policy is currently never.',
                },
            ]),
            createdAt: 100,
        };

        expect(shouldRenderChatMessage(message)).toBe(false);
    });

    it('hides assistant runtime system prompts that are replayed as history text', () => {
        const message: ChatMessage = {
            id: 'codex-system-like-user',
            role: 'user',
            content: 'You are Codex, a coding agent based on GPT-5.\n\n# Tools\nTools are grouped by namespace.',
            raw: userRaw([
                {
                    type: 'text',
                    text: 'You are Codex, a coding agent based on GPT-5.\n\n# Tools\nTools are grouped by namespace.',
                },
            ]),
            createdAt: 100,
        };

        expect(shouldRenderChatMessage(message)).toBe(false);
    });

    it('hides AGENTS and heartbeat protocol blocks from history rendering', () => {
        const agentsMessage: ChatMessage = {
            id: 'agents-context',
            role: 'user',
            content: '# AGENTS.md instructions for C:\\guodevelop\\ccg-switch\n\n<INSTRUCTIONS>\n必须使用中文回复\n</INSTRUCTIONS>',
            raw: userRaw([
                {
                    type: 'text',
                    text: '# AGENTS.md instructions for C:\\guodevelop\\ccg-switch\n\n<INSTRUCTIONS>\n必须使用中文回复\n</INSTRUCTIONS>',
                },
            ]),
            createdAt: 100,
        };
        const heartbeatMessage: ChatMessage = {
            id: 'heartbeat-context',
            role: 'user',
            content: '<heartbeat>\n  <automation_id>ccg-switch-chat-ui-parity-monitor</automation_id>\n</heartbeat>',
            raw: userRaw([
                {
                    type: 'text',
                    text: '<heartbeat>\n  <automation_id>ccg-switch-chat-ui-parity-monitor</automation_id>\n</heartbeat>',
                },
            ]),
            createdAt: 101,
        };

        expect(shouldRenderChatMessage(agentsMessage)).toBe(false);
        expect(shouldRenderChatMessage(heartbeatMessage)).toBe(false);
    });

    it('hides handoff summary blocks from history rendering', () => {
        const handoffMessage: ChatMessage = {
            id: 'handoff-context',
            role: 'user',
            content: 'Another language model started to solve this problem and produced a summary of its thinking process.\n\n## Handoff Summary\n\n- Current task: continue Chat UI parity.',
            raw: userRaw([
                {
                    type: 'text',
                    text: 'Another language model started to solve this problem and produced a summary of its thinking process.\n\n## Handoff Summary\n\n- Current task: continue Chat UI parity.',
                },
            ]),
            createdAt: 102,
        };

        expect(shouldRenderChatMessage(handoffMessage)).toBe(false);
    });

    it('hides Codex control markers from history rendering', () => {
        const turnAbortedMessage: ChatMessage = {
            id: 'turn-aborted',
            role: 'user',
            content: '<turn_aborted>',
            raw: userRaw([
                {
                    type: 'text',
                    text: '<turn_aborted>',
                },
            ]),
            createdAt: 100,
        };
        const userActionMessage: ChatMessage = {
            id: 'user-action',
            role: 'user',
            content: '<user_action>\n<context>User initiated a review task.</context>\n</user_action>',
            raw: userRaw([
                {
                    type: 'text',
                    text: '<user_action>\n<context>User initiated a review task.</context>\n</user_action>',
                },
            ]),
            createdAt: 101,
        };
        const agentsInstructionsMessage: ChatMessage = {
            id: 'agents-instructions',
            role: 'user',
            content: '<agents-instructions>\n# Global Instructions\n</agents-instructions>',
            raw: userRaw([
                {
                    type: 'text',
                    text: '<agents-instructions>\n# Global Instructions\n</agents-instructions>',
                },
            ]),
            createdAt: 102,
        };

        expect(shouldRenderChatMessage(turnAbortedMessage)).toBe(false);
        expect(shouldRenderChatMessage(userActionMessage)).toBe(false);
        expect(shouldRenderChatMessage(agentsInstructionsMessage)).toBe(false);
    });
});

describe('extractCompactBoundaryInfo', () => {
    it('parses SDK stream shape (snake_case)', () => {
        expect(extractCompactBoundaryInfo({
            type: 'system',
            subtype: 'compact_boundary',
            compact_metadata: {trigger: 'manual', pre_tokens: 120000},
        })).toEqual({trigger: 'manual', preTokens: 120000});
    });

    it('parses session file shape (camelCase)', () => {
        expect(extractCompactBoundaryInfo({
            type: 'system',
            subtype: 'compact_boundary',
            compactMetadata: {trigger: 'auto', preTokens: 275007, postTokens: 8320},
        })).toEqual({trigger: 'auto', preTokens: 275007});
    });

    it('returns null for non-compact raws and defaults missing metadata to auto', () => {
        expect(extractCompactBoundaryInfo(null)).toBeNull();
        expect(extractCompactBoundaryInfo({type: 'system', subtype: 'init'})).toBeNull();
        expect(extractCompactBoundaryInfo({type: 'user', subtype: 'compact_boundary'})).toBeNull();
        expect(extractCompactBoundaryInfo({
            type: 'system',
            subtype: 'compact_boundary',
        })).toEqual({trigger: 'auto', preTokens: undefined});
    });
});

describe('isCompactSummaryMessage', () => {
    const base = {id: 'm1', createdAt: 1} as const;

    it('detects the raw isCompactSummary flag (history path)', () => {
        const message: ChatMessage = {
            ...base,
            role: 'user',
            content: '任意内容',
            raw: {type: 'user', message: {content: []}, isCompactSummary: true},
        };
        expect(isCompactSummaryMessage(message)).toBe(true);
    });

    it('falls back to the fixed continuation prefix (live path)', () => {
        const message: ChatMessage = {
            ...base,
            role: 'user',
            content: 'This session is being continued from a previous conversation that ran out of context. ...',
        };
        expect(isCompactSummaryMessage(message)).toBe(true);
    });

    it('detects the prefix inside text blocks', () => {
        const message: ChatMessage = {
            ...base,
            role: 'user',
            content: '',
            raw: {
                type: 'user',
                message: {content: [{type: 'text', text: 'This session is being continued from a previous conversation. summary'}]},
            },
        };
        expect(isCompactSummaryMessage(message)).toBe(true);
    });

    it('ignores normal user and assistant messages', () => {
        expect(isCompactSummaryMessage({...base, role: 'user', content: '正常提问'})).toBe(false);
        expect(isCompactSummaryMessage({
            ...base,
            role: 'assistant',
            content: 'This session is being continued from a previous conversation',
        })).toBe(false);
    });
});
