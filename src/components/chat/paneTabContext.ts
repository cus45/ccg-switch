import {createContext, useContext} from 'react';

/**
 * 当前会话列（ChatPane）绑定的聊天 tab key；null = 全局活跃投影（主聊天）。
 *
 * 深层组件（如子代理轨迹卡片 SubagentHistoryPanel）经此感知宿主 pane，
 * 从对应 tab 快照取 sessionId/subagentRuns 等，避免侧聊面板误读主聊天数据。
 */
export const ChatPaneTabContext = createContext<string | null>(null);

export function useChatPaneTabKey(): string | null {
    return useContext(ChatPaneTabContext);
}
