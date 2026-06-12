export type ConversationThreadStatus =
    | 'idle'
    | 'running'
    | 'interrupted'
    | 'completed'
    | 'failed';

export type ConversationTurnStatus =
    | 'queued'
    | 'running'
    | 'waiting_approval'
    | 'interrupted'
    | 'completed'
    | 'failed';

export type ConversationRole = 'user' | 'assistant' | 'system' | 'tool';

export type ConversationItemType =
    | 'message'
    | 'reasoning'
    | 'command'
    | 'file_change'
    | 'mcp_tool'
    | 'approval'
    | 'error'
    | 'raw';

export type ConversationItemStatus = 'pending' | 'running' | 'completed' | 'failed';

export type ConversationEventType =
    | 'thread_started'
    | 'thread_resumed'
    | 'turn_started'
    | 'turn_interrupted'
    | 'turn_completed'
    | 'turn_failed'
    | 'item_started'
    | 'item_delta'
    | 'item_completed'
    | 'approval_requested'
    | 'approval_resolved';

export type ApprovalRequestType = 'command' | 'file_change' | 'mcp_tool' | 'user_input';
export type ApprovalDecision = 'approved' | 'denied';
export type CodexMcpServerState = 'unknown' | 'connected' | 'disconnected' | 'error';

export interface ThreadStartInput {
    workspaceId?: string;
    cwd: string;
    model?: string;
    providerId?: string;
    approvalPolicy?: string;
    sandboxPolicy?: string;
    metadata?: Record<string, unknown>;
}

export interface ThreadResumeInput {
    threadId: string;
    workspaceId?: string;
    cwd?: string;
    sourcePath?: string;
    metadata?: Record<string, unknown>;
}

export interface TurnStartInput {
    threadId: string;
    prompt: string;
    model?: string;
    approvalPolicy?: string;
    sandboxPolicy?: string;
    metadata?: Record<string, unknown>;
}

export interface ApprovalResponseInput {
    approvalId: string;
    decision: ApprovalDecision;
    message?: string;
    metadata?: Record<string, unknown>;
}

export interface ConversationThread {
    id: string;
    workspaceId?: string;
    cwd: string;
    title?: string;
    status: ConversationThreadStatus;
    createdAt: number;
    updatedAt: number;
}

export interface ConversationTurn {
    id: string;
    threadId: string;
    status: ConversationTurnStatus;
    createdAt: number;
    completedAt?: number;
}

export interface ConversationItem {
    id: string;
    threadId: string;
    turnId?: string;
    itemType: ConversationItemType;
    role?: ConversationRole;
    status: ConversationItemStatus;
    content?: string;
    summary?: string;
    metadata: Record<string, unknown>;
    createdAt: number;
    completedAt?: number;
}

export interface ApprovalRequest {
    id: string;
    threadId: string;
    turnId?: string;
    itemId?: string;
    requestType: ApprovalRequestType;
    title: string;
    body?: string;
    command?: string;
    cwd?: string;
    toolName?: string;
    metadata: Record<string, unknown>;
    createdAt: number;
}

export interface ConversationEvent {
    id: string;
    threadId: string;
    turnId?: string;
    approvalId?: string;
    eventType: ConversationEventType;
    item?: ConversationItem;
    approvalRequest?: ApprovalRequest;
    delta?: string;
    metadata: Record<string, unknown>;
    createdAt: number;
}

export interface ConversationThreadSnapshot {
    thread: ConversationThread;
    items: ConversationItem[];
    pendingApprovals: ApprovalRequest[];
}

export interface CodexConfigSummary {
    workspaceId?: string;
    codexHome?: string;
    configPath?: string;
    configExists: boolean;
    model?: string;
    providerId?: string;
    approvalPolicy?: string;
    sandboxPolicy?: string;
    metadata: Record<string, unknown>;
}

export interface CodexModelInfo {
    id: string;
    name: string;
    providerId?: string;
    supportsReasoning: boolean;
    supportsTools: boolean;
}

export interface CodexMcpServerStatus {
    serverId: string;
    name: string;
    state: CodexMcpServerState;
    message?: string;
}
