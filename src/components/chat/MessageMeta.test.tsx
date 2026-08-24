import {describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import MessageMeta from './MessageMeta';

const translationState = vi.hoisted(() => ({
    keyOnly: true,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            if (translationState.keyOnly) return key;
            if (key === 'chat.meta.duration') return '本次耗时';
            if (key === 'chat.meta.durationShort') return '耗时';
            if (key === 'chat.meta.input') return '输入';
            if (key === 'chat.meta.output') return '输出';
            if (key === 'chat.meta.tokensShort') return 'tokens';
            if (key === 'chat.meta.outputShort') return 'out';
            return key;
        },
    }),
}));

const usage = {
    input_tokens: 1_200,
    output_tokens: 345,
    cache_creation_input_tokens: 200,
    cache_read_input_tokens: 100,
};

describe('MessageMeta', () => {
    it('renders a compact summary without verbose labels', () => {
        translationState.keyOnly = false;

        const html = renderToStaticMarkup(<MessageMeta compact durationMs={83_000} usage={usage} />);

        expect(html).toContain('耗时');
        expect(html).toContain('1:23');
        expect(html).toContain('tokens 1.5K / out 345');
        expect(html).not.toContain('本次耗时');
    });

    it('renders the default verbose summary for non-compact contexts', () => {
        translationState.keyOnly = false;

        const html = renderToStaticMarkup(
            <MessageMeta
                durationMs={3_723_000}
                usage={{
                    input_tokens: 800,
                    output_tokens: 1200,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                }}
            />,
        );

        expect(html).toContain('本次耗时');
        expect(html).toContain('1:02:03');
        expect(html).toContain('输入 800 / 输出 1.2K');
    });

    // 改造前这些标签是硬编码中文，英文界面下会漏中文；现在走 i18n + 英文兜底。
    it('falls back to English labels when i18n keys are unavailable', () => {
        translationState.keyOnly = true;

        const html = renderToStaticMarkup(<MessageMeta durationMs={1_000} usage={usage} />);

        expect(html).toContain('Took');
        expect(html).toContain('in 1.5K / out 345');
        expect(html).not.toContain('chat.meta.');
        expect(html).not.toContain('本次耗时');
    });

    it('renders nothing without duration or usage', () => {
        expect(renderToStaticMarkup(<MessageMeta />)).toBe('');
    });
});
