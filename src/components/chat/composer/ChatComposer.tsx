import {
    type ClipboardEvent,
    type DragEvent,
    type KeyboardEvent,
    type PointerEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {useTranslation} from 'react-i18next';
import {invoke} from '@tauri-apps/api/core';
import {useComposerChatBinding} from './useComposerChatBinding';
import {useProviderStore} from '../../../stores/useProviderStore';
import type {ChatAttachment, QueuedChatMessage} from '../../../types/chat';
import {type ChatWorkspaceProjectOption, ContextBar} from './ContextBar';
import {ButtonArea} from './ButtonArea';
import {CompletionMenu} from './CompletionMenu';
import {MessageQueueBar} from './MessageQueueBar';
import {PromptEnhancerDialog} from './PromptEnhancerDialog';
import {useCompletions} from './useCompletions';
import {apply1MContextSuffix, type ChatProviderId, contextWindowFor} from './constants';
import {
    buildChatModelList,
    ensureChatModelInList,
    getChatModelRefreshSource,
    isChatModelStorageKey,
    storeFetchedChatModels,
} from '../../../utils/chatModels';
import {
    clampComposerHeight,
    COMPOSER_MAX_HEIGHT,
    COMPOSER_MIN_HEIGHT,
    getChatComposerInputLabel,
    getComposerHeightFromDrag,
} from '../../../utils/chatUiBehavior';
import type {ChatWorkspaceStatus} from '../../../utils/chatWorkspaceStatus';
import {ComposerHistory} from '../../../utils/composerHistory';
import {getCaretOffset, getPlainText, removeFileTag, useContentEditable} from './useContentEditable';
import './FileTag.css';

interface ChatComposerProps {
    /** 当前 provider 对应 SDK 是否缺失（缺失时拦截发送，提示安装） */
    sdkMissing: boolean;
    onSdkMissing: () => void;
    /** 工作目录（@ 文件补全用） */
    cwd?: string;
    workspaceProjects?: ChatWorkspaceProjectOption[];
    onWorkspaceChange?: (cwd: string) => void;
    workspaceStatus?: ChatWorkspaceStatus;
    onWorkspaceStatusChange?: (status: ChatWorkspaceStatus) => void;
    /** 绑定到的会话 tab；缺省=全局活跃 tab（主聊天）。侧边聊天传入其 tab key。 */
    tabKey?: string | null;
}

type FileWithPath = File & {
    path?: string;
};

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
]);

const IMAGE_EXTENSION_MEDIA_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
};

function inferImageMediaType(file: File): string | null {
    if (SUPPORTED_IMAGE_MEDIA_TYPES.has(file.type)) {
        return file.type;
    }

    const extension = file.name.split('.').pop()?.toLowerCase();
    return extension ? IMAGE_EXTENSION_MEDIA_TYPES[extension] ?? null : null;
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Unsupported file reader result'));
            }
        };
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

async function buildImageAttachment(file: File): Promise<ChatAttachment | null> {
    const mediaType = inferImageMediaType(file);
    if (!mediaType) {
        return null;
    }

    const dataUrl = await readFileAsDataUrl(file);
    const [, data = ''] = dataUrl.split(',', 2);
    if (!data) return null;

    const fileWithPath = file as FileWithPath;
    return {
        fileName: file.name || 'image',
        mediaType,
        data,
        path: fileWithPath.path,
        size: file.size,
    };
}

function fileDisplayName(name: string): string {
    return name.split(/[/\\]/).pop() || name;
}

function attachmentKey(attachment: ChatAttachment): string {
    return [
        attachment.fileName,
        attachment.mediaType,
        attachment.path ?? '',
        attachment.data ?? '',
        String(attachment.size ?? ''),
    ].join('\u0000');
}

function normalizeModelRefreshError(error: unknown): string | null {
    const message = error instanceof Error ? error.message : String(error ?? '');
    const normalized = message.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

export function restoreFailedSendAttachments(
    currentAttachments: ChatAttachment[],
    sentAttachments: ChatAttachment[],
): ChatAttachment[] {
    const currentKeys = new Set(currentAttachments.map(attachmentKey));
    const missingSentAttachments = sentAttachments.filter((attachment) => (
        !currentKeys.has(attachmentKey(attachment))
    ));
    return [...missingSentAttachments, ...currentAttachments];
}

interface ChatComposerSubmitState {
    hasPromptText: boolean;
    hasAttachments: boolean;
    isSending: boolean;
}

/**
 * 只在无内容或本地发送流程尚未落盘时阻止提交。
 * 流式进行中不再阻止：send/sendInTab 的忙时检查会把消息放入待发队列。
 */
export function shouldBlockChatComposerSubmit({
    hasPromptText,
    hasAttachments,
    isSending,
}: ChatComposerSubmitState): boolean {
    return (!hasPromptText && !hasAttachments) || isSending;
}

interface PromptEnhanceState {
    hasPromptText: boolean;
    isEnhancing: boolean;
    isEnhanceInFlight: boolean;
}

export function shouldBlockPromptEnhance({
    hasPromptText,
    isEnhancing,
    isEnhanceInFlight,
}: PromptEnhanceState): boolean {
    return !hasPromptText || isEnhancing || isEnhanceInFlight;
}

export interface DraftHistoryNavigationInput {
    direction: 'previous' | 'next';
    historyLength: number;
    /** 当前浏览到的历史下标；null=不在浏览历史（停在用户自己的草稿上）。 */
    cursor: number | null;
    /** 输入框当前文本。 */
    text: string;
    /** 光标在文本中的偏移。 */
    caretOffset: number;
}

export type DraftHistoryNavigation =
    /** 不接管按键，交回给编辑器做常规光标移动。 */
    | {kind: 'ignore'}
    /** 接管按键但内容不变（已到历史边界），避免光标跳到别处。 */
    | {kind: 'consume'}
    /** 应用某条历史；index 为 null 表示回到空草稿。 */
    | {kind: 'apply'; index: number | null};

/**
 * 上/下方向键的草稿历史导航决策。
 *
 * 两个此前踩过的坑，都靠这里的纯逻辑守住：
 * 1. **只能回退一步**：原判定是「草稿为空才接管」，而回填历史本身就把草稿填满了，
 *    第二次上箭头直接被拒。现在只要 `cursor !== null`（已在浏览历史）就继续接管。
 * 2. **多行草稿里方向键被抢**：回退出来的历史条目可能是多行的，此时上箭头应该
 *    先在文本内移动光标，只有光标已在首行（下箭头则是末行）才翻下一条。
 */
export function resolveDraftHistoryNavigation({
    direction,
    historyLength,
    cursor,
    text,
    caretOffset,
}: DraftHistoryNavigationInput): DraftHistoryNavigation {
    if (historyLength === 0) return {kind: 'ignore'};

    const isNavigating = cursor !== null;
    if (!isNavigating && text.trim()) return {kind: 'ignore'};

    if (text.includes('\n')) {
        if (direction === 'previous' && text.slice(0, caretOffset).includes('\n')) {
            return {kind: 'ignore'};
        }
        if (direction === 'next' && text.slice(caretOffset).includes('\n')) {
            return {kind: 'ignore'};
        }
    }

    if (direction === 'previous') {
        const current = cursor ?? historyLength;
        // 已到最早一条：吞掉按键，不让光标跳走，也不再回退。
        if (current <= 0) return {kind: 'consume'};
        return {kind: 'apply', index: current - 1};
    }

    if (!isNavigating) return {kind: 'ignore'};

    const nextIndex = (cursor ?? 0) + 1;
    return {kind: 'apply', index: nextIndex >= historyLength ? null : nextIndex};
}

/**
 * 发送控制台：顶部上下文栏 + 富输入框（@/#/!// 补全）+ 底部控制工具栏。
 * 整合自 jcc-gui ChatInputBox 的交互能力，用 ccg-switch 现有栈重写。
 */
export function ChatComposer({
    sdkMissing,
    onSdkMissing,
    cwd,
    workspaceProjects,
    onWorkspaceChange,
    workspaceStatus,
    onWorkspaceStatusChange,
    tabKey,
}: ChatComposerProps) {
    const { t } = useTranslation();
    const {
        provider,
        permissionMode,
        model,
        reasoningEffort,
        draft,
        contextTokens,
        contextMaxTokens,
        longContextEnabled,
        activeRequestId,
        activeSession,
        queuedMessages,
        setProvider,
        setPermissionMode,
        setModel,
        setLongContextEnabled,
        setReasoningEffort,
        setDraft,
        send,
        abort,
        readDraft,
        removeQueuedMessage,
        canAbort,
    } = useComposerChatBinding(tabKey);
    const {
        providers,
        hasLoaded: providersLoaded,
        loading: providersLoading,
        error: providersError,
        loadAllProviders,
    } = useProviderStore();

    const {
        editorRef,
        composingRef,
        getText,
        insertTag,
        clearEditor,
        setEditorText: setEditorContentText,
        focus: focusEditor,
    } = useContentEditable();

    const draftHistoryRef = useRef<string[]>([]);
    const historyCursorRef = useRef<number | null>(null);
    // 增量撤销/重做（Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y），800ms 内连续输入合并为一步
    const undoHistoryRef = useRef<ComposerHistory | null>(null);
    if (!undoHistoryRef.current) {
        undoHistoryRef.current = new ComposerHistory(draft);
    }
    const resizeCleanupRef = useRef<(() => void) | null>(null);
    const manualResizeRef = useRef(false);
    const sendInFlightRef = useRef(false);
    const enhanceInFlightRef = useRef(false);
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [isDraggingFile, setIsDraggingFile] = useState(false);
    const [isResizingComposer, setIsResizingComposer] = useState(false);
    const [editorHeight, setEditorHeight] = useState(COMPOSER_MIN_HEIGHT);
    const [statusPanelExpanded, setStatusPanelExpanded] = useState(true);
    const [modelConfigVersion, setModelConfigVersion] = useState(0);
    const [modelsRefreshing, setModelsRefreshing] = useState(false);
    const [modelsRefreshError, setModelsRefreshError] = useState<string | null>(null);
    const [editorText, setEditorPlainText] = useState(draft);

    // Prompt 增强弹窗状态
    const [enhancerOpen, setEnhancerOpen] = useState(false);
    const [enhancing, setEnhancing] = useState(false);
    const [enhancedText, setEnhancedText] = useState('');

    const completions = useCompletions({ cwd, provider });

    // 切换会话时强制关闭补全下拉，避免上一个会话遗留的「正在加载建议…」
    // 转圈状态挂在新会话上（active 状态只在输入/选中时才重置）。
    const sessionKey = activeSession
        ? `${activeSession.providerId}::${activeSession.sourcePath}`
        : null;
    const completionsClose = completions.close;
    useEffect(() => {
        completionsClose();
    }, [sessionKey, completionsClose]);

    const isStreaming = activeRequestId !== null;
    const providerId = provider as ChatProviderId;
    const modelOptions = useMemo(() => (
        ensureChatModelInList(
            buildChatModelList(providerId, providers),
            model,
        )
    ), [modelConfigVersion, model, providerId, providers]);
    const modelRefreshSource = useMemo(
        () => getChatModelRefreshSource(providerId, providers),
        [providerId, providers],
    );
    const effectiveModelForContext = providerId === 'claude'
        ? apply1MContextSuffix(model, longContextEnabled)
        : model;
    const fallbackMaxTokens = contextWindowFor(effectiveModelForContext);
    const maxTokens = contextMaxTokens && contextMaxTokens > 0 ? contextMaxTokens : fallbackMaxTokens;
    const percentage = maxTokens > 0 ? (contextTokens / maxTokens) * 100 : 0;

    useEffect(() => {
        if (!providersLoaded) {
            void loadAllProviders();
        }
    }, [loadAllProviders, providersLoaded]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const handleStorageChange = (event: StorageEvent) => {
            if (isChatModelStorageKey(event.key)) {
                setModelConfigVersion((version) => version + 1);
            }
        };
        const handleLocalStorageChange = (event: Event) => {
            const key = (event as CustomEvent<{key?: string}>).detail?.key ?? null;
            if (isChatModelStorageKey(key)) {
                setModelConfigVersion((version) => version + 1);
            }
        };

        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('localStorageChange', handleLocalStorageChange);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('localStorageChange', handleLocalStorageChange);
        };
    }, []);

    useEffect(() => {
        setModelsRefreshError(null);
    }, [providerId, modelRefreshSource?.url]);

    // 自适应高度
    const applyEditorHeight = useCallback((height: number) => {
        const nextHeight = clampComposerHeight(height);
        setEditorHeight(nextHeight);
        const el = editorRef.current;
        if (el) {
            el.style.height = `${nextHeight}px`;
        }
    }, [editorRef]);

    const autosize = useCallback((preferredHeight = editorHeight) => {
        const el = editorRef.current;
        if (!el) return;
        el.style.height = 'auto';
        applyEditorHeight(Math.max(el.scrollHeight, preferredHeight));
    }, [applyEditorHeight, editorHeight, editorRef]);

    useEffect(() => () => {
        resizeCleanupRef.current?.();
    }, []);

    // Sync external draft changes into contenteditable (e.g. history navigation)
    const lastSyncedDraftRef = useRef(draft);
    const syncTextFromEditor = useCallback((el: HTMLElement, persistDraft = true): string => {
        const text = getPlainText(el);
        setEditorPlainText((current) => current === text ? current : text);
        if (persistDraft) {
            lastSyncedDraftRef.current = text;
            setDraft(text);
            undoHistoryRef.current?.record(text);
        }
        return text;
    }, [setDraft]);

    useEffect(() => {
        const el = editorRef.current;
        if (!el || typeof MutationObserver === 'undefined') return undefined;

        const syncObservedText = () => {
            syncTextFromEditor(el, !composingRef.current);
        };
        syncObservedText();

        const observer = new MutationObserver(syncObservedText);
        observer.observe(el, {
            characterData: true,
            childList: true,
            subtree: true,
        });
        return () => observer.disconnect();
    }, [composingRef, editorRef, syncTextFromEditor]);

    useEffect(() => {
        const el = editorRef.current;
        if (!el) return;
        // Only sync if draft was changed externally (not from our own input)
        if (draft !== lastSyncedDraftRef.current) {
            const currentText = getPlainText(el);
            if (draft !== currentText) {
                // External change — set text content
                el.textContent = draft;
            }
            setEditorPlainText(draft);
            lastSyncedDraftRef.current = draft;
        }
    }, [draft, editorRef]);

    const handleResizePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startClientY = event.clientY;
        const startHeight = editorHeight;
        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;

        resizeCleanupRef.current?.();
        setIsResizingComposer(true);
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';

        const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
            moveEvent.preventDefault();
            const nextHeight = getComposerHeightFromDrag(
                startHeight,
                startClientY,
                moveEvent.clientY,
            );
            manualResizeRef.current = true;
            applyEditorHeight(nextHeight);
        };

        const cleanup = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', cleanup);
            window.removeEventListener('pointercancel', cleanup);
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousUserSelect;
            setIsResizingComposer(false);
            resizeCleanupRef.current = null;
        };

        resizeCleanupRef.current = cleanup;
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', cleanup, {once: true});
        window.addEventListener('pointercancel', cleanup, {once: true});
    };

    const syncDraftFromEditor = useCallback(() => {
        const el = editorRef.current;
        if (!el) return;
        syncTextFromEditor(el);
    }, [editorRef, syncTextFromEditor]);

    const handleInput = useCallback(() => {
        const el = editorRef.current;
        if (!el) return;
        const text = syncTextFromEditor(el);
        const caret = getCaretOffset(el);
        completions.onTextChange(text, caret);
        requestAnimationFrame(() => autosize());
    }, [editorRef, syncTextFromEditor, completions, autosize]);

    const handleSend = async () => {
        const rawText = getText();
        const text = rawText.trim();
        setEditorPlainText((current) => current === rawText ? current : rawText);
        if (lastSyncedDraftRef.current !== rawText) {
            lastSyncedDraftRef.current = rawText;
            setDraft(rawText);
        }
        if (shouldBlockChatComposerSubmit({
            hasPromptText: text.length > 0,
            hasAttachments: attachments.length > 0,
            isSending: sendInFlightRef.current,
        })) return;
        if (sdkMissing) {
            onSdkMissing();
            return;
        }
        const sendingAttachments = attachments;
        const attachmentLines = sendingAttachments.map((attachment) => (
            t('chat.imageAttachment', {name: fileDisplayName(attachment.fileName)})
        ));
        const displayText = attachmentLines.length > 0
            ? [text, attachmentLines.join('\n')].filter(Boolean).join('\n\n')
            : text;

        sendInFlightRef.current = true;
        setIsSending(true);
        try {
            // 先清空 UI（立即生效）
            setAttachments([]);
            if (text && draftHistoryRef.current[draftHistoryRef.current.length - 1] !== text) {
                draftHistoryRef.current = [...draftHistoryRef.current.slice(-49), text];
            }
            historyCursorRef.current = null;

            // 发送消息（store 内部会清空 draft）
            const sent = await send(text, { cwd, attachments: sendingAttachments, displayText });
            if (!sent) {
                setAttachments((current) => restoreFailedSendAttachments(current, sendingAttachments));
                if (text && !readDraft().trim()) {
                    setDraft(text);
                }
            } else {
                // Clear the contenteditable on successful send
                clearEditor();
                setEditorPlainText('');
                lastSyncedDraftRef.current = '';
            }
        } finally {
            sendInFlightRef.current = false;
            setIsSending(false);

            // 确保编辑器高度重置
            requestAnimationFrame(() => {
                autosize(manualResizeRef.current ? editorHeight : COMPOSER_MIN_HEIGHT);
                focusEditor();
            });
        }
    };

    const applyDraftFromHistory = (historyIndex: number | null) => {
        const nextDraft = historyIndex === null ? '' : draftHistoryRef.current[historyIndex] ?? '';
        historyCursorRef.current = historyIndex;
        setDraft(nextDraft);
        setEditorPlainText(nextDraft);
        requestAnimationFrame(() => {
            setEditorContentText(nextDraft);
            focusEditor();
            autosize();
        });
    };

    const navigateDraftHistory = (direction: 'previous' | 'next'): boolean => {
        const editor = editorRef.current;
        const text = editor ? getPlainText(editor) : draft;
        const decision = resolveDraftHistoryNavigation({
            direction,
            historyLength: draftHistoryRef.current.length,
            cursor: historyCursorRef.current,
            text,
            caretOffset: editor ? getCaretOffset(editor) : text.length,
        });

        if (decision.kind === 'ignore') return false;
        if (decision.kind === 'consume') return true;

        applyDraftFromHistory(decision.index);
        return true;
    };

    const applyCompletionSelection = useCallback((index: number) => {
        const el = editorRef.current;
        if (!el) return;
        const text = getPlainText(el);
        const result = completions.applySelection(index, text);
        if (!result) return;

        if (result.fileMeta) {
            // @ file completion: insert a styled chip
            insertTag(
                result.fileMeta.triggerStart,
                result.fileMeta.queryLength,
                result.fileMeta.filePath,
                result.fileMeta.isDir,
            );
            syncDraftFromEditor();
        } else {
            // Other completions: plain text replacement
            setEditorContentText(result.text);
            setEditorPlainText(result.text);
            lastSyncedDraftRef.current = result.text;
            setDraft(result.text);
            requestAnimationFrame(() => {
                focusEditor();
                autosize();
            });
        }
    }, [editorRef, completions, insertTag, syncDraftFromEditor, setEditorContentText, setDraft, focusEditor, autosize]);

    // 切换绑定 tab 时重置撤销历史（避免跨会话撤销）
    useEffect(() => {
        undoHistoryRef.current?.reset(readDraft());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tabKey]);

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        // 补全菜单优先消费方向键 / Esc / Enter
        const consumed = completions.handleKeyDown(e);
        if (consumed) {
            // Enter / Tab：确认补全
            if ((e.key === 'Enter' || e.key === 'Tab') && completions.isOpen) {
                applyCompletionSelection(completions.activeIndex);
            }
            return;
        }

        // Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z / Ctrl+Y 重做（覆盖原生：
        // 程序性写入后原生 undo 栈不可靠）
        const modifier = e.ctrlKey || e.metaKey;
        const keyLower = e.key.toLowerCase();
        if (modifier && !e.altKey && (keyLower === 'z' || keyLower === 'y')) {
            const isRedo = (keyLower === 'z' && e.shiftKey) || keyLower === 'y';
            e.preventDefault();
            const history = undoHistoryRef.current;
            if (!history) return;
            const current = getText();
            const target = isRedo ? history.redo(current) : history.undo(current);
            if (target !== null) {
                setDraft(target);
                setEditorPlainText(target);
                lastSyncedDraftRef.current = target;
                setEditorContentText(target);
                requestAnimationFrame(() => {
                    focusEditor();
                    autosize();
                });
            }
            return;
        }

        // Esc：流式进行中直接中止本轮（补全菜单未消费时才生效；侧聊无定向中止）
        if (e.key === 'Escape' && isStreaming && canAbort) {
            e.preventDefault();
            void abort();
            return;
        }

        if (e.key === 'ArrowUp' && navigateDraftHistory('previous')) {
            e.preventDefault();
            return;
        }

        if (e.key === 'ArrowDown' && navigateDraftHistory('next')) {
            e.preventDefault();
            return;
        }

        // 普通 Enter 发送，Shift+Enter 换行；IME 组合输入时 Enter 仅用于确认候选词。
        if (e.key === 'Enter' && !e.shiftKey && !composingRef.current && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void handleSend();
        }
    };

    // 队列条目点击回填：出队 + 文本并入输入框（已有草稿则换行拼接）+ 附件回挂
    const handleEditQueuedMessage = (item: QueuedChatMessage) => {
        removeQueuedMessage(item.id);
        if (item.attachments && item.attachments.length > 0) {
            const restored = item.attachments;
            setAttachments((current) => [...current, ...restored]);
        }
        const currentText = getText().trim();
        const nextText = currentText && item.text
            ? `${currentText}\n${item.text}`
            : (item.text || currentText);
        setDraft(nextText);
        setEditorPlainText(nextText);
        requestAnimationFrame(() => {
            setEditorContentText(nextText);
            focusEditor();
            autosize();
        });
    };

    const handleAddAttachment = async (files: FileList) => {
        const imageFiles = Array.from(files).filter((file) => inferImageMediaType(file) !== null);
        if (imageFiles.length === 0) return;

        const nextAttachments = (await Promise.all(
            imageFiles.map((file) => buildImageAttachment(file).catch(() => null)),
        )).filter((attachment): attachment is ChatAttachment => attachment !== null);

        if (nextAttachments.length > 0) {
            setAttachments((current) => [...current, ...nextAttachments]);
        }
    };

    const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
        const text = e.clipboardData.getData('text/plain');
        const hasImageFiles = Array.from(e.clipboardData.files).some((file) => inferImageMediaType(file) !== null);

        if (hasImageFiles) {
            e.preventDefault();
            void handleAddAttachment(e.clipboardData.files);
            if (text) {
                document.execCommand('insertText', false, text);
            }
            return;
        }

        // For text paste: only allow plain text (strip HTML)
        if (text) {
            e.preventDefault();
            document.execCommand('insertText', false, text);
        }
    };

    const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            setIsDraggingFile(true);
        }
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            setIsDraggingFile(true);
        }
    };

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
        const nextTarget = e.relatedTarget as Node | null;
        if (nextTarget && e.currentTarget.contains(nextTarget)) return;

        setIsDraggingFile(false);
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        if (e.dataTransfer.files.length === 0) return;

        e.preventDefault();
        setIsDraggingFile(false);
        void handleAddAttachment(e.dataTransfer.files);
        focusEditor();
    };

    // Handle click on file-tag close button
    const handleEditorClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('file-tag-close')) {
            e.preventDefault();
            e.stopPropagation();
            const tag = target.closest('.file-tag') as HTMLElement | null;
            const el = editorRef.current;
            if (tag && el) {
                removeFileTag(el, tag);
                syncDraftFromEditor();
                requestAnimationFrame(() => autosize());
            }
        }
    }, [editorRef, syncDraftFromEditor, autosize]);

    const handleEnhance = async () => {
        const text = getText().trim();
        if (shouldBlockPromptEnhance({
            hasPromptText: text.length > 0,
            isEnhancing: enhancing,
            isEnhanceInFlight: enhanceInFlightRef.current,
        })) return;
        enhanceInFlightRef.current = true;
        setEnhancerOpen(true);
        setEnhancing(true);
        setEnhancedText('');
        try {
            const result = await invoke<string>('chat_enhance_prompt', {
                prompt: text,
                model,
            });
            setEnhancedText(result || text);
        } catch (e) {
            setEnhancedText('');
            // 失败时关闭弹窗、保留原文，避免误导。
            setEnhancerOpen(false);
            console.error('[ChatComposer] enhance failed:', e);
        } finally {
            enhanceInFlightRef.current = false;
            setEnhancing(false);
        }
    };

    const handleRefreshModels = async () => {
        if (!modelRefreshSource || modelsRefreshing) return;

        setModelsRefreshing(true);
        setModelsRefreshError(null);
        try {
            const fetchedModels = await invoke<string[]>('fetch_models', {
                url: modelRefreshSource.url,
                apiKey: modelRefreshSource.apiKey,
            });
            const storedCount = storeFetchedChatModels(providerId, fetchedModels);
            setModelConfigVersion((version) => version + 1);
            if (fetchedModels.length > 0 && storedCount === 0) {
                setModelsRefreshError(t('chat.modelsRefreshSaveError'));
            } else if (storedCount === 0) {
                setModelsRefreshError(t('chat.modelsRefreshEmpty'));
            }
        } catch (refreshError) {
            setModelsRefreshError(normalizeModelRefreshError(refreshError) ?? t('chat.modelsRefreshError'));
        } finally {
            setModelsRefreshing(false);
        }
    };

    const applyEnhanced = () => {
        if (enhancedText) {
            setDraft(enhancedText);
            setEditorContentText(enhancedText);
            setEditorPlainText(enhancedText);
            requestAnimationFrame(() => autosize());
        }
        setEnhancerOpen(false);
    };

    const resizeComposerLabel = getChatComposerInputLabel({
        control: 'resize-composer',
        translate: t,
    });
    const richPlaceholder = getChatComposerInputLabel({
        control: 'placeholder',
        translate: t,
    });
    const completionEmptyText = getChatComposerInputLabel({
        control: 'completion-empty',
        translate: t,
    });
    const completionMenuLabel = getChatComposerInputLabel({
        control: 'completion-menu',
        translate: t,
    });
    const completionLoadingText = getChatComposerInputLabel({
        control: 'completion-loading',
        translate: t,
    });
    const dropFileHint = getChatComposerInputLabel({
        control: 'drop-file',
        translate: t,
    });
    const historyHint = getChatComposerInputLabel({
        control: 'history-hint',
        translate: t,
    });
    const hasEditorPromptText = editorText.trim().length > 0;

    return (
        <div className="bg-base-200/20 px-2 pb-4 pt-2 sm:px-3">
            <div className="w-full rounded-xl border border-base-300 bg-base-100/95 p-2 shadow-lg shadow-base-300/30 backdrop-blur transition-[border-color,box-shadow] duration-150 focus-within:border-primary/40 focus-within:shadow-primary/10">
                {/* 忙时排队的待发消息 */}
                <MessageQueueBar
                    items={queuedMessages}
                    onRemove={removeQueuedMessage}
                    onEdit={handleEditQueuedMessage}
                />

                {/* 顶部上下文栏 */}
                <ContextBar
                    attachments={attachments}
                    percentage={percentage}
                    usedTokens={contextTokens}
                    maxTokens={maxTokens}
                    cwd={cwd}
                    workspaceProjects={workspaceProjects}
                    onWorkspaceChange={onWorkspaceChange}
                    workspaceStatus={workspaceStatus}
                    onWorkspaceStatusChange={onWorkspaceStatusChange}
                    onRemoveAttachment={(index) => {
                        setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
                    }}
                    onAddAttachment={handleAddAttachment}
                    statusPanelExpanded={statusPanelExpanded}
                    onToggleStatusPanel={() => setStatusPanelExpanded((v) => !v)}
                />

                {/* 输入框 + 补全菜单 */}
                <div
                    className={`relative rounded-lg transition-colors ${
                        isDraggingFile ? 'bg-primary/5 ring-2 ring-primary/30' : ''
                    }`}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {completions.isOpen && (
                        <CompletionMenu
                            items={completions.items}
                            activeIndex={completions.activeIndex}
                            loading={completions.loading}
                            emptyText={completionEmptyText}
                            loadingText={completionLoadingText}
                            menuLabel={completionMenuLabel}
                            onSelect={(i) => {
                                applyCompletionSelection(i);
                            }}
                            onHover={completions.setActiveIndex}
                        />
                    )}
                    <button
                        type="button"
                        className={`absolute left-1/2 top-0 z-10 flex h-5 w-20 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize touch-none items-center justify-center rounded-full text-base-content/35 transition-colors hover:bg-base-200 hover:text-base-content/60 focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                            isResizingComposer ? 'bg-base-200 text-primary' : ''
                        }`}
                        title={resizeComposerLabel}
                        aria-label={resizeComposerLabel}
                        onPointerDown={handleResizePointerDown}
                    >
                        <span className="h-1 w-10 rounded-full bg-current" />
                    </button>
                    <div
                        ref={editorRef}
                        contentEditable
                        suppressContentEditableWarning
                        className="chat-composer-editable textarea textarea-bordered min-h-[36px] w-full resize-none overflow-y-auto py-1.5 text-sm leading-5"
                        role="textbox"
                        aria-multiline="true"
                        data-placeholder={richPlaceholder}
                        style={{
                            height: `${editorHeight}px`,
                            maxHeight: `${COMPOSER_MAX_HEIGHT}px`,
                        }}
                        onInput={handleInput}
                        onClick={handleEditorClick}
                        onCompositionStart={() => {
                            composingRef.current = true;
                        }}
                        onCompositionEnd={() => {
                            composingRef.current = false;
                            // Trigger input sync after IME composition ends
                            handleInput();
                        }}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                    />
                    {isDraggingFile && (
                        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border border-dashed border-primary bg-primary/10 text-xs font-medium text-primary backdrop-blur-[1px]">
                            {dropFileHint}
                        </div>
                    )}
                    {!hasEditorPromptText && draftHistoryRef.current.length > 0 && !isDraggingFile && (
                        <div className="mt-1 px-1 text-[11px] text-base-content/35">
                            {historyHint}
                        </div>
                    )}
                </div>

                {/* 底部控制工具栏 */}
                <ButtonArea
                    provider={providerId}
                    permissionMode={permissionMode}
                    model={model}
                    models={modelOptions}
                    modelsLoading={providersLoading && !providersLoaded}
                    modelsError={providersError}
                    modelsCanRefresh={Boolean(modelRefreshSource)}
                    modelsRefreshing={modelsRefreshing}
                    modelsRefreshError={modelsRefreshError}
                    longContextEnabled={longContextEnabled}
                    reasoningEffort={reasoningEffort}
                    isLoading={isStreaming}
                    isSubmitting={isSending}
                    isEnhancing={enhancing}
                    canSubmit={!shouldBlockChatComposerSubmit({
                        hasPromptText: hasEditorPromptText,
                        hasAttachments: attachments.length > 0,
                        isSending,
                    })}
                    hasPromptText={hasEditorPromptText}
                    onProviderChange={(p) => setProvider(p)}
                    onModeChange={setPermissionMode}
                    onModelChange={setModel}
                    onLongContextChange={setLongContextEnabled}
                    onRefreshModels={handleRefreshModels}
                    onReasoningChange={setReasoningEffort}
                    onEnhance={handleEnhance}
                    onSubmit={handleSend}
                    onStop={abort}
                />

                <PromptEnhancerDialog
                    isOpen={enhancerOpen}
                    isLoading={enhancing}
                    originalPrompt={draft}
                    enhancedPrompt={enhancedText}
                    onUseEnhanced={applyEnhanced}
                    onKeepOriginal={() => setEnhancerOpen(false)}
                    onClose={() => setEnhancerOpen(false)}
                />
            </div>
        </div>
    );
}
