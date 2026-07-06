import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AlertTriangle, Check, CircleSlash, Copy, RefreshCw, User} from 'lucide-react';
import type {ChatMessage, ContentBlock, TextBlock, ThinkingBlock, ToolResultBlock} from '../../types/chat';
import {STOPPED_OUTPUT_ERROR, useChatStore} from '../../stores/useChatStore';
import {useChatPaneTabKey} from './paneTabContext';
import {showToast} from '../common/ToastContainer';
import {cn} from '../../utils/cn';
import {getRenderableContentBlocks, shouldRenderChatMessage,} from '../../utils/chatMessageFlow';
import ContentBlockRenderer from './ContentBlockRenderer';
import MarkdownBlock from './MarkdownBlock';
import MessageMeta from './MessageMeta';
import StreamingPlaceholder from './StreamingPlaceholder';

interface MessageItemProps {
    message: ChatMessage;
    isLast: boolean;
    isSearchMatch?: boolean;
    anchorId?: string;
    onAnchorRef?: (messageId: string, node: HTMLElement | null) => void;
    findToolResult: (toolId: string | undefined) => ToolResultBlock | null;
}

function isTextBlock(block: ContentBlock): block is TextBlock {
    return block.type === 'text';
}

function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
    return block.type === 'thinking';
}

function getCopyText(message: ChatMessage, blocks: ContentBlock[]): string {
    const blockText = blocks
        .map((block) => {
            if (isTextBlock(block)) return block.text;
            if (isThinkingBlock(block)) return block.thinking;
            if (block.type === 'tool_use') return `${block.name} ${JSON.stringify(block.input, null, 2)}`;
            return '';
        })
        .filter((text) => text.trim().length > 0)
        .join('\n\n');

    if (blocks.length > 0) return blockText;
    if (message.content.trim()) return message.content;
    return '';
}

function getLastThinkingBlockIndex(blocks: ContentBlock[]): number | undefined {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
        if (isThinkingBlock(blocks[index])) return index;
    }

    return undefined;
}

function translateWithFallback(t: (key: string) => string, key: string, fallback: string): string {
    const translated = t(key);
    return translated === key ? fallback : translated;
}

export default function MessageItem({
    message,
    isLast,
    isSearchMatch = false,
    anchorId,
    onAnchorRef,
    findToolResult,
}: MessageItemProps) {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);
    const copyTimerRef = useRef<number | null>(null);
    // 宿主 pane 的 tab（侧聊）；null=主聊天全局投影。重发按钮据此路由到正确会话。
    const paneTabKey = useChatPaneTabKey();

    const isUser = message.role === 'user';
    const isAssistant = message.role === 'assistant';
    const blocks = useMemo(() => getRenderableContentBlocks(message.raw), [message.raw]);
    const hasBlocks = blocks.length > 0;
    const copyText = useMemo(() => getCopyText(message, blocks), [message, blocks]);
    const expandedThinkingBlockIndex = useMemo(
        () => (isAssistant && isLast && message.streaming ? getLastThinkingBlockIndex(blocks) : undefined),
        [blocks, isAssistant, isLast, message.streaming],
    );
    const isEmptyStreamingPlaceholder = isAssistant
        && isLast
        && Boolean(message.streaming)
        && !message.content.trim()
        && !hasBlocks;

    useEffect(() => () => {
        if (copyTimerRef.current !== null) {
            window.clearTimeout(copyTimerRef.current);
        }
    }, []);

    if (!shouldRenderChatMessage(message)) {
        return null;
    }

    const time = new Date(message.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
    const userLabel = translateWithFallback(t, 'chat.message.user', 'You');
    const assistantLabel = translateWithFallback(t, 'chat.message.assistant', 'AI Assistant');
    const systemLabel = translateWithFallback(t, 'chat.message.system', 'System');
    const copyLabel = translateWithFallback(t, 'chat.message.copy', 'Copy');
    const copiedLabel = translateWithFallback(t, 'chat.message.copied', 'Copied');
    const emptyUserLabel = translateWithFallback(t, 'chat.message.emptyUser', 'Empty message');
    const streamingConnectedLabel = translateWithFallback(
        t,
        'chat.message.streamingConnected',
        'Connected, generating response...',
    );
    const turnFailedLabel = translateWithFallback(t, 'chat.message.turnFailed', 'This turn failed');
    const stoppedByUserLabel = translateWithFallback(t, 'chat.message.stoppedByUser', 'Output stopped');
    const retryTurnLabel = translateWithFallback(t, 'chat.message.retryTurn', 'Resend');
    const retryUnavailableLabel = translateWithFallback(
        t,
        'chat.message.retryUnavailable',
        'Cannot resend automatically: no previous message, it has attachments, or a turn is running',
    );
    const isStoppedByUser = message.error === STOPPED_OUTPUT_ERROR;
    const handleRetryTurn = () => {
        void useChatStore.getState().retryLastUserMessage(paneTabKey).then((ok) => {
            if (!ok) showToast(retryUnavailableLabel, 'warning');
        });
    };
    // 失败/中止的可见反馈：内容为空时用户不该面对一个空气泡（尤其 send 直接抛错的场景）。
    const assistantErrorNotice = isAssistant && !message.streaming && message.error
        ? (isStoppedByUser
            ? (
                <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-base-content/50">
                    <CircleSlash size={12} className="shrink-0" />
                    <span>{stoppedByUserLabel}</span>
                </div>
            )
            : (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                        <span className="font-medium">{turnFailedLabel}</span>
                        {message.error.trim() ? `: ${message.error.trim()}` : ''}
                    </span>
                    {isLast && (
                        <button
                            type="button"
                            className="btn btn-ghost btn-xs h-6 min-h-0 shrink-0 gap-1 px-2 text-error"
                            onClick={handleRetryTurn}
                        >
                            <RefreshCw size={12} />
                            {retryTurnLabel}
                        </button>
                    )}
                </div>
            ))
        : null;

    const roleLabel = isUser
        ? userLabel
        : isAssistant
            ? assistantLabel
            : systemLabel;

    const handleCopy = async () => {
        if (!copyText.trim()) return;

        try {
            await navigator.clipboard.writeText(copyText);
            setCopied(true);
            if (copyTimerRef.current !== null) {
                window.clearTimeout(copyTimerRef.current);
            }
            copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
        } catch (e) {
            console.error('[MessageItem] Copy failed:', e);
        }
    };

    const canCopy = copyText.trim().length > 0;
    const copyButtonLabel = copied ? copiedLabel : copyLabel;
    const handleAnchorRef = useCallback((node: HTMLElement | null) => {
        if (!anchorId || !onAnchorRef) return;
        onAnchorRef(anchorId, node);
    }, [anchorId, onAnchorRef]);

    const copyButton = (
        <button
            type="button"
            className={cn(
                'btn btn-ghost btn-xs min-h-0 h-7 px-2 transition-opacity',
                isAssistant
                    ? 'absolute right-1 top-1 opacity-0 group-hover:opacity-100 focus:opacity-100'
                    : 'opacity-70 hover:opacity-100 focus:opacity-100',
                copied && 'opacity-100 text-success',
            )}
            title={copyButtonLabel}
            aria-label={copyButtonLabel}
            onClick={handleCopy}
            disabled={!canCopy}
        >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span className="hidden sm:inline">{copyButtonLabel}</span>
        </button>
    );

    const messageContent = (
        <div
            className={cn(
                'min-w-0 text-sm font-normal leading-relaxed text-base-content',
                isAssistant ? 'assistant-message-content pr-9' : 'space-y-2',
                isUser && 'user-message-content',
            )}
        >
            {hasBlocks ? (
                <ContentBlockRenderer
                    blocks={blocks}
                    findToolResult={findToolResult}
                    expandThinkingBlockIndex={expandedThinkingBlockIndex}
                    compact={isAssistant}
                    imageDisplay={isUser ? 'user-thumbnail' : undefined}
                />
            ) : message.content ? (
                <MarkdownBlock content={message.content} isStreaming={message.streaming} />
            ) : isEmptyStreamingPlaceholder ? (
                <StreamingPlaceholder />
            ) : isUser ? (
                <span className="italic text-base-content/40">{emptyUserLabel}</span>
            ) : null}

            {message.error && (
                <div className="flex items-start gap-2 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                    <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{message.error}</span>
                </div>
            )}
        </div>
    );

    if (isUser) {
        return (
            <article
                ref={anchorId ? handleAnchorRef : undefined}
                data-message-anchor-id={anchorId}
                className={cn(
                    'chat-message-row user-message-row group mx-auto flex w-full max-w-4xl justify-end px-3 py-2',
                    isSearchMatch && 'rounded-lg bg-primary/5 ring-1 ring-primary/15',
                )}
            >
                <div
                    className={cn(
                        'user-message-bubble max-w-[78%] rounded-2xl rounded-br-md border border-orange-100 bg-orange-50/75 px-3.5 py-2.5 shadow-sm sm:max-w-[760px]',
                        'dark:border-orange-500/20 dark:bg-orange-500/10',
                        message.error && 'border-error/30 bg-error/5 dark:border-error/40 dark:bg-error/10',
                    )}
                >
                    <header className="mb-1.5 flex items-center justify-between gap-2 text-xs text-base-content/50">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 text-white shadow-sm">
                                <User size={12} />
                            </span>
                            <span className="font-medium text-base-content/65">{roleLabel}</span>
                            <span>{time}</span>
                        </div>
                        {copyButton}
                    </header>

                    {messageContent}

                    {message.error && (
                        <footer className="mt-2">
                            <MessageMeta durationMs={message.durationMs} usage={message.usage} />
                        </footer>
                    )}
                </div>
            </article>
        );
    }

    if (isAssistant) {
        return (
            <article
                className={cn(
                    'chat-message-row assistant-message-flow group relative mx-auto w-full max-w-4xl px-4 py-3 transition-colors',
                    isSearchMatch && 'rounded-lg bg-primary/5 ring-1 ring-primary/15',
                    message.error && !isStoppedByUser && 'rounded-lg bg-error/5 ring-1 ring-error/20',
                )}
            >
                {canCopy && copyButton}

                {message.streaming && (
                    <div className="mb-1 inline-flex items-center gap-1.5 text-xs text-success/75">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success/80" />
                        {streamingConnectedLabel}
                    </div>
                )}

                {messageContent}

                {assistantErrorNotice}

                {!message.streaming && (
                    <footer className="assistant-message-meta mt-1">
                        <MessageMeta durationMs={message.durationMs} usage={message.usage} compact />
                    </footer>
                )}
            </article>
        );
    }

    return (
        <article
            className={cn(
                'chat-message-row group relative mx-auto w-full max-w-4xl overflow-hidden rounded-xl border border-gray-100 bg-white/95 px-4 py-3 pl-5 shadow-sm transition-all hover:border-base-content/20 hover:shadow-md',
                'dark:border-base-200 dark:bg-base-100/95',
                isSearchMatch && 'border-primary/35 bg-primary/5 shadow-md ring-1 ring-primary/15',
                message.error && 'border-error/30 bg-error/5 dark:border-error/40 dark:bg-error/10',
            )}
        >
            <div
                className={cn(
                    'absolute inset-y-0 left-0 w-1 bg-base-content/10',
                    message.error && 'bg-error/70',
                )}
            />

            <header className="mb-2 flex items-start justify-between gap-3 text-xs text-base-content/50">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-base-content/70">{roleLabel}</span>
                    <span>{time}</span>
                </div>

                {canCopy && copyButton}
            </header>

            {messageContent}

            {!message.streaming && (
                <footer className="mt-2">
                    <MessageMeta durationMs={message.durationMs} usage={message.usage} />
                </footer>
            )}
        </article>
    );
}
