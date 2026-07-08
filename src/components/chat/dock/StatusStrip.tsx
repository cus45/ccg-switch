import {useState} from 'react';
import {ChevronDown, ChevronUp} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {SdkStatus} from '../../../types/chat';
import type {ChatSessionLoadMetrics} from '../../../types/session';
import type {ChatMcpConnectivityState} from '../../../utils/chatMcpConnectivity';
import type {ChatMcpAvailabilitySummary} from '../../../utils/chatMcpStatus';
import type {ChatStatusSummary, ChatStatusToolSummary} from '../../../utils/chatStatusSummary';
import type {PermissionMode, ReasoningEffort} from '../composer/constants';
import {TokenIndicator} from '../composer/TokenIndicator';
import StatusPanel from '../StatusPanel';

interface StatusStripProps {
    // Compact bar
    daemonIndicatorClass: string;
    daemonStatusText: string;
    daemonDiagnosticText?: string | null;
    contextPercentage: number;
    contextUsedTokens?: number;
    contextMaxTokens?: number;
    // Diagnostics (forwarded to StatusPanel in the expandable drawer)
    provider: string;
    messageCount: number;
    daemonReady: boolean;
    model?: string | null;
    permissionMode?: PermissionMode;
    reasoningEffort?: ReasoningEffort;
    sdkStatus?: SdkStatus | null;
    daemonStatus?: string | null;
    daemonReconnecting?: boolean;
    daemonError?: string | null;
    mcpStatus?: ChatMcpAvailabilitySummary;
    mcpConnectivity?: ChatMcpConnectivityState;
    sessionLoadMetrics?: ChatSessionLoadMetrics | null;
    anchorCount?: number;
    activeAnchorLabel?: string;
    currentCwd?: string | null;
    isStreaming?: boolean;
    statusSummary?: ChatStatusSummary;
    onSelectTool?: (tool: ChatStatusToolSummary) => void;
    onReconnectDaemon?: () => void;
    onCheckMcpConnectivity?: () => void;
}

/**
 * 工具坞常驻细状态条：daemon 状态 + 上下文用量%，可展开抽屉查看完整诊断
 * （复用 `StatusPanel` 的诊断块，编辑/diff 由 ReviewPanel 负责，故 showEdits=false）。
 */
export default function StatusStrip({
    daemonIndicatorClass,
    daemonStatusText,
    daemonDiagnosticText,
    contextPercentage,
    contextUsedTokens,
    contextMaxTokens,
    ...diagnostics
}: StatusStripProps) {
    const {t} = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const tf = (key: string, fallback: string): string => {
        const translated = t(key);
        return translated === key ? fallback : translated;
    };

    const daemonTitle = daemonDiagnosticText || daemonStatusText;
    const toggleLabel = expanded
        ? tf('chat.dock.collapseDiagnostics', 'Hide diagnostics')
        : tf('chat.dock.expandDiagnostics', 'Show diagnostics');

    return (
        <div>
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${daemonIndicatorClass}`}
                    title={daemonTitle}
                    aria-label={daemonTitle}
                />
                <span
                    className="truncate text-gray-500 dark:text-base-content/60"
                    title={daemonTitle}
                >
                    {daemonStatusText}
                </span>
                <span className="ml-auto shrink-0">
                    <TokenIndicator
                        percentage={contextPercentage}
                        usedTokens={contextUsedTokens}
                        maxTokens={contextMaxTokens}
                    />
                </span>
                <button
                    type="button"
                    className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-base-content"
                    title={toggleLabel}
                    aria-label={toggleLabel}
                    aria-expanded={expanded}
                    onClick={() => setExpanded((value) => !value)}
                >
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
            </div>

            {expanded && (
                <div
                    className="flex min-h-0 flex-col overflow-hidden border-t border-base-200/60"
                    style={{height: 'min(50vh, 460px)'}}
                >
                    <StatusPanel showEdits={false} {...diagnostics} />
                </div>
            )}
        </div>
    );
}
