import {useTranslation} from 'react-i18next';
import {Check, CircleSlash} from 'lucide-react';
import type {TokenUsage} from '../../types/chat';
import {formatDurationHuman, formatTokenCount} from '../../utils/chatFormat';

export interface TurnCompleteDividerProps {
    durationMs?: number;
    usage?: TokenUsage;
    /** 本轮被用户中止：措辞与图标改为中性，不显示成「完成」。 */
    stopped?: boolean;
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
 * 回合收尾分隔条：`✓ 完成 · 12.3s · 1.5K tokens`。
 *
 * 改造前一轮结束只有右下角一行灰色小字尾注，回合边界在长转录里几乎看不出来。
 * 这里做成居中细线徽标，同时承担「本轮结束了」和「花了多少」两件事，
 * 与上下文压缩分隔条同一套视觉语言。
 */
export default function TurnCompleteDivider({
    durationMs,
    usage,
    stopped = false,
}: TurnCompleteDividerProps) {
    const {t} = useTranslation();

    const totalTokens = usage
        ? usage.input_tokens
            + usage.cache_creation_input_tokens
            + usage.cache_read_input_tokens
            + usage.output_tokens
        : 0;
    const hasDuration = typeof durationMs === 'number' && durationMs >= 0;

    // 没有耗时也没有用量时不值得占一行。
    if (!hasDuration && totalTokens <= 0) return null;

    const label = stopped
        ? translateWithFallback(t, 'chat.turn.stopped', 'Stopped')
        : translateWithFallback(t, 'chat.turn.complete', 'Done');
    const detailParts: string[] = [];
    if (hasDuration) detailParts.push(formatDurationHuman(durationMs));
    if (totalTokens > 0) {
        detailParts.push(translateWithFallback(
            t,
            'chat.turn.tokens',
            `${formatTokenCount(totalTokens)} tokens`,
            {tokens: formatTokenCount(totalTokens)},
        ));
    }

    const usageTitle = usage
        ? [
            translateWithFallback(t, 'chat.turn.usageInput', `Input ${formatTokenCount(usage.input_tokens)}`, {tokens: formatTokenCount(usage.input_tokens)}),
            translateWithFallback(t, 'chat.turn.usageCacheWrite', `Cache write ${formatTokenCount(usage.cache_creation_input_tokens)}`, {tokens: formatTokenCount(usage.cache_creation_input_tokens)}),
            translateWithFallback(t, 'chat.turn.usageCacheRead', `Cache read ${formatTokenCount(usage.cache_read_input_tokens)}`, {tokens: formatTokenCount(usage.cache_read_input_tokens)}),
            translateWithFallback(t, 'chat.turn.usageOutput', `Output ${formatTokenCount(usage.output_tokens)}`, {tokens: formatTokenCount(usage.output_tokens)}),
        ].join(' · ')
        : undefined;

    return (
        <div className="chat-turn-divider" role="separator" aria-label={label}>
            <span className="chat-turn-divider-line" aria-hidden="true" />
            <span className="chat-turn-divider-badge" title={usageTitle}>
                {stopped
                    ? <CircleSlash size={11} aria-hidden="true" />
                    : <Check size={11} aria-hidden="true" />}
                <span>{label}</span>
                {detailParts.length > 0 && (
                    <span className="chat-turn-divider-detail tabular-nums">
                        {detailParts.join(' · ')}
                    </span>
                )}
            </span>
            <span className="chat-turn-divider-line" aria-hidden="true" />
        </div>
    );
}
