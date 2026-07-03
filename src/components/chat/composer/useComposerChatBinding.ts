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

    if (!tabKey || !tabView) {
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
            setProvider: globalStore.setProvider,
            setPermissionMode: globalStore.setPermissionMode,
            setModel: globalStore.setModel,
            setLongContextEnabled: globalStore.setLongContextEnabled,
            setReasoningEffort: globalStore.setReasoningEffort,
            setDraft: globalStore.setDraft,
            send: globalStore.send,
            abort: globalStore.abort,
            readDraft: () => useChatStore.getState().draft,
            canAbort: true,
        };
    }

    const key = tabKey;
    const actions = useChatStore.getState();
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
        setProvider: (p) => {
            const model = getDefaultChatModelId(p as ChatProviderId);
            actions.updateTabConfig(key, {
                provider: p,
                model,
                reasoningEffort: correctReasoning(p as ChatProviderId, model, tabView.reasoningEffort),
            });
        },
        setPermissionMode: (m) => actions.updateTabConfig(key, {permissionMode: m}),
        setModel: (id) => {
            const model = strip1MContextSuffix(id);
            actions.updateTabConfig(key, {
                model,
                reasoningEffort: correctReasoning(tabView.provider as ChatProviderId, model, tabView.reasoningEffort),
            });
        },
        setLongContextEnabled: (enabled) => actions.updateTabConfig(key, {longContextEnabled: enabled}),
        setReasoningEffort: (e) => actions.updateTabConfig(key, {reasoningEffort: e}),
        setDraft: (text) => actions.setTabDraft(key, text),
        send: (text, opts) => actions.sendInTab(key, text, opts),
        // 后端 chat_abort 无法按 requestId 定向，侧聊不提供中止（见 canAbort）。
        abort: async () => {},
        readDraft: () => useChatStore.getState().openTabs.find((tab) => tab.key === key)?.draft ?? '',
        canAbort: false,
    };
}
