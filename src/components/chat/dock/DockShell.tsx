import type {KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode} from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {PanelRightClose, PanelRightOpen} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useShallow} from 'zustand/react/shallow';
import {useChatStore} from '../../../stores/useChatStore';
import type {ChatStatusEditSummary} from '../../../utils/chatStatusSummary';
import {
    clampRightDockWidth,
    loadRightDockState,
    MIN_RIGHT_DOCK_WIDTH,
    type RightDockState,
    saveRightDockState,
} from '../../../utils/rightDockState';
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
     * Wired in by ChatPage. Collapsed state keeps a fixed narrow rail (w-9) in
     * normal flow — the expand button sits where the header collapse button is.
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
    // 用户手动调整过的 dock 宽度（px）；null 表示未调整，走默认自适应宽度。
    const [dockWidth, setDockWidth] = useState<number | null>(() => loadRightDockState().width ?? null);
    const [docState, setDocState] = useState<DockDocumentsState>(loadDockDocumentsState);
    const [reviewTargetPath, setReviewTargetPath] = useState<string | null>(null);
    const [gitChanged, setGitChanged] = useState<GitChangedFiles>(EMPTY_GIT_CHANGED_FILES);
    const openSideChat = useChatStore((state) => state.openSideChat);
    const closeSideChat = useChatStore((state) => state.closeSideChat);
    const setDockChatTabKey = useChatStore((state) => state.setDockChatTabKey);
    // 正在工作（流式/排队）的聊天 tab key，用于侧聊文档 tab 的 loading 指示。
    // 活跃中心 tab 的快照可能滞后，改读顶层投影；背景 tab 事件直写快照，读快照即可。
    const busyChatTabKeys = useChatStore(useShallow((state) => state.openTabs
        .filter((tab) => (tab.key === state.activeTabKey
            ? Boolean(state.activeRequestId) || state.messages.some((message) => message.streaming)
            : tab.status === 'running' || tab.status === 'queued' || Boolean(tab.activeRequestId)))
        .map((tab) => tab.key)));
    // 后台完成回合、用户尚未查看的聊天 tab key（侧聊文档 tab 显示未读点）。
    const unreadChatTabKeys = useChatStore(useShallow((state) => state.openTabs
        .filter((tab) => Boolean(tab.unread))
        .map((tab) => tab.key)));
    // 上轮失败的聊天 tab key（侧聊文档 tab 显示失败红点，优先于未读蓝点）。
    const errorChatTabKeys = useChatStore(useShallow((state) => state.openTabs
        .filter((tab) => tab.status === 'error')
        .map((tab) => tab.key)));

    const activeDoc = docState.documents.find((doc) => doc.id === docState.activeDocId) ?? null;
    // 同步「dock 当前可见的侧聊」到 store：完成回合的未读判定与聚焦即读都依赖它。
    // dock 收起时侧聊不可见，视为 null（此时完成的回合会标未读）。
    const visibleSideChatKey = !collapsed && activeDoc?.kind === 'sideChat'
        ? activeDoc.chatTabKey ?? null
        : null;
    useEffect(() => {
        setDockChatTabKey(visibleSideChatKey);
        return () => setDockChatTabKey(null);
    }, [setDockChatTabKey, visibleSideChatKey]);

    useEffect(() => {
        // 与旧 RightDock 共用收起状态；activePanel 字段保留给回滚路径。
        const next: RightDockState = {...loadRightDockState(), collapsed};
        if (dockWidth != null) {
            next.width = dockWidth;
        } else {
            delete next.width;
        }
        saveRightDockState(next);
    }, [collapsed, dockWidth]);

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

    // 回到菜单页：保留已打开文档，仅取消活跃文档（新建入口都在菜单页）。
    const handleShowMenu = useCallback(() => {
        setDocState((state) => (state.activeDocId === null ? state : {...state, activeDocId: null}));
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
    const resizeLabel = tf('chat.dock.resize', 'Drag to resize the tool dock; double-click to reset');

    // 拖拽调宽：pointer capture 跟踪左缘把手；宽度即时生效并持久化。
    // 布局防溢出不靠 JS 测量：dock 允许 flex 收缩（min-width 兜底），主聊天区
    // `.chat-review-layout` 在 xl+ 有 min-width 保底——存的宽度再大，flex 也会
    // 先收缩 dock 保证整行不溢出，dock 右侧内容不会被推出窗口。
    const asideRef = useRef<HTMLElement | null>(null);
    const resizeDragRef = useRef<{pointerId: number; startX: number; startWidth: number} | null>(null);

    const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        const startWidth = asideRef.current?.getBoundingClientRect().width ?? dockWidth ?? 360;
        resizeDragRef.current = {pointerId: event.pointerId, startX: event.clientX, startWidth};
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = resizeDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const proposed = drag.startWidth + (drag.startX - event.clientX);
        setDockWidth(clampRightDockWidth(proposed));
    };

    const handleResizePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (resizeDragRef.current?.pointerId !== event.pointerId) return;
        resizeDragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        // 松开时把持久化宽度对齐到实际渲染宽度：拖超出可用空间时 CSS 把视觉
        // 宽度截在上限，存实际值避免下次在更大窗口里突然弹宽。
        const rendered = asideRef.current?.getBoundingClientRect().width;
        if (typeof rendered === 'number' && rendered > 0) {
            setDockWidth(clampRightDockWidth(rendered));
        }
    };

    const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const current = dockWidth ?? asideRef.current?.getBoundingClientRect().width ?? 360;
        const delta = event.key === 'ArrowLeft' ? 32 : -32;
        setDockWidth(clampRightDockWidth(current + delta));
    };

    if (collapsed) {
        // 收起态保留一个固定窄条停靠右缘：展开按钮与展开态 header 的收起按钮
        // 同位同样式（同一个开关的两个状态），不再用悬浮圆球。
        return (
            <aside
                className="flex h-full w-9 shrink-0 flex-col items-center border-l border-base-200/60 bg-white py-1.5 dark:bg-base-100"
                data-chat-right-dock="true"
            >
                <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-base-content"
                    title={expandLabel}
                    aria-label={expandLabel}
                    onClick={() => setCollapsed(false)}
                >
                    <PanelRightOpen size={16} />
                </button>
            </aside>
        );
    }

    const hasDocuments = docState.documents.length > 0;
    const defaultWidthClass = hasDocuments ? 'w-[min(46vw,820px)]' : 'w-[360px]';

    return (
        <aside
            ref={asideRef}
            className={`relative flex h-full ${dockWidth == null ? defaultWidthClass : ''} flex-col border-l border-base-200/60 bg-white dark:bg-base-100`}
            style={{
                minWidth: MIN_RIGHT_DOCK_WIDTH,
                ...(dockWidth != null ? {width: clampRightDockWidth(dockWidth)} : {}),
            }}
            data-chat-right-dock="true"
        >
            <div
                role="separator"
                aria-orientation="vertical"
                aria-label={resizeLabel}
                title={resizeLabel}
                tabIndex={0}
                className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none transition-colors hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none active:bg-primary/50"
                data-dock-resize-handle="true"
                onPointerDown={handleResizePointerDown}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerEnd}
                onPointerCancel={handleResizePointerEnd}
                onDoubleClick={() => setDockWidth(null)}
                onKeyDown={handleResizeKeyDown}
            />
            <div className="flex items-center justify-between gap-2 border-b border-base-200/60 px-2 py-1.5">
                <DockTabBar
                    documents={docState.documents}
                    activeDocId={docState.activeDocId}
                    busyChatTabKeys={busyChatTabKeys}
                    unreadChatTabKeys={unreadChatTabKeys}
                    errorChatTabKeys={errorChatTabKeys}
                    onActivate={handleActivate}
                    onClose={handleClose}
                    onShowMenu={handleShowMenu}
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
                <div>{statusStrip}</div>
            )}

            <div className="min-h-0 flex-1 overflow-hidden">
                {!activeDoc && (
                    <DockMenu
                        isGit={gitChanged.isGit}
                        onOpenFiles={handleOpenFiles}
                        onOpenReview={handleOpenReview}
                        onOpenSideChat={handleOpenSideChat}
                        onCloseAll={handleCloseAll}
                        hasDocuments={hasDocuments}
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
