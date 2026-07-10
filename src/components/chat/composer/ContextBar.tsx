import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {Check, ChevronDown, FolderOpen, GitBranch, Image as ImageIcon, Layers, Paperclip, X} from 'lucide-react';
import type {ChatAttachment} from '../../../types/chat';
import {getChatComposerInputLabel} from '../../../utils/chatUiBehavior';
import {
    createAndCheckoutChatGitBranch,
    type ChatGitBranch,
    type ChatWorkspaceStatus,
    listChatGitBranches,
    pickWorkspaceFolder,
} from '../../../utils/chatWorkspaceStatus';
import {TokenIndicator} from './TokenIndicator';

export interface ChatWorkspaceProjectOption {
    name: string;
    path: string;
}

interface ContextBarProps {
    /** 当前图片附件 */
    attachments: ChatAttachment[];
    /** token 用量百分比 0-100 */
    percentage: number;
    usedTokens?: number;
    maxTokens?: number;
    onRemoveAttachment: (index: number) => void;
    onAddAttachment: (files: FileList) => void | Promise<void>;
    cwd?: string | null;
    workspaceProjects?: ChatWorkspaceProjectOption[];
    onWorkspaceChange?: (cwd: string) => void;
    workspaceStatus?: ChatWorkspaceStatus;
    onWorkspaceStatusChange?: (status: ChatWorkspaceStatus) => void;
    /** 状态面板是否展开 */
    statusPanelExpanded?: boolean;
    onToggleStatusPanel?: () => void;
}

function pathDisplayName(path: string | null | undefined): string {
    const trimmed = path?.trim();
    if (!trimmed) return 'No folder';

    const parts = trimmed.split(/[\\/]+/).filter(Boolean);
    return parts[parts.length - 1] ?? trimmed;
}

function normalizeWorkspacePath(path: string | null | undefined): string {
    return path?.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase() ?? '';
}

function labelWithFallback(
    translate: (key: string, options?: Record<string, unknown>) => string,
    key: string,
    fallback: string,
    options?: Record<string, unknown>,
): string {
    const translated = options ? translate(key, options) : translate(key);
    if (translated !== key) return translated;
    if (!options) return fallback;

    return Object.entries(options).reduce(
        (label, [optionKey, value]) => label.split(`{{${optionKey}}}`).join(String(value)),
        fallback,
    );
}

/**
 * 输入区顶部上下文栏：附件按钮 + token 用量环 + 文件上下文芯片 + 状态面板开关。
 * 移植自 jcc-gui ContextBar，用 lucide + DaisyUI 重写。
 */
export function ContextBar({
    attachments,
    percentage,
    usedTokens,
    maxTokens,
    onRemoveAttachment,
    onAddAttachment,
    cwd,
    workspaceProjects = [],
    onWorkspaceChange,
    workspaceStatus,
    onWorkspaceStatusChange,
    statusPanelExpanded = true,
    onToggleStatusPanel,
}: ContextBarProps) {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const workspaceMenuRef = useRef<HTMLDivElement>(null);
    const gitMenuRef = useRef<HTMLDivElement>(null);
    const workspaceTriggerRef = useRef<HTMLButtonElement>(null);
    const gitTriggerRef = useRef<HTMLButtonElement>(null);
    const [previewImage, setPreviewImage] = useState<{url: string; name: string} | null>(null);
    const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
    const [gitMenuOpen, setGitMenuOpen] = useState(false);
    const [workspaceMenuPos, setWorkspaceMenuPos] = useState<{left: number; bottom: number} | null>(null);
    const [gitMenuPos, setGitMenuPos] = useState<{left: number; bottom: number} | null>(null);
    const [gitBranches, setGitBranches] = useState<ChatGitBranch[]>([]);
    const [gitBranchLoading, setGitBranchLoading] = useState(false);
    const [gitBranchError, setGitBranchError] = useState<string | null>(null);

    // ESC 键关闭预览
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && previewImage) {
                setPreviewImage(null);
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [previewImage]);

    // 点击菜单外部 / 按 ESC 关闭工作目录与 Git 分支下拉
    useEffect(() => {
        if (!workspaceMenuOpen && !gitMenuOpen) return undefined;

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (
                workspaceMenuOpen
                && !workspaceMenuRef.current?.contains(target)
                && !workspaceTriggerRef.current?.contains(target)
            ) {
                setWorkspaceMenuOpen(false);
            }
            if (
                gitMenuOpen
                && !gitMenuRef.current?.contains(target)
                && !gitTriggerRef.current?.contains(target)
            ) {
                setGitMenuOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setWorkspaceMenuOpen(false);
                setGitMenuOpen(false);
            }
        };

        window.addEventListener('mousedown', handlePointerDown);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('mousedown', handlePointerDown);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [workspaceMenuOpen, gitMenuOpen]);

    const attachLabel = getChatComposerInputLabel({
        control: 'attach',
        translate: t,
    });
    const removeAttachmentLabel = getChatComposerInputLabel({
        control: 'remove-attachment',
        translate: t,
    });
    const statusPanelToggleLabel = getChatComposerInputLabel({
        control: statusPanelExpanded ? 'collapse-panel' : 'expand-panel',
        translate: t,
    });
    const workspaceLabel = labelWithFallback(t, 'chat.layout.workspace', 'Workspace');
    const noFolderLabel = labelWithFallback(t, 'chat.layout.noWorkspaceFolder', 'No folder');
    const switchWorkspaceFolderLabel = labelWithFallback(
        t,
        'chat.layout.switchWorkspaceFolder',
        'Switch workspace folder: {{folder}}',
        {folder: cwd?.trim() || noFolderLabel},
    );
    const openFolderLabel = labelWithFallback(t, 'chat.layout.openFolder', 'Open folder...');
    const openFolderPromptLabel = labelWithFallback(t, 'chat.layout.openFolderPrompt', 'Open folder path');
    const noRecentFoldersLabel = labelWithFallback(t, 'chat.layout.noRecentFolders', 'No recent folders');
    const loadingBranchesLabel = labelWithFallback(t, 'chat.layout.loadingBranches', 'Loading branches...');
    const newBranchPromptLabel = labelWithFallback(t, 'chat.layout.newBranchPrompt', 'New branch name');
    const createBranchLabel = labelWithFallback(
        t,
        'chat.layout.createAndCheckoutBranch',
        'Create and checkout new branch...',
    );
    const closePreviewLabel = labelWithFallback(t, 'chat.layout.closeImagePreview', 'Close preview (ESC)');
    const workspaceDisplayName = pathDisplayName(cwd);
    const workspaceTitle = cwd?.trim()
        ? `${workspaceLabel}: ${cwd.trim()}`
        : `${workspaceLabel}: ${noFolderLabel}`;
    const gitBranch = workspaceStatus?.isGitRepository ? workspaceStatus.gitBranch : null;
    const translatedGitBranchLabel = t('chat.layout.inputStatusGitBranch');
    const gitBranchLabel = translatedGitBranchLabel === 'chat.layout.inputStatusGitBranch'
        ? 'Git'
        : translatedGitBranchLabel;
    const gitBranchTitle = gitBranch
        ? [
            `${gitBranchLabel}: ${gitBranch}`,
            workspaceStatus?.gitRoot,
        ].filter(Boolean).join(' · ')
        : undefined;
    const trimmedCwd = cwd?.trim() || '';

    const handleWorkspaceMenuToggle = () => {
        setGitMenuOpen(false);
        setWorkspaceMenuOpen((open) => {
            const next = !open;
            if (next) {
                const rect = workspaceTriggerRef.current?.getBoundingClientRect();
                if (rect) {
                    setWorkspaceMenuPos({
                        left: rect.left,
                        bottom: window.innerHeight - rect.top + 4,
                    });
                }
            }
            return next;
        });
    };

    const handleGitMenuToggle = () => {
        if (!trimmedCwd) return;
        const nextOpen = !gitMenuOpen;
        setGitMenuOpen(nextOpen);
        setWorkspaceMenuOpen(false);
        if (!nextOpen) return;

        const rect = gitTriggerRef.current?.getBoundingClientRect();
        if (rect) {
            setGitMenuPos({
                left: rect.left,
                bottom: window.innerHeight - rect.top + 4,
            });
        }

        setGitBranchLoading(true);
        setGitBranchError(null);
        void listChatGitBranches(trimmedCwd)
            .then(setGitBranches)
            .catch((error) => {
                setGitBranches([]);
                setGitBranchError(String(error));
            })
            .finally(() => setGitBranchLoading(false));
    };

    const handleWorkspaceSelect = (nextCwd: string) => {
        onWorkspaceChange?.(nextCwd);
        setWorkspaceMenuOpen(false);
    };

    const handleOpenFolderInput = () => {
        void pickWorkspaceFolder({
            defaultPath: trimmedCwd || null,
            title: openFolderLabel,
            promptFallbackLabel: openFolderPromptLabel,
        }).then((nextCwd) => {
            if (!nextCwd) return;
            handleWorkspaceSelect(nextCwd);
        });
    };

    const handleCreateBranch = () => {
        if (!trimmedCwd || typeof window === 'undefined') return;
        const branchName = window.prompt(newBranchPromptLabel)?.trim();
        if (!branchName) return;

        setGitBranchLoading(true);
        setGitBranchError(null);
        void createAndCheckoutChatGitBranch(trimmedCwd, branchName)
            .then((status) => {
                onWorkspaceStatusChange?.(status);
                setGitMenuOpen(false);
            })
            .catch((error) => {
                setGitBranchError(String(error));
            })
            .finally(() => setGitBranchLoading(false));
    };

    return (
        <div className="flex min-w-0 items-center gap-1.5 px-1 pb-1">
            {/* 附件 */}
            <button
                type="button"
                className="flex items-center justify-center w-7 h-7 rounded-md text-base-content/60 hover:bg-base-200 hover:text-base-content transition-colors"
                title={attachLabel}
                aria-label={attachLabel}
                onClick={() => fileInputRef.current?.click()}
            >
                <Paperclip size={15} />
            </button>
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                        void onAddAttachment(e.target.files);
                    }
                    e.target.value = '';
                }}
            />

            {/* token 用量环 */}
            <TokenIndicator
                percentage={percentage}
                usedTokens={usedTokens}
                maxTokens={maxTokens}
            />

            <div className="w-px h-4 bg-base-300" />

            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                <div className="relative min-w-0">
                    <button
                        ref={workspaceTriggerRef}
                        type="button"
                        data-chat-workspace-menu-trigger
                        className="chat-composer-workspace-switcher flex h-6 min-w-0 max-w-[10rem] items-center gap-1 rounded-md border border-base-300 bg-base-100 px-1.5 text-xs font-medium text-base-content/75 transition-colors hover:border-base-content/25 hover:bg-base-200/50 sm:max-w-[14rem] md:max-w-[18rem]"
                        title={workspaceTitle}
                        aria-label={switchWorkspaceFolderLabel}
                        aria-haspopup="menu"
                        aria-expanded={workspaceMenuOpen}
                        onClick={handleWorkspaceMenuToggle}
                    >
                        <FolderOpen size={12} className="shrink-0 text-base-content/45" />
                        <span className="min-w-0 truncate" dir="ltr">
                            {workspaceDisplayName}
                        </span>
                        {!cwd?.trim() && (
                            <span className="sr-only">{openFolderLabel}</span>
                        )}
                    </button>
                    {workspaceMenuOpen && createPortal(
                        <div
                            ref={workspaceMenuRef}
                            data-chat-workspace-menu
                            role="menu"
                            className="fixed z-50 w-64 rounded-md border border-base-300 bg-base-100 p-1 shadow-lg"
                            style={{
                                left: `${workspaceMenuPos?.left ?? 0}px`,
                                bottom: `${workspaceMenuPos?.bottom ?? 0}px`,
                            }}
                        >
                            {workspaceProjects.length === 0 ? (
                                <div className="px-2 py-1.5 text-xs text-base-content/45">
                                    {noRecentFoldersLabel}
                                </div>
                            ) : workspaceProjects.map((project) => {
                                const selected = normalizeWorkspacePath(project.path)
                                    === normalizeWorkspacePath(cwd);
                                return (
                                    <button
                                        key={project.path}
                                        type="button"
                                        role="menuitem"
                                        data-chat-workspace-option={project.path}
                                        aria-current={selected ? 'true' : undefined}
                                        className={`flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                                            selected
                                                ? 'bg-primary/10 text-primary'
                                                : 'text-base-content/75 hover:bg-base-200'
                                        }`}
                                        title={project.path}
                                        onClick={() => handleWorkspaceSelect(project.path)}
                                    >
                                        <FolderOpen size={12} className="shrink-0 text-base-content/40" />
                                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                                        {selected && <Check size={11} className="shrink-0" aria-hidden="true" />}
                                    </button>
                                );
                            })}
                            <button
                                type="button"
                                role="menuitem"
                                className="mt-1 flex w-full items-center gap-2 rounded border-t border-base-300 px-2 py-1.5 text-left text-xs text-base-content/75 hover:bg-base-200"
                                onClick={handleOpenFolderInput}
                            >
                                <FolderOpen size={12} className="shrink-0 text-base-content/40" />
                                {openFolderLabel}
                            </button>
                        </div>,
                        document.body,
                    )}
                </div>

                {gitBranch && (
                    <div className="relative min-w-0">
                        <button
                            ref={gitTriggerRef}
                            type="button"
                            data-chat-git-branch-trigger
                            className="chat-composer-git-branch chat-composer-git-branch-button flex h-6 min-w-0 max-w-[11rem] items-center gap-1 rounded-md border border-base-300 bg-base-100 px-1.5 text-xs font-medium text-base-content/75 transition-colors hover:border-base-content/25 hover:bg-base-200/50 sm:max-w-[16rem] md:max-w-[20rem]"
                            title={gitBranchTitle}
                            aria-label={`${gitBranchLabel} ${gitBranch}`}
                            aria-haspopup="menu"
                            aria-expanded={gitMenuOpen}
                            onClick={handleGitMenuToggle}
                        >
                            <GitBranch size={12} className="shrink-0 text-base-content/45" />
                            <span className="hidden shrink-0 text-base-content/45 sm:inline">
                                {gitBranchLabel}
                            </span>
                            <span className="min-w-0 truncate" dir="ltr">
                                {gitBranch}
                            </span>
                        </button>
                        {gitMenuOpen && createPortal(
                            <div
                                ref={gitMenuRef}
                                data-chat-git-branch-menu
                                role="menu"
                                className="fixed z-50 w-64 rounded-md border border-base-300 bg-base-100 p-1 shadow-lg"
                                style={{
                                    left: `${gitMenuPos?.left ?? 0}px`,
                                    bottom: `${gitMenuPos?.bottom ?? 0}px`,
                                }}
                            >
                                {gitBranchLoading && (
                                    <div className="px-2 py-1.5 text-xs text-base-content/45">
                                        {loadingBranchesLabel}
                                    </div>
                                )}
                                {gitBranchError && (
                                    <div className="px-2 py-1.5 text-xs text-error">
                                        {gitBranchError}
                                    </div>
                                )}
                                {gitBranches.map((branch) => (
                                    <div
                                        key={branch.name}
                                        className="flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-xs text-base-content/75"
                                    >
                                        <span className="flex w-3 shrink-0 justify-center text-primary">
                                            {branch.current ? <Check size={11} aria-hidden="true" /> : null}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate" dir="ltr">{branch.name}</span>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    data-chat-git-create-branch
                                    role="menuitem"
                                    className="mt-1 flex w-full items-center gap-2 rounded border-t border-base-300 px-2 py-1.5 text-left text-xs text-base-content/75 hover:bg-base-200"
                                    onClick={handleCreateBranch}
                                >
                                    <GitBranch size={12} className="shrink-0 text-base-content/40" />
                                    {createBranchLabel}
                                </button>
                            </div>,
                            document.body,
                        )}
                    </div>
                )}
                {attachments.map((attachment, index) => {
                    const imageUrl = attachment.data
                        ? `data:${attachment.mediaType};base64,${attachment.data}`
                        : attachment.path
                            ? `file://${attachment.path}`
                            : undefined;

                    return (
                        <div
                            key={`${attachment.fileName}-${index}`}
                            className="chat-attachment-preview relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-base-300 bg-base-200 cursor-pointer hover:border-primary transition-colors"
                            title={attachment.fileName}
                            onClick={() => {
                                if (imageUrl) {
                                    setPreviewImage({url: imageUrl, name: attachment.fileName});
                                }
                            }}
                        >
                            {imageUrl ? (
                                <img
                                    src={imageUrl}
                                    alt={attachment.fileName}
                                    className="h-full w-full object-cover"
                                />
                            ) : (
                                <div className="flex flex-col items-center justify-center gap-1 p-1">
                                    <ImageIcon size={16} className="text-primary" />
                                    <span className="truncate text-[9px] text-base-content/60" dir="ltr">
                                        {attachment.fileName}
                                    </span>
                                </div>
                            )}
                            <button
                                type="button"
                                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-sm bg-base-100/90 text-base-content/70 hover:bg-error hover:text-error-content focus:outline-none focus:ring-1 focus:ring-error/50"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveAttachment(index);
                                }}
                                title={removeAttachmentLabel}
                                aria-label={removeAttachmentLabel}
                            >
                                <X size={10} />
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* 右侧：状态面板开关 */}
            <div className="ml-auto flex items-center gap-1">
                {onToggleStatusPanel && (
                    <button
                        type="button"
                        className="flex items-center justify-center w-7 h-7 rounded-md text-base-content/60 hover:bg-base-200 hover:text-base-content transition-colors"
                        onClick={onToggleStatusPanel}
                        title={statusPanelToggleLabel}
                        aria-label={statusPanelToggleLabel}
                    >
                        {statusPanelExpanded ? <ChevronDown size={15} /> : <Layers size={15} />}
                    </button>
                )}
            </div>

            {/* 图片预览全屏遮罩 - 使用 Portal 渲染到 body */}
            {previewImage && createPortal(
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 animate-in fade-in duration-200"
                    onClick={() => setPreviewImage(null)}
                >
                    {/* 关闭按钮 */}
                    <button
                        type="button"
                        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-base-content/10 text-white hover:bg-base-content/20 transition-all focus:outline-none focus:ring-2 focus:ring-white/50"
                        onClick={() => setPreviewImage(null)}
                        aria-label={closePreviewLabel}
                        title={closePreviewLabel}
                    >
                        <X size={20} />
                    </button>

                    {/* 图片 */}
                    <img
                        src={previewImage.url}
                        alt={previewImage.name}
                        className="max-h-[90vh] max-w-[90vw] object-contain animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    />

                    {/* 底部文件名 */}
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-black/50 backdrop-blur-sm">
                        <div className="text-sm text-white/90 font-medium">
                            {previewImage.name}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
