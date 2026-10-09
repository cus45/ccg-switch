import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
    AlertCircle,
    ChevronLeft,
    ChevronRight,
    Inbox,
    RefreshCw,
    Search,
    X,
} from 'lucide-react';
import { usageKeys, useRequestLogs } from '../../hooks/useUsageQueries';
import type { LogFilters, LogTimeMode, TimeRange } from '../../types/usage';
import { formatCost, getLocaleFromLanguage, parseFiniteNumber } from '../../utils/format';
import { cn } from '../../utils/cn';
import { RequestDetailPanel } from './RequestDetailPanel';
import { EffortChip } from './EffortChip';
import { getTimeWindow, RANGE_LABEL_KEYS } from '../../services/usage';
import { getUsageProviderLabel, usageProviderTitle } from './providerLabel';
import {
    card,
    chip,
    emptyState,
    fieldLabel,
    ghostBtn,
    iconBtn,
    input,
    muted,
    pageBtn,
    primaryBtn,
    row,
    segment,
    segmentItem,
    select,
    tableWrap,
    thead,
    type ChipTone,
} from './styles';

interface RequestLogTableProps {
    /** 页面时间范围：「跟随」模式下日志窗口与汇总、趋势、统计表一致 */
    range: TimeRange;
    refreshMs: number;
}

/** 固定时间模式的最大跨度：30 天 */
const MAX_FIXED_RANGE_SECONDS = 30 * 24 * 3600;
const PAGE_SIZE = 20;

/** 日期时间输入框：不占满整行 */
const datetimeInput = 'input input-bordered input-sm tabular-nums';

/** Unix 秒 → `datetime-local` 需要的 `YYYY-MM-DDTHH:mm`（本地时区） */
function toDatetimeLocal(ts: number): string {
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` 字符串 → Unix 秒，非法返回 null */
function fromDatetimeLocal(value: string): number | null {
    if (value.length < 16) return null;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
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

export function RequestLogTable({ range, refreshMs }: RequestLogTableProps) {
    const { t, i18n } = useTranslation();
    const queryClient = useQueryClient();

    // 草稿态：改筛选不立即查询，点「搜索」才生效
    const [draftFilters, setDraftFilters] = useState<LogFilters>({});
    const [timeMode, setTimeMode] = useState<LogTimeMode>('rolling');
    // 生效态：真正参与查询的筛选
    const [appliedFilters, setAppliedFilters] = useState<LogFilters>({});
    const [page, setPage] = useState(0);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);

    // 跟随模式每 30s 重算一次窗口，让窗口终点始终是「现在」
    const [rollingNow, setRollingNow] = useState(() => Date.now());
    useEffect(() => {
        if (timeMode !== 'rolling') return;
        const timer = setInterval(() => setRollingNow(Date.now()), 30_000);
        return () => clearInterval(timer);
    }, [timeMode]);
    const rolling = getTimeWindow(range, rollingNow);

    // 页面切换时间范围 → 日志表回到「跟随」并清掉自定义时间，与上方汇总、统计表联动
    useEffect(() => {
        setRollingNow(Date.now());
        setTimeMode('rolling');
        setValidationError(null);
        setPage(0);
        const stripDates = (f: LogFilters): LogFilters => {
            const { startDate: _s, endDate: _e, ...rest } = f;
            return rest;
        };
        setDraftFilters(stripDates);
        setAppliedFilters(stripDates);
    }, [range]);

    // 生效的查询条件：滚动模式下覆盖时间窗口
    const effectiveFilters: LogFilters =
        timeMode === 'rolling'
            ? {
                  ...appliedFilters,
                  startDate: rolling.startDate,
                  endDate: rolling.endDate,
              }
            : appliedFilters;

    const { data: result, isLoading } = useRequestLogs(
        effectiveFilters,
        page,
        PAGE_SIZE,
        refreshMs
    );

    const logs = result?.data ?? [];
    const total = result?.total ?? 0;
    const totalPages = Math.ceil(total / PAGE_SIZE);

    /** 校验时间范围并提交草稿；校验失败以内联文案提示（i18n），不弹原生 alert */
    const handleSearch = () => {
        setValidationError(null);
        const next: LogFilters = { ...draftFilters };

        if (timeMode === 'fixed') {
            const { startDate, endDate } = draftFilters;
            if (startDate == null || endDate == null) {
                setValidationError(t('usage.invalidTimeRange'));
                return;
            }
            if (startDate > endDate) {
                setValidationError(t('usage.invalidTimeRangeOrder'));
                return;
            }
            if (endDate - startDate > MAX_FIXED_RANGE_SECONDS) {
                setValidationError(t('usage.timeRangeTooLarge'));
                return;
            }
        } else {
            // 滚动模式不带固定时间，交给 effectiveFilters 计算
            delete next.startDate;
            delete next.endDate;
        }

        setAppliedFilters(next);
        setPage(0);
    };

    const handleReset = () => {
        setValidationError(null);
        setDraftFilters({});
        setAppliedFilters({});
        setTimeMode('rolling');
        setPage(0);
    };

    const handleRefresh = () => {
        void queryClient.invalidateQueries({
            queryKey: usageKeys.logs(effectiveFilters, page, PAGE_SIZE),
        });
    };

    /**
     * 手动改时间 → 自动从滚动切到固定。
     * 切换瞬间把另一端补成当前滚动窗口的值（输入框里正显示着它），
     * 否则用户只改一端就点搜索，会被「请选择完整时间」拦住。
     */
    const handleTimeChange = (key: 'startDate' | 'endDate', value: string) => {
        const ts = fromDatetimeLocal(value);
        setValidationError(null);
        setDraftFilters((prev) => ({
            ...(timeMode === 'rolling'
                ? {
                      startDate: rolling.startDate,
                      endDate: rolling.endDate,
                  }
                : {}),
            ...prev,
            [key]: ts ?? undefined,
        }));
        setTimeMode('fixed');
    };

    /** 切回滚动窗口：清掉草稿里的固定时间 */
    const switchToRolling = () => {
        setValidationError(null);
        setTimeMode('rolling');
        setDraftFilters((prev) => {
            const { startDate: _s, endDate: _e, ...rest } = prev;
            return rest;
        });
    };

    /** 切到固定区间：把当前滚动窗口填进输入框，用户在此基础上改 */
    const switchToFixed = () => {
        setValidationError(null);
        setDraftFilters((prev) => ({
            startDate: rolling.startDate,
            endDate: rolling.endDate,
            ...prev,
        }));
        setTimeMode('fixed');
    };

    const locale = getLocaleFromLanguage(i18n.resolvedLanguage || i18n.language);

    // 输入框展示值：滚动模式显示实时窗口，固定模式显示草稿
    const displayStart =
        timeMode === 'rolling' ? rolling.startDate : draftFilters.startDate;
    const displayEnd = timeMode === 'rolling' ? rolling.endDate : draftFilters.endDate;

    return (
        <div className="space-y-4">
            {/* 筛选栏 */}
            <div className={cn(card, 'p-4')}>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                    <label className="block">
                        <span className={fieldLabel}>{t('usage.appType')}</span>
                        <select
                            className={select}
                            value={draftFilters.appType || 'all'}
                            onChange={(e) =>
                                setDraftFilters({
                                    ...draftFilters,
                                    appType: e.target.value === 'all' ? undefined : e.target.value,
                                })
                            }
                        >
                            <option value="all">{t('usage.allApps')}</option>
                            <option value="claude">Claude</option>
                            <option value="codex">Codex</option>
                            <option value="gemini">Gemini</option>
                        </select>
                    </label>

                    <label className="block">
                        <span className={fieldLabel}>{t('usage.statusCode')}</span>
                        <select
                            className={select}
                            value={draftFilters.statusCode?.toString() || 'all'}
                            onChange={(e) =>
                                setDraftFilters({
                                    ...draftFilters,
                                    statusCode:
                                        e.target.value === 'all'
                                            ? undefined
                                            : Number.parseInt(e.target.value, 10),
                                })
                            }
                        >
                            <option value="all">{t('common.all')}</option>
                            <option value="200">200 OK</option>
                            <option value="400">400 Bad Request</option>
                            <option value="401">401 Unauthorized</option>
                            <option value="429">429 Rate Limit</option>
                            <option value="500">500 Server Error</option>
                        </select>
                    </label>

                    <label className="col-span-2 block">
                        <span className={fieldLabel}>{t('usage.provider')}</span>
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder={t('usage.searchProviderPlaceholder')}
                                className={cn(input, 'pl-8')}
                                value={draftFilters.providerName || ''}
                                onChange={(e) =>
                                    setDraftFilters({
                                        ...draftFilters,
                                        providerName: e.target.value || undefined,
                                    })
                                }
                            />
                        </div>
                    </label>

                    <label className="col-span-2 block">
                        <span className={fieldLabel}>{t('usage.model')}</span>
                        <input
                            type="text"
                            placeholder={t('usage.searchModelPlaceholder')}
                            className={input}
                            value={draftFilters.model || ''}
                            onChange={(e) =>
                                setDraftFilters({
                                    ...draftFilters,
                                    model: e.target.value || undefined,
                                })
                            }
                        />
                    </label>
                </div>

                {/* 时间范围：滚动 24h / 固定区间 + 操作按钮 */}
                <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div>
                        <span className={fieldLabel}>{t('usage.timeRange')}</span>
                        <div className="flex flex-wrap items-center gap-2">
                            <div
                                className={segment}
                                role="radiogroup"
                                aria-label={t('usage.timeRange')}
                            >
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={timeMode === 'rolling'}
                                    className={segmentItem(timeMode === 'rolling')}
                                    onClick={switchToRolling}
                                >
                                    {t('usage.followRange', { range: t(RANGE_LABEL_KEYS[range]) })}
                                </button>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={timeMode === 'fixed'}
                                    className={segmentItem(timeMode === 'fixed')}
                                    onClick={switchToFixed}
                                >
                                    {t('usage.fixedRange')}
                                </button>
                            </div>
                            <input
                                type="datetime-local"
                                className={cn(
                                    datetimeInput,
                                    timeMode === 'rolling' && 'text-gray-400 dark:text-gray-500'
                                )}
                                value={displayStart != null ? toDatetimeLocal(displayStart) : ''}
                                onChange={(e) => handleTimeChange('startDate', e.target.value)}
                            />
                            <span className={muted}>~</span>
                            <input
                                type="datetime-local"
                                className={cn(
                                    datetimeInput,
                                    timeMode === 'rolling' && 'text-gray-400 dark:text-gray-500'
                                )}
                                value={displayEnd != null ? toDatetimeLocal(displayEnd) : ''}
                                onChange={(e) => handleTimeChange('endDate', e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                        <button type="button" className={primaryBtn} onClick={handleSearch}>
                            <Search className="h-3.5 w-3.5" />
                            {t('common.search')}
                        </button>
                        <button type="button" className={ghostBtn} onClick={handleReset}>
                            <X className="h-3.5 w-3.5" />
                            {t('common.reset')}
                        </button>
                        <button
                            type="button"
                            className={iconBtn}
                            onClick={handleRefresh}
                            title={t('common.refresh')}
                            aria-label={t('common.refresh')}
                        >
                            <RefreshCw className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {validationError && (
                    <div
                        role="alert"
                        className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400"
                    >
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        {validationError}
                    </div>
                )}
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
                        <table className="table table-sm">
                            <thead className={thead}>
                                <tr>
                                    <th className="whitespace-nowrap">{t('usage.time')}</th>
                                    <th className="whitespace-nowrap">{t('usage.provider')}</th>
                                    <th className="min-w-[200px] whitespace-nowrap">
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
                                    <th className="min-w-[90px] whitespace-nowrap text-right">
                                        {t('usage.cacheReadTokens')}
                                    </th>
                                    <th className="min-w-[90px] whitespace-nowrap text-right">
                                        {t('usage.cacheCreationTokens')}
                                    </th>
                                    <th className="whitespace-nowrap text-right">
                                        {t('usage.multiplier')}
                                    </th>
                                    <th className="whitespace-nowrap text-right">
                                        {t('usage.totalCost')}
                                    </th>
                                    <th className="min-w-[140px] whitespace-nowrap text-center">
                                        {t('usage.timingInfo')}
                                    </th>
                                    <th className="whitespace-nowrap">{t('usage.status')}</th>
                                    <th className="w-8" aria-hidden="true" />
                                </tr>
                            </thead>
                            <tbody>
                                {logs.length === 0 ? (
                                    <tr>
                                        <td colSpan={13}>
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
