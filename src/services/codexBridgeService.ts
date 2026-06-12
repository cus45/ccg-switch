import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
    ApprovalResponseInput,
    CodexConfigSummary,
    CodexMcpServerStatus,
    CodexModelInfo,
    ConversationEvent,
    ConversationThread,
    ConversationThreadSnapshot,
    ConversationTurn,
    ThreadResumeInput,
    ThreadStartInput,
    TurnStartInput,
} from '../types/conversation';

export const CODEX_CONVERSATION_EVENT = 'codex://conversation-event';

export async function readCodexConfig(workspaceId?: string): Promise<CodexConfigSummary> {
    return await invoke<CodexConfigSummary>('codex_config_read', { workspaceId });
}

export async function listCodexModels(providerId?: string): Promise<CodexModelInfo[]> {
    return await invoke<CodexModelInfo[]>('codex_model_list', { providerId });
}

export async function startCodexThread(input: ThreadStartInput): Promise<ConversationThread> {
    return await invoke<ConversationThread>('codex_thread_start', { input });
}

export async function resumeCodexThread(input: ThreadResumeInput): Promise<ConversationThread> {
    return await invoke<ConversationThread>('codex_thread_resume', { input });
}

export async function startCodexTurn(input: TurnStartInput): Promise<ConversationTurn> {
    return await invoke<ConversationTurn>('codex_turn_start', { input });
}

export async function interruptCodexTurn(threadId: string, turnId: string): Promise<void> {
    await invoke('codex_turn_interrupt', { threadId, turnId });
}

export async function readCodexThread(threadId: string): Promise<ConversationThreadSnapshot> {
    return await invoke<ConversationThreadSnapshot>('codex_thread_read', { threadId });
}

export async function listCodexMcpServerStatus(
    workspaceId?: string
): Promise<CodexMcpServerStatus[]> {
    return await invoke<CodexMcpServerStatus[]>('codex_mcp_server_status_list', { workspaceId });
}

export async function respondCodexApproval(input: ApprovalResponseInput): Promise<void> {
    await invoke('codex_approval_respond', { input });
}

export async function listenCodexConversationEvents(
    handler: (event: ConversationEvent) => void
): Promise<() => void> {
    return await listen<ConversationEvent>(CODEX_CONVERSATION_EVENT, (event) => {
        handler(event.payload);
    });
}
