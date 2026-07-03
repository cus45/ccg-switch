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
} from '../../../services/chatDockService';

interface FilesBrowserProps {
    currentCwd: string | null;
    gitRoot: string | null;
    changedFiles: GitChangedFile[];
    /** 打开文件 → DockShell push 一个 `file` 文档 tab。 */
    onOpenFile: (path: string) => void;
    /** Jump to the review document focused on the given absolute path. */
    onJumpToReview: (path: string) => void;
    /** 当前已打开的 file 文档路径（高亮树中选中项）。 */
    selectedPath?: string | null;
}

/**
 * 工作区文件树（DockShell 的 `files` 文档）。从旧 FilesPanel 拆出树部分；
 * 预览不再内嵌，点开文件交给 `onOpenFile` 生成独立 `file` 文档 tab。
 */
export default function FilesBrowser({
    currentCwd,
    gitRoot,
    changedFiles,
    onOpenFile,
    onJumpToReview,
    selectedPath,
}: FilesBrowserProps) {
    const {t} = useTranslation();
    const tf = useCallback((key: string, fallback: string): string => {
        const translated = t(key);
        return translated === key ? fallback : translated;
    }, [t]);

    const [tree, setTree] = useState<FileTreeState>(() => createFileTreeState(currentCwd ?? ''));

    const changedSet = useMemo(
        () => buildChangedPathSet(gitRoot, changedFiles.map((file) => file.path)),
        [gitRoot, changedFiles],
    );

    // Reset and load the root level whenever the workspace directory changes.
    useEffect(() => {
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
        <div className="flex h-full min-h-0 flex-col">
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
                        const selected = selectedPath === node.path;

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
                                    onClick={() => (node.isDir ? void handleToggleDir(node) : onOpenFile(node.path))}
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
    );
}
