import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import ProviderIcon from './ProviderIcon';

describe('ProviderIcon', () => {
    it('renders visible providers with brand SVG glyphs instead of first-letter badges', () => {
        const claudeHtml = renderToStaticMarkup(<ProviderIcon appType="claude" />);
        const codexHtml = renderToStaticMarkup(<ProviderIcon appType="codex" />);
        const geminiHtml = renderToStaticMarkup(<ProviderIcon appType="gemini" />);

        expect(claudeHtml).toContain('data-provider-brand-icon="claude"');
        expect(claudeHtml).toContain('data-chat-provider-icon-glyph="claude-lobehub"');
        expect(claudeHtml).toContain('<svg');
        expect(claudeHtml).not.toContain('>C</div>');

        expect(codexHtml).toContain('data-provider-brand-icon="codex"');
        expect(codexHtml).toContain('data-chat-provider-icon-glyph="chatgpt-openai"');
        expect(codexHtml).toContain('<svg');
        expect(codexHtml).toContain('bg-white');
        expect(codexHtml).toContain('fill="currentColor"');
        expect(codexHtml).not.toContain('stroke="currentColor"');
        expect(codexHtml).not.toContain('>C</div>');

        expect(geminiHtml).toContain('data-provider-brand-icon="gemini"');
        expect(geminiHtml).toContain('data-chat-provider-icon-glyph="gemini-google"');
        expect(geminiHtml).toContain('<svg');
        expect(geminiHtml).not.toContain('>G</div>');
        expect(geminiHtml).not.toContain('base64');
    });

    it('keeps hidden legacy providers on the first-letter fallback', () => {
        const opencodeHtml = renderToStaticMarkup(<ProviderIcon appType="opencode" />);

        expect(opencodeHtml).toContain('>O</div>');
        expect(opencodeHtml).not.toContain('data-provider-brand-icon="opencode"');
        expect(opencodeHtml).not.toContain('<svg');
    });
});
