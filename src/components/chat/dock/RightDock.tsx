import {useCallback, useEffect, useState} from 'react';
import type {ReactNode} from 'react';
import {ArrowLeft, PanelRightClose, PanelRightOpen} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {ChatStatusEditSummary} from '../../../utils/chatStatusSummary';
import {
    loadRightDockState,
    type RightDockPanel,
    saveRightDockState,
} from '../../../utils/rightDockState';
import {
    EMPTY_GIT_CHANGED_FILES,
    getChatGitChangedFiles,
    type GitChangedFiles,
} from '../../../services/chatDockService';
import type {EditDiffPreviewMode} from '../../toolBlocks/EditDiffPreview';
import DockMenu from './DockMenu';
import FilesPanel from './FilesPanel';
import ReviewPanel from './ReviewPanel';

interface RightDockProps {
    currentCwd: string | null;
    gitRoot: string | null;
    /** Files edited during this chat session (merged into the review list). */
    allEdits: ChatStatusEditSummary[];
    diffViewMode: EditDiffPreviewMode;
    onDiffViewModeChange: (mode: EditDiffPreviewMode) => void;
    diffWrapLines: boolean;
    onDiffWrapLinesChange: (wrap: boolean) => void;
    /**
     * Optional status strip rendered above the dock body (daemon / context usage).
     * Wired in by ChatPage; the collapsed dock occupies no layout width, so the
     * parent flex container must be `position: relative` for the floating expand
     * button to anchor to the conversation area's top-right corner.
     */
    statusStrip?: ReactNode;
}

export default function RightDock({
    currentCwd,
    gitRoot,
    allEdits,
    diffViewMode,
    onDiffViewModeChange,
    diffWrapLines,
    onDiffWrapLinesChange,
    statusStrip,
}: RightDockProps) {
    const {t} = useTranslation();
    const tf = useCallback((key: string, fallback: string): string => {
        const translated = t(key);
        return translated === key ? fallback : translated;
    }, [t]);

    const [collapsed, setCollapsed] = useState<boolean>(() => loadRightDockState().collapsed);
    const [activePanel, setActivePanel] = useState<RightDockPanel>(() => loadRightDockState().activePanel);
    const [reviewTargetPath, setReviewTargetPath] = useState<string | null>(null);
    const [gitChanged, setGitChanged] = useState<GitChangedFiles>(EMPTY_GIT_CHANGED_FILES);

    useEffect(() => {
        saveRightDockState({collapsed, activePanel});
    }, [collapsed, activePanel]);

    const refreshGitChanged = useCallback(async () => {
        if (!currentCwd) {
            setGitChanged(EMPTY_GIT_CHANGED_FILES);
            return;
        }
        try {
            setGitChanged(await getChatGitChangedFiles(currentCwd));
        } catch {
            setGitChanged(EMPTY_GIT_CHANGED_FILES);
        }
    }, [currentCwd]);

    useEffect(() => {
        void refreshGitChanged();
    }, [refreshGitChanged]);

    const handleJumpToReview = useCallback((path: string) => {
        setReviewTargetPath(path);
        setActivePanel('review');
    }, []);

    const expandLabel = tf('chat.dock.expand', 'Expand tool dock');
    const collapseLabel = tf('chat.dock.collapse', 'Collapse tool dock');
    const backLabel = tf('chat.dock.backToMenu', 'Back to menu');

    if (collapsed) {
        return (
            <button
                type="button"
                className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm hover:text-gray-700 dark:border-base-300 dark:bg-base-100 dark:text-base-content/70"
                title={expandLabel}
                aria-label={expandLabel}
                onClick={() => setCollapsed(false)}
            >
                <PanelRightOpen size={16} />
            </button>
        );
    }

    const headerTitle = activePanel === 'files'
        ? tf('chat.dock.files', 'Files')
        : activePanel === 'review'
            ? tf('chat.dock.review', 'Review')
            : tf('chat.dock.title', 'Tools');

    return (
        <aside
            className="flex h-full w-[360px] shrink-0 flex-col border-l border-gray-100 bg-white dark:border-base-200 dark:bg-base-100"
            data-chat-right-dock="true"
        >
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 dark:border-base-200">
                <div className="flex min-w-0 items-center gap-1">
                    {activePanel !== 'menu' && (
                        <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-base-content"
                            title={backLabel}
                            aria-label={backLabel}
                            onClick={() => setActivePanel('menu')}
                        >
                            <ArrowLeft size={15} />
                        </button>
                    )}
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-base-content">
                        {headerTitle}
                    </span>
                </div>
                <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-base-content"
                    title={collapseLabel}
                    aria-label={collapseLabel}
                    onClick={() => setCollapsed(true)}
                >
                    <PanelRightClose size={16} />
                </button>
            </div>

            {statusStrip && (
                <div className="border-b border-gray-100 dark:border-base-200">{statusStrip}</div>
            )}

            <div className="min-h-0 flex-1 overflow-hidden">
                {activePanel === 'menu' && (
                    <DockMenu
                        isGit={gitChanged.isGit}
                        onOpenFiles={() => setActivePanel('files')}
                        onOpenReview={() => setActivePanel('review')}
                    />
                )}
                {activePanel === 'files' && (
                    <FilesPanel
                        currentCwd={currentCwd}
                        gitRoot={gitRoot}
                        changedFiles={gitChanged.files}
                        onJumpToReview={handleJumpToReview}
                    />
                )}
                {activePanel === 'review' && (
                    <ReviewPanel
                        currentCwd={currentCwd}
                        gitRoot={gitRoot}
                        gitChanged={gitChanged}
                        allEdits={allEdits}
                        mode={diffViewMode}
                        onModeChange={onDiffViewModeChange}
                        wrapLines={diffWrapLines}
                        onWrapLinesChange={onDiffWrapLinesChange}
                        targetPath={reviewTargetPath}
                        onRefresh={() => void refreshGitChanged()}
                    />
                )}
            </div>
        </aside>
    );
}
