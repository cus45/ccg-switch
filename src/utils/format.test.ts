import { describe, expect, it } from 'vitest';
import {
    formatBucketDate,
    formatCost,
    formatLatency,
    formatPercent,
    formatTokens,
    parseFiniteNumber,
} from './format';

describe('parseFiniteNumber', () => {
    it('解析后端的 Decimal 字符串', () => {
        expect(parseFiniteNumber('0.010335')).toBeCloseTo(0.010335, 9);
        expect(parseFiniteNumber('3')).toBe(3);
    });

    it('非法值与空值一律归零，不产生 NaN', () => {
        expect(parseFiniteNumber(undefined)).toBe(0);
        expect(parseFiniteNumber('')).toBe(0);
        expect(parseFiniteNumber('abc')).toBe(0);
        expect(parseFiniteNumber('Infinity')).toBe(0);
    });
});

describe('formatCost', () => {
    it('精确 0 显示 $0，不是 $0.0000', () => {
        expect(formatCost('0')).toBe('$0');
        expect(formatCost(undefined)).toBe('$0');
    });

    it('小额保留 4 位小数 —— 单次请求常在 $0.01 以下', () => {
        expect(formatCost('0.010335')).toBe('$0.0103');
        expect(formatCost('0.0001')).toBe('$0.0001');
    });

    it('大额保留 2 位小数', () => {
        expect(formatCost('12.3456')).toBe('$12.35');
        expect(formatCost('1')).toBe('$1.00');
    });
});

describe('formatTokens', () => {
    it('按量级切换单位', () => {
        expect(formatTokens(999)).toBe('999');
        expect(formatTokens(1_500)).toBe('1.50K');
        expect(formatTokens(1_500_000)).toBe('1.50M');
    });

    it('0 与 undefined 显示 0', () => {
        expect(formatTokens(0)).toBe('0');
        expect(formatTokens(undefined)).toBe('0');
    });
});

describe('formatPercent', () => {
    it('保留 1 位小数', () => {
        expect(formatPercent(66.66667)).toBe('66.7%');
        expect(formatPercent(100)).toBe('100.0%');
    });

    it('0 与 undefined 显示 0%', () => {
        expect(formatPercent(0)).toBe('0%');
        expect(formatPercent(undefined)).toBe('0%');
    });
});

describe('formatLatency', () => {
    it('毫秒与秒按阈值切换', () => {
        expect(formatLatency(500)).toBe('500ms');
        expect(formatLatency(1_500)).toBe('1.50s');
    });

    it('0 与 undefined 显示 0ms', () => {
        expect(formatLatency(0)).toBe('0ms');
        expect(formatLatency(undefined)).toBe('0ms');
    });
});

describe('formatBucketDate', () => {
    it('非法日期原样返回，不抛异常', () => {
        expect(formatBucketDate('not-a-date')).toBe('Invalid Date');
    });

    it('可选显示时间部分', () => {
        const iso = '2026-09-01T10:30:00+08:00';
        const dateOnly = formatBucketDate(iso, false);
        const withTime = formatBucketDate(iso, true);
        expect(withTime.length).toBeGreaterThan(dateOnly.length);
    });
});
