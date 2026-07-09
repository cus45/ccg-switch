import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import type {QueuedChatMessage} from '../../../types/chat';
import {MessageQueueBar} from './MessageQueueBar';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => (
            options && 'count' in options ? `${key}:${String(options.count)}` : key
        ),
    }),
}));

const ITEMS: QueuedChatMessage[] = [
    {id: 'q1', text: '第一条排队消息', queuedAt: 1},
    {
        id: 'q2',
        text: '',
        attachments: [{fileName: 'shot.png', mediaType: 'image/png', data: 'x'}],
        queuedAt: 2,
    },
];

describe('MessageQueueBar', () => {
    it('renders nothing for an empty queue', () => {
        expect(renderToStaticMarkup(createElement(MessageQueueBar, {
            items: [],
            onRemove: () => {},
        }))).toBe('');
    });

    it('renders queue entries with edit affordance and attachment count', () => {
        const html = renderToStaticMarkup(createElement(MessageQueueBar, {
            items: ITEMS,
            onRemove: () => {},
            onEdit: () => {},
        }));

        expect(html).toContain('chat.queue.title:2');
        expect(html).toContain('第一条排队消息');
        expect(html).toContain('chat.queue.editHint');
        expect(html).toContain('chat.queue.attachmentOnly');
        expect(html).toContain('chat.queue.attachmentCount:1');
        expect(html).toContain('chat.queue.remove');
    });
});
