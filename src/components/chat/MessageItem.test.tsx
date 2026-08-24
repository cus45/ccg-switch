import {afterEach, describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ChatMessage} from '../../types/chat';
import MessageItem, {appendQuoteToDraft, buildQuotedDraft} from './MessageItem';
import WaitingIndicator from './WaitingIndicator';

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`,
    invoke: vi.fn(),
}));

vi.mock('dompurify', () => ({
    default: {
        sanitize: (html: string) => html,
    },
}));

const translationState = vi.hoisted(() => ({
    keyOnly: false,
}));

vi.mock('react-i18next', () => ({
    initReactI18next: {
        type: '3rdParty',
        init: () => undefined,
    },
    useTranslation: () => ({
        t: (key: string) => {
            if (translationState.keyOnly) return key;
            if (key === 'chat.message.user') return 'You';
            if (key === 'chat.message.assistant') return 'AI Assistant';
            if (key === 'chat.message.system') return 'System';
            if (key === 'chat.message.copy') return 'Copy';
            if (key === 'chat.message.copied') return 'Copied';
            if (key === 'chat.message.quote') return 'Quote in composer';
            if (key === 'chat.message.emptyUser') return 'Empty message';
            if (key === 'chat.message.waiting') return 'Waiting for response...';
            return key;
        },
    }),
}));

function renderMessage(message: ChatMessage) {
    return renderToStaticMarkup(
        <MessageItem
            message={message}
            isLast
            findToolResult={() => null}
        />,
    );
}

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
    return {
        id: 'message-1',
        role: 'user',
        content: 'hello',
        createdAt: 1,
        ...overrides,
    };
}

describe('MessageItem', () => {
    afterEach(() => {
        translationState.keyOnly = false;
    });

    it('keeps message role and action labels readable when i18n keys are unavailable', () => {
        translationState.keyOnly = true;

        const userHtml = renderMessage(makeMessage({role: 'user', content: 'hello'}));

        expect(userHtml).toContain('You');
        expect(userHtml).toContain('title="Copy"');
        expect(userHtml).toContain('aria-label="Copy"');
        expect(userHtml).toContain('title="Quote in composer"');
        expect(userHtml).not.toContain('chat.message.user');
        expect(userHtml).not.toContain('chat.message.copy');
        expect(userHtml).not.toContain('chat.message.quote');
    });

    it('keeps empty-user chrome readable when i18n keys are unavailable', () => {
        translationState.keyOnly = true;

        const emptyUserHtml = renderMessage(makeMessage({role: 'user', content: '', error: 'send failed'}));

        expect(emptyUserHtml).toContain('Empty message');
        expect(emptyUserHtml).not.toContain('chat.message.emptyUser');
    });

    it('流式 assistant 展示工作中指示器（耗时 + 状态），而不是一句静态提示', () => {
        translationState.keyOnly = true;

        const html = renderMessage(makeMessage({
            role: 'assistant',
            content: 'partial response',
            streaming: true,
            createdAt: Date.now(),
        }));

        expect(html).toContain('chat-working-indicator');
        expect(html).toContain('0:00');
        expect(html).toContain('Responding...');
        expect(html).not.toContain('chat.working.responding');
    });

    it('完成的 assistant 回合以收尾分隔条给出耗时与 token', () => {
        translationState.keyOnly = true;

        const html = renderMessage(makeMessage({
            role: 'assistant',
            content: 'done',
            durationMs: 12_340,
            usage: {
                input_tokens: 1_000,
                output_tokens: 500,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            },
        }));

        expect(html).toContain('chat-turn-divider');
        expect(html).toContain('Done');
        expect(html).toContain('12.3s');
        expect(html).toContain('1.5K tokens');
    });

    it('流式期间不渲染收尾分隔条', () => {
        const html = renderMessage(makeMessage({
            role: 'assistant',
            content: 'partial',
            streaming: true,
            durationMs: 5_000,
        }));

        expect(html).not.toContain('chat-turn-divider');
    });
});

describe('引用到输入框', () => {
    it('把正文逐行转成 Markdown 引用块，空行保留为裸 >', () => {
        expect(buildQuotedDraft('第一行\n\n第二行')).toBe('> 第一行\n>\n> 第二行');
    });

    it('空内容不产生引用', () => {
        expect(buildQuotedDraft('   \n  ')).toBe('');
    });

    it('超长正文被截断并加省略号', () => {
        const quoted = buildQuotedDraft('a'.repeat(50), 10);

        expect(quoted).toBe(`> ${'a'.repeat(10)}…`);
    });

    it('追加到空草稿时不留前导空行', () => {
        expect(appendQuoteToDraft('', '> hi')).toBe('> hi\n\n');
    });

    it('追加到已有草稿时用空行隔开', () => {
        expect(appendQuoteToDraft('已经写的内容  \n', '> hi')).toBe('已经写的内容\n\n> hi\n\n');
    });

    it('空引用不改动草稿', () => {
        expect(appendQuoteToDraft('原样', '')).toBe('原样');
    });
});

describe('WaitingIndicator', () => {
    afterEach(() => {
        translationState.keyOnly = false;
    });

    it('keeps waiting text readable when i18n keys are unavailable', () => {
        translationState.keyOnly = true;

        const html = renderToStaticMarkup(<WaitingIndicator />);

        expect(html).toContain('Waiting for response...');
        expect(html).not.toContain('chat.message.waiting');
    });
});
