import {useCallback, useEffect, useState} from 'react';
import type {ReactNode} from 'react';
import {PanelRightClose, PanelRightOpen} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useChatStore} from '../../../stores/useChatStore';
import type {ChatStatusEditSummary} from '../../../utils/chatStatusSummary';
import {loadRightDockState, saveRightDockState} from '../../../utils/rightDockState';
import {
    activateDockDocument,
    closeDockDocument,
    createFileDocument,
    createFilesDocument,
    createReviewDocument,
    createSideChatDocument,
    type DockDocumentsState,
    EMPTY_DOCK_DOCUMENTS_STATE,
    loadDockDocumentsState,
    openDockDocument,
    saveDockDocumentsState,
} from '../../../utils/dockDocuments';
import {
    EMPTY_GIT_CHANGED_FILES,
    getChatGitChangedFiles,
    type GitChangedFiles,
} from '../../../services/chatDockService';
import type {EditDiffPreviewMode} from '../../toolBlocks/EditDiffPreview';
import DockMenu from './DockMenu';
import DockTabBar from './DockTabBar';
import FilesBrowser from './FilesBrowser';
import FilePreview from './FilePreview';
import ReviewPanel from './ReviewPanel';
import SideChatPane from './SideChatPane';

interface DockShellProps {
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

/**
 * tab 化右侧 dock（替换 RightDock 卡片菜单）：文档 tab 条 + 按活跃文档路由
 * （files→FilesBrowser / file→FilePreview / review→ReviewPanel）。无文档时
 * 显示 DockMenu 启动页。收起/展开沿用 `rightDockState`；文档结构持久化到
 * `ccg-chat-dock-documents`。侧聊文档（sideChat）在 Stage D 接入。
 */
export default function DockShell({
    currentCwd,
    gitRoot,
    allEdits,
    diffViewMode,
    onDiffViewModeChange,
    diffWrapLines,
    onDiffWrapLinesChange,
    statusStrip,
}: DockShellProps) {
    const {t} = useTranslation();
    const tf = useCallback((key: string, fallback: string): string => {
        const translated = t(key);
        return translated === key ? fallback : translated;
    }, [t]);

    const [collapsed, setCollapsed] = useState<boolean>(() => loadRightDockState().collapsed);
    const [docState, setDocState] = useState<DockDocumentsState>(loadDockDocumentsState);
    const [reviewTargetPath, setReviewTargetPath] = useState<string | null>(null);
    const [gitChanged, setGitChanged] = useState<GitChangedFiles>(EMPTY_GIT_CHANGED_FILES);
    const openSideChat = useChatStore((state) => state.openSideChat);
    const closeSideChat = useChatStore((state) => state.closeSideChat);

    useEffect(() => {
        // 与旧 RightDock 共用收起状态；activePanel 字段保留给回滚路径。
        saveRightDockState({...loadRightDockState(), collapsed});
    }, [collapsed]);

    useEffect(() => {
        saveDockDocumentsState(docState);
    }, [docState]);

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

    const handleOpenFiles = useCallback(() => {
        setDocState((state) => openDockDocument(state, createFilesDocument(tf('chat.dock.files', 'Files'))));
    }, [tf]);

    const handleOpenReview = useCallback(() => {
        setDocState((state) => openDockDocument(state, createReviewDocument(tf('chat.dock.review', 'Review'))));
    }, [tf]);

    const handleOpenFile = useCallback((path: string) => {
        setDocState((state) => openDockDocument(state, createFileDocument(path)));
    }, []);

    const handleOpenSideChat = useCallback(() => {
        const chatTabKey = openSideChat();
        setDocState((state) => {
            const sideChatCount = state.documents.filter((doc) => doc.kind === 'sideChat').length;
            const base = tf('chat.dock.sideChat', 'Side chat');
            const title = sideChatCount > 0 ? `${base} ${sideChatCount + 1}` : base;
            return openDockDocument(state, createSideChatDocument(chatTabKey, title));
        });
    }, [openSideChat, tf]);

    const handleJumpToReview = useCallback((path: string) => {
        setReviewTargetPath(path);
        setDocState((state) => openDockDocument(state, createReviewDocument(tf('chat.dock.review', 'Review'))));
    }, [tf]);

    const handleActivate = useCallback((id: string) => {
        setDocState((state) => activateDockDocument(state, id));
    }, []);

    const handleClose = useCallback((id: string) => {
        // 关侧聊文档同时移除其聊天 tab（退役未完成发送），避免孤儿后台会话。
        const doc = docState.documents.find((candidate) => candidate.id === id);
        if (doc?.kind === 'sideChat' && doc.chatTabKey) {
            closeSideChat(doc.chatTabKey);
        }
        setDocState((state) => closeDockDocument(state, id));
    }, [closeSideChat, docState.documents]);

    const handleCloseAll = useCallback(() => {
        docState.documents.forEach((doc) => {
            if (doc.kind === 'sideChat' && doc.chatTabKey) {
                closeSideChat(doc.chatTabKey);
            }
        });
        setDocState(EMPTY_DOCK_DOCUMENTS_STATE);
    }, [closeSideChat, docState.documents]);

    const expandLabel = tf('chat.dock.expand', 'Expand tool dock');
    const collapseLabel = tf('chat.dock.collapse', 'Collapse tool dock');

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

    const activeDoc = docState.documents.find((doc) => doc.id === docState.activeDocId) ?? null;
    const hasDocuments = docState.documents.length > 0;

    return (
        <aside
            className={`flex h-full ${hasDocuments ? 'w-[min(46vw,820px)]' : 'w-[360px]'} shrink-0 flex-col border-l border-gray-100 bg-white dark:border-base-200 dark:bg-base-100`}
            data-chat-right-dock="true"
        >
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-2 py-1.5 dark:border-base-200">
                <DockTabBar
                    documents={docState.documents}
                    activeDocId={docState.activeDocId}
                    isGit={gitChanged.isGit}
                    onActivate={handleActivate}
                    onClose={handleClose}
                    onOpenFiles={handleOpenFiles}
                    onOpenReview={handleOpenReview}
                    onOpenSideChat={handleOpenSideChat}
                    onCloseAll={handleCloseAll}
                />
                <button
                    type="button"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-base-content"
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
                {!activeDoc && (
                    <DockMenu
                        isGit={gitChanged.isGit}
                        onOpenFiles={handleOpenFiles}
                        onOpenReview={handleOpenReview}
                    />
                )}
                {activeDoc?.kind === 'files' && (
                    <FilesBrowser
                        currentCwd={currentCwd}
                        gitRoot={gitRoot}
                        changedFiles={gitChanged.files}
                        onOpenFile={handleOpenFile}
                        onJumpToReview={handleJumpToReview}
                    />
                )}
                {activeDoc?.kind === 'file' && activeDoc.filePath && (
                    <FilePreview filePath={activeDoc.filePath} />
                )}
                {activeDoc?.kind === 'review' && (
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
                {activeDoc?.kind === 'sideChat' && activeDoc.chatTabKey && (
                    <SideChatPane tabKey={activeDoc.chatTabKey} />
                )}
            </div>
        </aside>
    );
}
