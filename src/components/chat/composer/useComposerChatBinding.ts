import {useMemo} from 'react';
import type {ChatAttachment} from '../../../types/chat';
import {type ChatTabView, useChatStore, useChatTab} from '../../../stores/useChatStore';
import {getDefaultChatModelId} from '../../../utils/chatModels';
import {type ChatProviderId, reasoningLevelsFor, strip1MContextSuffix} from './constants';

type ComposerReadSlice = Pick<
    ChatTabView,
    | 'provider'
    | 'permissionMode'
    | 'model'
    | 'reasoningEffort'
    | 'draft'
    | 'contextTokens'
    | 'contextMaxTokens'
    | 'longContextEnabled'
    | 'activeRequestId'
    | 'activeSession'
    | 'queuedMessages'
>;

export interface ComposerChatBinding extends ComposerReadSlice {
    setProvider: (p: ChatTabView['provider']) => void;
    setPermissionMode: (m: ChatTabView['permissionMode']) => void;
    setModel: (id: string) => void;
    setLongContextEnabled: (enabled: boolean) => void;
    setReasoningEffort: (e: ChatTabView['reasoningEffort']) => void;
    setDraft: (text: string) => void;
    send: (text: string, opts?: {
        cwd?: string;
        model?: string;
        attachments?: ChatAttachment[];
        displayText?: string;
    }) => Promise<boolean>;
    abort: () => Promise<void>;
    /** 读取当前绑定 tab 的最新草稿（避免闭包旧值）。 */
    readDraft: () => string;
    /** 从待发队列移除一条消息。 */
    removeQueuedMessage: (id: string) => void;
    /**
     * 是否可中止当前回合。主聊天可；侧聊(背景 tab)不可——后端 `chat_abort`
     * 无法按 requestId 定向，避免误杀主会话回合，故侧聊不提供中止。
     */
    canAbort: boolean;
}

function correctReasoning(
    provider: ChatProviderId,
    model: string,
    current: ChatTabView['reasoningEffort'],
): ChatTabView['reasoningEffort'] {
    const levels = reasoningLevelsFor(provider, model);
    return levels.some((level) => level.id === current)
        ? current
        : (levels[levels.length - 1]?.id ?? 'high');
}

/**
 * 把聊天输入所需的会话读值 + 动作绑定到「指定 tab」或「全局活跃 tab」。
 *
 * - `tabKey` 为空（或 tab 不存在）→ 返回现有全局 store 切片与动作，行为与重构前
 *   完全一致（主聊天零改动）。
 * - `tabKey` 存在 → 返回该 tab 的切片与 tab 作用域动作（侧边聊天并发发送）。
 *   provider/model 切换在此组合 model 重置与 reasoning 档位校正；草稿存于 tab 快照。
 */
export function useComposerChatBinding(tabKey?: string | null): ComposerChatBinding {
    // Hooks must run unconditionally; subscribe to both, then pick by tabKey.
    const globalStore = useChatStore();
    const tabView = useChatTab(tabKey ?? null);
    const key = tabKey ?? null;

    // tab 作用域动作必须引用稳定（仅随 key 变化）：ChatComposer 的
    // MutationObserver effect 依赖 setDraft，每轮渲染重建动作会导致
    // effect 重跑 → setTabDraft 写 store → 再渲染 的无限循环。
    // 动作内部经 getState() 读最新快照，不闭包捕获渲染期数据。
    const tabActions = useMemo(() => {
        if (!key) return null;
        const readTab = () => {
            const state = useChatStore.getState();
            return key === state.activeTabKey
                ? state
                : state.openTabs.find((tab) => tab.key === key);
        };
        return {
            setProvider: (p: ChatTabView['provider']) => {
                const model = getDefaultChatModelId(p as ChatProviderId);
                useChatStore.getState().updateTabConfig(key, {
                    provider: p,
                    model,
                    reasoningEffort: correctReasoning(
                        p as ChatProviderId,
                        model,
                        readTab()?.reasoningEffort ?? 'high',
                    ),
                });
            },
            setPermissionMode: (m: ChatTabView['permissionMode']) => {
                useChatStore.getState().updateTabConfig(key, {permissionMode: m});
            },
            setModel: (id: string) => {
                const model = strip1MContextSuffix(id);
                const current = readTab();
                useChatStore.getState().updateTabConfig(key, {
                    model,
                    reasoningEffort: correctReasoning(
                        (current?.provider ?? 'claude') as ChatProviderId,
                        model,
                        current?.reasoningEffort ?? 'high',
                    ),
                });
            },
            setLongContextEnabled: (enabled: boolean) => {
                useChatStore.getState().updateTabConfig(key, {longContextEnabled: enabled});
            },
            setReasoningEffort: (e: ChatTabView['reasoningEffort']) => {
                useChatStore.getState().updateTabConfig(key, {reasoningEffort: e});
            },
            setDraft: (text: string) => useChatStore.getState().setTabDraft(key, text),
            send: (
                text: string,
                opts?: {cwd?: string; model?: string; attachments?: ChatAttachment[]; displayText?: string},
            ) => useChatStore.getState().sendInTab(key, text, opts),
            // 后端 chat_abort 无法按 requestId 定向，侧聊不提供中止（见 canAbort）。
            abort: async () => {},
            readDraft: () => readTab()?.draft ?? '',
            removeQueuedMessage: (id: string) => useChatStore.getState().removeQueuedMessage(key, id),
            canAbort: false,
        };
    }, [key]);

    if (!key || !tabView || !tabActions) {
        return {
            provider: globalStore.provider,
            permissionMode: globalStore.permissionMode,
            model: globalStore.model,
            reasoningEffort: globalStore.reasoningEffort,
            draft: globalStore.draft,
            contextTokens: globalStore.contextTokens,
            contextMaxTokens: globalStore.contextMaxTokens,
            longContextEnabled: globalStore.longContextEnabled,
            activeRequestId: globalStore.activeRequestId,
            activeSession: globalStore.activeSession,
            queuedMessages: globalStore.queuedMessages,
            setProvider: globalStore.setProvider,
            setPermissionMode: globalStore.setPermissionMode,
            setModel: globalStore.setModel,
            setLongContextEnabled: globalStore.setLongContextEnabled,
            setReasoningEffort: globalStore.setReasoningEffort,
            setDraft: globalStore.setDraft,
            send: globalStore.send,
            abort: globalStore.abort,
            readDraft: () => useChatStore.getState().draft,
            removeQueuedMessage: (id: string) => {
                const state = useChatStore.getState();
                if (state.activeTabKey) state.removeQueuedMessage(state.activeTabKey, id);
            },
            canAbort: true,
        };
    }

    return {
        provider: tabView.provider,
        permissionMode: tabView.permissionMode,
        model: tabView.model,
        reasoningEffort: tabView.reasoningEffort,
        draft: tabView.draft,
        contextTokens: tabView.contextTokens,
        contextMaxTokens: tabView.contextMaxTokens,
        longContextEnabled: tabView.longContextEnabled,
        activeRequestId: tabView.activeRequestId,
        activeSession: tabView.activeSession,
        queuedMessages: tabView.queuedMessages,
        ...tabActions,
    };
}
