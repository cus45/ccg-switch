export type RightDockPanel = 'menu' | 'files' | 'review';

export interface RightDockState {
    collapsed: boolean;
    activePanel: RightDockPanel;
    /** 展开态宽度（px）；缺省表示未手动调整过，使用自动默认宽度。 */
    width?: number;
}

export const RIGHT_DOCK_STATE_STORAGE_KEY = 'ccg-chat-right-dock-state';

export const MIN_RIGHT_DOCK_WIDTH = 320;
export const MAX_RIGHT_DOCK_WIDTH = 1400;

export const DEFAULT_RIGHT_DOCK_STATE: RightDockState = {
    collapsed: false,
    activePanel: 'menu',
};

export function clampRightDockWidth(width: number, maxWidth = MAX_RIGHT_DOCK_WIDTH): number {
    const upperBound = Math.max(MIN_RIGHT_DOCK_WIDTH, Math.round(maxWidth));
    return Math.min(Math.max(Math.round(width), MIN_RIGHT_DOCK_WIDTH), upperBound);
}

function isRightDockPanel(value: unknown): value is RightDockPanel {
    return value === 'menu' || value === 'files' || value === 'review';
}

function isRightDockState(value: unknown): value is RightDockState {
    if (!value || typeof value !== 'object') return false;

    const candidate = value as Partial<RightDockState>;
    return typeof candidate.collapsed === 'boolean'
        && isRightDockPanel(candidate.activePanel)
        && (candidate.width === undefined
            || (typeof candidate.width === 'number' && Number.isFinite(candidate.width)));
}

export function loadRightDockState(): RightDockState {
    try {
        const raw = window.localStorage.getItem(RIGHT_DOCK_STATE_STORAGE_KEY);
        if (!raw) return DEFAULT_RIGHT_DOCK_STATE;

        const parsed = JSON.parse(raw) as unknown;
        if (!isRightDockState(parsed)) return DEFAULT_RIGHT_DOCK_STATE;
        return parsed.width === undefined
            ? parsed
            : {...parsed, width: clampRightDockWidth(parsed.width)};
    } catch {
        return DEFAULT_RIGHT_DOCK_STATE;
    }
}

export function saveRightDockState(state: RightDockState): void {
    try {
        window.localStorage.setItem(RIGHT_DOCK_STATE_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // localStorage can be unavailable in restricted WebView/browser contexts.
    }
}
