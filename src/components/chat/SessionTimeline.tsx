import {
    type RefObject,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertTriangle, GitFork, History, Loader2, Quote, RefreshCw } from 'lucide-react';
import type { ChatMessage, ToolResultBlock } from '../../types/chat';
import type { TimelineItem, ToolCall } from '../../types/timeline';
import { useSessionStream } from '../../hooks/useSessionStream';
import { getMessageSearchText } from '../../utils/chatNavigation';
import { cn } from '../../utils/cn';
import { useChatPaneTabKey } from './paneTabContext';
import { STOPPED_OUTPUT_ERROR, useChatStore } from '../../stores/useChatStore';
import { showToast } from '../common/ToastContainer';
import MessageItem, { appendQuoteToDraft, buildQuotedDraft } from './MessageItem';
import MarkdownBlock from './MarkdownBlock';
import ThinkingBlock from './ThinkingBlock';
import TurnCompleteDivider from './TurnCompleteDivider';
import WorkingIndicator from './WorkingIndicator';
import RewindConfirmDialog from './RewindConfirmDialog';
import {
    BashToolBlock,
    EditToolBlock,
    GenericToolBlock,
    PlanToolBlock,
    ReadToolBlock,
    TaskExecutionBlock,
    TodoToolBlock,
} from '../toolBlocks';

export interface SessionTimelineProps {
    messages: ChatMessage[];
    searchQuery?: string;
    fullHistorySearchStatus?: 'loading' | 'complete' | 'error' | null;
    scrollContainerRef?: RefObject<HTMLDivElement | null>;
    onCollapsedCountChange?: (count: number) => void;
    onMessageNodeRef?: (messageId: string, node: HTMLElement | null) => void;
    onRetryFullHistorySearch?: () => void;
    hasEarlierServerHistory?: boolean;
    isLoadingEarlierServerHistory?: boolean;
    onLoadEarlierServerHistory?: () => void;
    /** 启用虚拟化的阈值（默认 30 条） */
    virtualizedThreshold?: number;
    /** 会话分叉回调 */
    onForkMessage?: (message: ChatMessage) => void;
}

function getToolAnchorProps(toolIds: string[]) {
    const safeToolIds = toolIds.filter(Boolean);
    const anchorProps: {
        className: string;
        tabIndex: number;
        'data-chat-tool-id'?: string;
        'data-chat-tool-ids'?: string;
    } = {
        className: 'chat-tool-anchor scroll-mt-6 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/35',
        tabIndex: -1,
    };

    if (safeToolIds.length === 1) {
        anchorProps['data-chat-tool-id'] = safeToolIds[0];
    } else if (safeToolIds.length > 1) {
        anchorProps['data-chat-tool-ids'] = safeToolIds.join(' ');
    }

    return anchorProps;
}

function renderTimelineToolBlock(toolCall: ToolCall) {
    const { name, input, result, callId, kind } = toolCall;
    switch (kind) {
        case 'bash':
            return <BashToolBlock name={name} input={input} result={result} toolId={callId} compact />;
        case 'edit':
            return <EditToolBlock name={name} input={input} result={result} toolId={callId} compact />;
        case 'read':
            return <ReadToolBlock name={name} input={input} result={result} toolId={callId} compact />;
        case 'todo':
            return <TodoToolBlock name={name} input={input} result={result} toolId={callId} compact />;
        case 'plan':
            return <PlanToolBlock name={name} input={input} result={result} toolId={callId} compact />;
        case 'task':
            return <TaskExecutionBlock name={name} input={input} result={result} toolId={callId} compact />;
        default:
            return <GenericToolBlock name={name} input={input} result={result} toolId={callId} compact />;
    }
}

export default function SessionTimeline({
    messages,
    searchQuery = '',
    fullHistorySearchStatus = null,
    scrollContainerRef,
    onCollapsedCountChange,
    onMessageNodeRef,
    onRetryFullHistorySearch,
    hasEarlierServerHistory = false,
    isLoadingEarlierServerHistory = false,
    onLoadEarlierServerHistory,
    virtualizedThreshold = 30,
    onForkMessage,
}: SessionTimelineProps) {
    const { t } = useTranslation();
    const internalScrollRef = useRef<HTMLDivElement | null>(null);
    const activeScrollRef = scrollContainerRef ?? internalScrollRef;
    const shouldStickToBottomRef = useRef(true);
    const stickFrameRef = useRef<number | null>(null);

    // 状态流提取
    const { timeline, isStreaming } = useSessionStream(messages);

    // 搜索过滤与匹配
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();
    const isSearching = normalizedSearchQuery.length > 0;
    const showFullHistorySearchLoading = isSearching && fullHistorySearchStatus === 'loading';
    const showFullHistorySearchError = isSearching && fullHistorySearchStatus === 'error';

    const matchingMessageIdSet = useMemo(() => {
        if (!isSearching) return new Set<string>();
        const set = new Set<string>();
        for (const msg of messages) {
            if (getMessageSearchText(msg).includes(normalizedSearchQuery)) {
                set.add(msg.id);
            }
        }
        return set;
    }, [messages, isSearching, normalizedSearchQuery]);

    // 快速查找 ToolResult
    const toolResultMap = useMemo(() => {
        const map = new Map<string, ToolResultBlock>();
        for (const item of timeline) {
            if (item.type === 'tool' && item.toolCall.result) {
                map.set(item.toolCall.callId, item.toolCall.result);
            }
        }
        return map;
    }, [timeline]);

    const findToolResult = useCallback((toolId: string | undefined): ToolResultBlock | null => {
        if (!toolId) return null;
        return toolResultMap.get(toolId) ?? null;
    }, [toolResultMap]);

    // 虚拟化判断：项数超过阈值时启动 TanStack Virtualizer
    const isVirtualized = timeline.length > virtualizedThreshold;

    const stickToBottom = useCallback(() => {
        const container = activeScrollRef.current;
        if (!container) return;
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTo({ top: maxScrollTop, behavior: 'instant' });
    }, [activeScrollRef]);

    // 监听滚动位置，判断是否处于底部附近 (阈值 60px)
    useEffect(() => {
        const container = activeScrollRef.current;
        if (!container) return;

        const handleScroll = () => {
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            shouldStickToBottomRef.current = distanceFromBottom <= 60;
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            container.removeEventListener('scroll', handleScroll);
        };
    }, [activeScrollRef]);

    // 流式输出时，若吸底状态有效，自动保持吸底
    useEffect(() => {
        if (!shouldStickToBottomRef.current) return;
        if (stickFrameRef.current !== null) {
            cancelAnimationFrame(stickFrameRef.current);
        }
        stickFrameRef.current = requestAnimationFrame(() => {
            stickFrameRef.current = null;
            if (shouldStickToBottomRef.current) {
                stickToBottom();
            }
        });
    }, [timeline, isStreaming, stickToBottom]);

    const virtualizer = useVirtualizer({
        count: timeline.length,
        getScrollElement: () => activeScrollRef.current,
        enabled: isVirtualized,
        getItemKey: (index) => timeline[index]?.id ?? String(index),
        estimateSize: (index) => {
            const item = timeline[index];
            if (!item) return 80;
            if (item.type === 'tool') return 48;
            if (item.type === 'thought') return 42;
            if (item.type === 'compact') return 36;
            return 96;
        },
        overscan: 6,
    });

    // 告知上层折叠情况
    useEffect(() => {
        onCollapsedCountChange?.(0);
    }, [onCollapsedCountChange]);

    // Assistant 独立动作（重发/引用等）
    const paneTabKey = useChatPaneTabKey();
    const [rewindTargetMessage, setRewindTargetMessage] = useState<ChatMessage | null>(null);
    const [rewindBusy, setRewindBusy] = useState(false);

    const handleRewindConfirm = async (restoreFiles: boolean) => {
        if (!rewindTargetMessage) return;
        setRewindBusy(true);
        try {
            const ok = await useChatStore.getState().rewindToMessage(paneTabKey, rewindTargetMessage.id, { restoreFiles });
            if (ok) {
                setRewindTargetMessage(null);
            } else {
                showToast(t('chat.rewind.unavailable', 'Cannot rewind: only Claude sessions support this, and the turn must be finished.'), 'warning');
            }
        } catch (err) {
            showToast(t('chat.error.rewindFailed', { error: String(err) }), 'error');
        } finally {
            setRewindBusy(false);
        }
    };

    const handleQuote = (content: string) => {
        const quoted = buildQuotedDraft(content);
        const { draft, setDraft } = useChatStore.getState();
        setDraft(appendQuoteToDraft(draft, quoted));
    };

    // 渲染单条 TimelineItem
    const renderTimelineItem = (item: TimelineItem, index: number) => {
        const isMatch = isSearching && (
            (item.type === 'user_text' && matchingMessageIdSet.has(item.message.id))
            || (item.type === 'assistant_text' && matchingMessageIdSet.has(item.message.id))
            || (item.type === 'thought' && matchingMessageIdSet.has(item.messageId))
            || (item.type === 'tool' && matchingMessageIdSet.has(item.messageId))
        );

        if (item.type === 'compact') {
            return (
                <div
                    key={item.id}
                    className="my-3 flex items-center gap-3 px-2 text-xs text-base-content/40"
                    role="separator"
                >
                    <div className="h-px flex-1 bg-base-300" />
                    <span>
                        {t('chat.compactBoundary', {
                            trigger: item.info.trigger,
                            preTokens: item.info.preTokens,
                            defaultValue: `[Context Compacted · ${item.info.trigger}${item.info.preTokens ? ` · ${item.info.preTokens} tokens` : ''}]`,
                        })}
                    </span>
                    <div className="h-px flex-1 bg-base-300" />
                </div>
            );
        }

        if (item.type === 'user_text') {
            const isLast = index === timeline.length - 1;
            return (
                <div key={item.id} className="py-1">
                    <MessageItem
                        message={item.message}
                        isLast={isLast}
                        isSearchMatch={isMatch}
                        anchorId={item.message.id}
                        onAnchorRef={onMessageNodeRef}
                        findToolResult={findToolResult}
                    />
                </div>
            );
        }

        if (item.type === 'thought') {
            return (
                <div key={item.id} className="px-2 py-0.5">
                    <ThinkingBlock
                        content={item.content}
                        compact
                        streaming={item.isStreaming}
                    />
                </div>
            );
        }

        if (item.type === 'tool') {
            const anchorProps = getToolAnchorProps([item.toolCall.callId]);
            return (
                <div
                    key={item.id}
                    {...anchorProps}
                    className={cn(anchorProps.className, 'px-2 py-1')}
                >
                    {renderTimelineToolBlock(item.toolCall)}
                </div>
            );
        }

        if (item.type === 'assistant_text') {
            const isStopped = item.message.error === STOPPED_OUTPUT_ERROR;
            return (
                <article
                    key={item.id}
                    className={cn(
                        'chat-message-row assistant-message-flow group px-2 py-1',
                        isMatch && 'chat-message-row-match',
                        item.message.error && !isStopped && 'chat-message-row-error',
                    )}
                >
                    <div className="assistant-message-content min-w-0 text-sm font-normal leading-relaxed text-base-content">
                        {item.content ? (
                            <MarkdownBlock content={item.content} isStreaming={item.isStreaming} />
                        ) : null}
                    </div>

                    {item.message.error && !isStopped && (
                        <div className="mt-2 flex items-start gap-2 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                            <span>{item.message.error}</span>
                        </div>
                    )}

                    {item.isLastSegment && (
                        <footer className="chat-message-footer mt-2 flex items-center justify-between">
                            {item.isStreaming ? (
                                <WorkingIndicator
                                    startedAt={item.timestamp}
                                    outputTokens={item.tokenUsage?.output_tokens ?? 0}
                                />
                            ) : (
                                <TurnCompleteDivider
                                    durationMs={item.durationMs}
                                    usage={item.tokenUsage}
                                    stopped={isStopped}
                                />
                            )}

                            <div className="chat-message-actions opacity-0 transition-opacity group-hover:opacity-100 flex items-center gap-1">
                                {onForkMessage && (
                                    <button
                                        type="button"
                                        className="chat-message-action btn btn-ghost btn-xs"
                                        title={t('chat.message.fork', 'Fork session from here')}
                                        onClick={() => onForkMessage(item.message)}
                                    >
                                        <GitFork size={13} />
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="chat-message-action btn btn-ghost btn-xs"
                                    title={t('chat.message.quote', 'Quote in composer')}
                                    onClick={() => handleQuote(item.content)}
                                >
                                    <Quote size={13} />
                                </button>
                                <button
                                    type="button"
                                    className="chat-message-action btn btn-ghost btn-xs"
                                    title={t('chat.message.rewind', 'Rewind to here')}
                                    onClick={() => setRewindTargetMessage(item.message)}
                                >
                                    <History size={13} />
                                </button>
                            </div>
                        </footer>
                    )}
                </article>
            );
        }

        return null;
    };

    return (
        <div className="session-timeline w-full">
            {/* 顶部服务端历史加载按钮 */}
            {hasEarlierServerHistory && !isSearching && (
                <div className="mb-3 flex justify-center">
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm gap-2 text-xs text-base-content/60 hover:text-base-content"
                        disabled={isLoadingEarlierServerHistory}
                        onClick={onLoadEarlierServerHistory}
                    >
                        {isLoadingEarlierServerHistory ? (
                            <>
                                <Loader2 size={14} className="animate-spin" />
                                <span>{t('chat.layout.loadingEarlierServerHistory', 'Loading earlier history...')}</span>
                            </>
                        ) : (
                            <>
                                <RefreshCw size={14} />
                                <span>{t('chat.layout.loadEarlierServerHistory', 'Load earlier history from this session')}</span>
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* 搜索状态横幅 */}
            {isSearching && (
                <div className="mb-3 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2 text-xs text-base-content/70">
                    <div className="flex items-center justify-between">
                        <span>
                            {t('chat.layout.searchResults', {
                                count: matchingMessageIdSet.size,
                                defaultValue: `Found ${matchingMessageIdSet.size} matching message${matchingMessageIdSet.size === 1 ? '' : 's'}`,
                            })}
                        </span>
                        {showFullHistorySearchLoading && (
                            <span className="flex items-center gap-1 text-primary">
                                <Loader2 size={12} className="animate-spin" />
                                <span>{t('chat.layout.searchFullHistoryLoading', 'Searching complete history...')}</span>
                            </span>
                        )}
                        {showFullHistorySearchError && (
                            <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error"
                                onClick={onRetryFullHistorySearch}
                            >
                                {t('chat.layout.searchFullHistoryRetry', 'Retry')}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* 虚拟化容器 or 流式容器 */}
            {isVirtualized ? (
                <div
                    style={{
                        height: `${virtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                        const item = timeline[virtualRow.index];
                        return (
                            <div
                                key={virtualRow.key}
                                data-index={virtualRow.index}
                                ref={virtualizer.measureElement}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    transform: `translateY(${virtualRow.start}px)`,
                                }}
                            >
                                {renderTimelineItem(item, virtualRow.index)}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="space-y-1">
                    {timeline.map((item, index) => renderTimelineItem(item, index))}
                </div>
            )}

            {/* 回退确认弹窗 */}
            {rewindTargetMessage && (
                <RewindConfirmDialog
                    messagePreview={rewindTargetMessage.content}
                    busy={rewindBusy}
                    onConfirm={handleRewindConfirm}
                    onCancel={() => {
                        if (!rewindBusy) setRewindTargetMessage(null);
                    }}
                />
            )}
        </div>
    );
}
