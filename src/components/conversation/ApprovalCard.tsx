import { Check, ShieldQuestion, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApprovalRequest } from '../../types/conversation';

interface ApprovalCardProps {
    request: ApprovalRequest;
    disabled?: boolean;
    onApprove?: (request: ApprovalRequest, message?: string) => void;
    onDeny?: (request: ApprovalRequest) => void;
}

export function ApprovalCard({ request, disabled = false, onApprove, onDeny }: ApprovalCardProps) {
    const { t } = useTranslation();
    const [responseText, setResponseText] = useState('');
    const filePath = metadataString(request.metadata, 'filePath');
    const diffSummary = metadataString(request.metadata, 'diffSummary');
    const prompt = metadataString(request.metadata, 'prompt');
    const options = useMemo(() => metadataStringArray(request.metadata, 'options').slice(0, 3), [
        request.metadata,
    ]);
    const approvalMessage = responseText.trim() || undefined;
    const isApproveDisabled = disabled || !onApprove;
    const isDenyDisabled = disabled || !onDeny;

    return (
        <section className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    <ShieldQuestion className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-medium text-gray-900 dark:text-base-content">
                            {request.title}
                        </h4>
                        <span className="rounded bg-white/80 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-base-100 dark:text-amber-300">
                            {t(`conversation.approval.${request.requestType}`, { defaultValue: request.requestType })}
                        </span>
                    </div>
                    {request.body && (
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-gray-300">
                            {request.body}
                        </p>
                    )}
                    {request.toolName && (
                        <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                            {request.toolName}
                        </p>
                    )}
                    {filePath && (
                        <p className="mt-1 truncate font-mono text-xs text-gray-600 dark:text-gray-300">
                            {filePath}
                        </p>
                    )}
                    {diffSummary && (
                        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-500 dark:text-gray-400">
                            {diffSummary}
                        </p>
                    )}
                    {request.cwd && (
                        <p className="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                            {request.cwd}
                        </p>
                    )}
                    {request.command && (
                        <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-gray-950 px-3 py-2 text-xs text-gray-100">
                            <code>{request.command}</code>
                        </pre>
                    )}
                    {request.requestType === 'user_input' && (
                        <div className="mt-2 space-y-2">
                            {prompt && (
                                <p className="text-xs text-gray-600 dark:text-gray-300">
                                    {prompt}
                                </p>
                            )}
                            {options.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {options.map(option => (
                                        <button
                                            key={option}
                                            type="button"
                                            disabled={isApproveDisabled}
                                            onClick={() => onApprove?.(request, option)}
                                            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800/70 dark:bg-base-100 dark:text-amber-200 dark:hover:bg-amber-950/40"
                                        >
                                            {option}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <textarea
                                value={responseText}
                                disabled={disabled}
                                onChange={(event) => setResponseText(event.target.value)}
                                placeholder={t('conversation.user_input_placeholder')}
                                rows={2}
                                className="w-full resize-none rounded-md border border-amber-200 bg-white px-2.5 py-2 text-xs text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-900/60 dark:bg-base-100 dark:text-base-content"
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="mt-3 flex justify-end gap-2">
                <button
                    type="button"
                    disabled={isDenyDisabled}
                    onClick={() => onDeny?.(request)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-base-300 dark:bg-base-100 dark:text-gray-200 dark:hover:bg-base-200"
                >
                    <X className="h-3.5 w-3.5" />
                    {t('conversation.deny', { defaultValue: 'Deny' })}
                </button>
                <button
                    type="button"
                    disabled={isApproveDisabled}
                    onClick={() => onApprove?.(request, approvalMessage)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Check className="h-3.5 w-3.5" />
                    {t('conversation.approve', { defaultValue: 'Approve' })}
                </button>
            </div>
        </section>
    );
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
    const value = metadata[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function metadataStringArray(metadata: Record<string, unknown>, key: string): string[] {
    const value = metadata[key];
    if (!Array.isArray(value)) return [];
    return value
        .filter((option): option is string => typeof option === 'string')
        .map(option => option.trim())
        .filter(Boolean);
}
