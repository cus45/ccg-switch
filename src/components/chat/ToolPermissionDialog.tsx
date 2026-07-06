import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Check, Copy, Loader2, ShieldAlert, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {ToolPermissionRequest} from '../../types/permission';
import {copyToClipboard} from '../../utils/bridge';
import {
    type DialogSubmissionRef,
    isEditableShortcutTarget,
    isEnterShortcutControl,
    markDialogSubmitted,
} from '../../utils/dialogShortcuts';

interface ToolPermissionDialogProps {
    request: ToolPermissionRequest;
    onAnswer: (allow: boolean) => void;
    /** 'modal'=全屏居中（默认）；'inline'=限定在最近的 relative 祖先内（侧聊面板就地弹出）。 */
    container?: 'modal' | 'inline';
}

type ToolPermissionShortcutAction = 'allow' | 'deny' | null;

const TOOL_PERMISSION_TITLE_ID = 'tool-permission-title';
const TOOL_PERMISSION_DESCRIPTION_ID = 'tool-permission-description';

const PRIORITY_INPUT_KEYS = [
    'command',
    'file_path',
    'path',
    'url',
    'pattern',
    'query',
    'description',
    'prompt',
];
const PRIMARY_INPUT_KEYS = ['command', 'content', 'text'] as const;
const PREVIEW_VALUE_LIMIT = 600;
const RAW_INPUT_LIMIT = 12_000;

type ToolPermissionPrimaryInputKey = typeof PRIMARY_INPUT_KEYS[number];

const TOOL_PERMISSION_FALLBACKS = {
    title: 'Tool permission required',
    description: (toolName: string) => `Tool ${toolName} wants to run. Confirm whether to allow this operation.`,
    parameters: 'Parameters',
    rawInput: 'Full input',
    cwd: 'Working directory:',
    deny: 'Deny',
    allowOnce: 'Allow once',
    shortcutAllow: 'Allow once',
    shortcutDeny: 'Deny',
    primaryCommand: 'Command',
    primaryContent: 'Content',
    primaryText: 'Text',
    copyPrimaryInput: 'Copy primary input',
    copiedPrimaryInput: 'Copied primary input',
};

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function translateWithFallback(
    t: TranslateFn,
    key: string,
    fallback: string,
    options?: Record<string, unknown>,
): string {
    const translated = t(key, options);
    return translated === key ? fallback : translated;
}

export function getToolPermissionDialogLabels(t: TranslateFn, toolName: string) {
    return {
        title: translateWithFallback(t, 'chat.permission.toolTitle', TOOL_PERMISSION_FALLBACKS.title),
        description: translateWithFallback(
            t,
            'chat.permission.toolDescription',
            TOOL_PERMISSION_FALLBACKS.description(toolName),
            {tool: toolName},
        ),
        parameters: translateWithFallback(t, 'chat.permission.parameters', TOOL_PERMISSION_FALLBACKS.parameters),
        rawInput: translateWithFallback(t, 'chat.permission.rawInput', TOOL_PERMISSION_FALLBACKS.rawInput),
        cwd: translateWithFallback(t, 'chat.permission.cwd', TOOL_PERMISSION_FALLBACKS.cwd),
        deny: translateWithFallback(t, 'chat.permission.deny', TOOL_PERMISSION_FALLBACKS.deny),
        allowOnce: translateWithFallback(t, 'chat.permission.allowOnce', TOOL_PERMISSION_FALLBACKS.allowOnce),
        shortcutAllow: translateWithFallback(
            t,
            'chat.permission.shortcutAllow',
            TOOL_PERMISSION_FALLBACKS.shortcutAllow,
        ),
        shortcutDeny: translateWithFallback(
            t,
            'chat.permission.shortcutDeny',
            TOOL_PERMISSION_FALLBACKS.shortcutDeny,
        ),
        primaryCommand: translateWithFallback(
            t,
            'chat.permission.primaryCommand',
            TOOL_PERMISSION_FALLBACKS.primaryCommand,
        ),
        primaryContent: translateWithFallback(
            t,
            'chat.permission.primaryContent',
            TOOL_PERMISSION_FALLBACKS.primaryContent,
        ),
        primaryText: translateWithFallback(
            t,
            'chat.permission.primaryText',
            TOOL_PERMISSION_FALLBACKS.primaryText,
        ),
        copyPrimaryInput: translateWithFallback(
            t,
            'chat.permission.copyPrimaryInput',
            TOOL_PERMISSION_FALLBACKS.copyPrimaryInput,
        ),
        copiedPrimaryInput: translateWithFallback(
            t,
            'chat.permission.copiedPrimaryInput',
            TOOL_PERMISSION_FALLBACKS.copiedPrimaryInput,
        ),
    };
}

function truncateText(value: string, limit: number): string {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}...`;
}

function stringifyValue(value: unknown): string {
    if (typeof value === 'string') return truncateText(value, PREVIEW_VALUE_LIMIT);
    if (value === null || value === undefined) return '';
    try {
        return truncateText(JSON.stringify(value), PREVIEW_VALUE_LIMIT);
    } catch {
        return truncateText(String(value), PREVIEW_VALUE_LIMIT);
    }
}

function stringifyFullValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function isDuplicateWorkingDirectory(key: string, value: unknown, cwd: string): boolean {
    return key === 'cwd' && typeof value === 'string' && value === cwd;
}

export function getToolPermissionPrimaryInput(
    inputs: Record<string, unknown>,
): [ToolPermissionPrimaryInputKey, string] | null {
    for (const key of PRIMARY_INPUT_KEYS) {
        if (!(key in inputs)) continue;
        const value = stringifyValue(inputs[key]);
        if (value.trim().length > 0) return [key, value];
    }
    return null;
}

export function getToolPermissionInputPreview(
    inputs: Record<string, unknown>,
    cwd: string,
    omittedKeys: string[] = [],
): Array<[string, string]> {
    const omittedKeySet = new Set(omittedKeys);
    const entries = Object.entries(inputs)
        .filter(([key, value]) => !isDuplicateWorkingDirectory(key, value, cwd) && !omittedKeySet.has(key));
    const priorityEntries = PRIORITY_INPUT_KEYS
        .filter((key) => entries.some(([entryKey]) => entryKey === key))
        .map((key) => {
            const [, value] = entries.find(([entryKey]) => entryKey === key) as [string, unknown];
            return [key, stringifyValue(value)] as [string, string];
        });
    const fallbackEntries = entries
        .filter(([key]) => !PRIORITY_INPUT_KEYS.includes(key))
        .slice(0, Math.max(0, 6 - priorityEntries.length))
        .map(([key, value]) => [key, stringifyValue(value)] as [string, string]);

    return [...priorityEntries, ...fallbackEntries]
        .filter(([, value]) => value.trim().length > 0)
        .slice(0, 6);
}

export function resolveToolPermissionShortcutAction(
    key: string,
    target: EventTarget | null,
): ToolPermissionShortcutAction {
    if (key === '1') {
        return isEditableShortcutTarget(target) ? null : 'allow';
    }
    if (key === '2') {
        return isEditableShortcutTarget(target) ? null : 'deny';
    }
    if (key === 'Escape') {
        return isEditableShortcutTarget(target) ? null : 'deny';
    }
    if (key === 'Enter') {
        return isEnterShortcutControl(target) ? null : 'allow';
    }
    return null;
}

export function submitToolPermissionDecision(
    submittedRef: DialogSubmissionRef,
    onFirstSubmit: () => void,
    onDecision: (allow: boolean) => void,
    allow: boolean,
): boolean {
    if (!markDialogSubmitted(submittedRef, onFirstSubmit)) return false;
    onDecision(allow);
    return true;
}

export default function ToolPermissionDialog({
    request,
    onAnswer,
    container = 'modal',
}: ToolPermissionDialogProps) {
    const {t} = useTranslation();
    const [submitted, setSubmitted] = useState(false);
    const [primaryInputCopied, setPrimaryInputCopied] = useState(false);
    const submittedRef = useRef(false);
    const primaryInputCopyTimerRef = useRef<number | null>(null);
    const primaryInput = useMemo(() => getToolPermissionPrimaryInput(request.inputs), [request.inputs]);
    const primaryInputCopyText = useMemo(
        () => primaryInput ? stringifyFullValue(request.inputs[primaryInput[0]]) : '',
        [primaryInput, request.inputs],
    );
    const inputPreview = useMemo(
        () => getToolPermissionInputPreview(
            request.inputs,
            request.cwd,
            primaryInput ? [primaryInput[0]] : [],
        ),
        [request.cwd, request.inputs, primaryInput],
    );
    const rawInput = useMemo(() => truncateText(JSON.stringify(request.inputs, null, 2), RAW_INPUT_LIMIT), [request.inputs]);
    const labels = useMemo(() => getToolPermissionDialogLabels(t, request.toolName), [t, request.toolName]);
    const primaryInputLabel = primaryInput ? {
        command: labels.primaryCommand,
        content: labels.primaryContent,
        text: labels.primaryText,
    }[primaryInput[0]] : null;
    const primaryInputCopyLabel = primaryInputCopied ? labels.copiedPrimaryInput : labels.copyPrimaryInput;
    const allowActionLabel = `${labels.allowOnce} (1 / Enter)`;
    const denyActionLabel = `${labels.deny} (2 / Esc)`;

    useEffect(() => {
        submittedRef.current = false;
        setSubmitted(false);
        setPrimaryInputCopied(false);
    }, [request]);

    useEffect(() => () => {
        if (primaryInputCopyTimerRef.current !== null) {
            window.clearTimeout(primaryInputCopyTimerRef.current);
        }
    }, []);

    const markSubmittedBusy = useCallback(() => {
        setSubmitted(true);
    }, []);

    const handleDeny = useCallback(() => {
        submitToolPermissionDecision(submittedRef, markSubmittedBusy, onAnswer, false);
    }, [markSubmittedBusy, onAnswer]);
    const handleAllow = useCallback(() => {
        submitToolPermissionDecision(submittedRef, markSubmittedBusy, onAnswer, true);
    }, [markSubmittedBusy, onAnswer]);
    const handleCopyPrimaryInput = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (!primaryInput || !primaryInputCopyText.trim()) return;

        await copyToClipboard(primaryInputCopyText);
        setPrimaryInputCopied(true);
        if (primaryInputCopyTimerRef.current !== null) {
            window.clearTimeout(primaryInputCopyTimerRef.current);
        }
        primaryInputCopyTimerRef.current = window.setTimeout(() => {
            setPrimaryInputCopied(false);
            primaryInputCopyTimerRef.current = null;
        }, 1600);
    }, [primaryInput, primaryInputCopyText]);

    useEffect(() => {
        // inline（侧聊就地弹出）不占用全局快捷键，避免与中心 modal 双触发。
        if (container === 'inline') return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            const action = resolveToolPermissionShortcutAction(event.key, event.target);
            if (!action) return;
            event.preventDefault();
            if (action === 'allow') {
                handleAllow();
            } else {
                handleDeny();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [container, handleAllow, handleDeny]);

    const inline = container === 'inline';
    const overlay = (
        <div
            className={inline
                ? 'absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-3'
                : 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-6'}
            onClick={handleDeny}
        >
                <div
                    className={`flex ${inline ? 'max-h-full' : 'max-h-[82vh]'} w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-2xl`}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={TOOL_PERMISSION_TITLE_ID}
                    aria-describedby={TOOL_PERMISSION_DESCRIPTION_ID}
                    aria-busy={submitted}
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
                                <ShieldAlert className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <h3
                                    id={TOOL_PERMISSION_TITLE_ID}
                                    className="truncate text-sm font-semibold text-base-content"
                                >
                                    {labels.title}
                                </h3>
                                <p className="truncate text-xs text-base-content/60">
                                    {request.toolName}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-circle"
                            title={labels.deny}
                            aria-label={labels.deny}
                            onClick={handleDeny}
                            disabled={submitted}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-4 py-4">
                        <div className="space-y-4">
                            <div
                                id={TOOL_PERMISSION_DESCRIPTION_ID}
                                className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-base-content"
                            >
                                {labels.description}
                            </div>

                            {primaryInput && primaryInputLabel && (
                                <div
                                    className="overflow-hidden rounded-lg border border-base-300 bg-base-200/50"
                                    data-tool-permission-primary={primaryInput[0]}
                                >
                                    <div className="flex items-center justify-between gap-2 border-b border-base-300 px-3 py-2">
                                        <div className="text-xs font-medium uppercase tracking-wide text-base-content/45">
                                            {primaryInputLabel}
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-xs min-h-0 h-6 px-2 text-base-content/60 hover:text-base-content"
                                            title={primaryInputCopyLabel}
                                            aria-label={primaryInputCopyLabel}
                                            data-tool-permission-primary-copy={primaryInput[0]}
                                            onClick={handleCopyPrimaryInput}
                                            disabled={!primaryInputCopyText.trim()}
                                        >
                                            {primaryInputCopied
                                                ? <Check className="h-3.5 w-3.5" />
                                                : <Copy className="h-3.5 w-3.5" />}
                                        </button>
                                    </div>
                                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed text-base-content/85">
                                        {primaryInput[1]}
                                    </pre>
                                </div>
                            )}

                            {inputPreview.length > 0 && (
                                <div className="space-y-2">
                                    <div className="text-xs font-medium uppercase tracking-wide text-base-content/45">
                                        {labels.parameters}
                                    </div>
                                    <div className="space-y-1.5">
                                        {inputPreview.map(([key, value]) => (
                                            <div
                                                key={key}
                                                className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 rounded-md bg-base-200/70 px-3 py-2 text-xs"
                                            >
                                                <span className="truncate font-medium text-base-content/60">
                                                    {key}
                                                </span>
                                                <span className="min-w-0 break-words font-mono text-base-content/80">
                                                    {value}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <details className="rounded-lg border border-base-300 bg-base-200/40">
                                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-base-content/70">
                                    {labels.rawInput}
                                </summary>
                                <pre className="max-h-64 overflow-auto border-t border-base-300 p-3 text-xs leading-relaxed text-base-content/75">
                                    {rawInput}
                                </pre>
                            </details>

                            <div className="truncate text-xs text-base-content/50" title={request.cwd}>
                                <span className="font-medium">{labels.cwd}</span>
                                {' '}
                                {request.cwd}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3 border-t border-base-300 px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                title={denyActionLabel}
                                aria-label={denyActionLabel}
                                onClick={handleDeny}
                                disabled={submitted}
                            >
                                <X className="h-4 w-4" />
                                {labels.deny}
                                <kbd className="kbd kbd-xs">2</kbd>
                            </button>
                            <button
                                type="button"
                                className="btn btn-success btn-sm"
                                title={allowActionLabel}
                                aria-label={allowActionLabel}
                                onClick={handleAllow}
                                disabled={submitted}
                            >
                                {submitted ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Check className="h-4 w-4" />
                                )}
                                {labels.allowOnce}
                                <kbd className="kbd kbd-xs">1</kbd>
                            </button>
                        </div>
                        <div className="flex items-center justify-end gap-3 text-xs text-base-content/50">
                            <span className="inline-flex items-center gap-1.5">
                                <kbd>1</kbd>
                                <span className="hint-label">{labels.shortcutAllow}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <kbd>2</kbd>
                                <span className="hint-label">{labels.shortcutDeny}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <kbd>Enter</kbd>
                                <span className="hint-label">{labels.shortcutAllow}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <kbd>Esc</kbd>
                                <span className="hint-label">{labels.shortcutDeny}</span>
                            </span>
                        </div>
                    </div>
                </div>
        </div>
    );

    if (inline) {
        return overlay;
    }

    return createPortal(
        <>
            <div
                className="fixed top-0 left-0 right-0 h-8 z-[9998]"
                data-tauri-drag-region
            />
            {overlay}
        </>,
        document.body,
    );
}
