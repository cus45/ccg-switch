// 交互式 Chat 类型定义（对接 Rust chat_commands + ai-bridge daemon）

/** 消息角色 */
export type ChatRole = 'user' | 'assistant' | 'system';

/** 一条聊天消息 */
export interface ChatMessage {
    id: string;
    role: ChatRole;
    /** 已渲染的文本内容（流式累积） */
    content: string;
    /** 结构化数据（来自 [MESSAGE] 标签） */
    raw?: MessageRaw;
    /** 是否仍在流式输出中 */
    streaming?: boolean;
    /** 出错信息（如有） */
    error?: string;
    createdAt: number;
    /** 本轮耗时（毫秒），流式结束时记录（仅 assistant） */
    durationMs?: number;
    /** 本轮 token 用量（来自 [USAGE] 标签，仅 assistant） */
    usage?: TokenUsage;
    /** 上下文压缩分隔标记（role==='system' 时有效，渲染为转录分隔条） */
    compact?: CompactBoundaryInfo;
}

/** 上下文压缩（compact boundary）信息 */
export interface CompactBoundaryInfo {
    /** 'auto'（达到阈值自动压缩）| 'manual'（/compact 手动触发） */
    trigger: string;
    /** 压缩前的上下文 token 数 */
    preTokens?: number;
}

/** 用户输入区附件。图片附件使用 base64 数据传给 bridge，必要时由 bridge 落盘。 */
export interface ChatAttachment {
    fileName: string;
    mediaType: string;
    data?: string;
    path?: string;
    size?: number;
}

/** 忙时排队的待发消息（回合结束后自动按序发送） */
export interface QueuedChatMessage {
    id: string;
    text: string;
    attachments?: ChatAttachment[];
    queuedAt: number;
}

/** Token 用量（对应 daemon [USAGE] 标签的 JSON） */
export interface TokenUsage {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    /** 当前会话上下文窗口上限（由 sidecar 按 1M/200K 状态推送，可缺省） */
    max_tokens?: number;
}

/** MESSAGE 标签的完整结构 */
export interface MessageRaw {
    type: 'user' | 'assistant' | 'system';
    message: {
        content: ContentBlock[];
    };
    uuid?: string;
    timestamp?: string;
    /** 非空表示这是子代理(sidechain)消息,指向父 Task 工具块的 tool_use id。 */
    parent_tool_use_id?: string | null;
    /** system 消息子类型（init / compact_boundary / status …） */
    subtype?: string;
    /** subtype==='compact_boundary' 时的压缩元数据 */
    compact_metadata?: {
        trigger?: string;
        pre_tokens?: number;
    };
    /** 上下文压缩后自动注入的续接摘要消息（Claude Code 生成） */
    isCompactSummary?: boolean;
}

/** 内容块联合类型 */
export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

export interface TextBlock {
    type: 'text';
    text: string;
}

export interface ImageSource {
    type?: string;
    media_type?: string;
    mediaType?: string;
    data?: string;
    url?: string;
    path?: string;
}

export interface ImageBlock {
    type: 'image' | 'input_image';
    source?: ImageSource;
    media_type?: string;
    mediaType?: string;
    data?: string;
    url?: string;
    path?: string;
    image_url?: string | {
        url?: string;
        path?: string;
        detail?: string;
    };
    fileName?: string;
    name?: string;
}

export interface ToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export interface ToolResultBlock {
    type: 'tool_result';
    tool_use_id: string;
    content?: string | ContentBlock[];
    is_error?: boolean;
}

export interface ThinkingBlock {
    type: 'thinking';
    thinking: string;
}

/** 后端 "chat://stream" 事件载荷 */
export interface ChatStreamEvent {
    requestId: string;
    kind: 'line' | 'stderr';
    text: string;
}

/** 后端 "chat://done" 事件载荷 */
export interface ChatDoneEvent {
    requestId: string;
    success: boolean;
    error?: string | null;
}

/** 后端 "chat://message" 事件载荷，包含结构化 raw 消息。 */
export interface ChatMessageEvent {
    requestId: string;
    json: string;
}

/**
 * 后端 "chat://subagent-message" 事件载荷。子代理(Task)消息从主流里分流到此，
 * 按 parentToolUseId(= 父 Task 工具块 id)路由到对应的子代理卡片。
 */
export interface SubagentMessageEvent {
    requestId: string;
    parentToolUseId: string;
    json: string;
}

/** 后端 "chat://daemon" 生命周期事件载荷 */
export interface ChatDaemonEvent {
    event: string;
    pid?: number | null;
    message?: string | null;
    provider?: string | null;
}

/** 一条 daemon 诊断日志（debug 模式查看，来自 "chat://daemon" 事件） */
export interface DaemonLogEntry {
    id: number;
    timestamp: number;
    event: string;
    message: string | null;
    provider: string | null;
}

/** Provider 选择 */
export type ChatProvider = 'claude' | 'codex';

/** SDK 安装状态（对应 Rust SdkStatus） */
export interface SdkStatus {
    id: string;
    displayName: string;
    installed: boolean;
    path: string;
    currentVersion?: string | null;
    defaultVersion: string;
    latestVersion?: string | null;
    availableVersions: string[];
}

/** "chat://sdk-install-log" 事件载荷 */
export interface SdkInstallLogEvent {
    sdkId: string;
    line: string;
}

/** "chat://sdk-install-done" 事件载荷 */
export interface SdkInstallDoneEvent {
    sdkId: string;
    success: boolean;
    error?: string | null;
}

/** Node.js runtime 状态（对应 Rust NodeRuntimeStatus） */
export interface NodeRuntimeStatus {
    installed: boolean;
    nodePath?: string | null;
    npmPath?: string | null;
    version: string;
    installDir: string;
    source: 'private' | 'system' | 'missing' | string;
}

/** "chat://node-runtime-install-log" 事件载荷 */
export interface NodeRuntimeInstallLogEvent {
    line: string;
}

/** "chat://node-runtime-install-done" 事件载荷 */
export interface NodeRuntimeInstallDoneEvent {
    success: boolean;
    error?: string | null;
    status?: NodeRuntimeStatus | null;
}
