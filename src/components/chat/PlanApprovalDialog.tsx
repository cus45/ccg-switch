import {useCallback, useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown, ChevronUp, Loader2, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {PlanApprovalRequest} from '../../types/permission';
import {
    type DialogSubmissionRef,
    isEditableShortcutTarget,
    isEnterShortcutControl,
    markDialogSubmitted,
} from '../../utils/dialogShortcuts';
import MarkdownBlock from './MarkdownBlock';

type PlanApprovalShortcutAction = 'approve' | 'cancel' | null;

interface PlanApprovalDialogProps {
    request: PlanApprovalRequest;
    onApprove: (approved: boolean, targetMode: string) => void;
    onCancel: () => void;
    /** 'modal'=全屏居中（默认）；'inline'=限定在最近的 relative 祖先内（侧聊面板就地弹出）。 */
    container?: 'modal' | 'inline';
}

const PLAN_APPROVAL_TITLE_ID = 'plan-approval-title';
const PLAN_APPROVAL_DESCRIPTION_ID = 'plan-approval-description';

const PLAN_APPROVAL_FALLBACKS = {
    title: 'Plan approval required',
    subtitle: 'Review the plan before approving execution.',
    close: 'Close',
    planSummary: (count: number) => `Plan (${count} lines)`,
    allowedActions: (count: number) => `Allowed actions (${count})`,
    cwd: 'Working directory:',
    deny: 'Deny',
    approve: 'Approve',
    approveAuto: 'Approve & Auto',
    approveAutoTitle: 'Approve and switch to auto mode; future operations are allowed automatically.',
    approveAutoHint: 'Auto mode will allow future operations automatically after this approval.',
    shortcutApprove: 'Approve',
    shortcutDeny: 'Deny',
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

export function getPlanApprovalDialogLabels(
    t: TranslateFn,
    planLineCount: number,
    allowedActionCount: number,
) {
    return {
        title: translateWithFallback(t, 'chat.planApproval.title', PLAN_APPROVAL_FALLBACKS.title),
        subtitle: translateWithFallback(t, 'chat.planApproval.subtitle', PLAN_APPROVAL_FALLBACKS.subtitle),
        close: translateWithFallback(t, 'common.close', PLAN_APPROVAL_FALLBACKS.close),
        planSummary: translateWithFallback(
            t,
            'chat.planApproval.planSummary',
            PLAN_APPROVAL_FALLBACKS.planSummary(planLineCount),
            {count: planLineCount},
        ),
        allowedActions: translateWithFallback(
            t,
            'chat.planApproval.allowedActions',
            PLAN_APPROVAL_FALLBACKS.allowedActions(allowedActionCount),
            {count: allowedActionCount},
        ),
        cwd: translateWithFallback(t, 'chat.planApproval.cwd', PLAN_APPROVAL_FALLBACKS.cwd),
        deny: translateWithFallback(t, 'chat.planApproval.deny', PLAN_APPROVAL_FALLBACKS.deny),
        approve: translateWithFallback(t, 'chat.planApproval.approve', PLAN_APPROVAL_FALLBACKS.approve),
        approveAuto: translateWithFallback(t, 'chat.planApproval.approveAuto', PLAN_APPROVAL_FALLBACKS.approveAuto),
        approveAutoTitle: translateWithFallback(
            t,
            'chat.planApproval.approveAutoTitle',
            PLAN_APPROVAL_FALLBACKS.approveAutoTitle,
        ),
        approveAutoHint: translateWithFallback(
            t,
            'chat.planApproval.approveAutoHint',
            PLAN_APPROVAL_FALLBACKS.approveAutoHint,
        ),
        shortcutApprove: translateWithFallback(
            t,
            'chat.planApproval.shortcutApprove',
            PLAN_APPROVAL_FALLBACKS.shortcutApprove,
        ),
        shortcutDeny: translateWithFallback(
            t,
            'chat.planApproval.shortcutDeny',
            PLAN_APPROVAL_FALLBACKS.shortcutDeny,
        ),
    };
}

export function resolvePlanApprovalShortcutAction(
    key: string,
    target: EventTarget | null,
): PlanApprovalShortcutAction {
    if (key === 'Escape') {
        return isEditableShortcutTarget(target) ? null : 'cancel';
    }
    if (key === 'Enter') {
        return isEnterShortcutControl(target) ? null : 'approve';
    }
    return null;
}

export function submitPlanApprovalDecision(
    submittedRef: DialogSubmissionRef,
    onFirstSubmit: () => void,
    onDecision: (approved: boolean, targetMode: string) => void,
    approved: boolean,
    targetMode: string,
): boolean {
    if (!markDialogSubmitted(submittedRef, onFirstSubmit)) return false;
    onDecision(approved, targetMode);
    return true;
}

export default function PlanApprovalDialog({
    request,
    onApprove,
    onCancel,
    container = 'modal',
}: PlanApprovalDialogProps) {
    const {t} = useTranslation();
    const [planExpanded, setPlanExpanded] = useState(true);
    const [submitted, setSubmitted] = useState(false);
    const submittedRef = useRef(false);
    const planLineCount = request.plan.split('\n').length;
    const labels = getPlanApprovalDialogLabels(t, planLineCount, request.allowedPrompts.length);
    const denyActionLabel = `${labels.deny} (Esc)`;
    const approveActionLabel = `${labels.approve} (Enter)`;

    useEffect(() => {
        submittedRef.current = false;
        setSubmitted(false);
        setPlanExpanded(true);
    }, [request]);

    const markSubmitted = useCallback(
        () => markDialogSubmitted(submittedRef, () => setSubmitted(true)),
        [],
    );

    const markSubmittedBusy = useCallback(() => {
        setSubmitted(true);
    }, []);

    const handleDeny = useCallback(() => {
        submitPlanApprovalDecision(submittedRef, markSubmittedBusy, onApprove, false, 'default');
    }, [markSubmittedBusy, onApprove]);

    const handleApprove = useCallback(() => {
        submitPlanApprovalDecision(submittedRef, markSubmittedBusy, onApprove, true, 'default');
    }, [markSubmittedBusy, onApprove]);

    const handleApproveAuto = useCallback(() => {
        submitPlanApprovalDecision(submittedRef, markSubmittedBusy, onApprove, true, 'auto');
    }, [markSubmittedBusy, onApprove]);

    const handleCancel = useCallback(() => {
        if (!markSubmitted()) return;
        onCancel();
    }, [markSubmitted, onCancel]);

    useEffect(() => {
        // inline（侧聊就地弹出）不占用全局快捷键，避免与中心 modal 双触发。
        if (container === 'inline') return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            const action = resolvePlanApprovalShortcutAction(event.key, event.target);
            if (!action) return;
            event.preventDefault();
            if (action === 'approve') {
                handleApprove();
            } else {
                handleDeny();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [container, handleApprove, handleDeny]);

    const inline = container === 'inline';
    const overlay = (
        <div
            className={inline
                ? 'absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-3'
                : 'fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-6'}
            onClick={handleCancel}
        >
                <div
                    className={`bg-white dark:bg-base-100 rounded-xl shadow-2xl max-w-4xl w-full ${inline ? 'max-h-full' : 'max-h-[85vh]'} overflow-hidden flex flex-col`}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={PLAN_APPROVAL_TITLE_ID}
                    aria-describedby={PLAN_APPROVAL_DESCRIPTION_ID}
                    aria-busy={submitted}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* 头部 */}
                    <div className="flex items-center justify-between gap-4 p-4 border-b border-gray-200 dark:border-base-200">
                        <div className="min-w-0">
                            <h3
                                id={PLAN_APPROVAL_TITLE_ID}
                                className="text-lg font-semibold text-gray-900 dark:text-base-content"
                            >
                                {labels.title}
                            </h3>
                            <p
                                id={PLAN_APPROVAL_DESCRIPTION_ID}
                                className="mt-1 text-sm text-gray-500 dark:text-base-content/60"
                            >
                                {labels.subtitle}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="btn btn-ghost btn-sm btn-circle"
                            title={labels.close}
                            aria-label={labels.close}
                            disabled={submitted}
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* 内容 */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {/* Plan 预览 */}
                        <div className="space-y-2">
                            <button
                                type="button"
                                onClick={() => setPlanExpanded(!planExpanded)}
                                className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-base-content hover:text-blue-600 dark:hover:text-blue-400"
                                aria-expanded={planExpanded}
                            >
                                {planExpanded ? (
                                    <ChevronUp className="w-4 h-4" />
                                ) : (
                                    <ChevronDown className="w-4 h-4" />
                                )}
                                {labels.planSummary}
                            </button>
                            {planExpanded && (
                                <div className="max-h-96 overflow-auto rounded-lg bg-gray-50 p-4 text-sm text-gray-800 dark:bg-base-200 dark:text-base-content">
                                    <MarkdownBlock content={request.plan} />
                                </div>
                            )}
                        </div>

                        {/* Allowed Prompts */}
                        {request.allowedPrompts.length > 0 && (
                            <div className="space-y-3">
                                <div className="text-sm font-medium text-gray-700 dark:text-base-content">
                                    {labels.allowedActions}
                                </div>
                                <div className="space-y-2">
                                    {request.allowedPrompts.map((p, idx) => (
                                        <div
                                            key={idx}
                                            className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-base-200 rounded-lg"
                                        >
                                            <span className="badge badge-sm badge-primary shrink-0">
                                                {p.tool}
                                            </span>
                                            <span className="text-sm text-gray-600 dark:text-base-content/80">
                                                {p.prompt}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 工作目录 */}
                        <div className="text-xs text-gray-500 dark:text-base-content/60">
                            <span className="font-medium">{labels.cwd}</span> {request.cwd}
                        </div>
                    </div>

                    {/* 底部按钮 */}
                    <div className="space-y-3 border-t border-gray-200 p-4 dark:border-base-200">
                        <div className="flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={handleDeny}
                                className="btn btn-ghost btn-sm"
                                title={denyActionLabel}
                                aria-label={denyActionLabel}
                                disabled={submitted}
                            >
                                {labels.deny}
                            </button>
                            <button
                                type="button"
                                onClick={handleApprove}
                                className="btn btn-sm bg-gradient-to-r from-green-500 to-emerald-500 text-white border-none hover:from-green-600 hover:to-emerald-600"
                                title={approveActionLabel}
                                aria-label={approveActionLabel}
                                disabled={submitted}
                            >
                                {submitted && <Loader2 className="h-4 w-4 animate-spin" />}
                                {labels.approve}
                            </button>
                            <button
                                type="button"
                                onClick={handleApproveAuto}
                                className="btn btn-sm bg-gradient-to-r from-blue-500 to-purple-500 text-white border-none hover:from-blue-600 hover:to-purple-600"
                                title={labels.approveAutoTitle}
                                aria-label={labels.approveAutoTitle}
                                disabled={submitted}
                            >
                                {submitted && <Loader2 className="h-4 w-4 animate-spin" />}
                                {labels.approveAuto}
                            </button>
                        </div>
                        <div className="flex items-center justify-end gap-3 text-xs text-gray-500 dark:text-base-content/50">
                            <span className="inline-flex items-center gap-1.5">
                                <kbd>Enter</kbd>
                                <span className="hint-label">{labels.shortcutApprove}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <kbd>Esc</kbd>
                                <span className="hint-label">{labels.shortcutDeny}</span>
                            </span>
                        </div>
                        <p className="text-right text-xs text-amber-600 dark:text-amber-300">
                            {labels.approveAutoHint}
                        </p>
                    </div>
                </div>
        </div>
    );

    if (inline) {
        return overlay;
    }

    return createPortal(
        <>
            {/* 拖拽条 */}
            <div
                className="fixed top-0 left-0 right-0 h-8 z-[9998]"
                data-tauri-drag-region
            />
            {overlay}
        </>,
        document.body,
    );
}
