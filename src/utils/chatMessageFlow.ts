import type {ChatMessage, CompactBoundaryInfo, ContentBlock, MessageRaw, TextBlock, ToolResultBlock,} from '../types/chat';
import {isImageContentBlock, isImagePlaceholderText, isLikelyImageBase64Text} from './chatImageBlocks';

interface MergeRawChatMessageOptions {
    createId?: () => string;
    now?: () => number;
}

const TOOL_RESULT_CONTENT = '[tool_result]';
const PROTOCOL_CONTEXT_PREFIXES = [
    '<permissions instructions>',
    '<heartbeat>',
    '<environment_context>',
    '<workflow-state>',
    '<codex-mode>',
    '<app-context>',
    '<collaboration_mode>',
    '<skills_instructions>',
    '<plugins_instructions>',
    '<turn_aborted>',
    '<user_action>',
    '<subagent_notification>',
    '<agents-instructions>',
    '<skill>',
    '# AGENTS.md instructions for ',
    '## Skills\nA skill is a set of local instructions',
    '## Plugins\nA plugin is a local bundle',
    '## Heartbeats\nOccasionally you will see a user message surrounded',
    'Another language model started to solve this problem',
    '## Handoff Summary',
    'Filesystem sandboxing defines which files can be read or written.',
    'Tools are grouped by namespace',
];
const PROTOCOL_CONTEXT_PATTERNS = [
    /^You are Codex,\s+a coding agent\b/i,
    /^You are Claude Code\b/i,
    /^You are an AI assistant accessed via an API\b/i,
    /^Knowledge cutoff:\s*\d{4}-\d{2}/i,
    /^Current date:\s*\d{4}-\d{2}/i,
    /^#\s*AGENTS\.md\b/i,
    /^#\s*CLAUDE\.md\b/i,
    /^#\s*Tools\s*\n/i,
    /^##\s*Tools\s*\n/i,
];

function defaultCreateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultNow(): number {
    return Date.now();
}

function getRawContent(raw: MessageRaw): unknown {
    const topLevelContent = (raw as unknown as { content?: unknown }).content;
    return topLevelContent ?? raw.message?.content;
}

export function getContentBlocksFromRaw(raw?: MessageRaw | null): ContentBlock[] {
    if (!raw) return [];
    const content = getRawContent(raw);
    if (Array.isArray(content)) {
        return content.filter((block): block is ContentBlock => (
            Boolean(block)
            && typeof block === 'object'
            && 'type' in block
        ));
    }
    if (typeof content === 'string') {
        return [{type: 'text', text: content}];
    }
    return [];
}

function getDisplayContentBlocksFromRaw(raw?: MessageRaw | null): ContentBlock[] {
    const blocks = getContentBlocksFromRaw(raw);
    if (!blocks.some(isImageContentBlock)) return blocks;

    return blocks.filter((block, index) => {
        if (block.type !== 'text') return true;
        if (isImagePlaceholderText(block.text)) return false;
        if (!isLikelyImageBase64Text(block.text)) return true;

        const previousBlock = blocks[index - 1];
        const nextBlock = blocks[index + 1];
        return !(
            (previousBlock && isImageContentBlock(previousBlock))
            || (nextBlock && isImageContentBlock(nextBlock))
        );
    });
}

function isTextBlock(block: ContentBlock): block is TextBlock {
    return block.type === 'text';
}

function isToolResultBlock(block: ContentBlock): block is ToolResultBlock {
    return block.type === 'tool_result';
}

const MARKDOWN_LIST_ITEM_PATTERN = /^\s*(?:[-+*]|\d+[.)])\s+/;

function firstNonEmptyLine(text: string): string {
    return text.split('\n').find((line) => line.trim().length > 0) ?? '';
}

function lastNonEmptyLine(text: string): string {
    const lines = text.split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (lines[index].trim().length > 0) return lines[index];
    }
    return '';
}

function getTextBlockSeparator(previousText: string, nextText: string): string {
    if (previousText.endsWith('\n') || nextText.startsWith('\n')) return '';

    const previousLine = lastNonEmptyLine(previousText);
    const nextLine = firstNonEmptyLine(nextText);
    if (
        MARKDOWN_LIST_ITEM_PATTERN.test(previousLine)
        && MARKDOWN_LIST_ITEM_PATTERN.test(nextLine)
    ) {
        return '\n';
    }

    return '\n\n';
}

function mergeTextBlockText(previousText: string, nextText: string): string {
    const left = previousText.trimEnd();
    const right = nextText.trimStart();

    if (!left) return right;
    if (!right) return left;

    return `${left}${getTextBlockSeparator(left, right)}${right}`;
}

export function mergeAdjacentTextContentBlocks(blocks: ContentBlock[]): ContentBlock[] {
    return blocks.reduce<ContentBlock[]>((result, block) => {
        const previousBlock = result[result.length - 1];
        if (block.type === 'text' && previousBlock?.type === 'text') {
            result[result.length - 1] = {
                ...previousBlock,
                text: mergeTextBlockText(previousBlock.text, block.text),
            };
            return result;
        }

        result.push(block);
        return result;
    }, []);
}

function getTextFromRaw(raw: MessageRaw): string {
    return mergeAdjacentTextContentBlocks(getDisplayContentBlocksFromRaw(raw).filter(isRenderableContentBlock))
        .filter(isTextBlock)
        .map((block) => block.text)
        .filter((text) => text.trim().length > 0)
        .join('\n');
}

function getToolResultIds(raw: MessageRaw): string[] {
    return getContentBlocksFromRaw(raw)
        .filter(isToolResultBlock)
        .map((block) => block.tool_use_id)
        .filter((id) => id.trim().length > 0);
}

export function hasToolResult(raw?: MessageRaw | null): boolean {
    return getContentBlocksFromRaw(raw).some(isToolResultBlock);
}

function findToolResultInRange(
    messages: ChatMessage[],
    toolId: string,
    startIndex: number,
    endIndex: number,
): ToolResultBlock | null {
    for (let i = startIndex; i < endIndex; i += 1) {
        const blocks = getContentBlocksFromRaw(messages[i].raw);
        const result = blocks.find(
            (block): block is ToolResultBlock => (
                block.type === 'tool_result'
                && block.tool_use_id === toolId
            ),
        );
        if (result) return result;
    }

    return null;
}

function hasVisibleText(text: string | undefined): boolean {
    return Boolean(text?.trim());
}

export function isProtocolContextText(text: string | undefined): boolean {
    const trimmed = text?.trim();
    if (!trimmed) return false;

    return PROTOCOL_CONTEXT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
        || PROTOCOL_CONTEXT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isProtocolContextMessage(message: ChatMessage): boolean {
    if (isProtocolContextText(message.content)) return true;
    return getContentBlocksFromRaw(message.raw).some((block) => (
        block.type === 'text' && isProtocolContextText(block.text)
    ));
}

function isRenderableContentBlock(block: ContentBlock): boolean {
    if (isImageContentBlock(block)) return true;

    switch (block.type) {
        case 'text':
            return hasVisibleText(block.text);
        case 'thinking':
            return hasVisibleText(block.thinking);
        case 'tool_use':
            return true;
        case 'tool_result':
            return false;
        default:
            return false;
    }
}

export function getRenderableContentBlocks(raw?: MessageRaw | null): ContentBlock[] {
    return mergeAdjacentTextContentBlocks(getDisplayContentBlocksFromRaw(raw).filter(isRenderableContentBlock));
}

/**
 * 从 system/compact_boundary 原始 JSON 提取压缩信息。
 * 兼容两种键风格：SDK 实时流为 snake_case（compact_metadata/pre_tokens），
 * 会话文件为 camelCase（compactMetadata/preTokens）。非压缩边界返回 null。
 */
export function extractCompactBoundaryInfo(raw: unknown): CompactBoundaryInfo | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as {
        type?: unknown;
        subtype?: unknown;
        compact_metadata?: {trigger?: unknown; pre_tokens?: unknown};
        compactMetadata?: {trigger?: unknown; preTokens?: unknown};
    };
    if (record.type !== 'system' || record.subtype !== 'compact_boundary') return null;
    const meta = record.compact_metadata ?? record.compactMetadata;
    const trigger = typeof meta?.trigger === 'string' && meta.trigger ? meta.trigger : 'auto';
    const rawPreTokens = record.compact_metadata?.pre_tokens ?? record.compactMetadata?.preTokens;
    const preTokens = typeof rawPreTokens === 'number' && Number.isFinite(rawPreTokens)
        ? rawPreTokens
        : undefined;
    return {trigger, preTokens};
}

export function shouldRenderChatMessage(message: ChatMessage): boolean {
    // system 消息默认不渲染；compact 分隔条（上下文压缩标记）例外。
    if (message.role === 'system') return Boolean(message.compact);
    if (isProtocolContextMessage(message)) return false;
    if (message.role === 'user' && hasToolResult(message.raw)) return false;
    if (message.streaming || message.error) return true;
    if (message.content.trim().length > 0) return true;
    return getRenderableContentBlocks(message.raw).length > 0;
}

export function findToolResult(
    messages: ChatMessage[],
    toolId: string | undefined,
    startIndex = 0,
): ToolResultBlock | null {
    if (!toolId) return null;
    const safeStart = Math.max(0, startIndex);
    const forwardResult = findToolResultInRange(messages, toolId, safeStart, messages.length);
    if (forwardResult) return forwardResult;

    return findToolResultInRange(messages, toolId, 0, Math.min(safeStart, messages.length));
}

function findExistingToolResultMessage(messages: ChatMessage[], toolResultIds: string[]): number {
    if (toolResultIds.length === 0) return -1;
    const ids = new Set(toolResultIds);

    return messages.findIndex((message) => (
        getContentBlocksFromRaw(message.raw).some((block) => (
            block.type === 'tool_result'
            && ids.has(block.tool_use_id)
        ))
    ));
}

function findMatchingUserMessage(messages: ChatMessage[], raw: MessageRaw): number {
    const rawText = getTextFromRaw(raw);
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message.role !== 'user') continue;
        if (message.content === TOOL_RESULT_CONTENT) continue;
        if (rawText && message.content === rawText) return i;
    }
    return -1;
}

function findAssistantMessage(messages: ChatMessage[]): number {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message.role === 'assistant' && message.streaming) return i;
    }
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'assistant') return i;
    }
    return -1;
}

function getContentBlockMergeKey(block: ContentBlock): string {
    switch (block.type) {
        case 'text':
            return `text:${block.text}`;
        case 'thinking':
            return `thinking:${block.thinking}`;
        case 'tool_use':
            return `tool_use:${block.id}`;
        case 'tool_result':
            return `tool_result:${block.tool_use_id}`;
        case 'image':
        case 'input_image':
        default:
            return `${block.type}:${JSON.stringify(block)}`;
    }
}

function getAssistantRawMergeSeedBlocks(
    existingRaw: MessageRaw | undefined,
    existingContent: string,
): ContentBlock[] {
    const existingBlocks = getContentBlocksFromRaw(existingRaw);
    const hasExistingText = existingBlocks.some((block) => (
        block.type === 'text' && block.text.trim().length > 0
    ));
    const fallbackText = existingContent.trim();

    if (!hasExistingText && fallbackText) {
        return [{type: 'text', text: existingContent}, ...existingBlocks];
    }

    return existingBlocks;
}

function isTextAlreadyRepresentedInContent(block: ContentBlock, content: string): boolean {
    if (block.type !== 'text') return false;
    const text = block.text.trim();
    if (!text) return true;
    return content.includes(text);
}

function mergeAssistantRaw(
    existingRaw: MessageRaw | undefined,
    nextRaw: MessageRaw,
    existingContent: string,
): MessageRaw {
    const existingBlocks = getAssistantRawMergeSeedBlocks(existingRaw, existingContent);
    const existingKeys = new Set(existingBlocks.map(getContentBlockMergeKey));
    const nextBlocks = getContentBlocksFromRaw(nextRaw).filter((block) => {
        if (isTextAlreadyRepresentedInContent(block, existingContent)) return false;
        const key = getContentBlockMergeKey(block);
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
    });

    return {
        ...existingRaw,
        ...nextRaw,
        message: {
            ...existingRaw?.message,
            ...nextRaw.message,
            content: [...existingBlocks, ...nextBlocks],
        },
    };
}

function rawTimestamp(raw: MessageRaw, fallback: () => number): number {
    if (!raw.timestamp) return fallback();
    const parsed = Date.parse(raw.timestamp);
    return Number.isFinite(parsed) ? parsed : fallback();
}

function appendRawMessage(
    messages: ChatMessage[],
    raw: MessageRaw,
    content: string,
    options: Required<MergeRawChatMessageOptions>,
): ChatMessage[] {
    return [
        ...messages,
        {
            id: options.createId(),
            role: raw.type,
            content,
            raw,
            createdAt: rawTimestamp(raw, options.now),
        },
    ];
}

export function mergeRawChatMessage(
    messages: ChatMessage[],
    raw: MessageRaw,
    options: MergeRawChatMessageOptions = {},
): ChatMessage[] {
    const resolvedOptions: Required<MergeRawChatMessageOptions> = {
        createId: options.createId ?? defaultCreateId,
        now: options.now ?? defaultNow,
    };

    if (raw.type === 'assistant') {
        const existingIndex = findAssistantMessage(messages);
        if (existingIndex === -1) {
            return appendRawMessage(messages, raw, getTextFromRaw(raw), resolvedOptions);
        }

        return messages.map((message, index) => (
            index === existingIndex
                ? {
                    ...message,
                    raw: mergeAssistantRaw(message.raw, raw, message.content),
                    content: message.content,
                }
                : message
        ));
    }

    if (hasToolResult(raw)) {
        const existingIndex = findExistingToolResultMessage(messages, getToolResultIds(raw));
        if (existingIndex !== -1) {
            return messages.map((message, index) => (
                index === existingIndex
                    ? {
                        ...message,
                        raw,
                        content: TOOL_RESULT_CONTENT,
                    }
                    : message
            ));
        }

        return appendRawMessage(messages, raw, TOOL_RESULT_CONTENT, resolvedOptions);
    }

    const existingIndex = findMatchingUserMessage(messages, raw);
    if (existingIndex === -1) {
        return appendRawMessage(messages, raw, getTextFromRaw(raw), resolvedOptions);
    }

    return messages.map((message, index) => (
        index === existingIndex
            ? {
                ...message,
                raw,
                content: message.content,
            }
            : message
    ));
}

export {TOOL_RESULT_CONTENT};
