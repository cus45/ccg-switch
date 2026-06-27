import {type KeyboardEvent, type ReactNode, useEffect, useMemo, useState} from 'react';
import {
    Activity,
    AlertTriangle,
    Bot,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Columns2,
    ExternalLink,
    FileDiff,
    FilePenLine,
    Folder,
    FolderOpen,
    FolderTree,
    Loader2,
    PanelRightOpen,
    RefreshCw,
    Rows3,
    Server,
    SlidersHorizontal,
    Sparkles,
} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {SdkStatus} from '../../types/chat';
import type {ChatSessionLoadMetrics} from '../../types/session';
import {openFile} from '../../utils/bridge';
import {
    type ChatStatusEditSummary,
    type ChatStatusSummary,
    type ChatStatusToolSummary,
    getChatStatusEditKey,
} from '../../utils/chatStatusSummary';
import {
    canReconnectChatDaemon,
    CHAT_DAEMON_READY_TIMEOUT_ERROR_KEY,
    getChatDaemonDiagnosticText,
    getChatDaemonReconnectLabel,
    getChatDaemonStatusKind,
} from '../../utils/chatDaemonStatus';
import type {ChatMcpConnectivityState, ChatMcpLiveStatus} from '../../utils/chatMcpConnectivity';
import type {ChatMcpAvailabilitySummary} from '../../utils/chatMcpStatus';
import {cn} from '../../utils/cn';
import {AVAILABLE_MODES, type PermissionMode, REASONING_LEVELS, type ReasoningEffort} from './composer/constants';
import EditDiffPreview, {type EditDiffPreviewMode} from '../toolBlocks/EditDiffPreview';
import {isToolBlockToggleActivationKey} from '../../utils/toolGrouping';

const EMPTY_EDIT_SUMMARIES: ChatStatusEditSummary[] = [];
const AUTO_COLLAPSE_EDIT_TREE_FILE_THRESHOLD = 24;
const MAX_ACTIVITY_TASKS = 5;
const MAX_ACTIVITY_SUBAGENTS = 2;
const STATUS_EDIT_PREVIEW_TOP_PADDING = 12;
const STATUS_EDIT_PREVIEW_ROW_OFFSET = 8;
const STATUS_EDIT_PREVIEW_ESTIMATED_HEIGHT = 480;

export const isStatusEditInspectActivationKey = isToolBlockToggleActivationKey;

interface CollapsedFolderState {
    editSetKey: string;
    folders: Set<string>;
    userModified: boolean;
}

interface SessionLoadDisclosureState {
    metricsKey: string | null;
    expanded: boolean;
    userModified: boolean;
}

interface EditTreeNode {
    type: 'folder' | 'file';
    key: string;
    name: string;
    path: string;
    additions: number;
    deletions: number;
    status: ChatStatusEditSummary['status'];
    children: EditTreeNode[];
    edit?: ChatStatusEditSummary;
}

interface StatusPanelProps {
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
    selectedEditKey?: string | null;
    isDiffPaneCollapsed?: boolean;
    diffViewMode?: EditDiffPreviewMode;
    onSelectedEditChange?: (edit: ChatStatusEditSummary) => void;
    onOpenDiffPanel?: () => void;
    onDiffViewModeChange?: (mode: EditDiffPreviewMode) => void;
    onSelectTool?: (tool: ChatStatusToolSummary) => void;
    onReconnectDaemon?: () => void;
    onCheckMcpConnectivity?: () => void;
    /** When false, the recent-edits tree + diff controls are omitted (the dock's
     *  ReviewPanel owns edit/diff review). Defaults to true for standalone use. */
    showEdits?: boolean;
}

function normalizeEditPathParts(edit: ChatStatusEditSummary): string[] {
    const rawPath = (edit.displayPath || edit.openPath || 'unknown').replace(/\\/g, '/');
    const parts = rawPath.split('/').map((part) => part.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [rawPath || 'unknown'];
}

function mergeEditStatus(
    current: ChatStatusEditSummary['status'],
    next: ChatStatusEditSummary['status'],
): ChatStatusEditSummary['status'] {
    if (current === 'error' || next === 'error') return 'error';
    if (current === 'pending' || next === 'pending') return 'pending';
    return 'completed';
}

function sortEditTreeNodes(nodes: EditTreeNode[]): EditTreeNode[] {
    return [...nodes]
        .sort((left, right) => {
            if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
            return left.name.localeCompare(right.name);
        })
        .map((node) => ({
            ...node,
            children: node.children.length > 0 ? sortEditTreeNodes(node.children) : node.children,
        }));
}

function buildEditTree(edits: ChatStatusEditSummary[]): EditTreeNode[] {
    const root: EditTreeNode = {
        type: 'folder',
        key: 'folder:',
        name: '',
        path: '',
        additions: 0,
        deletions: 0,
        status: 'completed',
        children: [],
    };
    const childFolderMaps = new Map<string, Map<string, EditTreeNode>>();
    childFolderMaps.set(root.key, new Map());

    edits.forEach((edit, index) => {
        const parts = normalizeEditPathParts(edit);
        const fileName = parts[parts.length - 1] ?? edit.displayPath;
        const folderParts = parts.slice(0, -1);
        let parent = root;
        const currentPathParts: string[] = [];

        folderParts.forEach((part) => {
            currentPathParts.push(part);
            const folderPath = currentPathParts.join('/');
            const folderKey = `folder:${folderPath}`;
            let siblings = childFolderMaps.get(parent.key);

            if (!siblings) {
                siblings = new Map();
                childFolderMaps.set(parent.key, siblings);
            }

            let folder = siblings.get(part);
            if (!folder) {
                folder = {
                    type: 'folder',
                    key: folderKey,
                    name: part,
                    path: folderPath,
                    additions: 0,
                    deletions: 0,
                    status: 'completed',
                    children: [],
                };
                siblings.set(part, folder);
                parent.children.push(folder);
                childFolderMaps.set(folder.key, new Map());
            }

            folder.additions += edit.additions;
            folder.deletions += edit.deletions;
            folder.status = mergeEditStatus(folder.status, edit.status);
            parent = folder;
        });

        const filePath = [...folderParts, fileName].join('/');
        parent.children.push({
            type: 'file',
            key: `file:${edit.openPath || filePath}:${index}`,
            name: fileName,
            path: filePath,
            additions: edit.additions,
            deletions: edit.deletions,
            status: edit.status,
            children: [],
            edit,
        });
    });

    return sortEditTreeNodes(root.children);
}

function collectEditFolderKeys(nodes: EditTreeNode[]): string[] {
    return nodes.flatMap((node) => (
        node.type === 'folder'
            ? [node.key, ...collectEditFolderKeys(node.children)]
            : []
    ));
}

function createEditSetKey(edits: ChatStatusEditSummary[], touchedFileCount: number): string {
    return `${touchedFileCount}:${edits
        .map((edit) => `${edit.openPath || edit.displayPath}:${edit.additions}:${edit.deletions}:${edit.status}`)
        .join('|')}`;
}

function createDefaultCollapsedFolders(edits: ChatStatusEditSummary[], touchedFileCount: number): Set<string> {
    if (touchedFileCount <= AUTO_COLLAPSE_EDIT_TREE_FILE_THRESHOLD) return new Set();
    return new Set(collectEditFolderKeys(buildEditTree(edits)));
}

function normalizeRuntimeValue(value?: string | null): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    return trimmed.replace(/\\/g, '/');
}

function formatMetricMs(value: number | null): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    return `${Math.max(0, Math.round(value))}ms`;
}

function formatMetricCount(value: number | null): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    return String(value);
}

function createStatusEditPreviewId(editKey: string): string {
    return `status-edit-diff-preview-${editKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function getStatusEditPreviewTop(
    rowTop: number,
    viewportHeight: number,
    previewHeight = STATUS_EDIT_PREVIEW_ESTIMATED_HEIGHT,
): number {
    const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
    const safePreviewHeight = Number.isFinite(previewHeight) ? Math.max(0, previewHeight) : 0;
    const maxTop = Math.max(
        STATUS_EDIT_PREVIEW_TOP_PADDING,
        safeViewportHeight - safePreviewHeight - STATUS_EDIT_PREVIEW_TOP_PADDING,
    );
    const preferredTop = Math.max(STATUS_EDIT_PREVIEW_TOP_PADDING, rowTop - STATUS_EDIT_PREVIEW_ROW_OFFSET);
    return Math.min(preferredTop, maxTop);
}

function getMcpLiveStatusClass(status: ChatMcpLiveStatus): string {
    if (status === 'online') return 'completed';
    if (status === 'unknown') return 'pending';
    return 'error';
}

export default function StatusPanel({
    provider,
    messageCount,
    daemonReady,
    model,
    permissionMode,
    reasoningEffort,
    sdkStatus,
    daemonStatus,
    daemonReconnecting = false,
    daemonError,
    mcpStatus,
    mcpConnectivity,
    sessionLoadMetrics,
    anchorCount = 0,
    activeAnchorLabel,
    currentCwd,
    isStreaming = false,
    statusSummary,
    selectedEditKey,
    isDiffPaneCollapsed = false,
    diffViewMode,
    onSelectedEditChange,
    onOpenDiffPanel,
    onDiffViewModeChange,
    onSelectTool,
    onReconnectDaemon,
    onCheckMcpConnectivity,
    showEdits = true,
}: StatusPanelProps) {
    const { t } = useTranslation();
    const translateWithFallback = (key: string, fallback: string, options?: Record<string, unknown>) => {
        const translated = options ? t(key, options) : t(key);
        return translated === key ? fallback : translated;
    };
    const getPermissionModeFallbackLabel = (mode?: PermissionMode) => {
        switch (mode) {
            case 'plan':
                return 'Plan Mode';
            case 'acceptEdits':
                return 'Agent Mode';
            case 'bypassPermissions':
                return 'Auto Mode';
            case 'default':
                return 'Default Mode';
            default:
                return mode ?? '';
        }
    };
    const getReasoningFallbackLabel = (effort?: ReasoningEffort) => {
        switch (effort) {
            case 'low':
                return 'Low';
            case 'medium':
                return 'Medium';
            case 'high':
                return 'High';
            case 'xhigh':
                return 'Extra high';
            case 'max':
                return 'Max';
            default:
                return effort ?? '';
        }
    };
    const statusPanelLabel = translateWithFallback('chat.layout.statusPanel', 'Session status');
    const providerLabel = translateWithFallback('chat.providerLabel', 'AI provider');
    const messageCountLabel = translateWithFallback('chat.layout.messageCount', 'Messages');
    const anchorRailLabel = translateWithFallback('chat.layout.anchorRail', 'Message anchors');
    const providerTargetLabel = `${providerLabel}: ${provider}`;
    const messageCountTargetLabel = `${messageCountLabel}: ${messageCount}`;
    const anchorCountTargetLabel = `${anchorRailLabel}: ${anchorCount}`;
    const daemonLabel = translateWithFallback('chat.daemon.label', 'Daemon');
    const daemonSuccessLabel = translateWithFallback('common.success', 'Success');
    const daemonOfflineLabel = translateWithFallback('chat.daemon.offline', 'Daemon offline');
    const daemonErrorLabel = translateWithFallback('chat.daemon.error', 'Daemon error');
    const daemonStartingLabel = translateWithFallback('chat.starting', 'Starting...');
    const daemonReconnectLabel = getChatDaemonReconnectLabel({
        daemonReconnecting,
        translate: (key) => t(key),
    });
    const runtimeContextLabel = translateWithFallback('chat.layout.runtimeContext', 'Runtime context');
    const modelContextLabel = translateWithFallback('chat.modelLabel', 'Model');
    const permissionModeContextLabel = translateWithFallback('chat.modeLabel', 'Permission mode');
    const reasoningContextLabel = translateWithFallback('chat.reasoningLabel', 'Reasoning effort');
    const workspaceContextLabel = translateWithFallback('chat.layout.workspace', 'Workspace');
    const sdkStatusLabel = translateWithFallback('chat.layout.sdkStatus', 'SDK');
    const sdkInstalledLabel = translateWithFallback('chat.sdk.installed', 'Installed');
    const sdkNotInstalledLabel = translateWithFallback('chat.sdk.notInstalled', 'Not installed');
    const currentActivityLabel = translateWithFallback('chat.layout.currentActivity', 'Current activity');
    const streamingReplyLabel = translateWithFallback('chat.layout.streamingReply', 'Streaming reply');
    const idleActivityLabel = translateWithFallback('chat.layout.idle', 'Idle');
    const pendingToolsLabel = translateWithFallback('chat.layout.pendingTools', 'Pending tools');
    const errorToolsLabel = translateWithFallback('chat.layout.errorTools', 'Failed tools');
    const activityHistoryRegionLabel = translateWithFallback('chat.layout.activityHistoryRegion', 'Activity history');
    const currentAnchorLabel = translateWithFallback('chat.layout.currentAnchor', 'Current message');
    const inputStatusTasksLabel = translateWithFallback('chat.layout.inputStatusTasks', 'Tasks');
    const inputStatusSubagentsLabel = translateWithFallback('chat.layout.inputStatusSubagents', 'Subagents');
    const getHiddenActivityTaskLabel = (count: number) => translateWithFallback(
        'chat.layout.activityHistoryMoreTools',
        `${count} earlier ${count === 1 ? 'tool task' : 'tool tasks'} hidden from activity history`,
        {count},
    );
    const getHiddenActivitySubagentLabel = (count: number) => translateWithFallback(
        'chat.layout.activityHistoryMoreSubagents',
        `${count} earlier ${count === 1 ? 'subagent' : 'subagents'} hidden from activity history`,
        {count},
    );
    const recentEditsLabel = translateWithFallback('chat.layout.recentEdits', 'Recent edits');
    const expandEditTreeLabel = translateWithFallback('chat.layout.expandEditTree', 'Expand edit tree');
    const collapseEditTreeLabel = translateWithFallback('chat.layout.collapseEditTree', 'Collapse edit tree');
    const diffViewModeLabel = translateWithFallback('chat.layout.diffViewMode', 'Diff view mode');
    const diffUnifiedViewLabel = translateWithFallback('chat.layout.diffUnifiedView', 'Unified diff view');
    const diffSplitViewLabel = translateWithFallback('chat.layout.diffSplitView', 'Split diff view');
    const showRecentEditFilesLabel = translateWithFallback('chat.layout.showRecentEditFiles', 'Show recent edits');
    const getEditSummaryLabel = (count: number, additions: number, deletions: number) => translateWithFallback(
        'chat.layout.editSummary',
        `${count} ${count === 1 ? 'file' : 'files'} · +${additions} / -${deletions}`,
        {count, additions, deletions},
    );
    const getEditStatsTargetLabel = (target: string, additions: number, deletions: number) => translateWithFallback(
        'chat.layout.inputStatusEditFileStats',
        `Edit stats: ${target} · +${additions} / -${deletions}`,
        {file: target, additions, deletions},
    );
    const getEditFolderActionLabel = (isCollapsed: boolean, folder: string) => translateWithFallback(
        isCollapsed ? 'chat.layout.expandEditFolder' : 'chat.layout.collapseEditFolder',
        `${isCollapsed ? 'Expand' : 'Collapse'} folder: ${folder}`,
        {folder},
    );
    const getInspectDiffLabel = (isSelected: boolean, file: string) => translateWithFallback(
        isSelected ? 'chat.layout.inspectCurrentFullDiff' : 'chat.layout.inspectFullDiff',
        `${isSelected ? 'Current full diff' : 'Inspect full diff'}: ${file}`,
        {file},
    );
    const getOpenEditedFileLabel = (file: string) => translateWithFallback(
        'tools.openFileForPath',
        `Open file: ${file}`,
        {file},
    );
    const getReopenDiffPaneLabel = (edit?: ChatStatusEditSummary) => (
        edit
            ? translateWithFallback(
                'chat.layout.expandDiffPanelForFile',
                `Open diff review for ${edit.displayPath}`,
                {file: edit.displayPath},
            )
            : translateWithFallback('chat.layout.expandDiffPanel', 'Open diff review')
    );
    const getHiddenEditFilesLabel = (count: number) => translateWithFallback(
        'chat.layout.hiddenEditFiles',
        `${count} more ${count === 1 ? 'file' : 'files'} not shown in this list`,
        {count},
    );
    const getMcpServerStateLabel = (serverName: string, stateLabel: string, detail?: string | null) => (
        [`${serverName}: ${stateLabel}`, detail].filter(Boolean).join(' · ')
    );
    const getMcpServerNameLabel = (serverName: string) => translateWithFallback(
        'chat.layout.mcpServerName',
        `MCP server: ${serverName}`,
        {server: serverName},
    );
    const getMcpServerTransportLabel = (serverName: string, transport: string) => translateWithFallback(
        'chat.layout.mcpServerTransport',
        `MCP server transport: ${serverName} · ${transport}`,
        {server: serverName, transport},
    );
    const getRuntimeContextValueLabel = (label: string, value: string) => `${label}: ${value}`;
    const activeTool = statusSummary?.activeTool;
    const recentEdits = statusSummary?.recentEdits ?? EMPTY_EDIT_SUMMARIES;
    const allEdits = statusSummary?.allEdits ?? recentEdits;
    const touchedFileCount = statusSummary?.touchedFileCount ?? 0;
    const editSetKey = useMemo(() => createEditSetKey(allEdits, touchedFileCount), [allEdits, touchedFileCount]);
    const [showAllEdits, setShowAllEdits] = useState(false);
    const [collapsedFolderState, setCollapsedFolderState] = useState<CollapsedFolderState>(() => ({
        editSetKey,
        folders: createDefaultCollapsedFolders(allEdits, touchedFileCount),
        userModified: false,
    }));
    const [localDiffViewMode, setLocalDiffViewMode] = useState<EditDiffPreviewMode>('unified');
    const activeDiffViewMode = diffViewMode ?? localDiffViewMode;
    const visibleEdits = showAllEdits ? allEdits : recentEdits;
    const editPreviewLinesByKey = useMemo(() => {
        const previews = new Map<string, ChatStatusEditSummary['diffPreviewLines']>();
        [...allEdits, ...recentEdits].forEach((edit) => {
            if (edit.diffPreviewLines.length === 0) return;
            previews.set(getChatStatusEditKey(edit), edit.diffPreviewLines);
        });
        return previews;
    }, [allEdits, recentEdits]);
    const editTree = useMemo(() => buildEditTree(visibleEdits), [visibleEdits]);
    const editFolderKeys = useMemo(() => collectEditFolderKeys(editTree), [editTree]);
    const sessionLoadMetricsKey = sessionLoadMetrics
        ? `${sessionLoadMetrics.providerId}:${sessionLoadMetrics.sessionKey}:${sessionLoadMetrics.startedAt}`
        : null;
    const shouldAutoExpandSessionLoadMetrics = Boolean(
        sessionLoadMetrics && (
            sessionLoadMetrics.status === 'loading'
            || sessionLoadMetrics.status === 'error'
            || sessionLoadMetrics.error
        ),
    );
    const [sessionLoadDisclosureState, setSessionLoadDisclosureState] = useState<SessionLoadDisclosureState>(() => ({
        metricsKey: sessionLoadMetricsKey,
        expanded: shouldAutoExpandSessionLoadMetrics,
        userModified: false,
    }));
    const sessionLoadMetricsExpanded = Boolean(
        sessionLoadMetrics && (
            shouldAutoExpandSessionLoadMetrics || sessionLoadDisclosureState.expanded
        ),
    );
    const modelLabel = normalizeRuntimeValue(model);
    const workspaceLabel = normalizeRuntimeValue(currentCwd);
    const permissionModeInfo = permissionMode
        ? AVAILABLE_MODES.find((mode) => mode.id === permissionMode)
        : undefined;
    const permissionModeLabel = permissionModeInfo
        ? translateWithFallback(
            `chat.modes.${permissionModeInfo.i18nKey}.label`,
            getPermissionModeFallbackLabel(permissionModeInfo.id),
        )
        : permissionMode;
    const reasoningInfo = reasoningEffort
        ? REASONING_LEVELS.find((level) => level.id === reasoningEffort)
        : undefined;
    const reasoningLabel = reasoningInfo
        ? translateWithFallback(
            `chat.reasoning.${reasoningInfo.i18nKey}.label`,
            getReasoningFallbackLabel(reasoningInfo.id),
        )
        : reasoningEffort;
    const hasRuntimeContext = Boolean(
        modelLabel || permissionModeLabel || reasoningLabel || workspaceLabel || sdkStatus,
    );
    const sdkStatusValueLabel = sdkStatus
        ? `${sdkStatus.displayName} · ${sdkStatus.installed ? sdkInstalledLabel : sdkNotInstalledLabel}`
        : '';
    const pendingToolCount = statusSummary?.pendingToolCount ?? 0;
    const errorToolCount = statusSummary?.errorToolCount ?? 0;
    const pendingToolCountLabel = `${pendingToolsLabel}: ${pendingToolCount}`;
    const errorToolCountLabel = `${errorToolsLabel}: ${errorToolCount}`;
    const hasActivityToolCounts = pendingToolCount > 0 || errorToolCount > 0;
    const agentTools = statusSummary?.agentTools ?? (statusSummary?.toolTimeline ?? [])
        .filter((tool) => tool.type === 'agent');
    const activitySubagents = agentTools
        .filter((tool) => tool.toolId !== activeTool?.toolId);
    const recentActivitySubagents = [...activitySubagents].reverse().slice(0, MAX_ACTIVITY_SUBAGENTS);
    const hiddenActivitySubagentCount = Math.max(0, activitySubagents.length - recentActivitySubagents.length);
    const hiddenActivitySubagentLabel = getHiddenActivitySubagentLabel(hiddenActivitySubagentCount);
    const activitySubagentRatioLabel = `${inputStatusSubagentsLabel}: ${recentActivitySubagents.length} / ${activitySubagents.length}`;
    const hasActivitySubagents = recentActivitySubagents.length > 0;
    const activityTasks = (statusSummary?.toolTimeline ?? [])
        .filter((tool) => tool.type !== 'agent' && tool.toolId !== activeTool?.toolId);
    const recentActivityTasks = [...activityTasks].reverse().slice(0, MAX_ACTIVITY_TASKS);
    const hiddenActivityTaskCount = Math.max(0, activityTasks.length - recentActivityTasks.length);
    const hiddenActivityTaskLabel = getHiddenActivityTaskLabel(hiddenActivityTaskCount);
    const activityTaskRatioLabel = `${inputStatusTasksLabel}: ${recentActivityTasks.length} / ${activityTasks.length}`;
    const hasActivityTasks = recentActivityTasks.length > 0;
    const shouldShowCurrentActivityCard = Boolean(activeTool || isStreaming || hasActivityToolCounts || hasActivityTasks || hasActivitySubagents);
    const hiddenEditCount = Math.max(0, touchedFileCount - recentEdits.length);
    const collapsedFolders = collapsedFolderState.folders;
    const allFoldersCollapsed = editFolderKeys.length > 0 && editFolderKeys.every((key) => collapsedFolders.has(key));
    const canReopenDiffPane = Boolean(isDiffPaneCollapsed && allEdits.length > 0 && onOpenDiffPanel);
    const reopenDiffPaneEdit = selectedEditKey
        ? allEdits.find((edit) => getChatStatusEditKey(edit) === selectedEditKey) ?? allEdits[0]
        : allEdits[0];
    const reopenDiffPaneLabel = getReopenDiffPaneLabel(reopenDiffPaneEdit);
    const editSummaryLabel = getEditSummaryLabel(
        touchedFileCount,
        statusSummary?.totalAdditions ?? 0,
        statusSummary?.totalDeletions ?? 0,
    );
    const hiddenEditFilesLabel = getHiddenEditFilesLabel(hiddenEditCount);
    const hiddenEditFilesActionLabel = showAllEdits ? showRecentEditFilesLabel : hiddenEditFilesLabel;
    const shouldShowRecentEditsCard = touchedFileCount > 0 || allEdits.length > 0 || canReopenDiffPane;
    const shouldAutoExpandMcpDetails = Boolean(
        mcpStatus && (
            mcpStatus.loading
            || mcpStatus.error
            || mcpConnectivity?.checking
            || mcpConnectivity?.error
            || mcpConnectivity?.hasResults
        ),
    );
    const [mcpExpanded, setMcpExpanded] = useState(shouldAutoExpandMcpDetails);
    const mcpDetailsExpanded = Boolean(mcpStatus && mcpExpanded);
    const activeAnchorTargetLabel = activeAnchorLabel
        ? `${currentAnchorLabel}: ${activeAnchorLabel}`
        : '';

    useEffect(() => {
        setCollapsedFolderState((current) => {
            if (current.editSetKey === editSetKey) return current;
            if (current.userModified) {
                return {
                    ...current,
                    editSetKey,
                };
            }
            return {
                editSetKey,
                folders: createDefaultCollapsedFolders(allEdits, touchedFileCount),
                userModified: false,
            };
        });
    }, [allEdits, editSetKey, touchedFileCount]);

    useEffect(() => {
        if (!mcpStatus) {
            setMcpExpanded(false);
            return;
        }
        if (shouldAutoExpandMcpDetails) {
            setMcpExpanded(true);
        }
    }, [Boolean(mcpStatus), shouldAutoExpandMcpDetails]);

    useEffect(() => {
        setSessionLoadDisclosureState((current) => {
            if (!sessionLoadMetrics || !sessionLoadMetricsKey) {
                if (!current.metricsKey && !current.expanded && !current.userModified) return current;
                return {
                    metricsKey: null,
                    expanded: false,
                    userModified: false,
                };
            }

            if (current.metricsKey !== sessionLoadMetricsKey) {
                return {
                    metricsKey: sessionLoadMetricsKey,
                    expanded: shouldAutoExpandSessionLoadMetrics,
                    userModified: false,
                };
            }

            if (shouldAutoExpandSessionLoadMetrics && !current.expanded) {
                return {
                    ...current,
                    expanded: true,
                };
            }

            if (!shouldAutoExpandSessionLoadMetrics && !current.userModified && current.expanded) {
                return {
                    ...current,
                    expanded: false,
                };
            }

            return current;
        });
    }, [sessionLoadMetrics, sessionLoadMetricsKey, shouldAutoExpandSessionLoadMetrics]);

    const handleOpenEditedFile = (filePath: string, lineStart?: number, lineEnd?: number) => {
        void openFile(filePath, lineStart, lineEnd, currentCwd);
    };

    const handleDiffViewModeChange = (mode: EditDiffPreviewMode) => {
        if (onDiffViewModeChange) {
            onDiffViewModeChange(mode);
            return;
        }
        setLocalDiffViewMode(mode);
    };

    const toggleSessionLoadMetrics = () => {
        if (!sessionLoadMetrics || !sessionLoadMetricsKey) return;
        setSessionLoadDisclosureState((current) => {
            const currentExpanded = shouldAutoExpandSessionLoadMetrics
                || (current.metricsKey === sessionLoadMetricsKey && current.expanded);
            return {
                metricsKey: sessionLoadMetricsKey,
                expanded: !currentExpanded,
                userModified: true,
            };
        });
    };

    const handleSelectEditedFile = (edit: ChatStatusEditSummary) => {
        if (onSelectedEditChange) {
            onSelectedEditChange(edit);
            return;
        }
        handleOpenEditedFile(edit.openPath, edit.lineStart, edit.lineEnd);
    };

    const handleEditedFileKeyDown = (
        event: KeyboardEvent<HTMLDivElement>,
        edit: ChatStatusEditSummary,
    ) => {
        if (!isStatusEditInspectActivationKey(event.key)) return;
        event.preventDefault();
        handleSelectEditedFile(edit);
    };

    const toggleFolder = (folderKey: string) => {
        setCollapsedFolderState((current) => {
            const next = new Set(current.folders);
            if (next.has(folderKey)) {
                next.delete(folderKey);
            } else {
                next.add(folderKey);
            }
            return {
                ...current,
                folders: next,
                userModified: true,
            };
        });
    };

    const toggleAllFolders = () => {
        setCollapsedFolderState((current) => {
            if (editFolderKeys.length === 0) return current;
            const shouldExpandAll = editFolderKeys.every((key) => current.folders.has(key));
            return {
                ...current,
                folders: shouldExpandAll ? new Set() : new Set(editFolderKeys),
                userModified: true,
            };
        });
    };

    const getStatusLabel = (status: ChatStatusEditSummary['status']) => (
        status === 'error'
            ? translateWithFallback('tools.failed', 'Failed')
            : status === 'pending'
                ? translateWithFallback('tools.pending', 'Pending')
                : translateWithFallback('common.success', 'Success')
    );
    const getEditStatusTargetLabel = (edit: ChatStatusEditSummary) => (
        `${edit.displayPath}: ${getStatusLabel(edit.status)}`
    );
    const getToolStatusLabel = (status: ChatStatusToolSummary['status']) => (
        status === 'error'
            ? translateWithFallback('tools.failed', 'Failed')
            : status === 'pending'
                ? translateWithFallback('tools.pending', 'Pending')
                : translateWithFallback('common.success', 'Success')
    );
    const getToolStatusTargetLabel = (tool: ChatStatusToolSummary) => {
        const target = tool.summary || tool.detail || tool.label;
        return `${tool.label}: ${target} · ${getToolStatusLabel(tool.status)}`;
    };
    const getToolSummaryTargetLabel = (tool: ChatStatusToolSummary) => `${tool.label}: ${tool.summary}`;
    const getToolDetailTargetLabel = (tool: ChatStatusToolSummary) => `${tool.label}: ${tool.detail}`;
    const getActivityJumpLabelKey = (tool: ChatStatusToolSummary) => (
        tool.type === 'agent'
            ? 'chat.layout.scrollToSubagentActivity'
            : 'chat.layout.scrollToToolTask'
    );
    const getActivityJumpFallbackLabel = (tool: ChatStatusToolSummary) => {
        const target = tool.summary || tool.label;
        return `${tool.type === 'agent' ? 'Jump to subagent activity' : 'Jump to tool task'}: ${target}`;
    };
    const getActivityJumpLabel = (tool: ChatStatusToolSummary) => translateWithFallback(
        getActivityJumpLabelKey(tool),
        getActivityJumpFallbackLabel(tool),
        {tool: tool.summary || tool.label},
    );
    const renderToolStatusIcon = (status: ChatStatusToolSummary['status']) => {
        if (status === 'pending') return <Loader2 size={13} className="mt-0.5 flex-shrink-0 animate-spin text-warning" />;
        if (status === 'error') return <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-error" />;
        return <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0 text-success" />;
    };
    const renderActivityTaskRow = (tool: ChatStatusToolSummary) => (
        <button
            type="button"
            key={tool.toolId}
            className="status-activity-task-row flex w-full min-w-0 items-start gap-2 rounded-md bg-base-200/45 px-2 py-1.5 text-left transition-colors hover:bg-base-200/80 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-default disabled:opacity-100"
            title={getActivityJumpLabel(tool)}
            aria-label={getActivityJumpLabel(tool)}
            data-target-tool-id={tool.toolId}
            disabled={!onSelectTool}
            onClick={() => onSelectTool?.(tool)}
        >
            {renderToolStatusIcon(tool.status)}
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span className={`tool-command-chip ${tool.accentClass}`}>{tool.label}</span>
                    <span
                        className={`tool-state-pill ${tool.status}`}
                        title={getToolStatusTargetLabel(tool)}
                        aria-label={getToolStatusTargetLabel(tool)}
                    >
                        {getToolStatusLabel(tool.status)}
                    </span>
                </div>
                <div className="mt-1 truncate text-[11px] font-medium text-base-content/75">
                    {tool.summary}
                </div>
                {tool.detail && (
                    <div className="mt-0.5 truncate text-[10px] text-base-content/45">
                        {tool.detail}
                    </div>
                )}
            </div>
        </button>
    );

    const daemonStatusKind = getChatDaemonStatusKind({daemonReady, daemonStatus, daemonReconnecting});
    const showDaemonReconnect = Boolean(onReconnectDaemon) && (
        daemonReconnecting || canReconnectChatDaemon({daemonReady, daemonStatus, daemonReconnecting})
    );
    const readyStateClass = daemonStatusKind === 'ready'
        ? 'font-medium text-success'
        : daemonStatusKind === 'offline' || daemonStatusKind === 'error'
            ? 'font-medium text-error'
            : 'font-medium text-warning';
    const daemonStatusText = daemonStatusKind === 'ready'
        ? daemonSuccessLabel
        : daemonStatusKind === 'offline'
            ? daemonOfflineLabel
            : daemonStatusKind === 'error'
                ? daemonErrorLabel
                : daemonStatusKind === 'unknown' && daemonStatus
                ? daemonStatus
                : daemonStartingLabel;
    const daemonStatusAriaLabel = `${daemonLabel}: ${daemonStatusText}`;
    const daemonDiagnosticText = getChatDaemonDiagnosticText({
        daemonReady,
        daemonStatus,
        daemonReconnecting,
        error: daemonError,
    });
    const daemonDiagnosticDisplayText = daemonDiagnosticText === CHAT_DAEMON_READY_TIMEOUT_ERROR_KEY
        ? translateWithFallback(CHAT_DAEMON_READY_TIMEOUT_ERROR_KEY, 'Daemon did not become ready in time')
        : daemonDiagnosticText;
    const daemonDiagnosticDetailLabel = daemonDiagnosticDisplayText
        ? `${daemonStatusAriaLabel} · ${daemonDiagnosticDisplayText}`
        : '';
    const daemonStatusTargetLabel = daemonDiagnosticDetailLabel || daemonStatusAriaLabel;
    const mcpStatusLabel = translateWithFallback('chat.layout.mcpStatus', 'MCP');
    const mcpConfigurationErrorLabel = translateWithFallback('chat.layout.mcpConfigurationError', 'Configuration error');
    const mcpLiveCheckFailedLabel = translateWithFallback('chat.layout.mcpLiveCheckFailed', 'Live check failed');
    const mcpLoadingLabel = translateWithFallback('chat.layout.mcpLoading', 'Loading MCP configuration...');
    const mcpLoadingTargetLabel = `${mcpStatusLabel}: ${mcpLoadingLabel}`;
    const mcpConfiguredServersLabel = translateWithFallback('chat.layout.mcpConfiguredServers', 'Configured servers');
    const mcpConfiguredServersCountLabel = mcpStatus
        ? `${mcpConfiguredServersLabel}: ${mcpStatus.servers.length}`
        : '';
    const mcpNoServersLabel = translateWithFallback('chat.layout.mcpNoServers', 'No MCP servers configured');
    const mcpNoServersTargetLabel = `${mcpStatusLabel}: ${mcpNoServersLabel}`;
    const mcpEnabledLabel = translateWithFallback('chat.layout.mcpEnabled', 'Enabled');
    const mcpDisabledLabel = translateWithFallback('chat.layout.mcpDisabled', 'Disabled');
    const mcpManualCheckHintLabel = translateWithFallback(
        'chat.layout.mcpManualCheckHint',
        'Run a live check for enabled MCP servers.',
    );
    const mcpNoEnabledServersLabel = translateWithFallback(
        'chat.layout.mcpNoEnabledServers',
        'No enabled MCP servers to check.',
    );
    const mcpManualHintText = (mcpStatus?.enabledServers ?? 0) > 0
        ? mcpManualCheckHintLabel
        : mcpNoEnabledServersLabel;
    const mcpManualHintTargetLabel = `${mcpStatusLabel}: ${mcpManualHintText}`;
    const mcpCheckLiveLabel = translateWithFallback('chat.layout.mcpCheckLive', 'Check live');
    const mcpCheckingLabel = translateWithFallback('chat.layout.mcpChecking', 'Checking...');
    const mcpDetailsToggleLabel = mcpDetailsExpanded
        ? translateWithFallback('chat.layout.collapseMcpDetails', 'Collapse MCP details')
        : translateWithFallback('chat.layout.expandMcpDetails', 'Expand MCP details');
    const mcpCheckActionLabel = mcpConnectivity?.checking ? mcpCheckingLabel : mcpCheckLiveLabel;
    const mcpConfigurationErrorDetailLabel = mcpStatus?.error
        ? `${mcpStatusLabel}: ${mcpConfigurationErrorLabel} · ${mcpStatus.error}`
        : '';
    const mcpLiveCheckErrorDetailLabel = mcpConnectivity?.error
        ? `${mcpStatusLabel}: ${mcpLiveCheckFailedLabel} · ${mcpConnectivity.error}`
        : '';
    const mcpSummaryText = mcpStatus
        ? translateWithFallback('chat.layout.mcpEnabledSummary', `${mcpStatus.enabledServers} / ${mcpStatus.totalServers} available`, {
            enabled: mcpStatus.enabledServers,
            total: mcpStatus.totalServers,
        })
        : '';
    const mcpSummaryTargetLabel = mcpStatus?.error
        ? mcpConfigurationErrorDetailLabel
        : mcpStatus
            ? `${mcpStatusLabel}: ${mcpSummaryText}`
            : '';
    const mcpSummaryClass = mcpStatus?.error
        ? 'text-error'
        : mcpStatus?.loading
            ? 'text-warning'
            : (mcpStatus?.enabledServers ?? 0) > 0
                ? 'text-success'
                : 'text-base-content/55';
    const canCheckMcpConnectivity = Boolean(onCheckMcpConnectivity) && (mcpStatus?.enabledServers ?? 0) > 0;
    const sessionLoadMetricsLabel = translateWithFallback('chat.layout.sessionLoadMetrics', 'History load');
    const sessionLoadDetailsToggleLabel = sessionLoadMetricsExpanded
        ? translateWithFallback('chat.layout.collapseSessionLoadDetails', 'Collapse history load details')
        : translateWithFallback('chat.layout.expandSessionLoadDetails', 'Expand history load details');
    const sessionLoadSourceDetailLabel = translateWithFallback('chat.layout.sessionLoadSource', 'Source');
    const sessionLoadCacheDetailLabel = translateWithFallback('chat.layout.sessionLoadCache', 'Cache');
    const sessionLoadWindowDetailLabel = translateWithFallback('chat.layout.sessionLoadWindow', 'Window');
    const sessionLoadFullDetailLabel = translateWithFallback('chat.layout.sessionLoadFull', 'Full');
    const sessionLoadElapsedDetailLabel = translateWithFallback('chat.layout.sessionLoadElapsed', 'Elapsed');
    const getSessionLoadMapMsLabel = (ms: string) => translateWithFallback(
        'chat.layout.sessionLoadMapMs',
        `Map ${ms}`,
        {ms},
    );
    const sessionLoadStatusLabel = sessionLoadMetrics?.status === 'error'
        ? translateWithFallback('chat.layout.sessionLoadError', 'Load failed')
        : sessionLoadMetrics?.status === 'loading'
            ? translateWithFallback('chat.layout.sessionLoadLoading', 'Loading')
            : sessionLoadMetrics?.status === 'windowed'
                ? translateWithFallback('chat.layout.sessionLoadWindowed', 'Window ready')
                : translateWithFallback('chat.layout.sessionLoadComplete', 'Complete');
    const sessionLoadStatusAriaLabel = `${sessionLoadMetricsLabel}: ${sessionLoadStatusLabel}`;
    const sessionLoadErrorDetailLabel = sessionLoadMetrics?.error
        ? `${sessionLoadStatusAriaLabel} · ${sessionLoadMetrics.error}`
        : '';
    const sessionLoadStatusClass = sessionLoadMetrics?.status === 'error'
        ? 'error'
        : sessionLoadMetrics?.status === 'loading'
            ? 'pending'
            : 'completed';
    const sessionLoadSourceLabel = sessionLoadMetrics?.cacheHit
        ? translateWithFallback('chat.layout.sessionLoadCacheHit', 'Cache hit')
        : translateWithFallback('chat.layout.sessionLoadWindowFirstPaint', 'Window first paint');
    const sessionLoadSummaryText = sessionLoadMetrics
        ? [
            sessionLoadSourceLabel,
            sessionLoadMetrics.cacheHit
                ? formatMetricCount(sessionLoadMetrics.fullMessageCount)
                : `${formatMetricCount(sessionLoadMetrics.windowMessageCount)} / ${formatMetricCount(sessionLoadMetrics.totalMessageCount)}`,
            formatMetricMs(sessionLoadMetrics.elapsedMs ?? sessionLoadMetrics.windowLoadMs),
        ].join(' · ')
        : '';
    const sessionLoadSummaryTargetLabel = sessionLoadMetrics
        ? `${sessionLoadMetricsLabel}: ${sessionLoadSummaryText}`
        : '';
    const sessionLoadCardTargetLabel = sessionLoadMetrics
        ? `${sessionLoadSummaryTargetLabel} · ${sessionLoadSourceDetailLabel} · ${sessionLoadMetrics.sourcePath}`
        : '';
    const getSessionLoadDetailValueLabel = (fieldLabel: string, value: string) => (
        `${sessionLoadMetricsLabel}: ${fieldLabel} · ${value}`
    );
    const sessionLoadCacheValueText = sessionLoadMetrics
        ? [
            formatMetricCount(sessionLoadMetrics.fullMessageCount),
            formatMetricMs(sessionLoadMetrics.elapsedMs),
        ].join(' · ')
        : '';
    const sessionLoadWindowValueText = sessionLoadMetrics
        ? [
            `${formatMetricCount(sessionLoadMetrics.windowMessageCount)} / ${formatMetricCount(sessionLoadMetrics.totalMessageCount)}`,
            formatMetricMs(sessionLoadMetrics.windowLoadMs),
            getSessionLoadMapMsLabel(formatMetricMs(sessionLoadMetrics.windowMapMs)),
        ].join(' · ')
        : '';
    const sessionLoadFullValueText = sessionLoadMetrics
        ? [
            formatMetricCount(sessionLoadMetrics.fullMessageCount),
            formatMetricMs(sessionLoadMetrics.fullLoadMs),
            getSessionLoadMapMsLabel(formatMetricMs(sessionLoadMetrics.fullMapMs)),
        ].join(' · ')
        : '';
    const sessionLoadElapsedValueText = sessionLoadMetrics
        ? formatMetricMs(sessionLoadMetrics.elapsedMs)
        : '';
    const getMcpLiveStatusLabel = (status: ChatMcpLiveStatus) => {
        switch (status) {
            case 'online':
                return translateWithFallback('chat.layout.mcpLiveOnline', 'Online');
            case 'offline':
                return translateWithFallback('chat.layout.mcpLiveOffline', 'Offline');
            case 'timeout':
                return translateWithFallback('chat.layout.mcpLiveTimeout', 'Timed out');
            case 'error':
                return translateWithFallback('chat.layout.mcpLiveError', 'Error');
            case 'unknown':
            default:
                return translateWithFallback('chat.layout.mcpLiveUnknown', 'Unknown');
        }
    };
    const renderEditTreeNode = (node: EditTreeNode, depth: number): ReactNode => {
        const paddingLeft = `${6 + depth * 12}px`;

        if (node.type === 'folder') {
            const isCollapsed = collapsedFolders.has(node.key);
            const folderActionLabel = getEditFolderActionLabel(isCollapsed, node.path || node.name);
            const editStatsTargetLabel = getEditStatsTargetLabel(node.path || node.name, node.additions, node.deletions);
            return (
                <div key={node.key} className="status-edit-tree-node">
                    <button
                        type="button"
                        className="status-edit-tree-row status-edit-tree-folder"
                        style={{ paddingLeft }}
                        title={folderActionLabel}
                        aria-label={folderActionLabel}
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleFolder(node.key)}
                    >
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        {isCollapsed ? <Folder size={13} /> : <FolderOpen size={13} />}
                        <span className="min-w-0 flex-1 truncate">{node.name}</span>
                        <span
                            className="status-edit-tree-stats"
                            title={editStatsTargetLabel}
                            aria-label={editStatsTargetLabel}
                        >
                            <span className="text-success">+{node.additions}</span>
                            <span className="text-error">-{node.deletions}</span>
                        </span>
                    </button>
                    {!isCollapsed && node.children.map((child) => renderEditTreeNode(child, depth + 1))}
                </div>
            );
        }

        const edit = node.edit;
        if (!edit) return null;
        const editKey = getChatStatusEditKey(edit);
        const isSelected = selectedEditKey === editKey;
        const inspectDiffLabel = getInspectDiffLabel(isSelected, edit.displayPath);
        const openEditedFileLabel = getOpenEditedFileLabel(edit.displayPath);
        const editStatusTargetLabel = getEditStatusTargetLabel(edit);
        const editStatsTargetLabel = getEditStatsTargetLabel(edit.displayPath, edit.additions, edit.deletions);
        const previewLines = edit.diffPreviewLines.length > 0
            ? edit.diffPreviewLines
            : (editPreviewLinesByKey.get(editKey) ?? []);
        const previewId = previewLines.length > 0 ? createStatusEditPreviewId(editKey) : undefined;

        return (
            <div
                key={node.key}
                role="button"
                tabIndex={0}
                className={cn(
                    'status-edit-diff-trigger status-edit-tree-row status-edit-tree-file',
                    isSelected && 'status-edit-tree-file-selected',
                )}
                style={{ paddingLeft }}
                title={inspectDiffLabel}
                aria-label={inspectDiffLabel}
                aria-describedby={previewId}
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => handleSelectEditedFile(edit)}
                onKeyDown={(event) => handleEditedFileKeyDown(event, edit)}
            >
                <FileDiff size={12} className="status-edit-tree-file-icon" />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-base-content/70">
                        <span
                            className={`tool-state-pill ${edit.status}`}
                            title={editStatusTargetLabel}
                            aria-label={editStatusTargetLabel}
                        >
                            {getStatusLabel(edit.status)}
                        </span>
                        <span className="truncate">{node.name}</span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-base-content/40">
                        <span className="min-w-0 truncate">{edit.displayPath}</span>
                        {(edit.lineStart || edit.lineEnd) && (
                            <span className="flex-shrink-0">
                                {edit.lineStart ? `L${edit.lineStart}${edit.lineEnd && edit.lineEnd !== edit.lineStart ? `-L${edit.lineEnd}` : ''}` : ''}
                            </span>
                        )}
                    </div>
                </div>
                <div
                    className="status-edit-tree-stats"
                    title={editStatsTargetLabel}
                    aria-label={editStatsTargetLabel}
                >
                    <span className="text-success">+{edit.additions}</span>
                    <span className="text-error">-{edit.deletions}</span>
                    <button
                        type="button"
                        className="status-edit-tree-open"
                        title={openEditedFileLabel}
                        aria-label={openEditedFileLabel}
                        onClick={(event) => {
                            event.stopPropagation();
                            handleOpenEditedFile(edit.openPath, edit.lineStart, edit.lineEnd);
                        }}
                        onKeyDown={(event) => {
                            event.stopPropagation();
                        }}
                    >
                        <ExternalLink size={11} />
                    </button>
                </div>
                {previewId && (
                    <EditDiffPreview
                        id={previewId}
                        filePath={edit.displayPath}
                        additions={edit.additions}
                        deletions={edit.deletions}
                        lines={previewLines}
                        mode={activeDiffViewMode}
                        surface="status"
                    />
                )}
            </div>
        );
    };

    const diffModeButtonClass = (mode: EditDiffPreviewMode) => cn(
        'status-diff-mode-button',
        activeDiffViewMode === mode && 'active',
    );

    const renderEditToolbar = () => (
        <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1">
                <button
                    type="button"
                    className="status-edit-tree-toggle"
                    title={allFoldersCollapsed ? expandEditTreeLabel : collapseEditTreeLabel}
                    aria-label={allFoldersCollapsed ? expandEditTreeLabel : collapseEditTreeLabel}
                    onClick={toggleAllFolders}
                >
                    <FolderTree size={12} />
                </button>
            </div>
            <div className="status-diff-mode-toggle" role="group" aria-label={diffViewModeLabel}>
                <button
                    type="button"
                    className={diffModeButtonClass('unified')}
                    title={diffUnifiedViewLabel}
                    aria-label={diffUnifiedViewLabel}
                    aria-pressed={activeDiffViewMode === 'unified'}
                    onClick={() => handleDiffViewModeChange('unified')}
                >
                    <Rows3 size={12} />
                </button>
                <button
                    type="button"
                    className={diffModeButtonClass('split')}
                    title={diffSplitViewLabel}
                    aria-label={diffSplitViewLabel}
                    aria-pressed={activeDiffViewMode === 'split'}
                    onClick={() => handleDiffViewModeChange('split')}
                >
                    <Columns2 size={12} />
                    <span className="diff-mode-color-bars" aria-hidden="true">
                        <span className="diff-mode-color-bar deleted" />
                        <span className="diff-mode-color-bar added" />
                    </span>
                </button>
            </div>
        </div>
    );

    return (
        <aside className="hidden h-full min-w-0 flex-shrink-0 overflow-hidden border-l border-base-300 bg-base-100/70 p-2 xl:flex xl:flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-base-300 bg-base-200/30 p-2 text-xs text-base-content/60">
                <div className="mb-2 flex items-center gap-2 font-medium text-base-content/70">
                    <Activity size={14} />
                    <span>{statusPanelLabel}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <div className="flex items-center justify-between gap-2 col-span-2">
                        <span>{providerLabel}</span>
                        <span
                            className="status-top-provider-value font-medium text-base-content/70"
                            title={providerTargetLabel}
                            aria-label={providerTargetLabel}
                        >
                            {provider}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                        <span>{messageCountLabel}</span>
                        <span
                            className="status-top-message-count font-medium text-base-content/70"
                            title={messageCountTargetLabel}
                            aria-label={messageCountTargetLabel}
                        >
                            {messageCount}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                        <span>{anchorRailLabel}</span>
                        <span
                            className="status-top-anchor-count font-medium text-base-content/70"
                            title={anchorCountTargetLabel}
                            aria-label={anchorCountTargetLabel}
                        >
                            {anchorCount}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                        <span>{daemonLabel}</span>
                        <div className="flex min-w-0 items-center justify-end gap-1.5">
                            <span
                                className={cn('status-top-daemon-value', readyStateClass)}
                                title={daemonStatusTargetLabel}
                                aria-label={daemonStatusAriaLabel}
                            >
                                {daemonStatusText}
                            </span>
                            {showDaemonReconnect && (
                                <button
                                    type="button"
                                    className="status-daemon-reconnect"
                                    title={daemonReconnectLabel}
                                    aria-label={daemonReconnectLabel}
                                    disabled={daemonReconnecting}
                                    onClick={onReconnectDaemon}
                                >
                                    <RefreshCw size={11} className={daemonReconnecting ? 'animate-spin' : ''} />
                                </button>
                            )}
                        </div>
                    </div>
                    {daemonDiagnosticDisplayText && (
                        <div
                            className="status-daemon-diagnostic col-span-2 -mt-1 truncate text-[10px] leading-snug text-base-content/45"
                            title={daemonDiagnosticDetailLabel}
                            aria-label={daemonDiagnosticDetailLabel}
                        >
                            {daemonDiagnosticDisplayText}
                        </div>
                    )}
                    {mcpStatus && (
                        <div
                            className={cn(
                                'status-mcp-summary col-span-2 rounded-md border border-base-300/70 bg-base-100/45 px-2 py-1.5',
                                mcpDetailsExpanded && 'status-mcp-summary-expanded',
                            )}
                            title={mcpSummaryTargetLabel}
                            aria-label={mcpSummaryTargetLabel}
                        >
                            <button
                                type="button"
                                className="status-mcp-toggle flex w-full cursor-pointer items-center justify-between gap-2 text-left"
                                aria-expanded={mcpDetailsExpanded}
                                aria-label={mcpDetailsToggleLabel}
                                title={mcpDetailsToggleLabel}
                                onClick={() => setMcpExpanded((current) => !current)}
                            >
                                <div className="flex min-w-0 items-center gap-1.5">
                                    <ChevronRight size={12} className="status-mcp-chevron flex-shrink-0 text-base-content/35" />
                                    <Server size={12} className="flex-shrink-0 text-base-content/35" />
                                    <span className="text-base-content/55">{mcpStatusLabel}</span>
                                </div>
                                <div className={cn('flex min-w-0 items-center gap-1.5 font-medium', mcpSummaryClass)}>
                                    {mcpStatus.loading && <Loader2 size={11} className="flex-shrink-0 animate-spin" />}
                                    <span className="truncate">{mcpSummaryText}</span>
                                </div>
                            </button>
                            {mcpDetailsExpanded && (
                                <div className="status-mcp-details mt-2 space-y-1.5 border-t border-base-300/60 pt-1.5">
                                    {mcpStatus.error && (
                                        <div
                                            className="status-mcp-diagnostic truncate text-[10px] leading-snug text-base-content/45"
                                            title={mcpConfigurationErrorDetailLabel}
                                            aria-label={mcpConfigurationErrorDetailLabel}
                                        >
                                            {mcpStatus.error}
                                        </div>
                                    )}
                                    {mcpStatus.loading && (
                                        <div
                                            className="status-mcp-loading text-[10px] leading-snug text-base-content/45"
                                            title={mcpLoadingTargetLabel}
                                            aria-label={mcpLoadingTargetLabel}
                                        >
                                            {mcpLoadingLabel}
                                        </div>
                                    )}
                                    {onCheckMcpConnectivity && (
                                        <div className="flex items-center justify-between gap-2 rounded bg-base-200/35 px-1.5 py-1">
                                            <div
                                                className="status-mcp-check-hint min-w-0 text-[10px] leading-snug text-base-content/45"
                                                title={mcpManualHintTargetLabel}
                                                aria-label={mcpManualHintTargetLabel}
                                            >
                                                {mcpManualHintText}
                                            </div>
                                            <button
                                                type="button"
                                                className="status-mcp-check inline-flex flex-shrink-0 items-center gap-1 rounded border border-base-300/70 bg-base-100/60 px-1.5 py-0.5 text-[10px] font-medium text-base-content/60 transition-colors hover:bg-base-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                title={mcpCheckActionLabel}
                                                aria-label={mcpCheckActionLabel}
                                                disabled={!canCheckMcpConnectivity || mcpConnectivity?.checking}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onCheckMcpConnectivity?.();
                                                }}
                                            >
                                                <RefreshCw size={10} className={mcpConnectivity?.checking ? 'animate-spin' : ''} />
                                                {mcpConnectivity?.checking
                                                    ? mcpCheckingLabel
                                                    : mcpCheckLiveLabel}
                                            </button>
                                        </div>
                                    )}
                                    {mcpConnectivity?.error && (
                                        <div
                                            className="status-mcp-live-error truncate text-[10px] leading-snug text-error/80"
                                            title={mcpLiveCheckErrorDetailLabel}
                                            aria-label={mcpLiveCheckErrorDetailLabel}
                                        >
                                            {mcpConnectivity.error}
                                        </div>
                                    )}
                                    {mcpStatus.servers.length > 0 ? (
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-normal text-base-content/40">
                                                <span>{mcpConfiguredServersLabel}</span>
                                                <span
                                                    className="status-mcp-configured-server-count"
                                                    title={mcpConfiguredServersCountLabel}
                                                    aria-label={mcpConfiguredServersCountLabel}
                                                >
                                                    {mcpStatus.servers.length}
                                                </span>
                                            </div>
                                            {mcpStatus.servers.map((server) => {
                                                const liveResult = server.enabled
                                                    ? mcpConnectivity?.resultByServerId[server.id]
                                                    : undefined;
                                                const liveLatencyText = typeof liveResult?.latencyMs === 'number'
                                                    ? translateWithFallback('chat.layout.mcpLiveLatency', `${liveResult.latencyMs}ms`, {latency: liveResult.latencyMs})
                                                    : null;
                                                const liveDetailText = [liveResult?.message, liveLatencyText].filter(Boolean).join(' · ') || undefined;
                                                const liveStatusLabel = liveResult
                                                    ? getMcpLiveStatusLabel(liveResult.status)
                                                    : null;
                                                const liveStatusTargetLabel = liveStatusLabel
                                                    ? getMcpServerStateLabel(server.name, liveStatusLabel, liveDetailText)
                                                    : undefined;
                                                const serverEnabledStatusLabel = getMcpServerStateLabel(
                                                    server.name,
                                                    server.enabled ? mcpEnabledLabel : mcpDisabledLabel,
                                                );
                                                const serverNameLabel = getMcpServerNameLabel(server.name);
                                                const serverTransportLabel = server.transport
                                                    ? getMcpServerTransportLabel(server.name, server.transport)
                                                    : null;

                                                return (
                                                    <div key={server.id} className="flex min-w-0 items-center justify-between gap-2 rounded bg-base-200/45 px-1.5 py-1">
                                                        <div className="min-w-0">
                                                            <div
                                                                className="truncate text-[11px] font-medium text-base-content/70"
                                                                title={serverNameLabel}
                                                                aria-label={serverNameLabel}
                                                            >
                                                                {server.name}
                                                            </div>
                                                            <div className="flex min-w-0 items-center gap-1.5 truncate text-[10px] text-base-content/40">
                                                                {server.transport && (
                                                                    <span
                                                                        className="truncate"
                                                                        title={serverTransportLabel ?? undefined}
                                                                        aria-label={serverTransportLabel ?? undefined}
                                                                    >
                                                                        {server.transport}
                                                                    </span>
                                                                )}
                                                                {liveLatencyText && <span className="flex-shrink-0" aria-hidden="true">{liveLatencyText}</span>}
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-shrink-0 items-center gap-1">
                                                            {liveResult && (
                                                                <span
                                                                    className={cn(
                                                                        'status-mcp-live-result tool-state-pill',
                                                                        getMcpLiveStatusClass(liveResult.status),
                                                                    )}
                                                                    title={liveStatusTargetLabel}
                                                                    aria-label={liveStatusTargetLabel}
                                                                >
                                                                    {liveStatusLabel}
                                                                </span>
                                                            )}
                                                            <span
                                                                className={cn('tool-state-pill', server.enabled ? 'completed' : 'pending')}
                                                                title={serverEnabledStatusLabel}
                                                                aria-label={serverEnabledStatusLabel}
                                                            >
                                                                {server.enabled ? mcpEnabledLabel : mcpDisabledLabel}
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div
                                            className="status-mcp-empty text-[10px] leading-snug text-base-content/45"
                                            title={mcpNoServersTargetLabel}
                                            aria-label={mcpNoServersTargetLabel}
                                        >
                                            {mcpNoServersLabel}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {sessionLoadMetrics && (
                        <div
                            className={cn(
                                'status-session-load-metrics col-span-2 rounded-md border border-base-300/70 bg-base-100/45 px-2 py-1.5',
                                sessionLoadMetricsExpanded && 'status-session-load-metrics-expanded',
                            )}
                            title={sessionLoadCardTargetLabel}
                            aria-label={sessionLoadCardTargetLabel}
                        >
                            <button
                                type="button"
                                className="status-session-load-toggle flex w-full cursor-pointer items-center justify-between gap-2 text-left"
                                aria-expanded={sessionLoadMetricsExpanded}
                                aria-label={sessionLoadDetailsToggleLabel}
                                title={sessionLoadDetailsToggleLabel}
                                onClick={toggleSessionLoadMetrics}
                            >
                                <div className="flex min-w-0 items-center gap-1.5">
                                    {sessionLoadMetricsExpanded ? (
                                        <ChevronDown size={12} className="flex-shrink-0 text-base-content/35" />
                                    ) : (
                                        <ChevronRight size={12} className="flex-shrink-0 text-base-content/35" />
                                    )}
                                    <Activity size={12} className="flex-shrink-0 text-base-content/35" />
                                    <span className="truncate text-base-content/55">
                                        {sessionLoadMetricsLabel}
                                    </span>
                                </div>
                                <div className="flex min-w-0 items-center justify-end gap-1.5">
                                    <span
                                        className="min-w-0 truncate text-right text-[10px] font-medium text-base-content/55"
                                        title={sessionLoadSummaryTargetLabel}
                                        aria-label={sessionLoadSummaryTargetLabel}
                                    >
                                        {sessionLoadSummaryText}
                                    </span>
                                    <span
                                        className={cn('tool-state-pill', sessionLoadStatusClass)}
                                        title={sessionLoadStatusAriaLabel}
                                        aria-label={sessionLoadStatusAriaLabel}
                                    >
                                        {sessionLoadStatusLabel}
                                    </span>
                                </div>
                            </button>
                            {sessionLoadMetricsExpanded && (
                                <div className="status-session-load-details mt-2 space-y-1 border-t border-base-300/60 pt-1.5 text-[10px] leading-snug text-base-content/50">
                                    <div className="flex items-center justify-between gap-2">
                                        <span>{sessionLoadSourceDetailLabel}</span>
                                        <span
                                            className="truncate text-right font-medium text-base-content/65"
                                            title={getSessionLoadDetailValueLabel(sessionLoadSourceDetailLabel, sessionLoadSourceLabel)}
                                            aria-label={getSessionLoadDetailValueLabel(sessionLoadSourceDetailLabel, sessionLoadSourceLabel)}
                                        >
                                            {sessionLoadSourceLabel}
                                        </span>
                                    </div>
                                    {sessionLoadMetrics.cacheHit ? (
                                        <div className="flex items-center justify-between gap-2">
                                            <span>{sessionLoadCacheDetailLabel}</span>
                                            <span
                                                className="truncate text-right font-medium text-base-content/65"
                                                title={getSessionLoadDetailValueLabel(sessionLoadCacheDetailLabel, sessionLoadCacheValueText)}
                                                aria-label={getSessionLoadDetailValueLabel(sessionLoadCacheDetailLabel, sessionLoadCacheValueText)}
                                            >
                                                {sessionLoadCacheValueText}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between gap-2">
                                            <span>{sessionLoadWindowDetailLabel}</span>
                                            <span
                                                className="truncate text-right font-medium text-base-content/65"
                                                title={getSessionLoadDetailValueLabel(sessionLoadWindowDetailLabel, sessionLoadWindowValueText)}
                                                aria-label={getSessionLoadDetailValueLabel(sessionLoadWindowDetailLabel, sessionLoadWindowValueText)}
                                            >
                                                {sessionLoadWindowValueText}
                                            </span>
                                        </div>
                                    )}
                                    {!sessionLoadMetrics.cacheHit && sessionLoadMetrics.fullLoadMs !== null && (
                                        <div className="flex items-center justify-between gap-2">
                                            <span>{sessionLoadFullDetailLabel}</span>
                                            <span
                                                className="truncate text-right font-medium text-base-content/65"
                                                title={getSessionLoadDetailValueLabel(sessionLoadFullDetailLabel, sessionLoadFullValueText)}
                                                aria-label={getSessionLoadDetailValueLabel(sessionLoadFullDetailLabel, sessionLoadFullValueText)}
                                            >
                                                {sessionLoadFullValueText}
                                            </span>
                                        </div>
                                    )}
                                    {!sessionLoadMetrics.cacheHit && sessionLoadMetrics.elapsedMs !== null && (
                                        <div className="flex items-center justify-between gap-2">
                                            <span>{sessionLoadElapsedDetailLabel}</span>
                                            <span
                                                className="font-medium text-base-content/65"
                                                title={getSessionLoadDetailValueLabel(sessionLoadElapsedDetailLabel, sessionLoadElapsedValueText)}
                                                aria-label={getSessionLoadDetailValueLabel(sessionLoadElapsedDetailLabel, sessionLoadElapsedValueText)}
                                            >
                                                {sessionLoadElapsedValueText}
                                            </span>
                                        </div>
                                    )}
                                    {sessionLoadMetrics.error && (
                                        <div
                                            className="truncate text-error/80"
                                            title={sessionLoadErrorDetailLabel}
                                            aria-label={sessionLoadErrorDetailLabel}
                                        >
                                            {sessionLoadMetrics.error}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {hasRuntimeContext && (
                    <div className="status-runtime-context mt-2 rounded-md border border-base-300/70 bg-base-100/45 p-2">
                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-normal text-base-content/45">
                            <SlidersHorizontal size={12} />
                            <span>{runtimeContextLabel}</span>
                        </div>
                        <div className="status-runtime-context-grid grid grid-cols-2 gap-1.5">
                            {modelLabel && (
                                <div className="status-runtime-context-item min-w-0 rounded bg-base-200/35 px-1.5 py-1">
                                    <div className="truncate text-[9px] uppercase tracking-normal text-base-content/40">
                                        {modelContextLabel}
                                    </div>
                                    <div
                                        className="status-runtime-context-value min-w-0 truncate text-[11px] font-medium leading-tight text-base-content/70"
                                        title={getRuntimeContextValueLabel(modelContextLabel, modelLabel)}
                                        aria-label={getRuntimeContextValueLabel(modelContextLabel, modelLabel)}
                                    >
                                        {modelLabel}
                                    </div>
                                </div>
                            )}
                            {permissionModeLabel && (
                                <div className="status-runtime-context-item min-w-0 rounded bg-base-200/35 px-1.5 py-1">
                                    <div className="truncate text-[9px] uppercase tracking-normal text-base-content/40">
                                        {permissionModeContextLabel}
                                    </div>
                                    <div
                                        className="status-runtime-context-value min-w-0 truncate text-[11px] font-medium leading-tight text-base-content/70"
                                        title={getRuntimeContextValueLabel(permissionModeContextLabel, permissionModeLabel)}
                                        aria-label={getRuntimeContextValueLabel(permissionModeContextLabel, permissionModeLabel)}
                                    >
                                        {permissionModeLabel}
                                    </div>
                                </div>
                            )}
                            {reasoningLabel && (
                                <div className="status-runtime-context-item min-w-0 rounded bg-base-200/35 px-1.5 py-1">
                                    <div className="truncate text-[9px] uppercase tracking-normal text-base-content/40">
                                        {reasoningContextLabel}
                                    </div>
                                    <div
                                        className="status-runtime-context-value min-w-0 truncate text-[11px] font-medium leading-tight text-base-content/70"
                                        title={getRuntimeContextValueLabel(reasoningContextLabel, reasoningLabel)}
                                        aria-label={getRuntimeContextValueLabel(reasoningContextLabel, reasoningLabel)}
                                    >
                                        {reasoningLabel}
                                    </div>
                                </div>
                            )}
                            {workspaceLabel && (
                                <div className="status-runtime-context-item min-w-0 rounded bg-base-200/35 px-1.5 py-1">
                                    <div className="truncate text-[9px] uppercase tracking-normal text-base-content/40">
                                        {workspaceContextLabel}
                                    </div>
                                    <div
                                        className="status-runtime-context-value min-w-0 truncate text-[11px] font-medium leading-tight text-base-content/70"
                                        title={getRuntimeContextValueLabel(workspaceContextLabel, workspaceLabel)}
                                        aria-label={getRuntimeContextValueLabel(workspaceContextLabel, workspaceLabel)}
                                    >
                                        {workspaceLabel}
                                    </div>
                                </div>
                            )}
                            {sdkStatus && (
                                <div className="status-runtime-context-item min-w-0 rounded bg-base-200/35 px-1.5 py-1">
                                    <div className="truncate text-[9px] uppercase tracking-normal text-base-content/40">
                                        {sdkStatusLabel}
                                    </div>
                                    <div
                                        className={cn(
                                            'status-runtime-context-value min-w-0 truncate text-[11px] font-medium leading-tight',
                                            sdkStatus.installed ? 'text-success' : 'text-error',
                                        )}
                                        title={getRuntimeContextValueLabel(sdkStatusLabel, sdkStatus.path || sdkStatus.displayName)}
                                        aria-label={getRuntimeContextValueLabel(sdkStatusLabel, sdkStatusValueLabel)}
                                    >
                                        {sdkStatusValueLabel}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="mt-3 space-y-3">
                    {shouldShowCurrentActivityCard && (
                        <div className="rounded-md border border-base-300/70 bg-base-100/65 p-2">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-1.5 text-[10px] uppercase tracking-normal text-base-content/45">
                                    <Sparkles size={12} className="flex-shrink-0" />
                                    <span className="truncate">{currentActivityLabel}</span>
                                </div>
                                {hasActivityToolCounts && (
                                    <div className="status-activity-tool-counts flex flex-shrink-0 items-center gap-1">
                                        {pendingToolCount > 0 && (
                                            <span
                                                className="status-activity-tool-count pending tool-state-pill"
                                                title={pendingToolCountLabel}
                                                aria-label={pendingToolCountLabel}
                                            >
                                                {pendingToolCount}
                                            </span>
                                        )}
                                        {errorToolCount > 0 && (
                                            <span
                                                className="status-activity-tool-count error tool-state-pill"
                                                title={errorToolCountLabel}
                                                aria-label={errorToolCountLabel}
                                            >
                                                {errorToolCount}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {activeTool ? (
                                <div className="space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`tool-command-chip ${activeTool.accentClass}`}>
                                                    {activeTool.label}
                                                </span>
                                                <span
                                                    className={`tool-state-pill ${activeTool.status}`}
                                                    title={getToolStatusTargetLabel(activeTool)}
                                                    aria-label={getToolStatusTargetLabel(activeTool)}
                                                >
                                                    {getToolStatusLabel(activeTool.status)}
                                                </span>
                                            </div>
                                            <div
                                                className="truncate text-[12px] font-medium text-base-content/75"
                                                title={getToolSummaryTargetLabel(activeTool)}
                                                aria-label={getToolSummaryTargetLabel(activeTool)}
                                            >
                                                {activeTool.summary}
                                            </div>
                                        </div>
                                        {renderToolStatusIcon(activeTool.status)}
                                    </div>
                                    {activeTool.detail && (
                                        <div
                                            className="text-[11px] leading-tight text-base-content/50"
                                            title={getToolDetailTargetLabel(activeTool)}
                                            aria-label={getToolDetailTargetLabel(activeTool)}
                                        >
                                            {activeTool.detail}
                                        </div>
                                    )}
                                </div>
                            ) : isStreaming ? (
                                <div className="flex items-center gap-2 text-[11px] text-base-content/50">
                                    <Loader2 size={13} className="animate-spin text-success/75" />
                                    <span>{streamingReplyLabel}</span>
                                </div>
                            ) : !hasActivityTasks && !hasActivitySubagents && (
                                <div className="flex items-center gap-2 text-[11px] text-base-content/50">
                                    <span className="h-1.5 w-1.5 rounded-full bg-base-content/30" />
                                    <span>{idleActivityLabel}</span>
                                </div>
                            )}

                            {(hasActivityTasks || hasActivitySubagents) && (
                                <div
                                    className="status-activity-scroll-region mt-2 max-h-64 min-h-0 space-y-2 overflow-y-auto overscroll-contain pr-1 focus:outline-none focus:ring-2 focus:ring-primary/25"
                                    role="region"
                                    tabIndex={0}
                                    aria-label={activityHistoryRegionLabel}
                                >
                                    {hasActivityTasks && (
                                        <div className="status-activity-task-list space-y-1.5 border-t border-base-300/60 pt-1.5">
                                            <div className="flex items-center justify-between gap-2 px-1 text-[10px] uppercase tracking-normal text-base-content/40">
                                                <span>{inputStatusTasksLabel}</span>
                                                <span
                                                    className="status-activity-task-ratio"
                                                    title={activityTaskRatioLabel}
                                                    aria-label={activityTaskRatioLabel}
                                                >
                                                    {recentActivityTasks.length} / {activityTasks.length}
                                                </span>
                                            </div>
                                            {recentActivityTasks.map(renderActivityTaskRow)}
                                            {hiddenActivityTaskCount > 0 && (
                                                <div
                                                    className="status-activity-task-hidden-count px-1 text-[10px] text-base-content/40"
                                                    title={hiddenActivityTaskLabel}
                                                    aria-label={hiddenActivityTaskLabel}
                                                >
                                                    {hiddenActivityTaskLabel}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {hasActivitySubagents && (
                                        <div className="status-activity-subagent-list space-y-1.5 border-t border-base-300/60 pt-1.5">
                                            <div className="flex items-center justify-between gap-2 px-1 text-[10px] uppercase tracking-normal text-base-content/40">
                                                <span className="inline-flex min-w-0 items-center gap-1">
                                                    <Bot size={11} className="flex-shrink-0" />
                                                    <span className="truncate">{inputStatusSubagentsLabel}</span>
                                                </span>
                                                <span
                                                    className="status-activity-subagent-ratio"
                                                    title={activitySubagentRatioLabel}
                                                    aria-label={activitySubagentRatioLabel}
                                                >
                                                    {recentActivitySubagents.length} / {activitySubagents.length}
                                                </span>
                                            </div>
                                            {recentActivitySubagents.map(renderActivityTaskRow)}
                                            {hiddenActivitySubagentCount > 0 && (
                                                <div
                                                    className="status-activity-subagent-hidden-count px-1 text-[10px] text-base-content/40"
                                                    title={hiddenActivitySubagentLabel}
                                                    aria-label={hiddenActivitySubagentLabel}
                                                >
                                                    {hiddenActivitySubagentLabel}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {showEdits && shouldShowRecentEditsCard && (
                        <div className="rounded-md border border-base-300/70 bg-base-100/65 p-2">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-normal text-base-content/45">
                                    <FilePenLine size={12} />
                                    <span>{recentEditsLabel}</span>
                                </div>
                                <div className="flex min-w-0 items-center justify-end gap-1.5">
                                    <div
                                        className="max-w-[9rem] truncate text-right text-[10px] text-base-content/45"
                                        title={editSummaryLabel}
                                        aria-label={editSummaryLabel}
                                    >
                                        {editSummaryLabel}
                                    </div>
                                    {canReopenDiffPane && (
                                        <button
                                            type="button"
                                            className="status-edit-tree-toggle status-diff-pane-reopen status-diff-pane-reopen-header"
                                            title={reopenDiffPaneLabel}
                                            aria-label={reopenDiffPaneLabel}
                                            onClick={onOpenDiffPanel}
                                        >
                                            <PanelRightOpen size={12} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {visibleEdits.length > 0 && (
                                <div className="space-y-1.5">
                                    {renderEditToolbar()}
                                    <div className={cn(
                                        'status-edit-tree-scroll',
                                        showAllEdits && 'status-edit-tree-scroll-expanded',
                                    )}>
                                        {editTree.map((node) => renderEditTreeNode(node, 0))}
                                    </div>
                                    {hiddenEditCount > 0 && (
                                        <button
                                            type="button"
                                            className="w-full rounded-md border border-dashed border-base-300/70 bg-base-100/35 px-2 py-1.5 text-left text-[10px] text-base-content/45 transition-colors hover:bg-base-100/70"
                                            title={hiddenEditFilesActionLabel}
                                            aria-label={hiddenEditFilesActionLabel}
                                            onClick={() => setShowAllEdits((value) => !value)}
                                        >
                                            {hiddenEditFilesActionLabel}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {activeAnchorLabel && (
                        <div
                            className="rounded-md border border-base-300/70 bg-base-100/60 p-2"
                            title={activeAnchorTargetLabel}
                            aria-label={activeAnchorTargetLabel}
                        >
                            <div className="mb-1 flex items-center gap-1 text-[10px] text-base-content/45">
                                <span className="h-1.5 w-1.5 rounded-full bg-success/70" />
                                <span>{currentAnchorLabel}</span>
                            </div>
                            <div
                                className="status-active-anchor-value text-[11px] leading-tight text-base-content/60"
                                title={activeAnchorTargetLabel}
                                aria-label={activeAnchorTargetLabel}
                            >
                                {activeAnchorLabel}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
}
