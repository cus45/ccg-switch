import {useCallback, useEffect, useMemo, useState} from 'react';
import {ChevronDown, ChevronRight, Dot, FileText, Folder, Loader2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../utils/cn';
import {
    buildChangedPathSet,
    createFileTreeState,
    type FileTreeNode,
    type FileTreeState,
    flattenVisibleTree,
    isDirLoaded,
    isPathChanged,
    setDirChildren,
    setDirLoading,
    toggleDirExpanded,
} from '../../../utils/fileTreeUtils';
import {
    type GitChangedFile,
    listChatDirectory,
    readChatTextFile,
    type ReadTextFileResult,
} from '../../../services/chatDockService';

interface FilesPanelProps {
    currentCwd: string | null;
    gitRoot: string | null;
    changedFiles: GitChangedFile[];
    /** Jump to the review panel focused on the given absolute path. */
    onJumpToReview: (path: string) => void;
}

interface FilePreview {
    path: string;
    name: string;
    result: ReadTextFileResult;
}

function baseName(path: string): string {
    const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
    return segments[segments.length - 1] ?? path;
}

export default function FilesPanel({currentCwd, gitRoot, changedFiles, onJumpToReview}: FilesPanelProps) {
    const {t} = useTranslation();
    const tf = useCallback((key: string, fallback: string): string => {
        const translated = t(key);
        return translated === key ? fallback : translated;
    }, [t]);

    const [tree, setTree] = useState<FileTreeState>(() => createFileTreeState(currentCwd ?? ''));
    const [preview, setPreview] = useState<FilePreview | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    const changedSet = useMemo(
        () => buildChangedPathSet(gitRoot, changedFiles.map((file) => file.path)),
        [gitRoot, changedFiles],
    );

    // Reset and load the root level whenever the workspace directory changes.
    useEffect(() => {
        setPreview(null);
        if (!currentCwd) {
            setTree(createFileTreeState(''));
            return;
        }

        const init = createFileTreeState(currentCwd);
        const root = init.rootPath;
        setTree(setDirLoading(init, root, true));

        let cancelled = false;
        void (async () => {
            try {
                const entries = await listChatDirectory(root);
                if (!cancelled) setTree((prev) => setDirChildren(prev, root, entries));
            } catch {
                if (!cancelled) setTree((prev) => setDirLoading(prev, root, false));
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [currentCwd]);

    const handleToggleDir = useCallback(async (node: FileTreeNode) => {
        if (isDirLoaded(tree, node.path)) {
            setTree((prev) => toggleDirExpanded(prev, node.path));
            return;
        }

        setTree((prev) => setDirLoading(prev, node.path, true));
        try {
            const entries = await listChatDirectory(node.path);
            setTree((prev) => toggleDirExpanded(setDirChildren(prev, node.path, entries), node.path));
        } catch {
            setTree((prev) => setDirLoading(prev, node.path, false));
        }
    }, [tree]);

    const handleOpenFile = useCallback(async (node: FileTreeNode) => {
        setPreviewLoading(true);
        try {
            const result = await readChatTextFile(node.path);
            setPreview({path: node.path, name: node.name, result});
        } catch {
            setPreview(null);
        } finally {
            setPreviewLoading(false);
        }
    }, []);

    const rows = useMemo(() => flattenVisibleTree(tree), [tree]);

    if (!currentCwd) {
        return (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-gray-500 dark:text-base-content/60">
                {tf('chat.dock.noWorkspace', 'No workspace folder selected')}
            </div>
        );
    }

    const changedBadgeLabel = tf('chat.dock.changedBadge', 'Has Git changes; open review');

    return (
        <div className="flex h-full">
            {/* 预览主区（左） */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {preview ? (
                    <>
                        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-2 py-1 text-xs text-gray-500 dark:border-base-200 dark:text-base-content/60">
                            <span className="truncate font-medium text-gray-700 dark:text-base-content" title={preview.path}>
                                {baseName(preview.path)}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                                {preview.result.binary && <span>{tf('chat.dock.previewBinary', 'Binary file')}</span>}
                                {preview.result.truncated && <span>{tf('chat.dock.previewTruncated', 'Truncated')}</span>}
                            </span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto bg-gray-50 dark:bg-base-200/40">
                            {preview.result.binary ? (
                                <div className="p-3 text-xs text-gray-500 dark:text-base-content/60">
                                    {tf('chat.dock.previewBinaryHint', 'Preview is unavailable for binary files.')}
                                </div>
                            ) : preview.result.content.length === 0 ? (
                                <div className="p-3 text-xs text-gray-500 dark:text-base-content/60">
                                    {tf('chat.dock.previewEmpty', 'Empty file')}
                                </div>
                            ) : (
                                <pre className="whitespace-pre p-2 font-mono text-xs leading-relaxed text-gray-800 dark:text-base-content">
                                    {preview.result.content}
                                </pre>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex h-full items-center justify-center p-4 text-center text-sm text-gray-400 dark:text-base-content/50">
                        {previewLoading
                            ? tf('chat.dock.loading', 'Loading...')
                            : tf('chat.dock.selectFileToPreview', 'Select a file to preview')}
                    </div>
                )}
            </div>

            {/* 文件树（右列） */}
            <div className="flex w-[240px] shrink-0 flex-col border-l border-gray-100 dark:border-base-200">
                <div className="min-h-0 flex-1 overflow-y-auto py-1">
                    {rows.length === 0 ? (
                        <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-base-content/60">
                            {tf('chat.dock.filesEmpty', 'This folder is empty')}
                        </div>
                    ) : (
                        rows.map((node) => {
                            const expanded = Boolean(tree.expanded[node.path]);
                            const loading = Boolean(tree.loading[node.path]);
                            const changed = isPathChanged(changedSet, node.path);
                            const selected = preview?.path === node.path;

                            return (
                                <div
                                    key={node.path}
                                    className={cn(
                                        'flex items-center gap-1 pr-2 text-sm',
                                        selected && 'bg-orange-50 dark:bg-base-200',
                                    )}
                                >
                                    <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-1 rounded py-1 text-left hover:bg-gray-50 dark:hover:bg-base-200/60"
                                        style={{paddingLeft: 8 + node.depth * 14}}
                                        title={node.name}
                                        onClick={() => (node.isDir ? void handleToggleDir(node) : void handleOpenFile(node))}
                                    >
                                        {node.isDir ? (
                                            loading ? (
                                                <Loader2 size={14} className="shrink-0 animate-spin text-gray-400" />
                                            ) : expanded ? (
                                                <ChevronDown size={14} className="shrink-0 text-gray-400" />
                                            ) : (
                                                <ChevronRight size={14} className="shrink-0 text-gray-400" />
                                            )
                                        ) : (
                                            <span className="inline-block w-[14px] shrink-0" />
                                        )}
                                        {node.isDir ? (
                                            <Folder size={14} className="shrink-0 text-orange-400" />
                                        ) : (
                                            <FileText size={14} className="shrink-0 text-gray-400" />
                                        )}
                                        <span className="truncate text-gray-800 dark:text-base-content">{node.name}</span>
                                    </button>
                                    {changed && !node.isDir && (
                                        <button
                                            type="button"
                                            className="shrink-0 text-amber-500 hover:text-amber-600"
                                            title={changedBadgeLabel}
                                            aria-label={changedBadgeLabel}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onJumpToReview(node.path);
                                            }}
                                        >
                                            <Dot size={20} strokeWidth={4} />
                                        </button>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
