import {useTranslation} from 'react-i18next';
import {useChatStore} from '../../stores/useChatStore';
import MessageList from './MessageList';
import ConversationSearch from './ConversationSearch';
import ScrollControl from './ScrollControl';
import ChatInputStatusTabs from './ChatInputStatusTabs';
import ChatSessionTabs from './ChatSessionTabs';
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
    const {openTabs, activeTabKey, focusTab, closeTab, closeOtherTabs, closeAllTabs} = useChatStore();
    const isMain = variant === 'main';

    return (
        <section
            className="chat-conversation-pane"
            style={{flex: '1 1 0%'}}
        >
            {isMain && (
                <ChatSessionTabs
                    tabs={openTabs}
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
                onScrollToBottom={controller.scrollToBottom}
            />

            {/* 发送控制台：约束在会话列内，避免横跨会话栏/状态栏 */}
            <ChatInputStatusTabs
                statusSummary={controller.inputStatusSummary}
                isStreaming={controller.isStreaming}
                selectedEditKey={controller.activeSelectedEditKey}
                onSelectedEditChange={controller.handleSelectedEditChange}
                onSelectTool={controller.handleSelectStatusTool}
                mcpStatus={mcpStatus}
                collapseStatusTabsOnDesktop
            />
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
        </section>
    );
}
