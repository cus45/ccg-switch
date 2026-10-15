import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    BookOpen,
    Bot,
    Check,
    CheckSquare,
    ChevronDown,
    ChevronRight,
    ClipboardList,
    Copy,
    ExternalLink,
    Globe,
    HelpCircle,
    Loader2,
    PencilLine,
    Search,
    Terminal,
    Wrench,
    X,
} from 'lucide-react';
import type { ToolResultBlock } from '../../../types/chat';
import type { ToolCall } from '../../../types/timeline';
import type { ToolInput } from '../../../types/tools';
import { parseTodoItems } from '../../../types/tools';
import {
    collectEditToolItems,
    extractResultText,
    resolveToolTarget,
    summarizeCommand,
} from '../../../utils/toolPresentation';
import { copyToClipboard, openFile } from '../../../utils/bridge';
import { useChatStore } from '../../../stores/useChatStore';
import { cn } from '../../../utils/cn';
import EditDiffPreview from '../../toolBlocks/EditDiffPreview';
import MarkdownBlock from '../MarkdownBlock';

/** 记录卡片展开折叠状态的内存缓存，防止虚拟列表滚出屏幕后丢失状态 */
export interface ToolCallViewCache {
    expanded: Map<string, boolean>;
}

export const defaultToolCallViewCache: ToolCallViewCache = {
    expanded: new Map<string, boolean>(),
};

export interface ToolCallCardProps {
    toolCall?: ToolCall;
    // 兼容扁平传入属性
    callId?: string;
    name?: string;
    kind?: string;
    input?: ToolInput;
    result?: ToolResultBlock | null;
    status?: string;
    durationMs?: number;
    isError?: boolean;
    compact?: boolean;
    viewCache?: ToolCallViewCache;
    onOpenFile?: (path: string) => void;
}

/** 移除 ANSI 终端颜色转义字符 */
export function stripAnsi(text: string): string {
    return text
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '')
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b[ -/]*[@-~]/g, '');
}

/** 工具图标渲染器 */
export function renderToolIcon(kind: string): React.ReactNode {
    const k = (kind || '').toLowerCase();
    switch (k) {
        case 'read':
            return <BookOpen size={14} className="text-blue-500" />;
        case 'edit':
            return <PencilLine size={14} className="text-indigo-500" />;
        case 'execute':
        case 'bash':
            return <Terminal size={14} className="text-purple-500" />;
        case 'search':
            return <Search size={14} className="text-amber-500" />;
        case 'todo':
            return <CheckSquare size={14} className="text-emerald-500" />;
        case 'plan':
            return <ClipboardList size={14} className="text-cyan-500" />;
        case 'ask_user':
            return <HelpCircle size={14} className="text-rose-500" />;
        case 'task':
        case 'agent':
            return <Bot size={14} className="text-sky-500" />;
        case 'web':
            return <Globe size={14} className="text-teal-500" />;
        default:
            return <Wrench size={14} className="text-base-content/60" />;
    }
}

export const ToolCallCard = memo(function ToolCallCard(props: ToolCallCardProps) {
    const { t } = useTranslation();
    const currentCwd = useChatStore((s) => s.currentCwd);

    // 归一化输入属性（优先从 toolCall 获取，其次从扁平属性获取）
    const callId = props.toolCall?.callId ?? props.callId ?? '';
    const name = props.toolCall?.name ?? props.name ?? 'tool';
    const kind = (props.toolCall?.kind ?? props.kind ?? 'generic').toLowerCase();
    const input: ToolInput = (props.toolCall?.input as ToolInput) ?? props.input ?? {};
    const result = props.toolCall?.result ?? props.result ?? null;
    const status = props.toolCall?.status ?? props.status ?? (result ? (result.is_error ? 'failed' : 'complete') : 'running');
    const isError = props.toolCall?.isError ?? props.isError ?? Boolean(result?.is_error);
    const viewCache = props.viewCache ?? defaultToolCallViewCache;

    // 展开/折叠状态（默认：失败项自动展开，其余默认折叠）
    const initialExpanded = viewCache.expanded.get(callId) ?? (isError && status === 'failed');
    const [expanded, setExpandedState] = useState(initialExpanded);

    const toggleExpanded = () => {
        const next = !expanded;
        viewCache.expanded.set(callId, next);
        setExpandedState(next);
    };

    // 复制状态
    const [copied, setCopied] = useState<string | null>(null);
    const handleCopy = async (text: string, key: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        await copyToClipboard(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 1500);
    };

    // 1. Edit 类型特定解析
    const isEdit = kind === 'edit';
    const editItem = isEdit
        ? collectEditToolItems([{ type: 'tool_use', id: callId, name, input }], () => result)[0]
        : null;
    const target = isEdit ? resolveToolTarget(input) : null;
    const filePath = editItem?.filePath ?? target?.rawPath ?? '';
    const displayPath = editItem?.displayPath ?? target?.displayPath ?? filePath;
    const openPath = editItem?.openPath ?? target?.openPath;
    const additions = editItem?.additions ?? 0;
    const deletions = editItem?.deletions ?? 0;
    const diffPreviewLines = editItem?.diffPreviewLines ?? [];

    const handleFileClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (openPath) {
            if (props.onOpenFile) {
                props.onOpenFile(openPath);
            } else {
                void openFile(openPath, editItem?.lineStart, editItem?.lineEnd, currentCwd);
            }
        }
    };

    // 2. Execute / Bash 类型特定解析
    const isExecute = kind === 'execute' || kind === 'bash';
    const command = (input.command as string) ?? (input.cmd as string) ?? '';
    const commandSummary = summarizeCommand(command);

    let stdout = '';
    let stderr = '';
    let exitCode: number | null = null;
    if (result) {
        const rawResultText = extractResultText(result);
        try {
            const parsed = JSON.parse(rawResultText);
            stdout = parsed.stdout ?? '';
            stderr = parsed.stderr ?? '';
            exitCode = parsed.exit_code ?? parsed.exitCode ?? (result.is_error ? 1 : 0);
        } catch {
            stdout = rawResultText;
            exitCode = result.is_error ? 1 : 0;
        }
    }

    // 3. Todo 类型特定解析
    const isTodo = kind === 'todo';
    const todoItems = isTodo ? parseTodoItems(input) : [];

    // 4. Read 类型特定解析
    const isRead = kind === 'read';
    const readPath = (input.path as string) ?? (input.file_path as string) ?? '';
    const readResultText = isRead && result ? extractResultText(result) : '';

    // 标题文本解析
    let cardTitle = name;
    if (isEdit) {
        cardTitle = displayPath || filePath || name;
    } else if (isExecute) {
        cardTitle = commandSummary.summary || commandSummary.label || command || name;
    } else if (isRead) {
        cardTitle = readPath || name;
    } else if (isTodo) {
        cardTitle = t('tools.todoTitle', { count: todoItems.length, defaultValue: `Plan (${todoItems.length} items)` });
    } else if (kind === 'search') {
        const query = (input.query as string) ?? (input.pattern as string) ?? '';
        cardTitle = query ? `Search: ${query}` : name;
    } else if (kind === 'ask_user') {
        const question = (input.question as string) ?? (input.prompt as string) ?? '';
        cardTitle = question || name;
    } else if (kind === 'plan') {
        cardTitle = t('tools.planMode', { defaultValue: 'Exit Plan Mode' });
    }

    const isRunning = status === 'running';
    const isComplete = status === 'complete' && !isError;
    const isFailed = status === 'failed' || isError;

    return (
        <div
            className={cn(
                'tool-call-card rounded-lg border text-xs transition-colors my-1.5 overflow-hidden',
                isEdit
                    ? 'border-blue-500/25 bg-blue-500/[0.03]'
                    : isExecute
                    ? 'border-purple-500/20 bg-purple-500/[0.02]'
                    : 'border-base-300 bg-base-200/40',
                isFailed && 'border-error/40 bg-error/[0.03]',
            )}
        >
            {/* Header / 顶栏按钮 */}
            <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-base-300/30 transition-colors"
                onClick={toggleExpanded}
                aria-expanded={expanded}
            >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex-shrink-0">{renderToolIcon(kind)}</span>
                    <span className="truncate font-medium text-base-content" title={cardTitle}>
                        {cardTitle}
                    </span>

                    {/* Edit 类型的增删统计胶囊 */}
                    {isEdit && (additions > 0 || deletions > 0) && (
                        <span className="flex-shrink-0 font-mono text-[11px] font-semibold flex items-center gap-1 px-1.5 py-0.5 rounded bg-base-300/50">
                            {additions > 0 && <span className="text-emerald-500">+{additions}</span>}
                            {deletions > 0 && <span className="text-rose-500">-{deletions}</span>}
                        </span>
                    )}

                    {/* Execute 类型的 Exit Code 胶囊 */}
                    {isExecute && exitCode !== null && (
                        <span
                            className={cn(
                                'flex-shrink-0 font-mono text-[10px] font-semibold px-1.5 py-0.2 rounded',
                                exitCode === 0
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
                            )}
                        >
                            Exit {exitCode}
                        </span>
                    )}
                </div>

                {/* 右侧状态指示与展开箭头 */}
                <div className="flex flex-shrink-0 items-center gap-2">
                    {isRunning && (
                        <span className="flex items-center gap-1 text-amber-500 font-medium">
                            <Loader2 size={12} className="animate-spin" />
                            <span className="hidden sm:inline">{t('common.running', 'Running')}</span>
                        </span>
                    )}
                    {isComplete && (
                        <span className="text-emerald-500" title="Completed">
                            <Check size={13} />
                        </span>
                    )}
                    {isFailed && (
                        <span className="text-error flex items-center gap-0.5 font-medium" title="Failed">
                            <X size={13} />
                            <span className="hidden sm:inline">{t('common.failed', 'Failed')}</span>
                        </span>
                    )}

                    <span className="text-base-content/40 ml-1">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                </div>
            </button>

            {/* Body / 展开后详情 */}
            {expanded && (
                <div className="border-t border-base-300/60 p-3 space-y-2.5">
                    {/* 1. Edit 详情 */}
                    {isEdit && (
                        <div className="space-y-2">
                            {openPath && (
                                <div className="flex items-center justify-between gap-2 rounded bg-base-300/40 px-2.5 py-1.5">
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        className="cursor-pointer truncate font-mono text-primary hover:underline flex items-center gap-1.5"
                                        onClick={handleFileClick}
                                        onKeyDown={(e) => e.key === 'Enter' && handleFileClick(e as unknown as React.MouseEvent)}
                                        title={openPath}
                                    >
                                        <ExternalLink size={12} />
                                        <span>{displayPath || openPath}</span>
                                    </span>
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-xs gap-1"
                                        onClick={(e) => handleCopy(openPath, 'path', e)}
                                    >
                                        {copied === 'path' ? <Check size={11} /> : <Copy size={11} />}
                                        <span>{copied === 'path' ? t('common.copied', 'Copied') : t('tools.copyPath', 'Copy')}</span>
                                    </button>
                                </div>
                            )}

                            {diffPreviewLines.length > 0 ? (
                                <div className="rounded border border-base-300 bg-base-100 overflow-hidden">
                                    <EditDiffPreview
                                        filePath={displayPath || filePath}
                                        additions={additions}
                                        deletions={deletions}
                                        lines={diffPreviewLines}
                                        variant="panel"
                                    />
                                </div>
                            ) : (
                                result && (
                                    <div className="font-mono text-[11.5px] bg-base-300/20 p-2 rounded max-h-60 overflow-y-auto">
                                        <MarkdownBlock content={extractResultText(result)} />
                                    </div>
                                )
                            )}
                        </div>
                    )}

                    {/* 2. Execute / Bash 详情 */}
                    {isExecute && (
                        <div className="space-y-2">
                            {command && (
                                <div className="relative rounded bg-base-300/40 p-2 font-mono text-[11.5px] text-base-content break-all">
                                    <div className="flex items-center justify-between pb-1 text-[10.5px] text-base-content/50">
                                        <span>Command</span>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-xs h-5 min-h-0 px-1.5"
                                            onClick={(e) => handleCopy(command, 'cmd', e)}
                                        >
                                            {copied === 'cmd' ? <Check size={11} /> : <Copy size={11} />}
                                        </button>
                                    </div>
                                    <code>{command}</code>
                                </div>
                            )}

                            {(stdout || stderr) && (
                                <div className="relative rounded bg-neutral text-neutral-content p-2.5 font-mono text-[11.5px] max-h-80 overflow-y-auto">
                                    <div className="flex items-center justify-between pb-1 text-[10px] text-neutral-content/60 border-b border-neutral-content/10 mb-1.5">
                                        <span>Terminal Output</span>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-xs h-5 min-h-0 px-1.5 text-neutral-content hover:bg-neutral-content/10"
                                            onClick={(e) => handleCopy(stripAnsi(stdout + stderr), 'out', e)}
                                        >
                                            {copied === 'out' ? <Check size={11} /> : <Copy size={11} />}
                                            <span className="text-[10px]">{copied === 'out' ? 'Copied' : 'Copy'}</span>
                                        </button>
                                    </div>
                                    {stdout && <pre className="whitespace-pre-wrap">{stripAnsi(stdout)}</pre>}
                                    {stderr && <pre className="whitespace-pre-wrap text-rose-300">{stripAnsi(stderr)}</pre>}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 3. Read 详情 */}
                    {isRead && (
                        <div className="space-y-2">
                            <div className="font-mono text-xs text-base-content/70">
                                Path: <span className="text-base-content font-medium">{readPath}</span>
                            </div>
                            {readResultText && (
                                <div className="rounded bg-base-300/30 p-2 font-mono text-[11.5px] max-h-72 overflow-y-auto">
                                    <pre className="whitespace-pre-wrap">{readResultText}</pre>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 4. Todo 详情 */}
                    {isTodo && todoItems.length > 0 && (
                        <div className="space-y-1 rounded bg-base-300/20 p-2.5">
                            {todoItems.map((item, idx) => (
                                <div key={idx} className="flex items-start gap-2 py-0.5">
                                    {item.status === 'completed' && <Check size={13} className="text-emerald-500 mt-0.5 flex-shrink-0" />}
                                    {item.status === 'in_progress' && <Loader2 size={13} className="text-amber-500 animate-spin mt-0.5 flex-shrink-0" />}
                                    {item.status === 'pending' && <span className="w-3 h-3 rounded-full border border-base-content/30 mt-0.5 flex-shrink-0 inline-block" />}
                                    <span
                                        className={cn(
                                            'text-xs',
                                            item.status === 'completed' && 'line-through text-base-content/40',
                                            item.status === 'in_progress' && 'font-medium text-base-content',
                                        )}
                                    >
                                        {item.content}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* 5. Plan 详情 */}
                    {kind === 'plan' && (
                        <div className="rounded bg-base-300/20 p-2.5">
                            <MarkdownBlock content={String(input.plan ?? input.content ?? '')} />
                        </div>
                    )}

                    {/* 6. Generic / Fallback 详情 */}
                    {!isEdit && !isExecute && !isRead && !isTodo && kind !== 'plan' && (
                        <div className="space-y-2">
                            {Object.keys(input).length > 0 && (
                                <div className="rounded bg-base-300/30 p-2 font-mono text-[11px] max-h-48 overflow-y-auto">
                                    <pre className="whitespace-pre-wrap">{JSON.stringify(input, null, 2)}</pre>
                                </div>
                            )}
                            {result && (
                                <div className="rounded bg-base-300/20 p-2 font-mono text-[11px] max-h-48 overflow-y-auto">
                                    <pre className="whitespace-pre-wrap">{extractResultText(result)}</pre>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

export default ToolCallCard;
