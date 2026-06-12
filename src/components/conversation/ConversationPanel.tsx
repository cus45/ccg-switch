import { useMemo } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConversationStore } from '../../stores/useConversationStore';
import type { ApprovalRequest, ConversationItem, ThreadStartInput } from '../../types/conversation';
import { ApprovalCard } from './ApprovalCard';
import { MessageItem } from './MessageItem';

interface ConversationPanelProps {
    threadId?: string | null;
    title?: string;
    threadStartInput?: ThreadStartInput | null;
    inputValue?: string;
    inputDisabled?: boolean;
    className?: string;
    onInputChange?: (value: string) => void;
    onSubmitPrompt?: (prompt: string) => void;
    onInterruptTurn?: (threadId: string, turnId: string) => void;
    onApproveApproval?: (request: ApprovalRequest, message?: string) => void;
    onDenyApproval?: (request: ApprovalRequest) => void;
}

const EMPTY_CONVERSATION_ITEMS: ConversationItem[] = [];
const EMPTY_APPROVAL_REQUESTS: ApprovalRequest[] = [];

export function ConversationPanel({
    threadId,
    title,
    threadStartInput,
    inputValue = '',
    inputDisabled = false,
    className = '',
    onInputChange,
    onSubmitPrompt,
    onInterruptTurn,
    onApproveApproval,
    onDenyApproval,
}: ConversationPanelProps) {
    const { t } = useTranslation();
    const conversationState = useConversationStore();
    const selectedThreadId = threadId ?? conversationState.activeThreadId;
    const thread = selectedThreadId ? conversationState.threads[selectedThreadId] : null;
    const items = selectedThreadId
        ? conversationState.items[selectedThreadId] ?? EMPTY_CONVERSATION_ITEMS
        : EMPTY_CONVERSATION_ITEMS;
    const streaming = selectedThreadId
        ? conversationState.streaming[selectedThreadId]
        : undefined;
    const error = selectedThreadId
        ? conversationState.errorsByThread[selectedThreadId] ?? null
        : null;
    const displayTitle = thread?.title || title || thread?.id || t('conversation.new_thread');
    const displayCwd = thread?.cwd || threadStartInput?.cwd;
    const canSubmit = Boolean(onSubmitPrompt && inputValue.trim() && !inputDisabled);

    const approvals = useMemo(() => {
        if (!selectedThreadId) return EMPTY_APPROVAL_REQUESTS;
        return Object.values(conversationState.pendingApprovals)
            .filter(request => request.threadId === selectedThreadId)
            .sort((left, right) => left.createdAt - right.createdAt);
    }, [conversationState.pendingApprovals, selectedThreadId]);

    if (!selectedThreadId && !threadStartInput) {
        return (
            <section className={`flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white/60 p-6 text-center dark:border-base-300 dark:bg-base-100/60 ${className}`}>
                <MessageSquare className="mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('conversation.no_thread', { defaultValue: 'No conversation selected' })}
                </p>
            </section>
        );
    }

    return (
        <section className={`flex min-h-0 flex-1 flex-col rounded-lg border border-gray-200/70 bg-white dark:border-base-200 dark:bg-base-100 ${className}`}>
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200/70 px-4 py-3 dark:border-base-200">
                <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-base-content">
                        {displayTitle}
                    </h3>
                    {displayCwd && (
                        <p className="mt-0.5 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                            {displayCwd}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {streaming?.active && (
                        <div className="inline-flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {t('conversation.streaming', { defaultValue: 'Streaming' })}
                            </span>
                            {onInterruptTurn && selectedThreadId && streaming.turnId && (
                                <button
                                    type="button"
                                    className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-900/40"
                                    onClick={() => onInterruptTurn(selectedThreadId, streaming.turnId!)}
                                >
                                    {t('conversation.stop')}
                                </button>
                            )}
                        </div>
                    )}
                    {thread && (
                        <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-base-200 dark:text-gray-300">
                            {t(`conversation.thread_status.${thread.status}`, { defaultValue: thread.status })}
                        </span>
                    )}
                </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {error && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                        {error}
                    </div>
                )}

                {approvals.length > 0 && (
                    <div className="mb-3 space-y-2">
                        {approvals.map(request => (
                            <ApprovalCard
                                key={request.id}
                                request={request}
                                disabled={!onApproveApproval || !onDenyApproval}
                                onApprove={onApproveApproval}
                                onDeny={onDenyApproval}
                            />
                        ))}
                    </div>
                )}

                {items.length === 0 ? (
                    <div className="flex min-h-48 flex-col items-center justify-center text-center text-gray-400 dark:text-gray-500">
                        <MessageSquare className="mb-2 h-8 w-8 opacity-50" />
                        <p className="text-sm">
                            {t('conversation.no_items', { defaultValue: 'No messages yet' })}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {items.map(item => (
                            <MessageItem key={item.id} item={item} />
                        ))}
                    </div>
                )}
            </div>

            <form
                className="border-t border-gray-200/70 p-3 dark:border-base-200"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (canSubmit) {
                        onSubmitPrompt?.(inputValue.trim());
                    }
                }}
            >
                <div className="flex items-end gap-2">
                    <textarea
                        value={inputValue}
                        disabled={inputDisabled}
                        onChange={(event) => onInputChange?.(event.target.value)}
                        placeholder={t('conversation.prompt_placeholder')}
                        rows={3}
                        className="min-h-20 flex-1 resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-70 dark:border-base-300 dark:bg-base-200 dark:text-base-content dark:focus:border-blue-500 dark:focus:bg-base-100"
                    />
                    {onSubmitPrompt && (
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {t('conversation.send')}
                        </button>
                    )}
                </div>
            </form>
        </section>
    );
}
