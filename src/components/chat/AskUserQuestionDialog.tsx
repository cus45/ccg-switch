import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Loader2, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {AskUserQuestionRequest} from '../../types/permission';
import {isEditableShortcutTarget, markDialogSubmitted} from '../../utils/dialogShortcuts';

type AskUserQuestionShortcutAction = 'cancel' | null;

interface AskUserQuestionDialogProps {
    request: AskUserQuestionRequest;
    onAnswer: (answers: Record<string, string>) => void;
    onCancel: () => void;
    /** 'modal'=全屏居中（默认）；'inline'=限定在最近的 relative 祖先内（侧聊面板就地弹出）。 */
    container?: 'modal' | 'inline';
}

const ASK_USER_QUESTION_FALLBACKS = {
    title: 'Permission request',
    close: 'Close',
    cancel: 'Cancel',
    submit: 'Submit',
    submitting: 'Submitting...',
    shortcutCancel: 'Cancel',
    customAnswerLabel: 'Other',
    customAnswerPlaceholder: 'Type a custom answer...',
    customAnswerHint: 'Use this when the available options do not fit.',
    customAnswerRequiredLabel: 'Answer',
    customAnswerRequiredHint: 'Type an answer to continue.',
    progressSummary: (answered: number, total: number) => `${answered} / ${total} answered`,
    questionProgress: (current: number, total: number) => `Question ${current} of ${total}`,
    questionRequired: 'Required',
    questionAnswered: 'Answered',
    invalidQuestionFormat: 'Question data is not available. Cancel and try again.',
    submitBlockedHint: (remaining: number) => (
        `Answer ${remaining} required ${remaining === 1 ? 'question' : 'questions'} before submitting.`
    ),
};

const ASK_USER_QUESTION_TITLE_ID = 'ask-user-question-title';
const ASK_USER_QUESTION_DESCRIPTION_ID = 'ask-user-question-description';
const MAX_CUSTOM_ANSWER_LENGTH = 2000;

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

export function getAskUserQuestionDialogLabels(t: TranslateFn, header?: string) {
    const normalizedHeader = header?.trim();
    return {
        title: normalizedHeader || translateWithFallback(t, 'chat.askUser.title', ASK_USER_QUESTION_FALLBACKS.title),
        close: translateWithFallback(t, 'common.close', ASK_USER_QUESTION_FALLBACKS.close),
        cancel: translateWithFallback(t, 'common.cancel', ASK_USER_QUESTION_FALLBACKS.cancel),
        submit: translateWithFallback(t, 'chat.askUser.submit', ASK_USER_QUESTION_FALLBACKS.submit),
        submitting: translateWithFallback(t, 'chat.askUser.submitting', ASK_USER_QUESTION_FALLBACKS.submitting),
        shortcutCancel: translateWithFallback(
            t,
            'chat.askUser.shortcutCancel',
            ASK_USER_QUESTION_FALLBACKS.shortcutCancel,
        ),
        customAnswerLabel: translateWithFallback(
            t,
            'chat.askUser.customAnswerLabel',
            ASK_USER_QUESTION_FALLBACKS.customAnswerLabel,
        ),
        customAnswerPlaceholder: translateWithFallback(
            t,
            'chat.askUser.customAnswerPlaceholder',
            ASK_USER_QUESTION_FALLBACKS.customAnswerPlaceholder,
        ),
        customAnswerHint: translateWithFallback(
            t,
            'chat.askUser.customAnswerHint',
            ASK_USER_QUESTION_FALLBACKS.customAnswerHint,
        ),
        customAnswerRequiredLabel: translateWithFallback(
            t,
            'chat.askUser.customAnswerRequiredLabel',
            ASK_USER_QUESTION_FALLBACKS.customAnswerRequiredLabel,
        ),
        customAnswerRequiredHint: translateWithFallback(
            t,
            'chat.askUser.customAnswerRequiredHint',
            ASK_USER_QUESTION_FALLBACKS.customAnswerRequiredHint,
        ),
        questionRequired: translateWithFallback(
            t,
            'chat.askUser.questionRequired',
            ASK_USER_QUESTION_FALLBACKS.questionRequired,
        ),
        questionAnswered: translateWithFallback(
            t,
            'chat.askUser.questionAnswered',
            ASK_USER_QUESTION_FALLBACKS.questionAnswered,
        ),
        invalidQuestionFormat: translateWithFallback(
            t,
            'chat.askUser.invalidQuestionFormat',
            ASK_USER_QUESTION_FALLBACKS.invalidQuestionFormat,
        ),
    };
}

export function getAskUserQuestionCustomAnswerChrome(
    labels: ReturnType<typeof getAskUserQuestionDialogLabels>,
    hasOptions: boolean,
) {
    return {
        label: hasOptions ? labels.customAnswerLabel : labels.customAnswerRequiredLabel,
        hint: hasOptions ? labels.customAnswerHint : labels.customAnswerRequiredHint,
    };
}

export function getAskUserQuestionProgressSummary(
    t: TranslateFn,
    answered: number,
    total: number,
): string {
    return translateWithFallback(
        t,
        'chat.askUser.progressSummary',
        ASK_USER_QUESTION_FALLBACKS.progressSummary(answered, total),
        {answered, total},
    );
}

export function getAskUserQuestionProgressLabel(
    t: TranslateFn,
    current: number,
    total: number,
): string {
    return translateWithFallback(
        t,
        'chat.askUser.questionProgress',
        ASK_USER_QUESTION_FALLBACKS.questionProgress(current, total),
        {current, total},
    );
}

export function getAskUserQuestionSubmitBlockedHint(
    t: TranslateFn,
    remaining: number,
): string {
    const normalizedRemaining = Math.max(0, remaining);
    return translateWithFallback(
        t,
        'chat.askUser.submitBlockedHint',
        ASK_USER_QUESTION_FALLBACKS.submitBlockedHint(normalizedRemaining),
        {remaining: normalizedRemaining, count: normalizedRemaining},
    );
}

export function resolveAskUserQuestionShortcutAction(
    key: string,
    target: EventTarget | null,
): AskUserQuestionShortcutAction {
    if (key === 'Escape') {
        return isEditableShortcutTarget(target) ? null : 'cancel';
    }
    return null;
}

export function canSubmitAskUserQuestionAnswers(
    questions: AskUserQuestionRequest['questions'],
    answers: Record<string, string>,
    customAnswers: Record<string, string> = {},
): boolean {
    if (questions.length === 0) return false;
    const payload = buildAskUserQuestionAnswerPayload(questions, answers, customAnswers);
    return questions.every((question) => {
        const answer = payload[question.question];
        if (!answer) return false;
        return answer.split(',').some((value) => value.trim().length > 0);
    });
}

export function countAnsweredAskUserQuestions(
    questions: AskUserQuestionRequest['questions'],
    answers: Record<string, string>,
    customAnswers: Record<string, string> = {},
): number {
    return questions.filter((question) => isAskUserQuestionAnswered(question, answers, customAnswers)).length;
}

export function isAskUserQuestionAnswered(
    question: AskUserQuestionRequest['questions'][number],
    answers: Record<string, string>,
    customAnswers: Record<string, string> = {},
): boolean {
    const payload = buildAskUserQuestionAnswerPayload([question], answers, customAnswers);
    const answer = payload[question.question];
    if (!answer) return false;
    return answer.split(',').some((value) => value.trim().length > 0);
}

function splitAnswerValues(answer: string | undefined): string[] {
    if (!answer) return [];
    return answer
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

export function buildAskUserQuestionAnswerPayload(
    questions: AskUserQuestionRequest['questions'],
    answers: Record<string, string>,
    customAnswers: Record<string, string> = {},
): Record<string, string> {
    const payload: Record<string, string> = {};

    questions.forEach((question) => {
        const selectedValues = splitAnswerValues(answers[question.question]);
        const customAnswer = customAnswers[question.question]?.trim() ?? '';
        let values = question.multiSelect ? selectedValues : selectedValues.slice(0, 1);

        if (customAnswer) {
            values = question.multiSelect ? [...values, customAnswer] : [customAnswer];
        }

        if (values.length > 0) {
            payload[question.question] = values.join(',');
        }
    });

    return payload;
}

export default function AskUserQuestionDialog({
    request,
    onAnswer,
    onCancel,
    container = 'modal',
}: AskUserQuestionDialogProps) {
    const {t} = useTranslation();
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
    const [submitted, setSubmitted] = useState(false);
    const submittedRef = useRef(false);
    const labels = useMemo(
        () => getAskUserQuestionDialogLabels(t, request.questions[0]?.header),
        [request.questions, t],
    );
    const cancelActionLabel = `${labels.cancel} (Esc)`;
    const hasQuestions = request.questions.length > 0;
    const canSubmit = useMemo(
        () => canSubmitAskUserQuestionAnswers(request.questions, answers, customAnswers),
        [answers, customAnswers, request.questions],
    );
    const answeredQuestionCount = useMemo(
        () => countAnsweredAskUserQuestions(request.questions, answers, customAnswers),
        [answers, customAnswers, request.questions],
    );
    const progressSummary = useMemo(
        () => getAskUserQuestionProgressSummary(t, answeredQuestionCount, request.questions.length),
        [answeredQuestionCount, request.questions.length, t],
    );
    const remainingQuestionCount = Math.max(0, request.questions.length - answeredQuestionCount);
    const submitBlockedHint = useMemo(
        () => getAskUserQuestionSubmitBlockedHint(t, remainingQuestionCount),
        [remainingQuestionCount, t],
    );
    const submitActionLabel = !canSubmit && !submitted
        ? `${labels.submit}: ${submitBlockedHint}`
        : labels.submit;

    useEffect(() => {
        submittedRef.current = false;
        setSubmitted(false);
        setAnswers({});
        setCustomAnswers({});
    }, [request]);

    const markSubmitted = useCallback(
        () => markDialogSubmitted(submittedRef, () => setSubmitted(true)),
        [],
    );

    const handleSubmit = useCallback(() => {
        if (!canSubmit) return;
        if (!markSubmitted()) return;
        onAnswer(buildAskUserQuestionAnswerPayload(request.questions, answers, customAnswers));
    }, [answers, canSubmit, customAnswers, markSubmitted, onAnswer, request.questions]);

    const handleCancel = useCallback(() => {
        if (!markSubmitted()) return;
        onCancel();
    }, [markSubmitted, onCancel]);

    useEffect(() => {
        // inline（侧聊就地弹出）不占用全局快捷键，避免与中心 modal 双触发。
        if (container === 'inline') return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            const action = resolveAskUserQuestionShortcutAction(event.key, event.target);
            if (!action) return;
            event.preventDefault();
            handleCancel();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [container, handleCancel]);

    const inline = container === 'inline';
    const overlay = (
        <div
            className={inline
                ? 'absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-3'
                : 'fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-6'}
            onClick={handleCancel}
        >
                <div
                    className={`bg-white dark:bg-base-100 rounded-xl shadow-2xl max-w-2xl w-full ${inline ? 'max-h-full' : 'max-h-[80vh]'} overflow-hidden flex flex-col`}
                    aria-busy={submitted}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={ASK_USER_QUESTION_TITLE_ID}
                    aria-describedby={ASK_USER_QUESTION_DESCRIPTION_ID}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* 头部 */}
                    <div className="flex items-center justify-between gap-4 p-4 border-b border-gray-200 dark:border-base-200">
                        <div className="min-w-0">
                            <h3
                                id={ASK_USER_QUESTION_TITLE_ID}
                                className="truncate text-lg font-semibold text-gray-900 dark:text-base-content"
                            >
                                {labels.title}
                            </h3>
                            {hasQuestions && (
                                <p className="mt-1 text-xs text-gray-500 dark:text-base-content/60">
                                    {progressSummary}
                                </p>
                            )}
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
                        {!hasQuestions ? (
                            <p
                                id={ASK_USER_QUESTION_DESCRIPTION_ID}
                                className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning dark:text-warning"
                            >
                                {labels.invalidQuestionFormat}
                            </p>
                        ) : request.questions.map((q, idx) => {
                            const customAnswerChrome = getAskUserQuestionCustomAnswerChrome(
                                labels,
                                q.options.length > 0,
                            );
                            const questionHeader = q.header.trim();

                            return (
                                <div key={idx} className="space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1 space-y-1">
                                        {questionHeader && (
                                            <span className="inline-flex max-w-full rounded border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500 dark:border-base-200 dark:text-base-content/60">
                                                {questionHeader}
                                            </span>
                                        )}
                                        <label
                                            id={idx === 0 ? ASK_USER_QUESTION_DESCRIPTION_ID : undefined}
                                            className="block text-sm font-medium text-gray-700 dark:text-base-content"
                                        >
                                            {q.question}
                                        </label>
                                    </div>
                                    {request.questions.length > 1 && (
                                        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                                            <span className="badge badge-ghost badge-sm">
                                                {getAskUserQuestionProgressLabel(t, idx + 1, request.questions.length)}
                                            </span>
                                            <span
                                                className={`badge badge-sm ${
                                                    isAskUserQuestionAnswered(q, answers, customAnswers)
                                                        ? 'badge-success'
                                                        : 'badge-warning'
                                                }`}
                                            >
                                                {isAskUserQuestionAnswered(q, answers, customAnswers)
                                                    ? labels.questionAnswered
                                                    : labels.questionRequired}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {q.multiSelect ? (
                                    // 多选（checkbox）
                                    <div className="space-y-2">
                                        {q.options.map((opt) => (
                                            <label
                                                key={opt.label}
                                                className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-base-200 hover:bg-gray-50 dark:hover:bg-base-200 cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="checkbox checkbox-sm mt-0.5"
                                                    disabled={submitted}
                                                    checked={
                                                        answers[q.question]
                                                            ?.split(',')
                                                            .includes(opt.label) || false
                                                    }
                                                    onChange={(e) => {
                                                        const current = answers[q.question]
                                                            ?.split(',')
                                                            .filter(Boolean) || [];
                                                        const next = e.target.checked
                                                            ? [...current, opt.label]
                                                            : current.filter((v) => v !== opt.label);
                                                        setAnswers({
                                                            ...answers,
                                                            [q.question]: next.join(','),
                                                        });
                                                    }}
                                                />
                                                <div className="flex-1">
                                                    <div className="font-medium text-gray-900 dark:text-base-content">
                                                        {opt.label}
                                                    </div>
                                                    <div className="text-sm text-gray-500 dark:text-base-content/70 mt-1">
                                                        {opt.description}
                                                    </div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                ) : (
                                    // 单选（radio）
                                    <div className="space-y-2">
                                        {q.options.map((opt) => (
                                            <label
                                                key={opt.label}
                                                className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-base-200 hover:bg-gray-50 dark:hover:bg-base-200 cursor-pointer"
                                            >
                                                <input
                                                    type="radio"
                                                    name={`question-${idx}`}
                                                    className="radio radio-sm mt-0.5"
                                                    disabled={submitted}
                                                    checked={answers[q.question] === opt.label}
                                                    onChange={() =>
                                                        setAnswers({
                                                            ...answers,
                                                            [q.question]: opt.label,
                                                        })
                                                    }
                                                />
                                                <div className="flex-1">
                                                    <div className="font-medium text-gray-900 dark:text-base-content">
                                                        {opt.label}
                                                    </div>
                                                    <div className="text-sm text-gray-500 dark:text-base-content/70 mt-1">
                                                        {opt.description}
                                                    </div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                )}
                                <div className="space-y-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-3 dark:border-base-200 dark:bg-base-200/30">
                                    <label
                                        className="block text-sm font-medium text-gray-700 dark:text-base-content"
                                        htmlFor={`ask-user-custom-answer-${idx}`}
                                    >
                                        {customAnswerChrome.label}
                                    </label>
                                    <textarea
                                        id={`ask-user-custom-answer-${idx}`}
                                        className="textarea textarea-bordered min-h-20 w-full resize-y text-sm"
                                        value={customAnswers[q.question] ?? ''}
                                        placeholder={labels.customAnswerPlaceholder}
                                        maxLength={MAX_CUSTOM_ANSWER_LENGTH}
                                        disabled={submitted}
                                        onChange={(e) => {
                                            setCustomAnswers({
                                                ...customAnswers,
                                                [q.question]: e.target.value.slice(0, MAX_CUSTOM_ANSWER_LENGTH),
                                            });
                                        }}
                                    />
                                    <p className="text-xs text-gray-500 dark:text-base-content/60">
                                        {customAnswerChrome.hint}
                                    </p>
                                </div>
                            </div>
                            );
                        })}
                    </div>

                    {/* 底部按钮 */}
                    <div className="space-y-3 border-t border-gray-200 p-4 dark:border-base-200">
                        {hasQuestions && !canSubmit && !submitted && (
                            <p className="text-right text-xs text-warning dark:text-warning">
                                {submitBlockedHint}
                            </p>
                        )}
                        <div className="flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={handleCancel}
                                className="btn btn-ghost btn-sm"
                                title={cancelActionLabel}
                                aria-label={cancelActionLabel}
                                disabled={submitted}
                            >
                                {labels.cancel}
                            </button>
                            {hasQuestions && (
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    className="btn btn-sm bg-gradient-to-r from-blue-500 to-purple-500 text-white border-none hover:from-blue-600 hover:to-purple-600 disabled:opacity-70"
                                    title={submitActionLabel}
                                    aria-label={submitActionLabel}
                                    disabled={submitted || !canSubmit}
                                >
                                    {submitted && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {submitted ? labels.submitting : labels.submit}
                                </button>
                            )}
                        </div>
                        <div className="flex items-center justify-end gap-3 text-xs text-gray-500 dark:text-base-content/50">
                            <span className="inline-flex items-center gap-1.5">
                                <kbd>Esc</kbd>
                                <span className="hint-label">{labels.shortcutCancel}</span>
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
            {/* 拖拽条（防止模态层遮挡窗口标题栏） */}
            <div
                className="fixed top-0 left-0 right-0 h-8 z-[9998]"
                data-tauri-drag-region
            />
            {overlay}
        </>,
        document.body,
    );
}
