// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YearlyHeatmap } from './YearlyHeatmap';
import type { HeatmapDay } from '../../types/usage';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockUseYearlyHeatmap = vi.fn();
vi.mock('../../hooks/useUsageQueries', () => ({
    useYearlyHeatmap: (filters: unknown, refreshMs: number) =>
        mockUseYearlyHeatmap(filters, refreshMs),
}));

function createKeyOnlyI18n() {
    const instance = createInstance();
    instance.init({
        lng: 'zh',
        fallbackLng: false,
        resources: {
            zh: {
                translation: {
                    'usage.yearlyHeatmap': '全年使用热力图',
                    'usage.yearlyHeatmapSubtitle': '过去 365 天每日活跃度与用量分布',
                    'usage.heatmap.requests': '请求数',
                    'usage.heatmap.tokens': 'Token 用量',
                    'usage.heatmap.cost': '费用',
                    'usage.heatmap.less': '少',
                    'usage.heatmap.more': '多',
                    'usage.heatmap.totalActiveDays': '活跃天数',
                    'usage.heatmap.totalYearRequests': '年请求数',
                    'usage.heatmap.totalYearTokens': '年 Token 消耗',
                    'usage.heatmap.totalYearCost': '年累计费用',
                },
            },
        },
        initImmediate: false,
        interpolation: { escapeValue: false },
    });
    return instance;
}

function generateMockDays(count = 365): HeatmapDay[] {
    const result: HeatmapDay[] = [];
    const baseDate = new Date(2026, 0, 1);
    for (let i = 0; i < count; i++) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        result.push({
            date: `${y}-${m}-${day}`,
            requestCount: i % 5 === 0 ? i * 2 : 0,
            totalCost: i % 5 === 0 ? (i * 0.05).toFixed(4) : '0.0000',
            totalTokens: i % 5 === 0 ? i * 500 : 0,
        });
    }
    return result;
}

describe('YearlyHeatmap', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root && container) {
            act(() => {
                root?.unmount();
            });
        }
        container?.remove();
        container = null;
        root = null;
        vi.clearAllMocks();
    });

    it('renders skeleton during loading', () => {
        mockUseYearlyHeatmap.mockReturnValue({
            data: undefined,
            isLoading: true,
        });

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        act(() => {
            root?.render(
                createElement(
                    I18nextProvider,
                    { i18n: createKeyOnlyI18n() },
                    createElement(YearlyHeatmap, { filters: {}, refreshMs: 0 })
                )
            );
        });

        const skeleton = container.querySelector('[aria-busy="true"]');
        expect(skeleton).not.toBeNull();
    });

    it('renders 365 days contribution matrix and annual summary', () => {
        const days = generateMockDays(365);
        mockUseYearlyHeatmap.mockReturnValue({
            data: days,
            isLoading: false,
        });

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        act(() => {
            root?.render(
                createElement(
                    I18nextProvider,
                    { i18n: createKeyOnlyI18n() },
                    createElement(YearlyHeatmap, { filters: {}, refreshMs: 0 })
                )
            );
        });

        // Header exists
        expect(container.textContent).toContain('全年使用热力图');
        expect(container.textContent).toContain('过去 365 天每日活跃度与用量分布');

        // Metric buttons exist
        expect(container.textContent).toContain('请求数');
        expect(container.textContent).toContain('Token 用量');
        expect(container.textContent).toContain('费用');

        // Summary bar exists
        expect(container.textContent).toContain('活跃天数');
        expect(container.textContent).toContain('年请求数');
        expect(container.textContent).toContain('年 Token 消耗');
        expect(container.textContent).toContain('年累计费用');
    });

    it('switches metric to tokens and cost on button click', () => {
        const days = generateMockDays(365);
        mockUseYearlyHeatmap.mockReturnValue({
            data: days,
            isLoading: false,
        });

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        act(() => {
            root?.render(
                createElement(
                    I18nextProvider,
                    { i18n: createKeyOnlyI18n() },
                    createElement(YearlyHeatmap, { filters: {}, refreshMs: 0 })
                )
            );
        });

        const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        expect(buttons.length).toBe(3);

        // Click 'Token 用量'
        act(() => {
            buttons[1].click();
        });
        expect(buttons[1].getAttribute('aria-selected')).toBe('true');

        // Click '费用'
        act(() => {
            buttons[2].click();
        });
        expect(buttons[2].getAttribute('aria-selected')).toBe('true');
    });
});
