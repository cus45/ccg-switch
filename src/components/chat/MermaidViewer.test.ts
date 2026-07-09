import {describe, expect, it} from 'vitest';
import {
    clampMermaidScale,
    MERMAID_VIEWER_MAX_SCALE,
    MERMAID_VIEWER_MIN_SCALE,
} from './MermaidViewer';

describe('clampMermaidScale', () => {
    it('keeps scale within viewer bounds', () => {
        expect(clampMermaidScale(1)).toBe(1);
        expect(clampMermaidScale(0.01)).toBe(MERMAID_VIEWER_MIN_SCALE);
        expect(clampMermaidScale(100)).toBe(MERMAID_VIEWER_MAX_SCALE);
    });

    it('falls back to 1 for invalid input', () => {
        expect(clampMermaidScale(Number.NaN)).toBe(1);
        expect(clampMermaidScale(Number.POSITIVE_INFINITY)).toBe(1);
    });
});
