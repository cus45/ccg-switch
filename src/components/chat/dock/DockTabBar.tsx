import {useCallback} from 'react';
import {FileDiff, FileText, Folder, LayoutGrid, Loader2, MessageSquare, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../utils/cn';
import type {DockDocument, DockDocumentKind} from '../../../utils/dockDocuments';

interface DockTabBarProps {
    documents: DockDocument[];
    activeDocId: string | null;
    /** 正在工作（流式/排队）的聊天 tab key；侧聊文档 tab 据此显示 loading。 */
    busyChatTabKeys: string[];
    /** 后台完成回合、尚未查看的聊天 tab key；侧聊文档 tab 据此显示未读点。 */
    unreadChatTabKeys: string[];
    /** 上轮失败的聊天 tab key；侧聊文档 tab 显示失败红点（优先于未读）。 */
    errorChatTabKeys: string[];
    onActivate: (id: string) => void;
    onClose: (id: string) => void;
    /** 显示 dock 菜单页（新建入口都在菜单页里，tab 条不做扩展功能）。 */
    onShowMenu: () => void;
}

const KIND_ICON: Record<DockDocumentKind, typeof Folder> = {
    files: Folder,
    file: FileText,
    review: FileDiff,
    sideChat: MessageSquare,
};

/** dock 文档 tab 条：菜单页入口 + 文档切换/关闭。新建入口收敛在菜单页（DockMenu）。 */
export default function DockTabBar({
    documents,
    activeDocId,
    busyChatTabKeys,
    unreadChatTabKeys,
    errorChatTabKeys,
    onActivate,
    onClose,
    onShowMenu,
}: DockTabBarProps) {
    const {t} = useTranslation();
    const tf = useCallback((key: string, fallback: string): string => {
        const translated = t(key);
        return translated === key ? fallback : translated;
    }, [t]);

    const menuLabel = tf('chat.dock.menu', 'Dock menu');
    const closeTabLabel = tf('chat.dock.closeTab', 'Close tab');
    const menuActive = activeDocId === null;

    return (
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <button
                type="button"
                className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors',
                    menuActive
                        ? 'bg-orange-50 text-orange-500 dark:bg-base-200 dark:text-primary'
                        : 'text-gray-400 hover:text-gray-600 dark:hover:text-base-content',
                )}
                title={menuLabel}
                aria-label={menuLabel}
                aria-pressed={menuActive}
                onClick={onShowMenu}
            >
                <LayoutGrid size={14} />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                {documents.map((doc) => {
                    const Icon = KIND_ICON[doc.kind];
                    const active = doc.id === activeDocId;
                    const busy = doc.kind === 'sideChat'
                        && Boolean(doc.chatTabKey)
                        && busyChatTabKeys.includes(doc.chatTabKey as string);
                    const unread = !busy
                        && doc.kind === 'sideChat'
                        && Boolean(doc.chatTabKey)
                        && unreadChatTabKeys.includes(doc.chatTabKey as string);
                    const failed = !busy
                        && doc.kind === 'sideChat'
                        && Boolean(doc.chatTabKey)
                        && errorChatTabKeys.includes(doc.chatTabKey as string);
                    const workingLabel = tf('chat.dock.sideChatWorking', 'Working…');
                    const unreadLabel = tf('chat.dock.sideChatUnread', 'New reply');
                    const failedLabel = tf('chat.dock.sideChatFailed', 'Last turn failed');
                    const statusHint = busy ? workingLabel : failed ? failedLabel : unread ? unreadLabel : null;
                    return (
                        <div
                            key={doc.id}
                            className={cn(
                                'group flex max-w-[180px] shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                                active
                                    ? 'border-orange-200 bg-orange-50 text-gray-900 dark:border-primary/40 dark:bg-base-200 dark:text-base-content'
                                    : 'border-transparent text-gray-500 hover:bg-gray-50 dark:text-base-content/60 dark:hover:bg-base-200/60',
                            )}
                        >
                            <button
                                type="button"
                                className="flex min-w-0 items-center gap-1"
                                title={statusHint ? `${doc.title} · ${statusHint}` : doc.title}
                                onClick={() => onActivate(doc.id)}
                            >
                                {busy ? (
                                    <Loader2 size={13} className="shrink-0 animate-spin text-primary" aria-label={workingLabel} />
                                ) : (
                                    <Icon size={13} className="shrink-0" />
                                )}
                                <span className={cn('truncate', (unread || failed) && 'font-semibold')}>{doc.title}</span>
                                {failed ? (
                                    <span
                                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-error"
                                        title={failedLabel}
                                        aria-label={failedLabel}
                                    />
                                ) : unread ? (
                                    <span
                                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                                        title={unreadLabel}
                                        aria-label={unreadLabel}
                                    />
                                ) : null}
                            </button>
                            <button
                                type="button"
                                className={cn(
                                    'shrink-0 rounded text-gray-400 hover:text-gray-600 dark:hover:text-base-content',
                                    !active && 'opacity-0 group-hover:opacity-100 focus:opacity-100',
                                )}
                                title={closeTabLabel}
                                aria-label={`${closeTabLabel}: ${doc.title}`}
                                onClick={() => onClose(doc.id)}
                            >
                                <X size={12} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
