import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, X } from 'lucide-react';
import { useRequestDetail } from '../../hooks/useUsageQueries';
import {
    formatCost,
    formatEstimatedTokensPerSecond,
    formatNumber,
    formatOutputTokensPerSecond,
    getLocaleFromLanguage,
    isSessionLogRequest,
    parseFiniteNumber,
    SPEED_ESTIMATE_MIN_OUTPUT_TOKENS,
} from '../../utils/format';
import { cn } from '../../utils/cn';
import { chip, emptyState, iconBtn, muted } from './styles';
import { getUsageProviderLabel } from './providerLabel';
import { EffortChip } from './EffortChip';

/**
 * 单条请求详情面板
 *
 * 后端 `get_request_detail` 与 `useRequestDetail` hook 早已就绪，
 * 但日志表没有行点击，导致五项成本明细、TTFT、错误信息全都看不到。
 * 这个面板就是把那条链路接上。
 */

interface RequestDetailPanelProps {
    requestId: string | null;
    onClose: () => void;
}

/** 一个「标签 + 值」的字段行 */
function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4 py-1.5">
            <span className={cn('shrink-0 text-xs', muted)}>{label}</span>
            <span className="min-w-0 break-all text-right text-sm tabular-nums text-gray-800 dark:text-gray-100">
                {children}
            </span>
        </div>
    );
}

/** 区块底部的合计行 */
function Total({
    label,
    children,
    accent = false,
}: {
    label: string;
    children: ReactNode;
    accent?: boolean;
}) {
    return (
        <div className="mt-1 flex items-baseline justify-between border-t border-gray-200 pt-2 dark:border-base-200">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{label}</span>
            <span
                className={cn(
                    'text-base font-bold tabular-nums',
                    accent
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-900 dark:text-base-content'
                )}
            >
                {children}
            </span>
        </div>
    );
}

/** 区块容器 */
function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="rounded-lg border border-gray-100 bg-gray-50/60 px-4 py-3 dark:border-base-200 dark:bg-base-200/30">
            <h4 className={cn('mb-1 text-[11px] font-semibold uppercase tracking-wider', muted)}>
                {title}
            </h4>
            {children}
        </section>
    );
}

export function RequestDetailPanel({ requestId, onClose }: RequestDetailPanelProps) {
    const { t, i18n } = useTranslation();
    const { data: log, isLoading } = useRequestDetail(requestId);

    const locale = getLocaleFromLanguage(i18n.resolvedLanguage || i18n.language);

    // Esc 关闭 —— 模态面板必须能被键盘退出
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const multiplier = parseFiniteNumber(log?.costMultiplier) ?? 1;
    const totalTokens = (log?.inputTokens ?? 0) + (log?.outputTokens ?? 0);
    const ok = !!log && log.statusCode >= 200 && log.statusCode < 300;

    const exactTps = log ? formatOutputTokensPerSecond(log) : null;
    // 会话日志没有首字计时，速度是按日志时间戳估的，前面带 ≈
    const estimatedTps = exactTps == null && log ? formatEstimatedTokensPerSecond(log) : null;
    const isSession = !!log && isSessionLogRequest(log);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={t('usage.requestDetail')}
                className="animate-fadeIn flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-2xl dark:border-base-200 dark:bg-base-100"
                onClick={(e) => e.stopPropagation()}
            >
                {/* 头部 */}
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-base-200">
                    <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                            <FileText className="h-4 w-4" />
                        </div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-base-content">
                            {t('usage.requestDetail')}
                        </h3>
                        {log && (
                            <span className={chip(ok ? 'success' : 'error')}>{log.statusCode}</span>
                        )}
                    </div>
                    <button
                        type="button"
                        className={iconBtn}
                        onClick={onClose}
                        aria-label={t('common.close')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* 内容 */}
                <div className="flex-1 space-y-3 overflow-y-auto p-5">
                    {isLoading ? (
                        <div className="space-y-3" aria-busy="true">
                            <div className="skeleton h-28 w-full" />
                            <div className="skeleton h-36 w-full" />
                            <div className="skeleton h-36 w-full" />
                        </div>
                    ) : !log ? (
                        <div className={emptyState}>{t('usage.requestNotFound')}</div>
                    ) : (
                        <>
                            <Section title={t('usage.basicInfo')}>
                                <Field label={t('usage.requestId')}>
                                    <span className="font-mono text-xs">{log.requestId}</span>
                                </Field>
                                <Field label={t('usage.time')}>
                                    {new Date(log.createdAt * 1000).toLocaleString(locale)}
                                </Field>
                                <Field label={t('usage.provider')}>
                                    {getUsageProviderLabel(log.providerName, t).label}
                                    <span className={cn('ml-2 font-mono text-[10px]', muted)}>
                                        {log.providerId}
                                    </span>
                                </Field>
                                <Field label={t('usage.appType')}>
                                    <span className={chip('neutral')}>{log.appType}</span>
                                </Field>
                                <Field label={t('usage.model')}>
                                    <span className="font-mono text-xs">{log.model}</span>
                                </Field>
                                {log.requestModel && log.requestModel !== log.model && (
                                    <Field label={t('usage.requestModel')}>
                                        <span className="font-mono text-xs">
                                            {log.requestModel}
                                        </span>
                                    </Field>
                                )}
                                <Field label={t('usage.status')}>
                                    <span className={chip(ok ? 'success' : 'error')}>
                                        {log.statusCode}
                                    </span>
                                </Field>
                            </Section>

                            <Section title={t('usage.tokenUsage')}>
                                <Field label={t('usage.inputTokens')}>
                                    {formatNumber(log.inputTokens, locale)}
                                </Field>
                                <Field label={t('usage.outputTokens')}>
                                    {formatNumber(log.outputTokens, locale)}
                                </Field>
                                <Field label={t('usage.cacheReadTokens')}>
                                    {formatNumber(log.cacheReadTokens, locale)}
                                </Field>
                                <Field label={t('usage.cacheCreationTokens')}>
                                    {formatNumber(log.cacheCreationTokens, locale)}
                                </Field>
                                <Total label={t('usage.totalTokens')}>
                                    {formatNumber(totalTokens, locale)}
                                </Total>
                            </Section>

                            <Section title={t('usage.costBreakdown')}>
                                <Field label={`${t('usage.inputCost')} (${t('usage.baseCost')})`}>
                                    {formatCost(log.inputCostUsd, 6)}
                                </Field>
                                <Field label={`${t('usage.outputCost')} (${t('usage.baseCost')})`}>
                                    {formatCost(log.outputCostUsd, 6)}
                                </Field>
                                <Field label={`${t('usage.cacheReadCost')} (${t('usage.baseCost')})`}>
                                    {formatCost(log.cacheReadCostUsd, 6)}
                                </Field>
                                <Field
                                    label={`${t('usage.cacheCreationCost')} (${t('usage.baseCost')})`}
                                >
                                    {formatCost(log.cacheCreationCostUsd, 6)}
                                </Field>
                                {multiplier !== 1 && (
                                    <Field label={t('usage.costMultiplier')}>
                                        <span className={chip('warning')}>×{log.costMultiplier}</span>
                                    </Field>
                                )}
                                <Total label={t('usage.totalCost')} accent>
                                    {formatCost(log.totalCostUsd, 6)}
                                </Total>
                            </Section>

                            <Section title={t('usage.performance')}>
                                <Field label={t('usage.speed')}>
                                    {exactTps != null ? (
                                        `${exactTps} tok/s`
                                    ) : estimatedTps != null ? (
                                        `${t('usage.speedEstimatedValue', { value: estimatedTps })}`
                                    ) : (
                                        <span className={muted}>
                                            {isSession
                                                ? log.outputTokens < SPEED_ESTIMATE_MIN_OUTPUT_TOKENS
                                                    ? t('usage.speedEstimateTooFew')
                                                    : t('usage.noTimingSession')
                                                : log.outputTokens < 100
                                                  ? t('usage.speedTooFew')
                                                  : t('usage.noFirstToken')}
                                        </span>
                                    )}
                                </Field>
                                <Field label={t('usage.latency')}>
                                    {formatNumber(log.latencyMs, locale)} ms
                                </Field>
                                {log.isStreaming && log.firstTokenMs != null && (
                                    <Field label={`${t('usage.latency')} (TTFT)`}>
                                        {formatNumber(log.firstTokenMs, locale)} ms
                                    </Field>
                                )}
                                <Field label={t('usage.streamMode')}>
                                    <span className={chip(log.isStreaming ? 'info' : 'violet')}>
                                        {log.isStreaming ? t('usage.stream') : t('usage.nonStream')}
                                    </span>
                                </Field>
                                <Field label={t('usage.reasoningEffort')}>
                                    <EffortChip effort={log.reasoningEffort} />
                                </Field>
                            </Section>

                            {log.errorMessage && (
                                <Section title={t('usage.errorMessage')}>
                                    <pre className="whitespace-pre-wrap break-all rounded-md bg-red-500/5 p-2 text-xs text-red-600 dark:text-red-400">
                                        {log.errorMessage}
                                    </pre>
                                </Section>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
