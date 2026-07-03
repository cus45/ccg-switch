import {beforeEach, describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChatComposer} from './ChatComposer';
import {CompletionMenu} from './CompletionMenu';

const loadAllProviders = vi.fn();
let mockedContextTokens = 0;
let mockedContextMaxTokens: number | null = null;
let mockedLongContextEnabled = true;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, _options?: Record<string, unknown>) => key,
    }),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('../../../stores/useChatStore', () => ({
    useChatStore: () => ({
        provider: 'claude',
        permissionMode: 'default',
        model: 'claude-sonnet-provider-20260601',
        reasoningEffort: 'high',
        draft: '',
        contextTokens: mockedContextTokens,
        contextMaxTokens: mockedContextMaxTokens,
        longContextEnabled: mockedLongContextEnabled,
        activeRequestId: null,
        setProvider: vi.fn(),
        setPermissionMode: vi.fn(),
        setModel: vi.fn(),
        setLongContextEnabled: vi.fn(),
        setReasoningEffort: vi.fn(),
        setDraft: vi.fn(),
        send: vi.fn(),
        abort: vi.fn(),
        activeSession: null,
        setCurrentCwd: vi.fn(),
    }),
    useChatTab: () => null,
}));

vi.mock('../../../stores/useProviderStore', () => ({
    useProviderStore: () => ({
        providers: [
            {
                id: 'provider-claude',
                name: 'Provider Claude',
                appType: 'claude',
                apiKey: 'test-key',
                url: 'https://api.example.com',
                defaultSonnetModel: 'claude-sonnet-provider-20260601',
                inFailoverQueue: false,
                isActive: true,
                createdAt: '2026-06-19T00:00:00.000Z',
            },
        ],
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
        onTextChange: vi.fn(),
        handleKeyDown: () => false,
        applySelection: () => null,
        setActiveIndex: vi.fn(),
    }),
}));

describe('ChatComposer render integration', () => {
    beforeEach(() => {
        mockedContextTokens = 0;
        mockedContextMaxTokens = null;
        mockedLongContextEnabled = true;
    });

    it('passes provider-loaded model options into the bottom model selector', () => {
        const html = renderToStaticMarkup(
            <ChatComposer
                sdkMissing={false}
                onSdkMissing={() => undefined}
                cwd="C:\\repo"
            />,
        );

        expect(html).toContain('claude-sonnet-provider-20260601');
        expect(html).toContain('data-chat-model-icon="claude-sonnet"');
    });

    it('wires a manual model refresh affordance when the active provider can fetch models', () => {
        const html = renderToStaticMarkup(
            <ChatComposer
                sdkMissing={false}
                onSdkMissing={() => undefined}
                cwd="C:\\repo"
            />,
        );

        expect(html).toContain('title="Refresh models"');
        expect(html).not.toContain('chat.modelsRefresh');
    });

    it('uses sidecar-provided context max tokens for the usage indicator', () => {
        mockedContextTokens = 125_000;
        mockedContextMaxTokens = 1_000_000;

        const html = renderToStaticMarkup(
            <ChatComposer
                sdkMissing={false}
                onSdkMissing={() => undefined}
                cwd="C:\\repo"
            />,
        );

        expect(html).toContain('12.5% · 125k / 1000k chat.context');
    });

    it('uses the default enabled 1M context toggle for Claude fallback context window', () => {
        mockedContextTokens = 125_000;
        mockedContextMaxTokens = null;
        mockedLongContextEnabled = true;

        const html = renderToStaticMarkup(
            <ChatComposer
                sdkMissing={false}
                onSdkMissing={() => undefined}
                cwd="C:\\repo"
            />,
        );

        expect(html).toContain('12.5% · 125k / 1000k chat.context');
        expect(html).toContain('chat-long-context-toggle');
        expect(html).toMatch(/role="switch"(?=[^>]*aria-checked="true")/);
    });

    it('keeps sidecar-provided context max tokens authoritative over the 1M toggle fallback', () => {
        mockedContextTokens = 50_000;
        mockedContextMaxTokens = 200_000;
        mockedLongContextEnabled = true;

        const html = renderToStaticMarkup(
            <ChatComposer
                sdkMissing={false}
                onSdkMissing={() => undefined}
                cwd="C:\\repo"
            />,
        );

        expect(html).toContain('25.0% · 50k / 200k chat.context');
    });

    it('keeps composer input surface labels readable when translations return keys', () => {
        const html = renderToStaticMarkup(
            <ChatComposer
                sdkMissing={false}
                onSdkMissing={() => undefined}
                cwd="C:\\repo"
            />,
        );

        expect(html).toContain('title="Add attachment"');
        expect(html).toContain('title="Collapse status panel"');
        expect(html).toContain('title="Drag to resize the input"');
        expect(html).toContain('aria-label="Drag to resize the input"');
        expect(html).toContain('placeholder="Type a message... @ to reference files, # for subagents, ! for presets. Enter to send, Shift+Enter for newline"');
        expect(html).not.toContain('chat.attach');
        expect(html).not.toContain('chat.collapsePanel');
        expect(html).not.toContain('chat.resizeComposer');
        expect(html).not.toContain('chat.richPlaceholder');
    });

    it('renders workspace git context in the top composer bar without a centered max-width cap', () => {
        const html = renderToStaticMarkup(
            <ChatComposer
                sdkMissing={false}
                onSdkMissing={() => undefined}
                cwd="C:\\repo"
                workspaceStatus={{
                    gitBranch: 'ai-report',
                    gitRoot: 'C:/repo',
                    isGitRepository: true,
                }}
            />,
        );

        expect(html).toContain('chat-composer-git-branch');
        expect(html).toContain('ai-report');
        expect(html).toContain('aria-label="Git ai-report"');
        expect(html).toContain('title="Git: ai-report · C:/repo"');
        expect(html).not.toContain('max-w-2xl');
        expect(html).not.toContain('mx-auto w-full max-w-2xl');
    });

    it('renders workspace folder and git branch actions in the top composer bar', () => {
        const html = renderToStaticMarkup(
            <ChatComposer
                sdkMissing={false}
                onSdkMissing={() => undefined}
                cwd="C:/workspace/ccg-switch"
                workspaceStatus={{
                    gitBranch: 'cc-gui',
                    gitRoot: 'C:/workspace/ccg-switch',
                    isGitRepository: true,
                }}
            />,
        );

        expect(html).toContain('chat-composer-workspace-switcher');
        expect(html).toContain('ccg-switch');
        expect(html).toContain('title="Workspace: C:/workspace/ccg-switch"');
        expect(html).toContain('aria-label="Switch workspace folder: C:/workspace/ccg-switch"');
        expect(html).toContain('chat-composer-git-branch-button');
        expect(html).toContain('aria-haspopup="menu"');
        expect(html).toContain('cc-gui');
    });

    it('keeps a folder picker affordance visible when no workspace is selected', () => {
        const html = renderToStaticMarkup(
            <ChatComposer
                sdkMissing={false}
                onSdkMissing={() => undefined}
                cwd={undefined}
            />,
        );

        expect(html).toContain('chat-composer-workspace-switcher');
        expect(html).toContain('No folder');
        expect(html).toContain('Open folder...');
        expect(html).toContain('aria-label="Switch workspace folder: No folder"');
    });

    it('renders completion menu loading and items with readable accessibility chrome', () => {
        const loadingHtml = renderToStaticMarkup(
            <CompletionMenu
                items={[]}
                activeIndex={0}
                loading
                emptyText="No matches"
                loadingText="Loading suggestions..."
                menuLabel="Completion suggestions"
                onSelect={() => undefined}
                onHover={() => undefined}
            />,
        );

        expect(loadingHtml).toContain('role="listbox"');
        expect(loadingHtml).toContain('aria-label="Completion suggestions"');
        expect(loadingHtml).toContain('role="status"');
        expect(loadingHtml).toContain('Loading suggestions...');
        expect(loadingHtml).not.toContain('…');

        const itemsHtml = renderToStaticMarkup(
            <CompletionMenu
                items={[
                    {
                        id: 'review',
                        label: '/review',
                        description: 'Review working tree changes',
                    },
                    {
                        id: 'help',
                        label: '/help',
                    },
                ]}
                activeIndex={0}
                emptyText="No matches"
                loadingText="Loading suggestions..."
                menuLabel="Completion suggestions"
                onSelect={() => undefined}
                onHover={() => undefined}
            />,
        );

        expect(itemsHtml).toContain('role="option"');
        expect(itemsHtml).toContain('aria-selected="true"');
        expect(itemsHtml).toContain('aria-selected="false"');
        expect(itemsHtml).toContain('aria-label="/review. Review working tree changes"');
    });
});
