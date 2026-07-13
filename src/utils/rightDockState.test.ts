// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
    clampRightDockWidth,
    DEFAULT_RIGHT_DOCK_STATE,
    loadRightDockState,
    MAX_RIGHT_DOCK_WIDTH,
    MIN_RIGHT_DOCK_WIDTH,
    RIGHT_DOCK_STATE_STORAGE_KEY,
    type RightDockState,
    saveRightDockState,
} from './rightDockState';

describe('rightDockState', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    it('defaults to an expanded dock on the menu panel', () => {
        expect(loadRightDockState()).toEqual(DEFAULT_RIGHT_DOCK_STATE);
        expect(DEFAULT_RIGHT_DOCK_STATE).toEqual({collapsed: false, activePanel: 'menu'});
    });

    it('loads and saves collapsed state and the active panel', () => {
        const state: RightDockState = {collapsed: true, activePanel: 'review'};

        saveRightDockState(state);

        expect(window.localStorage.getItem(RIGHT_DOCK_STATE_STORAGE_KEY)).toBe(JSON.stringify(state));
        expect(loadRightDockState()).toEqual(state);
    });

    it('falls back to default state when persisted data is invalid', () => {
        window.localStorage.setItem(RIGHT_DOCK_STATE_STORAGE_KEY, JSON.stringify({
            collapsed: 'yes',
            activePanel: 'browser',
        }));

        expect(loadRightDockState()).toEqual(DEFAULT_RIGHT_DOCK_STATE);
    });

    it('round-trips a manually resized dock width', () => {
        const state: RightDockState = {collapsed: false, activePanel: 'menu', width: 640};

        saveRightDockState(state);

        expect(loadRightDockState()).toEqual(state);
    });

    it('clamps out-of-range persisted widths on load', () => {
        saveRightDockState({collapsed: false, activePanel: 'menu', width: 20});
        expect(loadRightDockState().width).toBe(MIN_RIGHT_DOCK_WIDTH);

        saveRightDockState({collapsed: false, activePanel: 'menu', width: 99999});
        expect(loadRightDockState().width).toBe(MAX_RIGHT_DOCK_WIDTH);
    });

    it('falls back to default state when the persisted width is not a number', () => {
        window.localStorage.setItem(RIGHT_DOCK_STATE_STORAGE_KEY, JSON.stringify({
            collapsed: false,
            activePanel: 'menu',
            width: 'wide',
        }));

        expect(loadRightDockState()).toEqual(DEFAULT_RIGHT_DOCK_STATE);
    });

    it('clampRightDockWidth respects a custom viewport-derived upper bound', () => {
        expect(clampRightDockWidth(900, 700)).toBe(700);
        expect(clampRightDockWidth(500, 700)).toBe(500);
        expect(clampRightDockWidth(900, 100)).toBe(MIN_RIGHT_DOCK_WIDTH);
    });

    it('does not throw when localStorage is unavailable', () => {
        vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });

        expect(loadRightDockState()).toEqual(DEFAULT_RIGHT_DOCK_STATE);
        expect(() => saveRightDockState({collapsed: true, activePanel: 'files'})).not.toThrow();
    });
});
