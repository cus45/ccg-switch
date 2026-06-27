export type RightDockPanel = 'menu' | 'files' | 'review';

export interface RightDockState {
    collapsed: boolean;
    activePanel: RightDockPanel;
}

export const RIGHT_DOCK_STATE_STORAGE_KEY = 'ccg-chat-right-dock-state';

export const DEFAULT_RIGHT_DOCK_STATE: RightDockState = {
    collapsed: false,
    activePanel: 'menu',
};

function isRightDockPanel(value: unknown): value is RightDockPanel {
    return value === 'menu' || value === 'files' || value === 'review';
}

function isRightDockState(value: unknown): value is RightDockState {
    if (!value || typeof value !== 'object') return false;

    const candidate = value as Partial<RightDockState>;
    return typeof candidate.collapsed === 'boolean'
        && isRightDockPanel(candidate.activePanel);
}

export function loadRightDockState(): RightDockState {
    try {
        const raw = window.localStorage.getItem(RIGHT_DOCK_STATE_STORAGE_KEY);
        if (!raw) return DEFAULT_RIGHT_DOCK_STATE;

        const parsed = JSON.parse(raw) as unknown;
        return isRightDockState(parsed)
            ? parsed
            : DEFAULT_RIGHT_DOCK_STATE;
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
