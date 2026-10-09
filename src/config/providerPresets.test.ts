import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, matchesPreset, presetsForApp } from './providerPresets';

describe('provider presets', () => {
    it('covers every switchable app', () => {
        for (const app of ['claude', 'codex', 'gemini', 'opencode', 'claudedesktop'] as const) {
            expect(presetsForApp(app).length).toBeGreaterThan(0);
        }
    });

    it('carries no promotion or tracking parameters', () => {
        const urls = PROVIDER_PRESETS.flatMap((p) => [p.url, p.websiteUrl, p.apiKeyUrl]).filter(Boolean) as string[];
        for (const url of urls) {
            expect(url).not.toMatch(/[?&](aff|track_id|ref|invite|utm_[a-z]+)=/i);
        }
    });

    it('only has usable https base URLs', () => {
        for (const p of PROVIDER_PRESETS) {
            expect(p.url).toMatch(/^https?:\/\/[^{}<>$]+$/);
        }
    });

    it('keeps Claude Desktop models within the claude-* names Desktop accepts', () => {
        for (const p of presetsForApp('claudedesktop')) {
            for (const m of Object.values(p.models ?? {})) {
                expect(m).toMatch(/^claude-(sonnet|opus|haiku|fable)-.+/);
            }
        }
    });

    it('searches by name and domain', () => {
        const kimi = presetsForApp('claude').find((p) => p.name.includes('Kimi'));
        expect(kimi).toBeDefined();
        expect(matchesPreset(kimi!, 'kimi')).toBe(true);
        expect(matchesPreset(kimi!, 'moonshot')).toBe(true);
        expect(matchesPreset(kimi!, 'no-such-provider')).toBe(false);
    });
});
