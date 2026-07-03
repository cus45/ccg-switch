import {useEffect, useState} from 'react';
import {Loader2, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {ChatSessionTab} from '../../stores/useChatStore';
import {cn} from '../../utils/cn';
import {sessionTitle} from './chatSessionSidebarUtils';
import {ProviderBrandIcon} from './composer/ModelIcon';

interface ChatSessionTabsProps {
    tabs: ChatSessionTab[];
    activeTabKey: string | null;
    onFocusTab: (key: string) => void;
    onCloseTab: (key: string) => void;
    onCloseOtherTabs: (key: string) => void;
    onCloseAllTabs: () => void;
}

interface TabContextMenuState {
    tabKey: string;
    x: number;
    y: number;
}

function translateWithFallback(
    translate: (key: string, options?: Record<string, unknown>) => string,
    key: string,
    fallback: string,
    options?: Record<string, unknown>,
): string {
    const translated = translate(key, options);
    return translated && translated !== key ? translated : fallback;
}

function projectFolderName(path: string | null): string {
    if (!path) return '';
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/g, '');
    return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

function tabTitle(tab: ChatSessionTab, newChatLabel: string): string {
    if (tab.activeSession) return sessionTitle(tab.activeSession);
    const firstUserMessage = tab.messages.find((message) => message.role === 'user')?.content.trim();
    if (firstUserMessage) return firstUserMessage;
    return newChatLabel;
}

function tabStatusLabel(
    translate: (key: string, options?: Record<string, unknown>) => string,
    status: ChatSessionTab['status'],
): string {
    const fallbackByStatus: Record<ChatSessionTab['status'], string> = {
        idle: 'Idle',
        loading: 'Loading',
        running: 'Running',
        queued: 'Queued',
        error: 'Error',
    };
    return translateWithFallback(
        translate,
        `chat.sessionTabs.status.${status}`,
        fallbackByStatus[status],
    );
}

export default function ChatSessionTabs({
    tabs,
    activeTabKey,
    onFocusTab,
    onCloseTab,
    onCloseOtherTabs,
    onCloseAllTabs,
}: ChatSessionTabsProps) {
    const {t} = useTranslation();
    const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);
    const newChatLabel = translateWithFallback(t, 'chat.sessionPanel.newChat', 'New chat');
    const closeTabLabel = translateWithFallback(t, 'chat.sessionTabs.close', 'Close tab');
    const closeOtherTabsLabel = translateWithFallback(t, 'chat.sessionTabs.closeOthers', 'Close other tabs');
    const closeAllTabsLabel = translateWithFallback(t, 'chat.sessionTabs.closeAll', 'Close all tabs');
    const tabListLabel = translateWithFallback(t, 'chat.sessionTabs.label', 'Open conversations');

    useEffect(() => {
        if (!contextMenu) return undefined;
        const close = () => setContextMenu(null);
        window.addEventListener('click', close);
        window.addEventListener('keydown', close);
        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('keydown', close);
        };
    }, [contextMenu]);

    if (tabs.length === 0) return null;

    return (
        <div
            role="tablist"
            aria-label={tabListLabel}
            className="chat-session-tabs-strip relative flex h-8 min-h-8 shrink-0 items-end gap-0.5 overflow-hidden border-b border-base-300 bg-base-100/85 px-1 pt-1"
        >
            {tabs.map((tab) => {
                const active = tab.key === activeTabKey;
                const title = tabTitle(tab, newChatLabel);
                const folder = projectFolderName(tab.currentCwd ?? tab.activeSession?.projectDir ?? null);
                const statusLabel = tabStatusLabel(t, tab.status);
                const isBusy = tab.status === 'running' || tab.status === 'loading' || tab.status === 'queued';
                const unreadLabel = translateWithFallback(t, 'chat.sessionTabs.unread', 'New reply');
                const showUnread = Boolean(tab.unread) && !isBusy;

                return (
                    <div
                        key={tab.key}
                        role="tab"
                        aria-selected={active}
                        data-chat-session-tab-key={tab.key}
                        className={cn(
                            'group flex h-7 min-w-24 w-44 max-w-56 flex-shrink items-center gap-1 rounded-t border px-1.5 text-[11px] transition-colors',
                            active
                                ? 'border-base-300 border-b-base-100 bg-base-100 text-base-content shadow-sm'
                                : 'border-transparent bg-base-200/55 text-base-content/65 hover:bg-base-200',
                        )}
                        onContextMenu={(event) => {
                            event.preventDefault();
                            setContextMenu({
                                tabKey: tab.key,
                                x: event.clientX,
                                y: event.clientY,
                            });
                        }}
                    >
                        <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-1 text-left"
                            onClick={() => onFocusTab(tab.key)}
                            title={`${title}${folder ? ` · ${folder}` : ''} · ${showUnread ? unreadLabel : statusLabel}`}
                        >
                            <ProviderBrandIcon provider={tab.provider} size={12} colored />
                            <span className={cn('min-w-0 flex-1 truncate font-medium', showUnread && 'font-semibold')}>
                                {title}
                            </span>
                            {showUnread && (
                                <span
                                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                                    title={unreadLabel}
                                    aria-label={unreadLabel}
                                />
                            )}
                            {isBusy && (
                                <span
                                    className="flex shrink-0 items-center"
                                    title={statusLabel}
                                    aria-label={statusLabel}
                                >
                                    <Loader2 size={11} className="animate-spin text-primary" />
                                </span>
                            )}
                            {tab.status === 'error' && (
                                <span
                                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-error"
                                    title={statusLabel}
                                    aria-label={statusLabel}
                                />
                            )}
                        </button>
                        <button
                            type="button"
                            className="btn btn-ghost btn-xs btn-square h-4 min-h-0 w-4 shrink-0 opacity-60 hover:opacity-100"
                            onClick={() => onCloseTab(tab.key)}
                            title={closeTabLabel}
                            aria-label={closeTabLabel}
                        >
                            <X size={10}/>
                        </button>
                    </div>
                );
            })}
            {contextMenu && (
                <div
                    className="fixed z-50 min-w-36 rounded-md border border-base-300 bg-base-100 p-1 text-xs shadow-lg"
                    style={{left: contextMenu.x, top: contextMenu.y}}
                    role="menu"
                >
                    <button
                        type="button"
                        className="w-full rounded px-2 py-1.5 text-left hover:bg-base-200"
                        data-chat-session-tab-menu-action="close-others"
                        role="menuitem"
                        onClick={(event) => {
                            event.stopPropagation();
                            onCloseOtherTabs(contextMenu.tabKey);
                            setContextMenu(null);
                        }}
                    >
                        {closeOtherTabsLabel}
                    </button>
                    <button
                        type="button"
                        className="w-full rounded px-2 py-1.5 text-left hover:bg-base-200"
                        data-chat-session-tab-menu-action="close-all"
                        role="menuitem"
                        onClick={(event) => {
                            event.stopPropagation();
                            onCloseAllTabs();
                            setContextMenu(null);
                        }}
                    >
                        {closeAllTabsLabel}
                    </button>
                </div>
            )}
        </div>
    );
}
