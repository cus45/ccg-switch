/**
 * 右键菜单的视口内定位。
 *
 * 直接把 `clientX/clientY` 塞进 `left/top` 的写法在靠近右边缘或底边时会让菜单
 * 一部分跑到屏幕外——菜单项点不到，而且没有任何提示。这里按菜单尺寸做翻转与钳制。
 */

export interface ContextMenuPositionInput {
    /** 触发点（视口坐标）。 */
    x: number;
    y: number;
    /** 菜单估算尺寸。 */
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
    /** 与视口边缘保留的间距。 */
    margin?: number;
}

export interface ContextMenuPosition {
    left: number;
    top: number;
}

const DEFAULT_MARGIN = 8;

export function resolveContextMenuPosition({
    x,
    y,
    width,
    height,
    viewportWidth,
    viewportHeight,
    margin = DEFAULT_MARGIN,
}: ContextMenuPositionInput): ContextMenuPosition {
    // 优先向右下展开；放不下就翻到触发点另一侧，翻过去还放不下再钳到边缘内。
    const maxLeft = viewportWidth - width - margin;
    const maxTop = viewportHeight - height - margin;

    const flippedLeft = x + width + margin > viewportWidth ? x - width : x;
    const flippedTop = y + height + margin > viewportHeight ? y - height : y;

    return {
        left: Math.max(margin, Math.min(flippedLeft, Math.max(margin, maxLeft))),
        top: Math.max(margin, Math.min(flippedTop, Math.max(margin, maxTop))),
    };
}
