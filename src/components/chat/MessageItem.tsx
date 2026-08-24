import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AlertTriangle, Check, CircleSlash, Copy, FoldVertical, History, Quote, RefreshCw, User} from 'lucide-react';
import type {ChatMessage, ContentBlock, TextBlock, ThinkingBlock, ToolResultBlock} from '../../types/chat';
import {STOPPED_OUTPUT_ERROR, useChatStore} from '../../stores/useChatStore';
import {useChatPaneTabKey} from './paneTabContext';
import {showToast} from '../common/ToastContainer';
import {cn} from '../../utils/cn';
import {getRenderableContentBlocks, isCompactSummaryMessage, shouldRenderChatMessage,} from '../../utils/chatMessageFlow';
import {resolveTurnActivity} from '../../utils/chatFormat';
import CompactSummaryBlock from './CompactSummaryBlock';
import ContentBlockRenderer from './ContentBlockRenderer';
import MarkdownBlock from './MarkdownBlock';
import MessageMeta from './MessageMeta';
import RewindConfirmDialog from './RewindConfirmDialog';
import TurnCompleteDivider from './TurnCompleteDivider';
import WorkingIndicator from './WorkingIndicator';

/** 引用到输入框时截断，避免把一整篇回复灌进 composer。 */
const QUOTE_MAX_LENGTH = 1_200;

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

/** 把正文转成 Markdown 引用块，供「引用到输入框」使用。 */
export function buildQuotedDraft(source: string, maxLength: number = QUOTE_MAX_LENGTH): string {
    const trimmed = source.trim();
    if (!trimmed) return '';

    const clipped = trimmed.length > maxLength ? `${trimmed.slice(0, maxLength).trimEnd()}…` : trimmed;
    return clipped
        .split('\n')
        .map((line) => (line.trim() ? `> ${line}` : '>'))
        .join('\n');
}

export function appendQuoteToDraft(currentDraft: string, quoted: string): string {
    if (!quoted) return currentDraft;
    const base = currentDraft.replace(/\s+$/, '');
    return base ? `${base}\n\n${quoted}\n\n` : `${quoted}\n\n`;
}

export default function MessageItem({
    message,
    isLast,
    isSearchMatch = false,
    anchorId,
    onAnchorRef,
    findToolResult,
}: MessageItemProps) {
    const {t} = useTranslation();
    const [copied, setCopied] = useState(false);
    const copyTimerRef = useRef<number | null>(null);
    // 宿主 pane 的 tab（侧聊）；null=主聊天全局投影。重发/引用据此路由到正确会话。
    const paneTabKey = useChatPaneTabKey();
    const [rewindOpen, setRewindOpen] = useState(false);
    const [rewindBusy, setRewindBusy] = useState(false);

    const isUser = message.role === 'user';
    const isAssistant = message.role === 'assistant';
    const blocks = useMemo(() => getRenderableContentBlocks(message.raw), [message.raw]);
    const hasBlocks = blocks.length > 0;
    const copyText = useMemo(() => getCopyText(message, blocks), [message, blocks]);
    const expandedThinkingBlockIndex = useMemo(
        () => (isAssistant && isLast && message.streaming ? getLastThinkingBlockIndex(blocks) : undefined),
        [blocks, isAssistant, isLast, message.streaming],
    );
    // 等待期反馈：正在跑哪个工具、已完成几步（详见 chatFormat.resolveTurnActivity）
    const turnActivity = useMemo(
        () => (isAssistant && message.streaming
            ? resolveTurnActivity(blocks, findToolResult)
            : null),
        [blocks, findToolResult, isAssistant, message.streaming],
    );

    const handleAnchorRef = useCallback((node: HTMLElement | null) => {
        if (!anchorId || !onAnchorRef) return;
        onAnchorRef(anchorId, node);
    }, [anchorId, onAnchorRef]);

    useEffect(() => () => {
        if (copyTimerRef.current !== null) {
            window.clearTimeout(copyTimerRef.current);
        }
    }, []);

    const handleCopy = useCallback(async () => {
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
    }, [copyText]);

    const handleQuote = useCallback(() => {
        const quoted = buildQuotedDraft(copyText);
        if (!quoted) return;

        const store = useChatStore.getState();
        // 侧聊的草稿存在 openTabs 里；活跃 tab 的草稿走顶层投影。
        const isBackgroundTab = Boolean(paneTabKey) && paneTabKey !== store.activeTabKey;
        const currentDraft = isBackgroundTab
            ? store.openTabs.find((tab) => tab.key === paneTabKey)?.draft ?? ''
            : store.draft;
        const nextDraft = appendQuoteToDraft(currentDraft, quoted);

        if (paneTabKey) {
            store.setTabDraft(paneTabKey, nextDraft);
        } else {
            store.setDraft(nextDraft);
        }
    }, [copyText, paneTabKey]);

    // ---- 以下开始条件渲染；所有 hook 都在上面，保证调用顺序稳定 ----

    if (!shouldRenderChatMessage(message)) {
        return null;
    }

    // 上下文压缩分隔条：细线 + 居中徽标，标记此处之前的对话已被压缩归纳。
    if (message.role === 'system' && message.compact) {
        const compactLabel = message.compact.trigger === 'manual'
            ? translateWithFallback(t, 'chat.compact.manual', 'Context compacted (manual)')
            : translateWithFallback(t, 'chat.compact.auto', 'Context compacted automatically');
        const preTokensLabel = typeof message.compact.preTokens === 'number' && message.compact.preTokens > 0
            ? ` · ${Math.round(message.compact.preTokens / 1000)}K tokens`
            : '';
        return (
            <div
                className="chat-message-row chat-turn-divider"
                role="separator"
                aria-label={compactLabel}
            >
                <span className="chat-turn-divider-line" aria-hidden="true" />
                <span className="chat-turn-divider-badge">
                    <FoldVertical size={11} aria-hidden="true" />
                    {compactLabel}
                    {preTokensLabel}
                </span>
                <span className="chat-turn-divider-line" aria-hidden="true" />
            </div>
        );
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
    const quoteLabel = translateWithFallback(t, 'chat.message.quote', 'Quote in composer');
    const emptyUserLabel = translateWithFallback(t, 'chat.message.emptyUser', 'Empty message');
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

    const canCopy = copyText.trim().length > 0;
    const copyButtonLabel = copied ? copiedLabel : copyLabel;

    // 消息级回退：仅 user 消息且带会话 uuid 时可用（provider/回合状态在 store 侧校验）。
    const rewindLabel = translateWithFallback(t, 'chat.rewind.action', 'Rewind to here');
    const rewindUnavailableLabel = translateWithFallback(
        t,
        'chat.rewind.unavailable',
        'Cannot rewind: only Claude sessions support this, and the turn must be finished.',
    );
    const canRewind = isUser && Boolean(message.raw?.uuid?.trim());
    const handleRewindConfirm = (restoreFiles: boolean) => {
        setRewindBusy(true);
        void useChatStore.getState()
            .rewindToMessage(paneTabKey, message.id, {restoreFiles})
            .then((ok) => {
                setRewindBusy(false);
                if (ok) {
                    setRewindOpen(false);
                } else {
                    showToast(rewindUnavailableLabel, 'warning');
                }
            });
    };

    /**
     * 消息操作条。改造前 assistant 的复制按钮是 `absolute right-1 top-1` 的孤零零
     * 一颗，长消息里根本够不着，也没有别的动作。现在收成统一的一组，
     * 悬停/聚焦显形，键盘可达。
     */
    const messageActions = (
        <div className="chat-message-actions">
            {canRewind && (
                <button
                    type="button"
                    className="chat-message-action"
                    title={rewindLabel}
                    aria-label={rewindLabel}
                    onClick={() => setRewindOpen(true)}
                >
                    <History size={13} />
                </button>
            )}
            {canCopy && (
                <button
                    type="button"
                    className="chat-message-action"
                    title={quoteLabel}
                    aria-label={quoteLabel}
                    onClick={handleQuote}
                >
                    <Quote size={13} />
                </button>
            )}
            {canCopy && (
                <button
                    type="button"
                    className={cn('chat-message-action', copied && 'chat-message-action-done')}
                    title={copyButtonLabel}
                    aria-label={copyButtonLabel}
                    onClick={handleCopy}
                >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
            )}
        </div>
    );

    const messageContent = (
        <div
            className={cn(
                'min-w-0 text-sm font-normal leading-relaxed text-base-content',
                isAssistant ? 'assistant-message-content' : 'space-y-2',
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
                    streaming={Boolean(message.streaming)}
                />
            ) : message.content ? (
                <MarkdownBlock content={message.content} isStreaming={message.streaming} />
            ) : isUser ? (
                <span className="italic text-base-content/40">{emptyUserLabel}</span>
            ) : null}

            {message.error && !isAssistant && (
                <div className="flex items-start gap-2 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                    <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{message.error}</span>
                </div>
            )}
        </div>
    );

    // 压缩续接摘要：系统生成的交接材料而非用户发言，默认折叠成摘要卡。
    if (isUser && isCompactSummaryMessage(message)) {
        return (
            <article
                ref={anchorId ? handleAnchorRef : undefined}
                data-message-anchor-id={anchorId}
                className={cn(
                    'chat-message-row chat-message-row-compact',
                    isSearchMatch && 'chat-message-row-match',
                )}
            >
                <CompactSummaryBlock content={message.content} />
            </article>
        );
    }

    if (isUser) {
        return (
            <article
                ref={anchorId ? handleAnchorRef : undefined}
                data-message-anchor-id={anchorId}
                className={cn(
                    'chat-message-row user-message-row group',
                    isSearchMatch && 'chat-message-row-match',
                )}
            >
                <div
                    className={cn(
                        'user-message-bubble',
                        message.error && 'user-message-bubble-error',
                    )}
                >
                    <header className="chat-message-header">
                        <span className="chat-message-avatar">
                            <User size={12} />
                        </span>
                        <span className="chat-message-role">{roleLabel}</span>
                        <span className="chat-message-time tabular-nums">{time}</span>
                        <span className="flex-1" />
                        {messageActions}
                    </header>

                    {messageContent}

                    {message.error && (
                        <footer className="mt-2">
                            <MessageMeta durationMs={message.durationMs} usage={message.usage} />
                        </footer>
                    )}
                </div>
                {rewindOpen && (
                    <RewindConfirmDialog
                        messagePreview={message.content}
                        busy={rewindBusy}
                        onConfirm={handleRewindConfirm}
                        onCancel={() => {
                            if (!rewindBusy) setRewindOpen(false);
                        }}
                    />
                )}
            </article>
        );
    }

    if (isAssistant) {
        return (
            <article
                className={cn(
                    'chat-message-row assistant-message-flow group',
                    isSearchMatch && 'chat-message-row-match',
                    message.error && !isStoppedByUser && 'chat-message-row-error',
                )}
            >
                {messageContent}

                {assistantErrorNotice}

                {/* 收尾行：状态在左（流式=工作中指示器，完成=回合分隔条），操作在右。
                    放在正文下方而不是浮在右上角，既不遮挡首行，也正好落在读完的位置。 */}
                <footer className="chat-message-footer">
                    {message.streaming ? (
                        <WorkingIndicator
                            startedAt={message.createdAt}
                            outputTokens={message.usage?.output_tokens ?? 0}
                            activeToolName={turnActivity?.activeToolName ?? null}
                            completedToolCount={turnActivity?.completedToolCount ?? 0}
                        />
                    ) : (
                        <TurnCompleteDivider
                            durationMs={message.durationMs}
                            usage={message.usage}
                            stopped={isStoppedByUser}
                        />
                    )}
                    {messageActions}
                </footer>
            </article>
        );
    }

    return (
        <article
            className={cn(
                'chat-message-row system-message-card group',
                isSearchMatch && 'chat-message-row-match',
                message.error && 'chat-message-row-error',
            )}
        >
            <header className="chat-message-header">
                <span className="chat-message-role">{roleLabel}</span>
                <span className="chat-message-time tabular-nums">{time}</span>
                <span className="flex-1" />
                {messageActions}
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
