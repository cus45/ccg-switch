// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {ChatComposer} from './ChatComposer';

(
    globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
).IS_REACT_ACT_ENVIRONMENT = true;

const loadAllProviders = vi.fn();
const setDraft = vi.fn();
const send = vi.fn(async () => true);

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('../../../stores/useChatStore', () => {
    const useChatStore = () => ({
        provider: 'claude',
        permissionMode: 'default',
        model: 'claude-sonnet-provider-20260601',
        reasoningEffort: 'high',
        draft: '',
        contextTokens: 0,
        activeRequestId: null,
        activeSession: null,
        setProvider: vi.fn(),
        setPermissionMode: vi.fn(),
        setModel: vi.fn(),
        setReasoningEffort: vi.fn(),
        setDraft,
        send,
        abort: vi.fn(),
    });
    useChatStore.getState = () => ({draft: ''});
    return {useChatStore, useChatTab: () => null};
});

vi.mock('../../../stores/useProviderStore', () => ({
    useProviderStore: () => ({
        providers: [],
        hasLoaded: true,
        loading: false,
        error: null,
        loadAllProviders,
    }),
}));

vi.mock('./useCompletions', () => ({
    useCompletions: () => ({
        isOpen: false,
        items: [],
        activeIndex: 0,
        loading: false,
        close: vi.fn(),
        onTextChange: vi.fn(),
        handleKeyDown: () => false,
        applySelection: () => null,
        setActiveIndex: vi.fn(),
    }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
    if (root) {
        await act(async () => {
            root?.unmount();
        });
    }
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
});

async function renderComposer(): Promise<{container: HTMLDivElement; editor: HTMLElement}> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
        root?.render(
            <ChatComposer
                sdkMissing={false}
                onSdkMissing={() => undefined}
                cwd="C:\\repo"
            />,
        );
    });

    const editor = container.querySelector('[role="textbox"]');
    expect(editor).toBeInstanceOf(HTMLElement);
    return {container, editor: editor as HTMLElement};
}

describe('ChatComposer image paste', () => {
    it('keeps the send button usable when contenteditable text exists before draft syncs', async () => {
        const {container, editor} = await renderComposer();
        editor.textContent = '你好';
        await act(async () => {
            await Promise.resolve();
        });

        const sendButton = container.querySelector<HTMLButtonElement>('.chat-composer-primary-action');
        expect(sendButton).toBeInstanceOf(HTMLButtonElement);
        expect(sendButton?.disabled).toBe(false);

        await act(async () => {
            sendButton?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
            await Promise.resolve();
        });

        expect(send).toHaveBeenCalledWith('你好', expect.objectContaining({
            cwd: 'C:\\\\repo',
        }));
    });

    it('attaches pasted images while canceling native editor insertion', async () => {
        const {container, editor} = await renderComposer();
        const imageFile = new File(['image-bytes'], 'screenshot.png', {type: 'image/png'});
        const pasteEvent = new Event('paste', {bubbles: true, cancelable: true});

        Object.defineProperty(pasteEvent, 'clipboardData', {
            value: {
                files: [imageFile] as unknown as FileList,
                getData: (type: string) => type === 'text/plain' ? '' : '',
            },
        });

        let eventWasNotCanceled = true;
        await act(async () => {
            eventWasNotCanceled = editor.dispatchEvent(pasteEvent);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(eventWasNotCanceled).toBe(false);

        for (let attempt = 0; attempt < 10 && !container.querySelector('.chat-attachment-preview img'); attempt += 1) {
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
            });
        }

        const thumbnail = container.querySelector<HTMLImageElement>('.chat-attachment-preview img');
        expect(thumbnail?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
        expect(editor.querySelector('img')).toBeNull();
    });
});
