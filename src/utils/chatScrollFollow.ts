/**
 * 转录滚动跟随的判定逻辑（纯函数，便于单测）。
 *
 * 改造前的问题：自动滚底 effect 依赖整个 `messages`，流式期间每来一截增量就调
 * 一次 `scrollTo({behavior: 'smooth'})`。平滑滚动是有动画时长的，被下一帧的调用
 * 不断打断重启，结果既抖动又永远追不上底部；而且只有「是否接近底部」一个状态，
 * 无法表达「用户正在往上翻，别拽我」的意图。
 *
 * 现在拆成两件事：
 * - **跟随状态**（follow）：由用户手势显式脱离，滚回底部区域自动恢复；
 * - **滚动行为**：流式期间用 `instant`（没有动画可被打断），用户主动回底用 `smooth`。
 */

/** 距底多少像素以内算「在底部区域」。 */
export const BOTTOM_FOLLOW_THRESHOLD = 160;

export interface ScrollMetrics {
    scrollHeight: number;
    scrollTop: number;
    clientHeight: number;
}

export function getDistanceFromBottom({scrollHeight, scrollTop, clientHeight}: ScrollMetrics): number {
    return scrollHeight - scrollTop - clientHeight;
}

export function isNearBottom(
    metrics: ScrollMetrics,
    threshold: number = BOTTOM_FOLLOW_THRESHOLD,
): boolean {
    return getDistanceFromBottom(metrics) < threshold;
}

/**
 * 判定所需的最小事件形态。真实的 `WheelEvent` / `KeyboardEvent` / `TouchEvent`
 * 都结构兼容，因此调用处直接传原生事件即可，而本模块不依赖 DOM。
 */
export interface FollowDetachCandidate {
    type: string;
    deltaY?: number;
    key?: string;
}

/**
 * 这个手势是否表达了「我要自己看历史」的意图。
 *
 * 只认用户手势，不认 `scroll` 事件——`scroll` 分不清是用户滚的还是我们
 * `scrollTo` 滚的，用它判定会导致程序滚动把自己踢出跟随状态。
 */
export function isFollowDetachIntent(event: FollowDetachCandidate): boolean {
    if (event.type === 'wheel') {
        // 只有往上滚才是脱离意图；往下滚交给「接近底部自动恢复」处理。
        return (event.deltaY ?? 0) < 0;
    }

    if (event.type === 'touchmove') {
        // 触摸无法在单个事件里可靠判向；一律视为接管，滚回底部会自动恢复。
        return true;
    }

    if (event.type === 'keydown') {
        return event.key === 'PageUp' || event.key === 'ArrowUp' || event.key === 'Home';
    }

    return false;
}

/**
 * 流式期间禁用平滑滚动：每帧都有新内容，动画只会互相打断成抖动。
 */
export function resolveFollowScrollBehavior(isStreaming: boolean): ScrollBehavior {
    return isStreaming ? 'instant' : 'smooth';
}

export interface UnreadCountInput {
    /** 当前是否处于跟随状态。跟随时视口始终在底部，不存在未读。 */
    following: boolean;
    previousCount: number;
    nextCount: number;
    currentUnread: number;
}

export function nextUnreadCount({
    following,
    previousCount,
    nextCount,
    currentUnread,
}: UnreadCountInput): number {
    if (following) return 0;
    // 只累加增量；条数减少（切会话、清空、压缩）不倒扣。
    if (nextCount <= previousCount) return currentUnread;
    return currentUnread + (nextCount - previousCount);
}
