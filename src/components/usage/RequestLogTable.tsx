import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { useRequestLogs } from '../../hooks/useUsageQueries';
import type { LogFilters, StatsFilters, UsageRangeSelection } from '../../types/usage';
import {
    formatCost,
    formatEstimatedTokensPerSecond,
    formatOutputTokensPerSecond,
    getLocaleFromLanguage,
    parseFiniteNumber,
} from '../../utils/format';
import { cn } from '../../utils/cn';
import { resolveUsageRange } from '../../services/usage';
import { RequestDetailPanel } from './RequestDetailPanel';
import { EffortChip } from './EffortChip';
import { getUsageProviderLabel, usageProviderTitle } from './providerLabel';
import ProviderIcon from '../providers/ProviderIcon';
import { APP_LABELS, type AppType } from '../../types/app';
import {
    card,
    chip,
    emptyState,
    muted,
    pageBtn,
    row,
    select,
    tableWrap,
    thead,
    type ChipTone,
} from './styles';

interface RequestLogTableProps {
    range: UsageRangeSelection;
    /** 顶部筛选行下发的全局筛选（应用 / 供应商 / 模型） */
    filters: StatsFilters;
    refreshMs: number;
}

const PAGE_SIZE = 20;

/** 状态码下拉的候选值（只作用于请求日志，所以留在本页签内） */
const STATUS_CODE_OPTIONS = [200, 400, 401, 429, 500] as const;

/** 已知应用（claude/codex/gemini…）才显示图标与本地名；未知的直接回退到原值 */
function isKnownApp(appType: string): appType is AppType {
    return appType in APP_LABELS;
}

/** 请求日志「应用」列的名字：图标已区分品牌，列里只留最短能认出的名字 */
function appLabelOf(appType: string): string {
    return isKnownApp(appType) ? APP_LABELS[appType] : appType;
}

/** 用时着色：≤5s 绿、≤120s 黄、更久红；非法值灰 */
function durationTone(sec: number): ChipTone {
    if (!Number.isFinite(sec)) return 'neutral';
    if (sec <= 5) return 'success';
    if (sec <= 120) return 'warning';
    return 'error';
}

/** 页码序列：≤7 页全显，否则首尾 + 当前页前后各一页，中间省略 */
function pageList(page: number, totalPages: number): (number | 'gap')[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i);
    const pages: (number | 'gap')[] = [0];
    if (page > 2) pages.push('gap');
    for (let i = Math.max(1, page - 1); i <= Math.min(totalPages - 2, page + 1); i++) {
        pages.push(i);
    }
    if (page < totalPages - 3) pages.push('gap');
    pages.push(totalPages - 1);
    return pages;
}

export function RequestLogTable({ range, filters, refreshMs }: RequestLogTableProps) {
    const { t, i18n } = useTranslation();

    const [statusCode, setStatusCode] = useState<number | undefined>(undefined);
    const [page, setPage] = useState(0);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // 「跟随当前时刻」的窗口终点每 30s 重算一次，否则时间窗停在进页面那一刻
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(timer);
    }, []);
    const { startDate, endDate } = resolveUsageRange(range, now);

    // 顶部筛选 + 本页签状态码 + 时间窗 → 日志查询条件
    const logFilters: LogFilters = {
        appType: filters.appType,
        providerName: filters.providerName,
        model: filters.model,
        statusCode,
        startDate,
        endDate,
    };

    // 筛选 / 时间范围一变就回到第一页；滚动窗口每 30s 抖一下不算（不依赖 startDate/endDate）
    useEffect(() => {
        setPage(0);
    }, [
        range.preset,
        range.customStartDate,
        range.customEndDate,
        range.liveEndTime,
        filters.appType,
        filters.providerName,
        filters.model,
        statusCode,
    ]);

    const { data: result, isLoading } = useRequestLogs(logFilters, page, PAGE_SIZE, refreshMs);

    const logs = result?.data ?? [];
    const total = result?.total ?? 0;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const locale = getLocaleFromLanguage(i18n.resolvedLanguage || i18n.language);

    return (
        <div className="space-y-4">
            {/* 页签内工具栏：状态码只作用于请求日志，不放进顶部全局筛选行 */}
            <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="flex items-center gap-2">
                    <span className={cn('text-xs', muted)}>{t('usage.statusCode')}</span>
                    <select
                        className={cn(select, 'max-w-[140px]')}
                        value={statusCode?.toString() ?? 'all'}
                        onChange={(e) =>
                            setStatusCode(
                                e.target.value === 'all'
                                    ? undefined
                                    : Number.parseInt(e.target.value, 10)
                            )
                        }
                    >
                        <option value="all">{t('usage.statusFilter.all')}</option>
                        {STATUS_CODE_OPTIONS.map((code) => (
                            <option key={code} value={code}>
                                {code}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {isLoading ? (
                <div className={cn(card, 'space-y-3 p-4')} aria-busy="true">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                        <div key={i} className="skeleton h-8 w-full" />
                    ))}
                </div>
            ) : (
                <>
                    <div className={tableWrap}>
                        {/* 15 列较宽：把 DaisyUI 默认的每列左右 16px padding 收到 8px，
                            否则常规窗口下表格就超出容器、出现横向滚动条 */}
                        <table className="table table-sm [&_td]:px-2 [&_th]:px-2">
                            <thead className={thead}>
                                <tr>
                                    <th className="whitespace-nowrap">{t('usage.time')}</th>
                                    <th className="whitespace-nowrap">{t('usage.app')}</th>
                                    <th className="whitespace-nowrap">{t('usage.provider')}</th>
                                    <th className="min-w-[160px] whitespace-nowrap">
                                        {t('usage.billingModel')}
                                    </th>
                                    <th className="whitespace-nowrap">
                                        {t('usage.reasoningEffort')}
                                    </th>
                                    <th className="whitespace-nowrap text-right">
                                        {t('usage.inputTokens')}
                                    </th>
                                    <th className="whitespace-nowrap text-right">
                                        {t('usage.outputTokens')}
                                    </th>
                                    <th className="min-w-[76px] whitespace-nowrap text-right">
                                        {t('usage.cacheReadTokens')}
                                    </th>
                                    <th className="min-w-[76px] whitespace-nowrap text-right">
                                        {t('usage.cacheCreationTokens')}
                                    </th>
                                    <th className="whitespace-nowrap text-right">
                                        {t('usage.multiplier')}
                                    </th>
                                    <th className="whitespace-nowrap text-right">
                                        {t('usage.totalCost')}
                                    </th>
                                    <th className="min-w-[128px] whitespace-nowrap text-center">
                                        {t('usage.timingInfo')}
                                    </th>
                                    <th
                                        className="whitespace-nowrap text-right"
                                        title={t('usage.speedHelp')}
                                    >
                                        {t('usage.speed')}
                                    </th>
                                    <th className="whitespace-nowrap">{t('usage.status')}</th>
                                    <th className="w-8" aria-hidden="true" />
                                </tr>
                            </thead>
                            <tbody>
                                {logs.length === 0 ? (
                                    <tr>
                                        <td colSpan={15}>
                                            <div className={emptyState}>
                                                <Inbox className="h-8 w-8 opacity-40" />
                                                <span>{t('usage.noData')}</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    logs.map((log) => {
                                        const durationMs =
                                            typeof log.durationMs === 'number'
                                                ? log.durationMs
                                                : log.latencyMs;
                                        const durationSec = durationMs / 1000;
                                        const firstSec =
                                            log.isStreaming && log.firstTokenMs != null
                                                ? log.firstTokenMs / 1000
                                                : null;
                                        const multiplier = parseFiniteNumber(log.costMultiplier) ?? 1;
                                        const modelChanged =
                                            !!log.requestModel && log.requestModel !== log.model;
                                        const provider = getUsageProviderLabel(log.providerName, t);
                                        const exactTps = formatOutputTokensPerSecond(log);
                                        // 会话日志导入的请求没有首字计时，速度是按日志时间戳估的，前面带 ≈
                                        const estimatedTps =
                                            exactTps == null
                                                ? formatEstimatedTokensPerSecond(log)
                                                : null;
                                        const tps = exactTps ?? estimatedTps;
                                        const timingTip =
                                            log.latencyMs > 0 && log.firstTokenMs != null
                                                ? t('usage.timingTip', {
                                                      duration: (log.latencyMs / 1000).toFixed(1),
                                                      ttft: (log.firstTokenMs / 1000).toFixed(1),
                                                  })
                                                : estimatedTps != null
                                                  ? t('usage.estimatedTimingTip', {
                                                        duration: (log.latencyMs / 1000).toFixed(1),
                                                    })
                                                  : undefined;
                                        return (
                                            <tr
                                                key={log.requestId}
                                                className={cn(row, 'cursor-pointer')}
                                                onClick={() => setSelectedId(log.requestId)}
                                                title={t('usage.requestDetail')}
                                            >
                                                <td className="whitespace-nowrap tabular-nums text-gray-600 dark:text-gray-300">
                                                    {new Date(log.createdAt * 1000).toLocaleString(
                                                        locale
                                                    )}
                                                </td>
                                                <td className="whitespace-nowrap">
                                                    <span
                                                        className="flex items-center gap-1.5"
                                                        title={appLabelOf(log.appType)}
                                                    >
                                                        {isKnownApp(log.appType) && (
                                                            <ProviderIcon
                                                                appType={log.appType}
                                                                size="sm"
                                                            />
                                                        )}
                                                        <span className="truncate">
                                                            {appLabelOf(log.appType)}
                                                        </span>
                                                    </span>
                                                </td>
                                                <td
                                                    className={cn(
                                                        'whitespace-nowrap font-medium',
                                                        provider.isSession
                                                            ? 'text-gray-600 dark:text-gray-300'
                                                            : 'text-gray-900 dark:text-base-content'
                                                    )}
                                                    title={usageProviderTitle(provider)}
                                                >
                                                    {provider.label}
                                                </td>
                                                <td className="max-w-[220px]">
                                                    <div
                                                        className="truncate font-mono text-xs text-gray-800 dark:text-gray-100"
                                                        title={
                                                            modelChanged
                                                                ? `${t('usage.requestModel')}: ${log.requestModel}\n${t('usage.responseModel')}: ${log.model}`
                                                                : log.model
                                                        }
                                                    >
                                                        {log.model}
                                                    </div>
                                                    {modelChanged && (
                                                        <div
                                                            className="truncate font-mono text-[10px] text-gray-400 dark:text-gray-500"
                                                            title={log.requestModel}
                                                        >
                                                            ← {log.requestModel}
                                                        </div>
                                                    )}
                                                </td>
                                                <td>
                                                    <EffortChip effort={log.reasoningEffort} />
                                                </td>
                                                <td className="text-right tabular-nums">
                                                    {log.inputTokens.toLocaleString(locale)}
                                                </td>
                                                <td className="text-right tabular-nums">
                                                    {log.outputTokens.toLocaleString(locale)}
                                                </td>
                                                <td className="text-right tabular-nums text-gray-500 dark:text-gray-400">
                                                    {log.cacheReadTokens.toLocaleString(locale)}
                                                </td>
                                                <td className="text-right tabular-nums text-gray-500 dark:text-gray-400">
                                                    {log.cacheCreationTokens.toLocaleString(locale)}
                                                </td>
                                                <td className="text-right">
                                                    {multiplier !== 1 ? (
                                                        <span className={chip('warning')}>
                                                            ×{log.costMultiplier}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-gray-400 dark:text-gray-500">
                                                            ×1
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="text-right font-semibold tabular-nums text-gray-900 dark:text-base-content">
                                                    {formatCost(log.totalCostUsd)}
                                                </td>
                                                <td>
                                                    <div className="flex items-center justify-center gap-1">
                                                        <span className={chip(durationTone(durationSec))}>
                                                            {Number.isFinite(durationSec)
                                                                ? `${Math.round(durationSec)}s`
                                                                : '--'}
                                                        </span>
                                                        {firstSec != null && (
                                                            <span className={chip(durationTone(firstSec))}>
                                                                {Number.isFinite(firstSec)
                                                                    ? `${firstSec.toFixed(1)}s`
                                                                    : '--'}
                                                            </span>
                                                        )}
                                                        <span
                                                            className={chip(
                                                                log.isStreaming ? 'info' : 'violet'
                                                            )}
                                                        >
                                                            {log.isStreaming
                                                                ? t('usage.stream')
                                                                : t('usage.nonStream')}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td
                                                    className={cn(
                                                        'text-right tabular-nums',
                                                        tps == null
                                                            ? 'text-gray-400 dark:text-gray-500'
                                                            : 'text-gray-700 dark:text-gray-200'
                                                    )}
                                                    title={timingTip}
                                                >
                                                    {tps == null ? (
                                                        '—'
                                                    ) : (
                                                        <>
                                                            {estimatedTps != null && '≈'}
                                                            {tps}
                                                            <span className="ms-0.5 text-[11px] font-normal text-gray-400">
                                                                tok/s
                                                            </span>
                                                        </>
                                                    )}
                                                </td>
                                                <td>
                                                    <span
                                                        className={chip(
                                                            log.statusCode >= 200 &&
                                                                log.statusCode < 300
                                                                ? 'success'
                                                                : 'error'
                                                        )}
                                                    >
                                                        {log.statusCode}
                                                    </span>
                                                </td>
                                                <td className="text-gray-300 dark:text-gray-600">
                                                    <ChevronRight className="h-4 w-4" />
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* 分页 */}
                    {total > 0 && (
                        <div
                            className={cn(
                                'flex flex-wrap items-center justify-between gap-3 px-1 text-sm',
                                muted
                            )}
                        >
                            <span className="tabular-nums">
                                {t('usage.totalRecords', { total })}
                                {totalPages > 1 && (
                                    <>
                                        {' · '}
                                        {t('usage.pageOf', { page: page + 1, pages: totalPages })}
                                    </>
                                )}
                            </span>
                            <div className="inline-flex items-center gap-1">
                                <button
                                    type="button"
                                    className={pageBtn(false)}
                                    onClick={() => setPage(Math.max(0, page - 1))}
                                    disabled={page === 0}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                {pageList(page, totalPages).map((p, idx) =>
                                    p === 'gap' ? (
                                        <span key={`gap-${idx}`} className="px-1 text-gray-400">
                                            …
                                        </span>
                                    ) : (
                                        <button
                                            key={p}
                                            type="button"
                                            className={pageBtn(p === page)}
                                            onClick={() => setPage(p)}
                                            aria-current={p === page ? 'page' : undefined}
                                        >
                                            {p + 1}
                                        </button>
                                    )
                                )}
                                <button
                                    type="button"
                                    className={pageBtn(false)}
                                    onClick={() => setPage(page + 1)}
                                    disabled={page >= totalPages - 1}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* 请求详情面板 */}
            {selectedId && (
                <RequestDetailPanel requestId={selectedId} onClose={() => setSelectedId(null)} />
            )}
        </div>
    );
}
