import {Clock} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {TokenUsage} from '../../types/chat';
import {formatDurationClock, formatTokenCount} from '../../utils/chatFormat';

interface MessageMetaProps {
    /** 本轮耗时（毫秒） */
    durationMs?: number;
    /** token 用量 */
    usage?: TokenUsage;
    /** 是否按 assistant 流式尾注风格展示 */
    compact?: boolean;
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
 * 消息元数据 - 显示耗时和 token 用量。
 *
 * 文案此前是硬编码中文（「本次耗时」「输入」「输出」），英文界面下会漏出中文。
 */
export default function MessageMeta({durationMs, usage, compact = false}: MessageMetaProps) {
    const {t} = useTranslation();

    if (durationMs === undefined && !usage) return null;

    // 计算总输入 token（非缓存输入 + 缓存写 + 缓存读）
    const totalInput = usage
        ? usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
        : 0;
    const output = usage?.output_tokens ?? 0;
    const hasTokens = totalInput > 0 || output > 0;

    const durationLabel = compact
        ? translateWithFallback(t, 'chat.meta.durationShort', 'took')
        : translateWithFallback(t, 'chat.meta.duration', 'Took');
    const inputLabel = compact
        ? translateWithFallback(t, 'chat.meta.tokensShort', 'tokens')
        : translateWithFallback(t, 'chat.meta.input', 'in');
    const outputLabel = compact
        ? translateWithFallback(t, 'chat.meta.outputShort', 'out')
        : translateWithFallback(t, 'chat.meta.output', 'out');
    const usageTitle = usage
        ? translateWithFallback(
            t,
            'chat.meta.usageBreakdown',
            `Input ${formatTokenCount(usage.input_tokens)} · Cache write ${formatTokenCount(usage.cache_creation_input_tokens)} · Cache read ${formatTokenCount(usage.cache_read_input_tokens)} · Output ${formatTokenCount(output)}`,
            {
                input: formatTokenCount(usage.input_tokens),
                cacheWrite: formatTokenCount(usage.cache_creation_input_tokens),
                cacheRead: formatTokenCount(usage.cache_read_input_tokens),
                output: formatTokenCount(output),
            },
        )
        : undefined;

    return (
        <div
            className={
                compact
                    ? 'inline-flex items-center gap-1 text-[11px] leading-none text-base-content/42'
                    : 'flex items-center gap-1.5 mt-1.5 text-xs text-base-content/50'
            }
        >
            {durationMs !== undefined && (
                <>
                    <Clock size={compact ? 10 : 12} className={compact ? 'opacity-70' : ''} />
                    <span>{durationLabel}</span>
                    <span className={compact ? 'font-medium text-base-content/60' : 'font-medium'}>
                        {formatDurationClock(durationMs)}
                    </span>
                </>
            )}
            {durationMs !== undefined && hasTokens && (
                <span className="opacity-40">·</span>
            )}
            {hasTokens && (
                <span title={usageTitle}>
                    {inputLabel} {formatTokenCount(totalInput)} / {outputLabel} {formatTokenCount(output)}
                </span>
            )}
        </div>
    );
}
