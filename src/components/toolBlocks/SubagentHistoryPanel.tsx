import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
    ArrowUpRight,
    Bot,
    FileCode2,
    Globe,
    History,
    ListTree,
    Loader2,
    Pencil,
    RefreshCw,
    Search,
    Terminal,
    Wrench
} from 'lucide-react';
import ContentBlockRenderer from '../chat/ContentBlockRenderer';
import type {ChatMessage, ToolResultBlock} from '../../types/chat';
import type {UnifiedSessionMessage} from '../../types/session';
import {findToolResult, getRenderableContentBlocks, shouldRenderChatMessage} from '../../utils/chatMessageFlow';
import {loadClaudeSubagentHistory} from '../../services/subagentHistoryService';
import {useChatStore, useChatTab} from '../../stores/useChatStore';
import {useChatPaneTabKey} from '../chat/paneTabContext';
import {openFile} from '../../utils/bridge';
import {
    buildSubagentProcessModel,
    extractSubagentResultRuntimeMeta,
    resolveSubagentHistoryRequest,
    summarizeSubagentProcessToolCall,
} from './subagentHistoryUtils';
import {formatLineRange} from '../../utils/toolPresentation';

interface SubagentHistoryPanelProps {
    agentId?: string | null;
    description?: string | null;
    enabled: boolean;
    hasVisibleMeta?: boolean;
    result?: ToolResultBlock | null;
    /** 父 Task 工具块 id；子代理 live 消息按它路由(== 子代理消息的 parent_tool_use_id)。 */
    toolId?: string | null;
}

interface SubagentProcessSummaryProps {
    agentId?: string | null;
    requestSessionId?: string | null;
    currentCwd: string | null;
    process: ReturnType<typeof buildSubagentProcessModel>;
}

function normalizeHistoryRole(role: string): ChatMessage['role'] {
    if (role === 'user' || role === 'assistant' || role === 'system') {
        return role;
    }
    return 'system';
}

function mapHistoryMessage(
    sessionId: string,
    message: UnifiedSessionMessage,
    index: number,
): ChatMessage {
    const parsedTime = message.ts ? Date.parse(message.ts) : NaN;
    return {
        id: `subagent-${sessionId}-${index}`,
        role: normalizeHistoryRole(message.role),
        content: message.content,
        raw: message.raw ?? undefined,
        createdAt: Number.isFinite(parsedTime) ? parsedTime : index,
    };
}

function hasRenderableHistory(messages: ChatMessage[]): boolean {
    return messages.some(shouldRenderChatMessage);
}

function formatStatNumber(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

function formatTokenStat(t: ReturnType<typeof useTranslation>['t'], value: number): string {
    const label = t('tools.subagentProcessTokens', { count: 0 });
    const suffix = label.replace(/\s*0[\s,.-]*/u, '').trim() || 'tokens';
    return `${formatStatNumber(value)} ${suffix}`;
}

function getSubagentToolIcon(iconKind: ReturnType<typeof summarizeSubagentProcessToolCall>['iconKind']) {
    switch (iconKind) {
        case 'command':
            return Terminal;
        case 'search':
            return Search;
        case 'read':
            return FileCode2;
        case 'list':
            return ListTree;
        case 'patch':
            return Pencil;
        case 'web':
            return Globe;
        case 'agent':
            return Bot;
        default:
            return Wrench;
    }
}

export function SubagentProcessSummary({
    agentId,
    requestSessionId,
    currentCwd,
    process,
}: SubagentProcessSummaryProps) {
    const { t } = useTranslation();

    if (!(process.thought || process.readFiles.length > 0 || process.toolCalls.length > 0 || process.finalSummary)) {
        return null;
    }

    return (
        <div className="subagent-process-card">
            <div className="subagent-process-header">
                <div>
                    <div className="subagent-process-title">{t('tools.subagentProcessTitle')}</div>
                    {(agentId || requestSessionId) && (
                        <div className="subagent-process-subtitle">
                            {agentId || requestSessionId}
                        </div>
                    )}
                </div>
                <div className="subagent-process-stats">
                    {[
                        process.totalDurationMs != null ? t('tools.subagentProcessDuration', { count: process.totalDurationMs }) : null,
                        process.toolUseCount > 0 ? t('tools.subagentProcessTools', { count: process.toolUseCount }) : null,
                        process.readFiles.length > 0 ? t('tools.subagentProcessFiles', { count: process.readFiles.length }) : null,
                        process.totalTokens != null ? formatTokenStat(t, process.totalTokens) : null,
                    ].filter(Boolean).join(' · ')}
                </div>
            </div>

            <div className="subagent-process-sections">
                {process.thought && (
                    <section className="subagent-process-section">
                        <div className="subagent-section-heading">{t('tools.subagentProcessThinking')}</div>
                        <div className="subagent-note-card">{process.thought}</div>
                    </section>
                )}

                {process.readFiles.length > 0 && (
                    <section className="subagent-process-section">
                        <div className="subagent-section-heading">
                            {t('tools.subagentProcessFilesRead', { count: process.readFiles.length })}
                        </div>
                        <div className="subagent-file-grid">
                            {process.readFiles.map((file) => (
                                <button
                                    key={file.id}
                                    type="button"
                                    className="subagent-file-chip clickable-file"
                                    title={t('tools.subagentProcessOpenFile', { file: file.displayPath })}
                                    aria-label={t('tools.subagentProcessOpenFile', { file: file.displayPath })}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        void openFile(file.openPath, file.lineStart, file.lineEnd, currentCwd);
                                    }}
                                    onKeyDown={(event) => {
                                        event.stopPropagation();
                                    }}
                                >
                                    <FileCode2 className="subagent-chip-icon" aria-hidden="true" />
                                        <span className="subagent-chip-body">
                                            <span className="subagent-chip-text">{file.displayPath}</span>
                                            {file.lineStart && (
                                                <span className="subagent-chip-meta">
                                                    {formatLineRange({ start: file.lineStart, end: file.lineEnd })}
                                                </span>
                                            )}
                                        </span>
                                    <ArrowUpRight className="subagent-chip-action-icon" aria-hidden="true" />
                                </button>
                            ))}
                        </div>
                    </section>
                )}

                {process.toolCalls.length > 0 && (
                    <section className="subagent-process-section">
                        <div className="subagent-section-heading">{t('tools.subagentProcessOtherTools')}</div>
                        <div className="subagent-tool-list">
                            {process.toolCalls.map((tool) => {
                                const presentation = summarizeSubagentProcessToolCall(tool);
                                const Icon = getSubagentToolIcon(presentation.iconKind);
                                const interactiveTarget = tool.resultFile ?? tool.target;
                                const hasTarget = Boolean(interactiveTarget);
                                const detailText = tool.detail?.trim();
                                const resultSummaryText = tool.resultSummary?.trim();
                                const showDetail = Boolean(
                                    detailText
                                    && detailText !== presentation.summary
                                    && detailText !== interactiveTarget?.displayPath,
                                ) || Boolean(
                                    detailText
                                    && interactiveTarget
                                    && detailText === presentation.summary
                                );
                                const showResultSummary = Boolean(
                                    resultSummaryText
                                    && resultSummaryText !== presentation.summary
                                    && resultSummaryText !== interactiveTarget?.displayPath
                                    && resultSummaryText !== detailText,
                                );
                                const isJsonLikeDetail = Boolean(
                                    tool.detail?.trim().startsWith('{')
                                    || tool.resultSummary?.trim().startsWith('{')
                                );

                                return (
                                    <div key={tool.id} className="subagent-tool-row">
                                        <div className="subagent-tool-row-main">
                                            <Icon className="subagent-chip-icon" aria-hidden="true" />
                                            <span className={`tool-command-chip ${presentation.accentClass}`}>
                                                {presentation.label}
                                            </span>
                                            <span className="subagent-tool-row-name" title={tool.name}>
                                                {tool.name}
                                            </span>
                                            {hasTarget ? (
                                                <button
                                                    type="button"
                                                    className="subagent-tool-row-target clickable-file"
                                                    title={t('tools.subagentProcessOpenFile', { file: interactiveTarget?.displayPath ?? presentation.summary })}
                                                    aria-label={t('tools.subagentProcessOpenFile', { file: interactiveTarget?.displayPath ?? presentation.summary })}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        if (!interactiveTarget) {
                                                            return;
                                                        }
                                                        void openFile(
                                                            interactiveTarget.openPath,
                                                            interactiveTarget.lineStart,
                                                            interactiveTarget.lineEnd,
                                                            currentCwd,
                                                        );
                                                    }}
                                                    onKeyDown={(event) => {
                                                        event.stopPropagation();
                                                    }}
                                                >
                                                    <span className="subagent-tool-row-summary" title={interactiveTarget?.displayPath ?? presentation.summary}>
                                                        {interactiveTarget?.displayPath ?? presentation.summary}
                                                    </span>
                                                    {interactiveTarget?.lineStart && (
                                                        <span className="subagent-chip-meta">
                                                            {formatLineRange({ start: interactiveTarget.lineStart, end: interactiveTarget.lineEnd })}
                                                        </span>
                                                    )}
                                                    <ArrowUpRight className="subagent-chip-action-icon" aria-hidden="true" />
                                                </button>
                                            ) : (
                                                <span className="subagent-tool-row-summary" title={presentation.summary}>
                                                    {presentation.summary}
                                                </span>
                                            )}
                                        </div>
                                        {showDetail && (
                                            <small className="subagent-tool-row-detail" title={tool.detail}>
                                                {tool.detail}
                                            </small>
                                        )}
                                        {showResultSummary && !isJsonLikeDetail && (
                                            <small className="subagent-tool-row-detail" title={tool.resultSummary}>
                                                {tool.resultSummary}
                                            </small>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {process.finalSummary && (
                    <section className="subagent-process-section">
                        <div className="subagent-section-heading">{t('tools.subagentProcessResult')}</div>
                        <div className="subagent-result-card">{process.finalSummary}</div>
                        {process.fullResultText && (
                            <details className="subagent-result">
                                <summary>{t('tools.subagentProcessShowFullOutput')}</summary>
                                <pre>{process.fullResultText}</pre>
                            </details>
                        )}
                    </section>
                )}
            </div>
        </div>
    );
}

export default function SubagentHistoryPanel({
    agentId,
    description,
    enabled,
    hasVisibleMeta = false,
    result,
    toolId,
}: SubagentHistoryPanelProps) {
    const { t } = useTranslation();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [retryToken, setRetryToken] = useState(0);
    // 宿主 pane 绑定的 tab（侧聊）；null/未命中回退全局活跃投影（主聊天）。
    // 不按 pane 区分会让侧聊里的子代理卡片误用主聊天的会话上下文与 live 轨迹。
    const paneTabKey = useChatPaneTabKey();
    const paneTab = useChatTab(paneTabKey);
    const globalProvider = useChatStore((state) => state.activeSession?.providerId ?? state.provider);
    const globalSessionId = useChatStore((state) => state.sessionId);
    const globalSourcePath = useChatStore((state) => state.activeSession?.sourcePath ?? null);
    const globalCwd = useChatStore((state) => state.currentCwd);
    // Live trajectory streamed into this Task card (keyed by the Task tool_use id).
    // When present it takes over from the on-disk history load.
    const globalLiveMessages = useChatStore((state) => (toolId ? state.subagentRuns[toolId] : undefined));
    const activeProvider = paneTab ? (paneTab.activeSession?.providerId ?? paneTab.provider) : globalProvider;
    const sessionId = paneTab ? paneTab.sessionId : globalSessionId;
    const sourcePath = paneTab ? (paneTab.activeSession?.sourcePath ?? null) : globalSourcePath;
    const currentCwd = paneTab ? paneTab.currentCwd : globalCwd;
    const liveMessages = paneTab
        ? (toolId ? paneTab.subagentRuns[toolId] : undefined)
        : globalLiveMessages;
    const hasLive = Boolean(liveMessages && liveMessages.length > 0);
    const historyRequest = resolveSubagentHistoryRequest({
        sessionId,
        sourcePath,
        currentCwd,
        agentId,
        description,
    });
    const {
        requestSessionId,
        requestSourcePath,
        canLoad: canLoadHistory,
    } = historyRequest;
    const runtimeMeta = extractSubagentResultRuntimeMeta(result);
    const renderMessages = hasLive ? (liveMessages as ChatMessage[]) : messages;
    const process = buildSubagentProcessModel(renderMessages, runtimeMeta);
    // 轨迹限高滚动：live 流式时跟随底部；用户上滚阅读时停止跟随，回到底部附近恢复。
    const trajectoryRef = useRef<HTMLDivElement | null>(null);
    const followTrajectoryRef = useRef(true);
    const handleTrajectoryScroll = () => {
        const el = trajectoryRef.current;
        if (!el) return;
        followTrajectoryRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    useEffect(() => {
        const el = trajectoryRef.current;
        if (!el || !hasLive || !followTrajectoryRef.current) return;
        el.scrollTop = el.scrollHeight;
    }, [hasLive, renderMessages.length]);
    // Identity of the on-disk load; used to dedupe + recover from mid-flight
    // dep changes without leaving `loading` stuck true (the previous bug).
    // retryToken 使「重试」按钮能强制一次全新加载。
    const loadKey = `${activeProvider}|${requestSessionId ?? ''}|${requestSourcePath ?? ''}|${agentId ?? ''}|${description ?? ''}|${retryToken}`;
    const loadedKeyRef = useRef<string>('');

    useEffect(() => {
        setMessages([]);
        setLoaded(false);
        setError(null);
        loadedKeyRef.current = '';
    }, [loadKey]);

    useEffect(() => {
        // Live data wins — never disk-load while streaming into the card.
        if (!enabled || hasLive) {
            return;
        }
        if (activeProvider !== 'claude') {
            setLoaded(true);
            return;
        }
        // Still running (no tool_result yet): show a "running" state instead of
        // loading an incomplete on-disk session. Disk load only for finished runs.
        if (!result) {
            return;
        }
        if (!canLoadHistory) {
            setLoaded(true);
            return;
        }
        // Dedupe by identity (not by `loading`), so a cancelled in-flight load
        // can always be superseded by a fresh one for the settled identity.
        if (loadedKeyRef.current === loadKey) {
            return;
        }

        loadedKeyRef.current = loadKey;
        const resolvedRequestSessionId = requestSessionId ?? 'subagent';
        let cancelled = false;
        setLoading(true);
        setError(null);

        void loadClaudeSubagentHistory({
            sourcePath: requestSourcePath ?? undefined,
            sessionId: resolvedRequestSessionId,
            agentId,
            description,
        })
            .then((history) => {
                if (cancelled) {
                    return;
                }
                setMessages(history.map((message, index) => mapHistoryMessage(resolvedRequestSessionId, message, index)));
                setLoaded(true);
            })
            .catch((err) => {
                if (cancelled) {
                    return;
                }
                setLoaded(true);
                setError(String(err));
                loadedKeyRef.current = ''; // allow retry on a later render
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [
        enabled,
        hasLive,
        result,
        activeProvider,
        agentId,
        canLoadHistory,
        description,
        loadKey,
        requestSessionId,
        requestSourcePath,
    ]);

    // Live trajectory: render immediately, bypassing all disk-load states.
    if (hasLive) {
        return renderTrajectory();
    }

    if (activeProvider !== 'claude') {
        return (
            <div className="agent-history-placeholder agent-history-placeholder-inline">
                <div className="agent-history-placeholder-text">
                    <History className="agent-history-placeholder-icon" aria-hidden="true" />
                    <span>{t('tools.subagentHistory')}</span>
                </div>
                <div className="agent-history-placeholder-note">
                    {t('tools.subagentHistoryUnavailable')}
                </div>
            </div>
        );
    }

    // No tool_result yet → the sub-agent is still running. Show a running state
    // rather than a permanent spinner (the reported "stuck loading" symptom).
    if (!result) {
        return (
            <div className="agent-history-placeholder agent-history-placeholder-inline">
                <div className="agent-history-placeholder-text">
                    <Loader2 className="agent-history-placeholder-icon animate-spin" aria-hidden="true" />
                    <span>{t('tools.subagentRunning', '子代理运行中…')}</span>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="agent-history-placeholder agent-history-placeholder-inline">
                <div className="agent-history-placeholder-text">
                    <Loader2 className="agent-history-placeholder-icon animate-spin" aria-hidden="true" />
                    <span>{t('tools.subagentHistoryLoading')}</span>
                </div>
            </div>
        );
    }

    if (!canLoadHistory) {
        return (
            <div className="agent-history-placeholder agent-history-placeholder-inline">
                <div className="agent-history-placeholder-text">
                    <History className="agent-history-placeholder-icon" aria-hidden="true" />
                    <span>{t('tools.subagentHistory')}</span>
                </div>
                <div className="agent-history-placeholder-note">
                    {hasVisibleMeta ? t('tools.subagentHistoryUnavailable') : t('tools.subagentHistoryPendingEmpty')}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="agent-history-placeholder agent-history-placeholder-inline">
                <div className="agent-history-placeholder-text">
                    <History className="agent-history-placeholder-icon" aria-hidden="true" />
                    <span>{t('tools.subagentHistory')}</span>
                </div>
                <div className="agent-history-placeholder-note flex items-center gap-2">
                    <span className="text-error" title={error}>
                        {t('tools.subagentHistoryLoadFailed')}
                    </span>
                    <button
                        type="button"
                        className="btn btn-ghost btn-xs h-5 min-h-0 gap-1 px-1.5 text-error"
                        onClick={() => setRetryToken((token) => token + 1)}
                    >
                        <RefreshCw size={11} />
                        {t('tools.subagentHistoryRetry', '重试')}
                    </button>
                </div>
            </div>
        );
    }

    if (loaded && !hasRenderableHistory(messages)) {
        return (
            <div className="agent-history-placeholder agent-history-placeholder-inline">
                <div className="agent-history-placeholder-text">
                    <History className="agent-history-placeholder-icon" aria-hidden="true" />
                    <span>{t('tools.subagentHistory')}</span>
                </div>
                <div className="agent-history-placeholder-note">
                    {t('tools.subagentHistoryEmpty')}
                </div>
            </div>
        );
    }

    return renderTrajectory();

    function renderTrajectory() {
        // 运行中（尚无 tool_result）时在轨迹尾部保留一个活动指示，
        // 让用户知道子代理仍在产出，而不是卡片「渲染完就停了」。
        const stillRunning = hasLive && !result;
        return (
            <div className="tool-section">
                <div className="tool-section-label">{t('tools.subagentHistory')}:</div>
                <SubagentProcessSummary
                    agentId={agentId}
                    requestSessionId={requestSessionId}
                    currentCwd={currentCwd}
                    process={process}
                />
                <div
                    ref={trajectoryRef}
                    className="max-h-96 space-y-3 overflow-y-auto overflow-x-hidden pr-1"
                    onScroll={handleTrajectoryScroll}
                >
                    {renderMessages.map((message, messageIndex) => {
                        if (!shouldRenderChatMessage(message)) {
                            return null;
                        }
                        const blocks = getRenderableContentBlocks(message.raw);
                        if (blocks.length > 0) {
                            return (
                                <div
                                    key={message.id}
                                    className="agent-history-message assistant-message-flow min-w-0 max-w-full overflow-x-hidden"
                                >
                                    <ContentBlockRenderer
                                        blocks={blocks}
                                        findToolResult={(id) => findToolResult(renderMessages, id, messageIndex)}
                                        compact
                                    />
                                </div>
                            );
                        }

                        if (!message.content.trim()) {
                            return null;
                        }

                        return (
                            <div key={message.id} className="agent-history-message">
                                <div className="task-field-content task-prompt">{message.content}</div>
                            </div>
                        );
                    })}
                    {stillRunning && (
                        <div className="flex items-center gap-1.5 py-1 text-xs text-base-content/50">
                            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                            <span>{t('tools.subagentRunning', '子代理运行中…')}</span>
                        </div>
                    )}
                </div>
            </div>
        );
    }
}
