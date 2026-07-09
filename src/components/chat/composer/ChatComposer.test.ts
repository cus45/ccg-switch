import {describe, expect, it} from 'vitest';
import type {ChatAttachment} from '../../../types/chat';
import {restoreFailedSendAttachments, shouldBlockChatComposerSubmit, shouldBlockPromptEnhance,} from './ChatComposer';

describe('restoreFailedSendAttachments', () => {
    const sentAttachment: ChatAttachment = {
        fileName: 'sent.png',
        mediaType: 'image/png',
        data: 'sent-data',
        size: 10,
    };
    const laterAttachment: ChatAttachment = {
        fileName: 'later.png',
        mediaType: 'image/png',
        data: 'later-data',
        size: 20,
    };

    it('restores failed-send attachments ahead of attachments added while the send was pending', () => {
        expect(restoreFailedSendAttachments([laterAttachment], [sentAttachment])).toEqual([
            sentAttachment,
            laterAttachment,
        ]);
    });

    it('does not duplicate attachments that are already present', () => {
        expect(restoreFailedSendAttachments([sentAttachment], [sentAttachment])).toEqual([
            sentAttachment,
        ]);
    });
});

describe('shouldBlockChatComposerSubmit', () => {
    it('blocks duplicate submits while chat_send is still waiting for a request id', () => {
        expect(shouldBlockChatComposerSubmit({
            hasPromptText: true,
            hasAttachments: false,
            isSending: true,
        })).toBe(true);
    });

    it('allows the first non-empty submit when no turn is active or being started', () => {
        expect(shouldBlockChatComposerSubmit({
            hasPromptText: true,
            hasAttachments: false,
            isSending: false,
        })).toBe(false);
    });

    it('blocks empty submits', () => {
        expect(shouldBlockChatComposerSubmit({
            hasPromptText: false,
            hasAttachments: false,
            isSending: false,
        })).toBe(true);
    });

    it('allows submit during a streaming turn (message is queued by the store)', () => {
        expect(shouldBlockChatComposerSubmit({
            hasPromptText: true,
            hasAttachments: false,
            isSending: false,
        })).toBe(false);
    });
});

describe('shouldBlockPromptEnhance', () => {
    it('blocks duplicate prompt enhancement while the previous request is in flight', () => {
        expect(shouldBlockPromptEnhance({
            hasPromptText: true,
            isEnhancing: false,
            isEnhanceInFlight: true,
        })).toBe(true);
    });

    it('allows the first prompt enhancement for non-empty text', () => {
        expect(shouldBlockPromptEnhance({
            hasPromptText: true,
            isEnhancing: false,
            isEnhanceInFlight: false,
        })).toBe(false);
    });

    it('blocks empty prompts and rendered loading state', () => {
        expect(shouldBlockPromptEnhance({
            hasPromptText: false,
            isEnhancing: false,
            isEnhanceInFlight: false,
        })).toBe(true);
        expect(shouldBlockPromptEnhance({
            hasPromptText: true,
            isEnhancing: true,
            isEnhanceInFlight: false,
        })).toBe(true);
    });
});
