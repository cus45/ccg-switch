import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { getTimeWindow, isHourlyRange, resolveUsageRange, TIME_RANGES } from './usage';

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
        const hourly = TIME_RANGES.filter((preset) => isHourlyRange({ preset }));
        expect(hourly).toEqual(['today', '1d']);
    });

    it('自定义区间看实际跨度：≤24h 按小时，更长按天', () => {
        const now = new Date(2026, 9, 9, 15, 0, 0).getTime();
        const nowSec = Math.floor(now / 1000);
        expect(
            isHourlyRange({
                preset: 'custom',
                customStartDate: nowSec - 6 * 3600,
                customEndDate: nowSec,
            })
        ).toBe(true);
        expect(
            isHourlyRange({
                preset: 'custom',
                customStartDate: nowSec - 3 * 24 * 3600,
                customEndDate: nowSec,
            })
        ).toBe(false);
    });
});

describe('resolveUsageRange', () => {
    it('预设走 getTimeWindow', () => {
        const now = Date.UTC(2026, 9, 9);
        expect(resolveUsageRange({ preset: '7d' }, now)).toEqual(getTimeWindow('7d', now));
    });

    it('自定义区间用显式起止', () => {
        const now = Date.UTC(2026, 9, 9);
        const window = resolveUsageRange(
            { preset: 'custom', customStartDate: 1000, customEndDate: 2000 },
            now
        );
        expect(window).toEqual({ startDate: 1000, endDate: 2000 });
    });

    it('liveEndTime 让终点跟随当前时刻，忽略填写的结束时间', () => {
        const now = Date.UTC(2026, 9, 9);
        const window = resolveUsageRange(
            { preset: 'custom', customStartDate: 1000, customEndDate: 2000, liveEndTime: true },
            now
        );
        expect(window.startDate).toBe(1000);
        expect(window.endDate).toBe(Math.floor(now / 1000));
    });
});
