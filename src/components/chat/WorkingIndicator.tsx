import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Loader2} from 'lucide-react';
import {formatDurationClock, formatTokenCount} from '../../utils/chatFormat';

const TICK_INTERVAL_MS = 1_000;

export interface WorkingIndicatorProps {
    /** 本回合起点（流式 assistant 消息的 createdAt）。 */
    startedAt: number;
    /** daemon 已推送的输出 token 数；缺省或 0 时不显示。 */
    outputTokens?: number;
    /** 正在执行的工具名；null 表示当前在生成文本。 */
    activeToolName?: string | null;
    /** 本轮已完成的工具调用数，用于「已执行 N 步」。 */
    completedToolCount?: number;
}

function translateWithFallback(
    t: (key: string, options?: Record<string, unknown>) => string,
    key: string,
    fallback: string,
    options?: Record<string, unknown>,
): string {
    const translated = t(key, options);
    return translated === key ? fallback : translated;
}

/**
 * 「工作中」指示器：spinner + 已用时 + 实时 token + 当前工具。
 *
 * 改造前流式期间只有一个绿点和一句「正在生成回复」，等待期是个黑箱——用户
 * 分不清模型在思考、在跑一个两分钟的构建、还是已经卡死。这四项信息全部由
 * 现有流式消息派生（createdAt / usage.output_tokens / 未完成的 tool_use），
 * 不需要 store 新增字段。
 */
export default function WorkingIndicator({
    startedAt,
    outputTokens = 0,
    activeToolName = null,
    completedToolCount = 0,
}: WorkingIndicatorProps) {
    const {t} = useTranslation();
    const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - startedAt));

    useEffect(() => {
        setElapsedMs(Math.max(0, Date.now() - startedAt));
        const timer = window.setInterval(() => {
            setElapsedMs(Math.max(0, Date.now() - startedAt));
        }, TICK_INTERVAL_MS);

        return () => window.clearInterval(timer);
    }, [startedAt]);

    const respondingLabel = translateWithFallback(t, 'chat.working.responding', 'Responding...');
    const runningToolLabel = activeToolName
        ? translateWithFallback(t, 'chat.working.runningTool', `Running ${activeToolName}`, {tool: activeToolName})
        : null;
    const stepsLabel = completedToolCount > 0
        ? translateWithFallback(
            t,
            'chat.working.completedSteps',
            `${completedToolCount} steps done`,
            {count: completedToolCount},
        )
        : null;
    const tokensLabel = outputTokens > 0
        ? translateWithFallback(
            t,
            'chat.working.outputTokens',
            `${formatTokenCount(outputTokens)} tokens`,
            {tokens: formatTokenCount(outputTokens)},
        )
        : null;

    return (
        <div className="chat-working-indicator" role="status" aria-live="polite" data-testid="chat-working-indicator">
            <Loader2 size={12} className="chat-working-spinner" aria-hidden="true" />
            <span className="chat-working-clock tabular-nums">{formatDurationClock(elapsedMs)}</span>
            <span className="chat-working-primary">{runningToolLabel ?? respondingLabel}</span>
            {tokensLabel && (
                <>
                    <span className="chat-working-separator" aria-hidden="true">·</span>
                    <span className="tabular-nums">{tokensLabel}</span>
                </>
            )}
            {stepsLabel && (
                <>
                    <span className="chat-working-separator" aria-hidden="true">·</span>
                    <span className="tabular-nums">{stepsLabel}</span>
                </>
            )}
        </div>
    );
}
