// RewindConfirmDialog - 「回退到此消息重来」确认弹窗（消息级 rewind/fork，仅 Claude）

import {useState} from 'react';
import {createPortal} from 'react-dom';
import {History, Loader2, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';

interface RewindConfirmDialogProps {
    /** 目标 user 消息的文本预览 */
    messagePreview: string;
    busy: boolean;
    onConfirm: (restoreFiles: boolean) => void;
    onCancel: () => void;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function translateWithFallback(t: TranslateFn, key: string, fallback: string): string {
    const translated = t(key);
    return translated === key ? fallback : translated;
}

/**
 * 两种回退模式：
 * - 仅对话：fork 会话文件在该消息处截断，工作区文件保持现状；
 * - 对话 + 文件：先经 SDK checkpoint 把工作区文件恢复到该时点，再 fork。
 */
export default function RewindConfirmDialog({
    messagePreview,
    busy,
    onConfirm,
    onCancel,
}: RewindConfirmDialogProps) {
    const {t} = useTranslation();
    const [restoreFiles, setRestoreFiles] = useState(false);

    const title = translateWithFallback(t, 'chat.rewind.title', 'Rewind to this message');
    const description = translateWithFallback(
        t,
        'chat.rewind.description',
        'The conversation is forked at this message; later turns are removed from the new branch and the original text is restored to the composer.',
    );
    const conversationOnlyLabel = translateWithFallback(t, 'chat.rewind.conversationOnly', 'Conversation only');
    const conversationOnlyHint = translateWithFallback(
        t,
        'chat.rewind.conversationOnlyHint',
        'Workspace files stay as they are now.',
    );
    const withFilesLabel = translateWithFallback(t, 'chat.rewind.withFiles', 'Conversation + files');
    const withFilesHint = translateWithFallback(
        t,
        'chat.rewind.withFilesHint',
        'Also restore workspace files to the checkpoint taken at this message (Claude file checkpointing).',
    );
    const cancelLabel = translateWithFallback(t, 'common.cancel', 'Cancel');
    const confirmLabel = translateWithFallback(t, 'chat.rewind.confirm', 'Rewind');
    const closeLabel = translateWithFallback(t, 'common.close', 'Close');

    const dialog = (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={busy ? undefined : onCancel}
        >
            <div
                className="w-full max-w-md rounded-xl border border-base-300 bg-base-100 p-4 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/15 text-warning">
                            <History size={16} />
                        </span>
                        <h3 className="text-sm font-semibold text-base-content">{title}</h3>
                    </div>
                    <button
                        type="button"
                        className="btn btn-ghost btn-xs h-6 min-h-0 w-6 p-0"
                        onClick={onCancel}
                        disabled={busy}
                        title={closeLabel}
                        aria-label={closeLabel}
                    >
                        <X size={14} />
                    </button>
                </div>

                <p className="mb-2 text-xs leading-5 text-base-content/60">{description}</p>
                {messagePreview && (
                    <div className="mb-3 max-h-20 overflow-hidden rounded-lg border border-base-300/70 bg-base-200/40 px-3 py-2 text-xs text-base-content/70">
                        <span className="line-clamp-3 whitespace-pre-wrap break-words">{messagePreview}</span>
                    </div>
                )}

                <div className="mb-4 flex flex-col gap-2">
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-base-300/70 px-3 py-2 transition-colors hover:bg-base-200/40">
                        <input
                            type="radio"
                            name="rewind-mode"
                            className="radio radio-primary radio-xs mt-0.5"
                            checked={!restoreFiles}
                            onChange={() => setRestoreFiles(false)}
                            disabled={busy}
                        />
                        <span className="min-w-0">
                            <span className="block text-xs font-medium text-base-content">{conversationOnlyLabel}</span>
                            <span className="block text-[11px] text-base-content/55">{conversationOnlyHint}</span>
                        </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-base-300/70 px-3 py-2 transition-colors hover:bg-base-200/40">
                        <input
                            type="radio"
                            name="rewind-mode"
                            className="radio radio-primary radio-xs mt-0.5"
                            checked={restoreFiles}
                            onChange={() => setRestoreFiles(true)}
                            disabled={busy}
                        />
                        <span className="min-w-0">
                            <span className="block text-xs font-medium text-base-content">{withFilesLabel}</span>
                            <span className="block text-[11px] text-base-content/55">{withFilesHint}</span>
                        </span>
                    </label>
                </div>

                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={onCancel}
                        disabled={busy}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className="btn btn-warning btn-sm gap-1.5"
                        onClick={() => onConfirm(restoreFiles)}
                        disabled={busy}
                    >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );

    if (typeof document === 'undefined') return dialog;
    return createPortal(dialog, document.body);
}
