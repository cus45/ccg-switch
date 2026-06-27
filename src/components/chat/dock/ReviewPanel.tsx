import {useCallback, useEffect, useMemo, useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../utils/cn';
import {
    type ChatStatusEditSummary,
    getChatStatusEditKey,
} from '../../../utils/chatStatusSummary';
import {buildDiffPreviewLines} from '../../../utils/toolPresentation';
import {joinTreePath, normalizeComparePath} from '../../../utils/fileTreeUtils';
import {
    getChatGitFileContents,
    type GitChangedFiles,
} from '../../../services/chatDockService';
import type {EditDiffPreviewMode} from '../../toolBlocks/EditDiffPreview';
import ChatDiffReviewPane from '../ChatDiffReviewPane';

interface ReviewPanelProps {
    currentCwd: string | null;
    gitRoot: string | null;
    gitChanged: GitChangedFiles;
    /** Files edited during this chat session (merged into the review list). */
    allEdits: ChatStatusEditSummary[];
    mode: EditDiffPreviewMode;
    onModeChange: (mode: EditDiffPreviewMode) => void;
    wrapLines: boolean;
    onWrapLinesChange: (wrap: boolean) => void;
    /** Absolute path to auto-select (set when jumping from the file tree). */
    targetPath: string | null;
    onRefresh: () => void;
}

const GIT_KEY_PREFIX = 'git:';
const EDIT_KEY_PREFIX = 'edit:';

function buildGitEditSummary(
    gitRoot: string | null,
    path: string,
    oldContent: string,
    newContent: string,
): ChatStatusEditSummary {
    const diffPreviewLines = buildDiffPreviewLines(oldContent, newContent);
    const additions = diffPreviewLines.filter((line) => line.kind === 'added').length;
    const deletions = diffPreviewLines.filter((line) => line.kind === 'removed').length;
    return {
        toolId: `${GIT_KEY_PREFIX}${path}`,
        displayPath: path,
        openPath: gitRoot ? joinTreePath(gitRoot, path) : path,
        additions,
        deletions,
        diffPreviewLines,
        status: 'completed',
    };
}

export default function ReviewPanel({
    currentCwd,
    gitRoot,
    gitChanged,
    allEdits,
    mode,
    onModeChange,
    wrapLines,
    onWrapLinesChange,
    targetPath,
    onRefresh,
}: ReviewPanelProps) {
    const {t} = useTranslation();
    const tf = useCallback((key: string, fallback: string): string => {
        const translated = t(key);
        return translated === key ? fallback : translated;
    }, [t]);

    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [gitEdit, setGitEdit] = useState<ChatStatusEditSummary | null>(null);
    const [loadingDiff, setLoadingDiff] = useState(false);

    const editKeyOf = useCallback(
        (edit: ChatStatusEditSummary): string => `${EDIT_KEY_PREFIX}${getChatStatusEditKey(edit)}`,
        [],
    );

    // Default selection: first git change, otherwise first chat edit.
    useEffect(() => {
        if (selectedKey) return;
        const firstGit = gitChanged.files[0];
        if (firstGit) {
            setSelectedKey(`${GIT_KEY_PREFIX}${firstGit.path}`);
            return;
        }
        const firstEdit = allEdits[0];
        if (firstEdit) setSelectedKey(editKeyOf(firstEdit));
    }, [selectedKey, gitChanged.files, allEdits, editKeyOf]);

    // Auto-select the file the user jumped to from the tree.
    useEffect(() => {
        if (!targetPath) return;
        const target = normalizeComparePath(targetPath);
        const match = gitChanged.files.find((file) => {
            const abs = gitRoot ? joinTreePath(gitRoot, file.path) : file.path;
            return normalizeComparePath(abs) === target || normalizeComparePath(file.path) === target;
        });
        if (match) setSelectedKey(`${GIT_KEY_PREFIX}${match.path}`);
    }, [targetPath, gitChanged.files, gitRoot]);

    // Fetch HEAD/working contents for the selected git file and build its diff.
    useEffect(() => {
        if (!selectedKey || !selectedKey.startsWith(GIT_KEY_PREFIX) || !currentCwd) {
            setGitEdit(null);
            return;
        }
        const path = selectedKey.slice(GIT_KEY_PREFIX.length);
        let cancelled = false;
        setLoadingDiff(true);
        void (async () => {
            try {
                const contents = await getChatGitFileContents(currentCwd, path);
                if (!cancelled) {
                    setGitEdit(buildGitEditSummary(gitRoot, path, contents.oldContent, contents.newContent));
                }
            } catch {
                if (!cancelled) setGitEdit(null);
            } finally {
                if (!cancelled) setLoadingDiff(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedKey, currentCwd, gitRoot]);

    const selectedEdit = useMemo<ChatStatusEditSummary | undefined>(() => {
        if (!selectedKey) return undefined;
        if (selectedKey.startsWith(EDIT_KEY_PREFIX)) {
            return allEdits.find((edit) => editKeyOf(edit) === selectedKey);
        }
        return gitEdit ?? undefined;
    }, [selectedKey, allEdits, editKeyOf, gitEdit]);

    const hasGitChanges = gitChanged.isGit && gitChanged.files.length > 0;
    const hasAnything = hasGitChanges || allEdits.length > 0;

    const refreshLabel = tf('chat.dock.refresh', 'Refresh changes');
    const gitSectionLabel = tf('chat.dock.gitChangedSection', 'Working-tree changes');
    const editSectionLabel = tf('chat.dock.chatEditedSection', 'Edited in this chat');

    const rowClass = (active: boolean) => cn(
        'flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-gray-50 dark:hover:bg-base-200/60',
        active && 'bg-orange-50 dark:bg-base-200',
    );

    return (
        <div className="flex h-full flex-col">
            <div className="flex max-h-[40%] min-h-[2.5rem] shrink-0 flex-col border-b border-gray-100 dark:border-base-200">
                <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-xs font-medium text-gray-500 dark:text-base-content/60">
                        {tf('chat.dock.review', 'Review')}
                    </span>
                    <button
                        type="button"
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-base-content"
                        title={refreshLabel}
                        aria-label={refreshLabel}
                        onClick={onRefresh}
                    >
                        <RefreshCw size={13} />
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pb-1">
                    {!hasAnything && (
                        <div className="px-2 py-3 text-center text-xs text-gray-500 dark:text-base-content/60">
                            {tf('chat.dock.reviewEmpty', 'No changes to review')}
                        </div>
                    )}

                    {hasGitChanges && (
                        <div>
                            <div className="px-2 pt-1 text-[11px] uppercase tracking-wide text-gray-400">
                                {gitSectionLabel}
                            </div>
                            {gitChanged.files.map((file) => {
                                const key = `${GIT_KEY_PREFIX}${file.path}`;
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        className={rowClass(selectedKey === key)}
                                        title={file.path}
                                        onClick={() => setSelectedKey(key)}
                                    >
                                        <span className="w-4 shrink-0 text-center font-mono text-[10px] text-gray-400">
                                            {file.status}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-base-content">
                                            {file.path}
                                        </span>
                                        <span className="shrink-0 text-emerald-500">+{file.additions}</span>
                                        <span className="shrink-0 text-rose-500">-{file.deletions}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {allEdits.length > 0 && (
                        <div>
                            <div className="px-2 pt-1 text-[11px] uppercase tracking-wide text-gray-400">
                                {editSectionLabel}
                            </div>
                            {allEdits.map((edit) => {
                                const key = editKeyOf(edit);
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        className={rowClass(selectedKey === key)}
                                        title={edit.displayPath}
                                        onClick={() => setSelectedKey(key)}
                                    >
                                        <span className="w-4 shrink-0" />
                                        <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-base-content">
                                            {edit.displayPath}
                                        </span>
                                        <span className="shrink-0 text-emerald-500">+{edit.additions}</span>
                                        <span className="shrink-0 text-rose-500">-{edit.deletions}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className="min-h-0 flex-1">
                {loadingDiff && !selectedEdit ? (
                    <div className="flex h-full items-center justify-center text-xs text-gray-500 dark:text-base-content/60">
                        {tf('chat.dock.loading', 'Loading...')}
                    </div>
                ) : (
                    <ChatDiffReviewPane
                        edit={selectedEdit}
                        mode={mode}
                        wrapLines={wrapLines}
                        currentCwd={currentCwd}
                        onModeChange={onModeChange}
                        onWrapLinesChange={onWrapLinesChange}
                    />
                )}
            </div>
        </div>
    );
}
