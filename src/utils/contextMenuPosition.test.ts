import {describe, expect, it} from 'vitest';
import {resolveContextMenuPosition} from './contextMenuPosition';

function position(overrides: Partial<Parameters<typeof resolveContextMenuPosition>[0]> = {}) {
    return resolveContextMenuPosition({
        x: 100,
        y: 100,
        width: 160,
        height: 80,
        viewportWidth: 1000,
        viewportHeight: 800,
        ...overrides,
    });
}

describe('resolveContextMenuPosition', () => {
    it('空间够时就在触发点向右下展开', () => {
        expect(position()).toEqual({left: 100, top: 100});
    });

    it('贴右边缘时翻到触发点左侧', () => {
        expect(position({x: 960}).left).toBe(800);
    });

    it('贴下边缘时翻到触发点上方', () => {
        expect(position({y: 780}).top).toBe(700);
    });

    it('右下角同时翻转', () => {
        expect(position({x: 980, y: 790})).toEqual({left: 820, top: 710});
    });

    it('翻转后仍超出左上时钳到边距内，不出现负坐标', () => {
        expect(position({x: 10, y: 10, width: 400, height: 300, viewportWidth: 380, viewportHeight: 280}))
            .toEqual({left: 8, top: 8});
    });

    it('菜单比视口还大时也不返回负坐标', () => {
        const result = position({viewportWidth: 100, viewportHeight: 50});

        expect(result.left).toBeGreaterThanOrEqual(0);
        expect(result.top).toBeGreaterThanOrEqual(0);
    });

    it('自定义边距生效', () => {
        expect(position({x: 995, margin: 20}).left).toBe(820);
    });
});
