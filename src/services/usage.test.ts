import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { getTimeWindow, isHourlyRange, TIME_RANGES } from './usage';

describe('getTimeWindow', () => {
    it('today 从本地今天 0 点开始，到现在结束', () => {
        const now = new Date(2026, 9, 9, 15, 30, 45).getTime();
        const { startDate, endDate } = getTimeWindow('today', now);
        expect(endDate).toBe(Math.floor(now / 1000));
        expect(startDate).toBe(Math.floor(new Date(2026, 9, 9, 0, 0, 0).getTime() / 1000));
    });

    it('凌晨刚过 0 点时 today 窗口很短，而 1d 仍是完整 24 小时', () => {
        const now = new Date(2026, 9, 9, 0, 5, 0).getTime();
        const today = getTimeWindow('today', now);
        const day = getTimeWindow('1d', now);
        expect(today.endDate - today.startDate).toBe(5 * 60);
        expect(day.endDate - day.startDate).toBe(24 * 3600);
    });

    it('7d / 30d 是滚动窗口', () => {
        const now = Date.UTC(2026, 9, 9);
        expect(getTimeWindow('7d', now).startDate).toBe(now / 1000 - 7 * 86400);
        expect(getTimeWindow('30d', now).startDate).toBe(now / 1000 - 30 * 86400);
    });
});

describe('isHourlyRange', () => {
    it('今天与 24 小时按小时分桶，7 天 / 30 天按天', () => {
        expect(TIME_RANGES.filter(isHourlyRange)).toEqual(['today', '1d']);
    });
});
