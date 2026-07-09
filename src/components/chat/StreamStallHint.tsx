// StreamStallHint - 回合卡死提示（对标 desktop-cc-gui 的 turn stalled 检测，轻量版）

import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Hourglass, Square} from 'lucide-react';
import {getRequestActivityAt, useChatStore} from '../../stores/useChatStore';

/** 超过该时长无任何 daemon 输出（含工具事件）视为停滞 */
export const STREAM_STALL_THRESHOLD_MS = 90_000;
const POLL_INTERVAL_MS = 5_000;

interface StreamStallHintProps {
    /** 该 pane 进行中的 requestId；null=空闲 */
    requestId: string | null;
    streaming: boolean;
    /** 是否提供停止按钮（主聊天可中止；侧聊后端无法定向中止） */
    canAbort: boolean;
}

export function computeStalledSeconds(
    lastActivityAt: number | null,
    now: number,
    thresholdMs: number = STREAM_STALL_THRESHOLD_MS,
): number | null {
    if (lastActivityAt === null) return null;
    const idleMs = now - lastActivityAt;
    return idleMs >= thresholdMs ? Math.floor(idleMs / 1000) : null;
}

/**
 * 流式回合长时间（90s）没有任何输出时的非侵入提示。
 * 长工具任务（构建/测试）本来就可能长时间无输出，因此措辞保持中性，
 * 仅提供「停止本轮」出口，不做自动干预。
 */
export default function StreamStallHint({requestId, streaming, canAbort}: StreamStallHintProps) {
    const {t} = useTranslation();
    const abort = useChatStore((state) => state.abort);
    const [stalledSeconds, setStalledSeconds] = useState<number | null>(null);

    useEffect(() => {
        if (!streaming || !requestId) {
            setStalledSeconds(null);
            return undefined;
        }
        const evaluate = () => {
            setStalledSeconds(computeStalledSeconds(getRequestActivityAt(requestId), Date.now()));
        };
        evaluate();
        const timer = window.setInterval(evaluate, POLL_INTERVAL_MS);
        return () => {
            window.clearInterval(timer);
            setStalledSeconds(null);
        };
    }, [requestId, streaming]);

    if (!streaming || stalledSeconds === null) return null;

    const stopLabel = t('chat.stall.stop');

    return (
        <div
            className="mx-2 mb-1 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-base-content/70"
            role="status"
            data-testid="chat-stream-stall-hint"
        >
            <Hourglass size={13} className="shrink-0 text-warning" aria-hidden="true" />
            <span className="min-w-0 flex-1">
                {t('chat.stall.hint', {seconds: stalledSeconds})}
            </span>
            {canAbort && (
                <button
                    type="button"
                    className="btn btn-ghost btn-xs h-6 min-h-0 shrink-0 gap-1 px-2 text-warning"
                    onClick={() => {
                        void abort();
                    }}
                    title={stopLabel}
                    aria-label={stopLabel}
                >
                    <Square size={11} />
                    {stopLabel}
                </button>
            )}
        </div>
    );
}
