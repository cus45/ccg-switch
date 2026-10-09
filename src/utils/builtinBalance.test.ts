import { describe, expect, it } from 'vitest';
import { supportsBuiltinBalance } from './builtinBalance';

describe('supportsBuiltinBalance', () => {
    it('matches the providers the backend can query', () => {
        expect(supportsBuiltinBalance('https://api.deepseek.com/anthropic')).toBe(true);
        expect(supportsBuiltinBalance('https://API.SiliconFlow.cn/v1')).toBe(true);
        expect(supportsBuiltinBalance('https://openrouter.ai/api')).toBe(true);
    });

    it('ignores other providers and empty urls', () => {
        expect(supportsBuiltinBalance('https://api.anthropic.com')).toBe(false);
        expect(supportsBuiltinBalance(undefined)).toBe(false);
        expect(supportsBuiltinBalance('')).toBe(false);
    });
});
