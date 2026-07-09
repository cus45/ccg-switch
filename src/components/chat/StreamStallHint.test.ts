import {describe, expect, it} from 'vitest';
import {computeStalledSeconds, STREAM_STALL_THRESHOLD_MS} from './StreamStallHint';

describe('computeStalledSeconds', () => {
    const base = 1_000_000;

    it('returns null without activity record', () => {
        expect(computeStalledSeconds(null, base)).toBeNull();
    });

    it('returns null while output is still fresh', () => {
        expect(computeStalledSeconds(base, base + STREAM_STALL_THRESHOLD_MS - 1)).toBeNull();
    });

    it('returns stalled seconds once the threshold is crossed', () => {
        expect(computeStalledSeconds(base, base + STREAM_STALL_THRESHOLD_MS)).toBe(90);
        expect(computeStalledSeconds(base, base + 125_000)).toBe(125);
    });

    it('supports a custom threshold', () => {
        expect(computeStalledSeconds(base, base + 10_000, 5_000)).toBe(10);
        expect(computeStalledSeconds(base, base + 4_000, 5_000)).toBeNull();
    });
});
