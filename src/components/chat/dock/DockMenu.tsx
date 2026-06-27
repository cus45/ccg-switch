import {FileDiff, FolderTree} from 'lucide-react';
import {useTranslation} from 'react-i18next';

interface DockMenuProps {
    /** Whether the workspace is a Git repository; gates the review card. */
    isGit: boolean;
    onOpenFiles: () => void;
    onOpenReview: () => void;
}

export default function DockMenu({isGit, onOpenFiles, onOpenReview}: DockMenuProps) {
    const {t} = useTranslation();
    const tf = (key: string, fallback: string): string => {
        const translated = t(key);
        return translated === key ? fallback : translated;
    };

    const cardClass = 'flex w-full items-start gap-3 rounded-xl border border-gray-100 bg-white p-3 text-left shadow-sm transition hover:border-gray-200 hover:shadow dark:border-base-200 dark:bg-base-100 dark:hover:border-base-300';

    return (
        <div className="h-full space-y-2 overflow-y-auto p-3">
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
        </div>
    );
}
