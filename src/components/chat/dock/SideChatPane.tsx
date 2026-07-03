import {useMemo} from 'react';
import {useMcpStoreV2} from '../../../stores/useMcpStoreV2';
import {useSdkStore} from '../../../stores/useSdkStore';
import {buildChatMcpAvailabilitySummary} from '../../../utils/chatMcpStatus';
import {ChatPane} from '../ChatPane';
import {useChatPaneController} from '../useChatPaneController';

interface SideChatPaneProps {
    /** 引用 useChatStore.openTabs 池里的侧聊 tab（由 openSideChat 创建）。 */
    tabKey: string;
}

/**
 * dock 的 `sideChat` 文档：完整第二聊天面板。自建 ChatPaneController 实例
 * （与主聊天互不共享搜索/滚动/锚点状态）；sdk/mcp 状态按该 tab 的 provider
 * 独立计算。SDK 管理弹窗在 ChatPage，侧聊内缺 SDK 仅提示不开面板。
 */
export default function SideChatPane({tabKey}: SideChatPaneProps) {
    const controller = useChatPaneController({tabKey});
    const sdkStatuses = useSdkStore((s) => s.statuses);
    const mcpServers = useMcpStoreV2((s) => s.servers);
    const mcpLoading = useMcpStoreV2((s) => s.loading);
    const mcpError = useMcpStoreV2((s) => s.error);

    const sdkId = controller.provider === 'claude' ? 'claude-sdk' : 'codex-sdk';
    const currentSdk = sdkStatuses.find((status) => status.id === sdkId);
    const sdkMissing = currentSdk ? !currentSdk.installed : false;
    const mcpStatus = useMemo(
        () => buildChatMcpAvailabilitySummary({
            servers: mcpServers,
            provider: controller.provider,
            loading: mcpLoading,
            error: mcpError,
        }),
        [controller.provider, mcpError, mcpLoading, mcpServers],
    );

    return (
        <ChatPane
            controller={controller}
            variant="side"
            sdkMissing={sdkMissing}
            onSdkMissing={() => {}}
            mcpStatus={mcpStatus}
        />
    );
}
