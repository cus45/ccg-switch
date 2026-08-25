import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../utils/cn';
import {selectCenterTabs, useChatStore} from '../../stores/useChatStore';
import {getChatDaemonDiagnosticDisplayText} from '../../utils/chatDaemonStatus';
import {getActivePermissionDialog, shouldRoutePermissionToSideChat} from '../../utils/chatUiBehavior';
import {ChatPaneTabContext} from './paneTabContext';
import AskUserQuestionDialog from './AskUserQuestionDialog';
import PlanApprovalDialog from './PlanApprovalDialog';
import ToolPermissionDialog from './ToolPermissionDialog';
import MessageList from './MessageList';
import ConversationSearch from './ConversationSearch';
import ScrollControl from './ScrollControl';
import ChatInputStatusTabs from './ChatInputStatusTabs';
import ChatSessionTabs from './ChatSessionTabs';
import StreamStallHint from './StreamStallHint';
import {ChatComposer} from './composer/ChatComposer';
import type {ChatWorkspaceProjectOption} from './composer/ContextBar';
import type {ChatWorkspaceStatus} from '../../utils/chatWorkspaceStatus';
import type {ChatMcpAvailabilitySummary} from '../../utils/chatMcpStatus';
import type {ChatPaneController} from './useChatPaneController';

export interface ChatPaneProps {
    /** 会话列状态控制器。主聊天由 ChatPage 创建并与右侧 dock 共享；侧聊自建实例。 */
    controller: ChatPaneController;
    variant?: 'main' | 'side';
    sdkMissing: boolean;
    onSdkMissing: () => void;
    mcpStatus: ChatMcpAvailabilitySummary;
    workspaceProjects?: ChatWorkspaceProjectOption[];
    onWorkspaceChange?: (cwd: string) => void;
    workspaceStatus?: ChatWorkspaceStatus;
    onWorkspaceStatusChange?: (status: ChatWorkspaceStatus) => void;
}

/**
 * 完整会话列（主聊天 / 侧边聊天共用）：
 * [会话 tab 条(仅 main)] + 转录搜索 + 转录 + 滚动控制 + 输入区状态 tabs + composer。
 * 数据源 = `useChatPaneController(tabKey)`；variant='side' 时 composer 走 tab 作用域
 * 绑定（并发发送），variant='main' 保持全局活跃 tab 路径（含真实 abort），行为与重构前一致。
 */
export function ChatPane({
    controller,
    variant = 'main',
    sdkMissing,
    onSdkMissing,
    mcpStatus,
    workspaceProjects,
    onWorkspaceChange,
    workspaceStatus,
    onWorkspaceStatusChange,
}: ChatPaneProps) {
    const {t} = useTranslation();
    const {
        openTabs,
        activeTabKey,
        focusTab,
        closeTab,
        closeOtherTabs,
        closeAllTabs,
        dockChatTabKey,
        pendingAskUserQuestion,
        pendingPlanApproval,
        pendingToolPermission,
        answerAskUserQuestion,
        answerToolPermission,
        approvePlan,
    } = useChatStore();
    const isMain = variant === 'main';
    const centerTabs = useMemo(() => selectCenterTabs(openTabs), [openTabs]);

    // 权限请求就地弹出：仅当本 pane 是 dock 当前可见侧聊，且请求 sessionId
    // 与本 pane 会话一致时接管渲染（其余场景由 ChatPage 中心 modal 兜底）。
    const isVisibleSideChat = !isMain
        && controller.tabKey !== null
        && controller.tabKey === dockChatTabKey;
    const paneSessionId = isVisibleSideChat
        ? openTabs.find((tab) => tab.key === controller.tabKey)?.sessionId ?? null
        : null;
    const routesToPane = (requestSessionId?: string | null) => isVisibleSideChat
        && shouldRoutePermissionToSideChat({requestSessionId, sideChatSessionId: paneSessionId});
    const paneAskUserQuestion = pendingAskUserQuestion && routesToPane(pendingAskUserQuestion.sessionId)
        ? pendingAskUserQuestion
        : null;
    const panePlanApproval = pendingPlanApproval && routesToPane(pendingPlanApproval.sessionId)
        ? pendingPlanApproval
        : null;
    const paneToolPermission = pendingToolPermission && routesToPane(pendingToolPermission.sessionId)
        ? pendingToolPermission
        : null;
    const panePermissionDialog = getActivePermissionDialog({
        hasAskUserQuestion: Boolean(paneAskUserQuestion),
        askUserQuestionTimestamp: paneAskUserQuestion?.timestamp ?? null,
        hasPlanApproval: Boolean(panePlanApproval),
        planApprovalTimestamp: panePlanApproval?.timestamp ?? null,
        hasToolPermission: Boolean(paneToolPermission),
        toolPermissionTimestamp: paneToolPermission?.timestamp ?? null,
    });

    return (
        <ChatPaneTabContext.Provider value={isMain ? null : controller.tabKey}>
            <section
                className={cn('chat-conversation-pane', !isMain && 'relative h-full w-full')}
                style={{flex: '1 1 0%'}}
            >
            {isMain && (
                <ChatSessionTabs
                    // 只显示中心会话：dock 侧聊与它们共用 openTabs 池，
                    // 不过滤的话每开一个侧聊，这里就会多出一个「新对话」。
                    tabs={centerTabs}
                    activeTabKey={activeTabKey}
                    onFocusTab={focusTab}
                    onCloseTab={closeTab}
                    onCloseOtherTabs={closeOtherTabs}
                    onCloseAllTabs={closeAllTabs}
                />
            )}
            <ConversationSearch
                ref={controller.searchInputRef}
                value={controller.searchQuery}
                onChange={controller.handleSearchChange}
            />

            <div
                ref={controller.scrollRef}
                className="flex-1 scroll-pb-8 overflow-y-auto px-2 py-3 sm:px-3"
                onScroll={controller.updateBottomState}
            >
                {!controller.hasMessages && (
                    <div className="flex h-full flex-col items-center justify-center text-base-content/40">
                        <p className="text-sm">{t('chat.empty')}</p>
                    </div>
                )}
                <MessageList
                    messages={controller.searchSourceMessages}
                    searchQuery={controller.searchQuery}
                    fullHistorySearchStatus={controller.fullHistorySearchStatus}
                    scrollContainerRef={controller.scrollRef}
                    onCollapsedCountChange={controller.setCollapsedAnchorCount}
                    onMessageNodeRef={controller.handleMessageNodeRef}
                    onRetryFullHistorySearch={controller.handleRetryFullHistorySearch}
                    hasEarlierServerHistory={controller.hasEarlierServerHistory}
                    isLoadingEarlierServerHistory={controller.isLoadingEarlierServerHistory}
                    onLoadEarlierServerHistory={controller.handleLoadEarlierServerHistory}
                />
            </div>

            <ScrollControl
                visible={controller.hasMessages && !controller.isNearBottom}
                unreadCount={controller.unreadCount}
                onScrollToBottom={controller.scrollToBottom}
            />

            {/* 发送控制台：约束在会话列内，避免横跨会话栏/状态栏 */}
            <StreamStallHint
                requestId={controller.activeRequestId}
                streaming={controller.isStreaming}
                canAbort={isMain}
            />
            <ChatInputStatusTabs
                statusSummary={controller.inputStatusSummary}
                isStreaming={controller.isStreaming}
                selectedEditKey={controller.activeSelectedEditKey}
                onSelectedEditChange={controller.handleSelectedEditChange}
                onSelectTool={controller.handleSelectStatusTool}
                mcpStatus={mcpStatus}
                collapseStatusTabsOnDesktop
            />
            {/* 侧聊没有页面级错误横幅：tab 错误就地显示（主聊天沿用 ChatPage 横幅）。 */}
            {!isMain && controller.error && (
                <div
                    className="mx-2 mb-1 rounded-lg border border-error/30 bg-error/10 px-3 py-1.5 text-xs text-error"
                    role="alert"
                >
                    {getChatDaemonDiagnosticDisplayText({diagnosticText: controller.error, translate: t})
                        ?? controller.error}
                </div>
            )}
            <ChatComposer
                sdkMissing={sdkMissing}
                onSdkMissing={onSdkMissing}
                cwd={controller.currentCwd ?? undefined}
                workspaceProjects={workspaceProjects}
                onWorkspaceChange={onWorkspaceChange}
                workspaceStatus={workspaceStatus}
                onWorkspaceStatusChange={onWorkspaceStatusChange}
                tabKey={isMain ? undefined : controller.tabKey}
            />

            {/* 本侧聊触发的权限请求就地弹出（覆盖本 pane，不遮挡主聊天） */}
            {panePermissionDialog === 'ask-user-question' && paneAskUserQuestion && (
                <AskUserQuestionDialog
                    container="inline"
                    request={paneAskUserQuestion}
                    onAnswer={(answers) => answerAskUserQuestion(paneAskUserQuestion.requestId, answers)}
                    onCancel={() => answerAskUserQuestion(paneAskUserQuestion.requestId, {})}
                />
            )}
            {panePermissionDialog === 'plan-approval' && panePlanApproval && (
                <PlanApprovalDialog
                    container="inline"
                    request={panePlanApproval}
                    onApprove={(approved, targetMode) => approvePlan(panePlanApproval.requestId, approved, targetMode)}
                    onCancel={() => approvePlan(panePlanApproval.requestId, false, 'default')}
                />
            )}
            {panePermissionDialog === 'tool-permission' && paneToolPermission && (
                <ToolPermissionDialog
                    container="inline"
                    request={paneToolPermission}
                    onAnswer={(allow) => answerToolPermission(paneToolPermission.requestId, allow)}
                />
            )}
            </section>
        </ChatPaneTabContext.Provider>
    );
}
