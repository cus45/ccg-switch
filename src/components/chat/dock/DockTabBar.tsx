import {useCallback} from 'react';
import {FileDiff, FileText, Folder, MessageSquare, Plus, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../utils/cn';
import type {DockDocument, DockDocumentKind} from '../../../utils/dockDocuments';

interface DockTabBarProps {
    documents: DockDocument[];
    activeDocId: string | null;
    /** 非 git 工作区时 “+” 菜单不提供审查入口。 */
    isGit: boolean;
    onActivate: (id: string) => void;
    onClose: (id: string) => void;
    onOpenFiles: () => void;
    onOpenReview: () => void;
    onOpenSideChat: () => void;
    onCloseAll: () => void;
}

const KIND_ICON: Record<DockDocumentKind, typeof Folder> = {
    files: Folder,
    file: FileText,
    review: FileDiff,
    sideChat: MessageSquare,
};

/** dock 文档 tab 条：文档切换/关闭 + “+” 新建菜单（文件浏览 / 审查[仅 git]）。 */
export default function DockTabBar({
    documents,
    activeDocId,
    isGit,
    onActivate,
    onClose,
    onOpenFiles,
    onOpenReview,
    onOpenSideChat,
    onCloseAll,
}: DockTabBarProps) {
    const {t} = useTranslation();
    const tf = useCallback((key: string, fallback: string): string => {
        const translated = t(key);
        return translated === key ? fallback : translated;
    }, [t]);

    const addTabLabel = tf('chat.dock.addTab', 'Open a dock tab');
    const closeTabLabel = tf('chat.dock.closeTab', 'Close tab');
    // DaisyUI dropdown 以焦点驱动；点击菜单项后主动收起，避免菜单悬留。
    const blurActiveMenu = () => {
        (document.activeElement as HTMLElement | null)?.blur();
    };

    return (
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                {documents.map((doc) => {
                    const Icon = KIND_ICON[doc.kind];
                    const active = doc.id === activeDocId;
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
                                title={doc.title}
                                onClick={() => onActivate(doc.id)}
                            >
                                <Icon size={13} className="shrink-0" />
                                <span className="truncate">{doc.title}</span>
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

            <div className="dropdown dropdown-end shrink-0">
                <button
                    type="button"
                    tabIndex={0}
                    className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-base-content"
                    title={addTabLabel}
                    aria-label={addTabLabel}
                >
                    <Plus size={15} />
                </button>
                <ul
                    tabIndex={0}
                    className="menu dropdown-content z-30 mt-1 w-44 rounded-lg border border-gray-100 bg-white p-1 text-sm shadow-lg dark:border-base-200 dark:bg-base-100"
                >
                    <li>
                        <button
                            type="button"
                            onClick={() => {
                                blurActiveMenu();
                                onOpenSideChat();
                            }}
                        >
                            <MessageSquare size={14} className="text-emerald-500" />
                            {tf('chat.dock.newSideChat', 'New side chat')}
                        </button>
                    </li>
                    <li>
                        <button
                            type="button"
                            onClick={() => {
                                blurActiveMenu();
                                onOpenFiles();
                            }}
                        >
                            <Folder size={14} className="text-orange-400" />
                            {tf('chat.dock.files', 'Files')}
                        </button>
                    </li>
                    {isGit && (
                        <li>
                            <button
                                type="button"
                                onClick={() => {
                                    blurActiveMenu();
                                    onOpenReview();
                                }}
                            >
                                <FileDiff size={14} className="text-sky-500" />
                                {tf('chat.dock.review', 'Review')}
                            </button>
                        </li>
                    )}
                    {documents.length > 0 && (
                        <li className="border-t border-gray-100 dark:border-base-200">
                            <button
                                type="button"
                                onClick={() => {
                                    blurActiveMenu();
                                    onCloseAll();
                                }}
                            >
                                <X size={14} className="text-gray-400" />
                                {tf('chat.dock.closeAllTabs', 'Close all tabs')}
                            </button>
                        </li>
                    )}
                </ul>
            </div>
        </div>
    );
}
