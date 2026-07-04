import {FileDiff, FolderTree, MessageSquarePlus, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';

interface DockMenuProps {
    /** Whether the workspace is a Git repository; gates the review card. */
    isGit: boolean;
    onOpenFiles: () => void;
    onOpenReview: () => void;
    /** 提供时显示「新侧边聊天」卡片（DockShell）；旧 RightDock 不传。 */
    onOpenSideChat?: () => void;
    /** 提供且 hasDocuments 时显示「关闭全部标签页」次要入口（DockShell）。 */
    onCloseAll?: () => void;
    hasDocuments?: boolean;
}

export default function DockMenu({
    isGit,
    onOpenFiles,
    onOpenReview,
    onOpenSideChat,
    onCloseAll,
    hasDocuments = false,
}: DockMenuProps) {
    const {t} = useTranslation();
    const tf = (key: string, fallback: string): string => {
        const translated = t(key);
        return translated === key ? fallback : translated;
    };

    const cardClass = 'flex w-full items-start gap-3 rounded-xl border border-gray-100 bg-white p-3 text-left shadow-sm transition hover:border-gray-200 hover:shadow dark:border-base-200 dark:bg-base-100 dark:hover:border-base-300';

    return (
        <div className="h-full space-y-2 overflow-y-auto p-3">
            {onOpenSideChat && (
                <button type="button" className={cardClass} onClick={onOpenSideChat}>
                    <span className="mt-0.5 text-emerald-500">
                        <MessageSquarePlus size={18} />
                    </span>
                    <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900 dark:text-base-content">
                            {tf('chat.dock.newSideChat', 'New side chat')}
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-base-content/60">
                            {tf('chat.dock.newSideChatDesc', 'Open a second, parallel chat panel')}
                        </span>
                    </span>
                </button>
            )}

            <button type="button" className={cardClass} onClick={onOpenFiles}>
                <span className="mt-0.5 text-orange-500">
                    <FolderTree size={18} />
                </span>
                <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900 dark:text-base-content">
                        {tf('chat.dock.files', 'Files')}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500 dark:text-base-content/60">
                        {tf('chat.dock.filesDesc', 'Browse the workspace file tree')}
                    </span>
                </span>
            </button>

            {isGit && (
                <button type="button" className={cardClass} onClick={onOpenReview}>
                    <span className="mt-0.5 text-pink-500">
                        <FileDiff size={18} />
                    </span>
                    <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900 dark:text-base-content">
                            {tf('chat.dock.review', 'Review')}
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-base-content/60">
                            {tf('chat.dock.reviewDesc', 'Inspect Git working-tree changes')}
                        </span>
                    </span>
                </button>
            )}

            {onCloseAll && hasDocuments && (
                <button
                    type="button"
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 py-2 text-xs text-gray-400 transition hover:border-gray-200 hover:text-gray-600 dark:hover:border-base-300 dark:hover:text-base-content"
                    onClick={onCloseAll}
                >
                    <X size={13} />
                    {tf('chat.dock.closeAllTabs', 'Close all tabs')}
                </button>
            )}
        </div>
    );
}
