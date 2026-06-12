import { create } from 'zustand';
import type {
    ApprovalRequest,
    ConversationEvent,
    ConversationItem,
    ConversationItemStatus,
    ConversationThread,
    ConversationThreadSnapshot,
    ConversationThreadStatus,
} from '../types/conversation';

export interface ConversationStreamingState {
    threadId: string;
    turnId?: string;
    itemId?: string;
    active: boolean;
    startedAt: number;
    updatedAt: number;
}

export interface ConversationRuntimeState {
    threads: Record<string, ConversationThread>;
    threadOrder: string[];
    activeThreadId: string | null;
    items: Record<string, ConversationItem[]>;
    pendingApprovals: Record<string, ApprovalRequest>;
    streaming: Record<string, ConversationStreamingState>;
    errorsByThread: Record<string, string>;
    error: string | null;
}

interface ConversationStore extends ConversationRuntimeState {
    setActiveThread: (threadId: string | null) => void;
    upsertThread: (thread: ConversationThread) => void;
    loadSnapshot: (snapshot: ConversationThreadSnapshot) => void;
    applyEvent: (event: ConversationEvent) => void;
    applyEvents: (events: ConversationEvent[]) => void;
    resolveApproval: (approvalId: string) => void;
    interruptThread: (threadId: string) => void;
    resetThread: (threadId: string) => void;
    reset: () => void;
    clearError: () => void;
}

export function createEmptyConversationState(): ConversationRuntimeState {
    return {
        threads: {},
        threadOrder: [],
        activeThreadId: null,
        items: {},
        pendingApprovals: {},
        streaming: {},
        errorsByThread: {},
        error: null,
    };
}

export function reduceConversationEvent(
    state: ConversationRuntimeState,
    event: ConversationEvent
): ConversationRuntimeState {
    const next = cloneRuntimeState(state);
    const status = threadStatusForEvent(event);
    ensureThread(next, event, status);

    switch (event.eventType) {
        case 'thread_started':
        case 'thread_resumed':
            next.activeThreadId = event.threadId;
            delete next.errorsByThread[event.threadId];
            return next;

        case 'turn_started':
            next.activeThreadId = event.threadId;
            delete next.errorsByThread[event.threadId];
            next.streaming[event.threadId] = {
                threadId: event.threadId,
                turnId: event.turnId,
                active: true,
                startedAt: event.createdAt,
                updatedAt: event.createdAt,
            };
            return next;

        case 'item_started':
            if (event.item) {
                upsertItem(next, { ...event.item, status: 'running' });
                updateStreamingItem(next, event, event.item.id);
            }
            return next;

        case 'item_delta':
            appendItemDelta(next, event);
            return next;

        case 'item_completed':
            if (event.item) {
                upsertItem(next, {
                    ...event.item,
                    status: event.item.status === 'failed' ? 'failed' : 'completed',
                    completedAt: event.item.completedAt ?? event.createdAt,
                });
                clearStreamingItem(next, event, event.item.id);
            } else {
                const itemId = resolveItemId(next, event);
                completeItemById(next, event, itemId, 'completed');
                clearStreamingItem(next, event, itemId);
            }
            return next;

        case 'approval_requested':
            if (event.item) {
                upsertItem(next, event.item);
            }
            if (event.approvalRequest) {
                next.pendingApprovals[event.approvalRequest.id] = event.approvalRequest;
                updateThread(next, event.threadId, 'running', event.createdAt);
            }
            return next;

        case 'approval_resolved':
            removeApproval(next, resolveApprovalId(event));
            return next;

        case 'turn_completed':
            completeRunningItems(next, event.threadId, event.turnId, event.createdAt);
            delete next.streaming[event.threadId];
            updateThread(next, event.threadId, 'idle', event.createdAt);
            return next;

        case 'turn_interrupted':
            settleRunningItems(next, event.threadId, event.turnId, event.createdAt, 'failed');
            delete next.streaming[event.threadId];
            removeApprovalsByThread(next, event.threadId);
            updateThread(next, event.threadId, 'interrupted', event.createdAt);
            return next;

        case 'turn_failed':
            settleRunningItems(next, event.threadId, event.turnId, event.createdAt, 'failed');
            delete next.streaming[event.threadId];
            removeApprovalsByThread(next, event.threadId);
            updateThread(next, event.threadId, 'failed', event.createdAt);
            next.error = event.delta ?? metadataString(event.metadata, 'message') ?? 'Conversation turn failed';
            next.errorsByThread[event.threadId] = next.error;
            return next;

        default:
            return next;
    }
}

export function loadConversationSnapshot(
    state: ConversationRuntimeState,
    snapshot: ConversationThreadSnapshot
): ConversationRuntimeState {
    const next = cloneRuntimeState(state);
    next.threads[snapshot.thread.id] = snapshot.thread;
    next.threadOrder = addThreadToOrder(next.threadOrder, snapshot.thread.id);
    next.items[snapshot.thread.id] = sortItems(snapshot.items);
    next.activeThreadId = snapshot.thread.id;
    delete next.errorsByThread[snapshot.thread.id];

    removeApprovalsByThread(next, snapshot.thread.id);
    for (const approval of snapshot.pendingApprovals) {
        next.pendingApprovals[approval.id] = approval;
    }

    if (snapshot.thread.status === 'running') {
        next.streaming[snapshot.thread.id] = {
            threadId: snapshot.thread.id,
            active: true,
            startedAt: snapshot.thread.updatedAt,
            updatedAt: snapshot.thread.updatedAt,
        };
    } else {
        delete next.streaming[snapshot.thread.id];
    }

    return next;
}

export function resolveConversationApproval(
    state: ConversationRuntimeState,
    approvalId: string
): ConversationRuntimeState {
    const next = cloneRuntimeState(state);
    removeApproval(next, approvalId);
    return next;
}

export function interruptConversationThread(
    state: ConversationRuntimeState,
    threadId: string
): ConversationRuntimeState {
    const next = cloneRuntimeState(state);
    settleRunningItems(next, threadId, undefined, Date.now(), 'failed');
    delete next.streaming[threadId];
    removeApprovalsByThread(next, threadId);
    delete next.errorsByThread[threadId];
    if (next.threads[threadId]) {
        updateThread(next, threadId, 'interrupted', Date.now());
    }
    return next;
}

export function simulateConversationReducer(): ConversationRuntimeState {
    const startedAt = 1_700_000_000_000;
    let state = createEmptyConversationState();
    state = reduceConversationEvent(state, {
        id: 'event-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        eventType: 'turn_started',
        metadata: { cwd: 'C:\\guodevelop\\ccg-switch' },
        createdAt: startedAt,
    });
    state = reduceConversationEvent(state, {
        id: 'event-2',
        threadId: 'thread-1',
        turnId: 'turn-1',
        eventType: 'item_started',
        item: {
            id: 'item-1',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemType: 'message',
            role: 'assistant',
            status: 'running',
            metadata: {},
            createdAt: startedAt + 1,
        },
        metadata: {},
        createdAt: startedAt + 1,
    });
    state = reduceConversationEvent(state, {
        id: 'event-3',
        threadId: 'thread-1',
        turnId: 'turn-1',
        eventType: 'item_delta',
        delta: 'hello',
        metadata: { itemId: 'item-1' },
        createdAt: startedAt + 2,
    });
    state = reduceConversationEvent(state, {
        id: 'event-4',
        threadId: 'thread-1',
        turnId: 'turn-1',
        eventType: 'approval_requested',
        approvalRequest: {
            id: 'approval-1',
            threadId: 'thread-1',
            turnId: 'turn-1',
            requestType: 'command',
            title: 'Run command',
            command: 'npm run build',
            metadata: {},
            createdAt: startedAt + 3,
        },
        metadata: {},
        createdAt: startedAt + 3,
    });
    state = reduceConversationEvent(state, {
        id: 'event-5',
        threadId: 'thread-1',
        turnId: 'turn-1',
        eventType: 'approval_resolved',
        approvalId: 'approval-1',
        metadata: {},
        createdAt: startedAt + 4,
    });
    state = reduceConversationEvent(state, {
        id: 'event-6',
        threadId: 'thread-1',
        turnId: 'turn-1',
        eventType: 'item_completed',
        metadata: { itemId: 'item-1' },
        createdAt: startedAt + 5,
    });
    return reduceConversationEvent(state, {
        id: 'event-7',
        threadId: 'thread-1',
        turnId: 'turn-1',
        eventType: 'turn_completed',
        metadata: {},
        createdAt: startedAt + 6,
    });
}

export const useConversationStore = create<ConversationStore>((set) => ({
    ...createEmptyConversationState(),

    setActiveThread: (threadId) => {
        set({ activeThreadId: threadId });
    },

    upsertThread: (thread) => {
        set(state => {
            const next = cloneRuntimeState(state);
            next.threads[thread.id] = thread;
            next.threadOrder = addThreadToOrder(next.threadOrder, thread.id);
            return next;
        });
    },

    loadSnapshot: (snapshot) => {
        set(state => loadConversationSnapshot(state, snapshot));
    },

    applyEvent: (event) => {
        set(state => reduceConversationEvent(state, event));
    },

    applyEvents: (events) => {
        set(state => events.reduce(reduceConversationEvent, state));
    },

    resolveApproval: (approvalId) => {
        set(state => resolveConversationApproval(state, approvalId));
    },

    interruptThread: (threadId) => {
        set(state => interruptConversationThread(state, threadId));
    },

    resetThread: (threadId) => {
        set(state => {
            const next = cloneRuntimeState(state);
            delete next.threads[threadId];
            delete next.items[threadId];
            delete next.streaming[threadId];
            delete next.errorsByThread[threadId];
            removeApprovalsByThread(next, threadId);
            next.threadOrder = next.threadOrder.filter(id => id !== threadId);
            if (next.activeThreadId === threadId) {
                next.activeThreadId = next.threadOrder[0] ?? null;
            }
            return next;
        });
    },

    reset: () => {
        set(createEmptyConversationState());
    },

    clearError: () => {
        set({ error: null, errorsByThread: {} });
    },
}));

function cloneRuntimeState(state: ConversationRuntimeState): ConversationRuntimeState {
    return {
        threads: { ...state.threads },
        threadOrder: [...state.threadOrder],
        activeThreadId: state.activeThreadId,
        items: Object.fromEntries(
            Object.entries(state.items).map(([threadId, items]) => [threadId, [...items]])
        ),
        pendingApprovals: { ...state.pendingApprovals },
        streaming: { ...state.streaming },
        errorsByThread: { ...state.errorsByThread },
        error: state.error,
    };
}

function ensureThread(
    state: ConversationRuntimeState,
    event: ConversationEvent,
    status: ConversationThreadStatus | null
): void {
    const existing = state.threads[event.threadId];
    state.threads[event.threadId] = {
        id: event.threadId,
        workspaceId: metadataString(event.metadata, 'workspaceId') ?? existing?.workspaceId,
        cwd: metadataString(event.metadata, 'cwd') ?? existing?.cwd ?? '',
        title: metadataString(event.metadata, 'title') ?? existing?.title,
        status: status ?? existing?.status ?? 'idle',
        createdAt: existing?.createdAt ?? event.createdAt,
        updatedAt: event.createdAt,
    };
    state.threadOrder = addThreadToOrder(state.threadOrder, event.threadId);
}

function updateThread(
    state: ConversationRuntimeState,
    threadId: string,
    status: ConversationThreadStatus,
    updatedAt: number
): void {
    const thread = state.threads[threadId];
    if (!thread) return;
    state.threads[threadId] = { ...thread, status, updatedAt };
}

function threadStatusForEvent(event: ConversationEvent): ConversationThreadStatus | null {
    switch (event.eventType) {
        case 'turn_started':
        case 'item_started':
        case 'item_delta':
        case 'item_completed':
        case 'approval_requested':
            return 'running';
        case 'turn_completed':
        case 'thread_started':
        case 'thread_resumed':
        case 'approval_resolved':
            return null;
        case 'turn_interrupted':
            return 'interrupted';
        case 'turn_failed':
            return 'failed';
        default:
            return null;
    }
}

function upsertItem(state: ConversationRuntimeState, item: ConversationItem): void {
    const threadItems = state.items[item.threadId] ?? [];
    const nextItem = normalizeItem(item);
    const index = threadItems.findIndex(candidate => candidate.id === item.id);
    state.items[item.threadId] = index === -1
        ? sortItems([...threadItems, nextItem])
        : sortItems(threadItems.map(candidate => (
            candidate.id === item.id
                ? mergeItem(candidate, nextItem)
                : candidate
        )));
}

function appendItemDelta(state: ConversationRuntimeState, event: ConversationEvent): void {
    if (event.delta === undefined && event.item) {
        upsertItem(state, event.item);
        updateStreamingItem(state, event, event.item.id);
        return;
    }

    const itemId = resolveItemId(state, event);
    const delta = event.delta ?? '';
    const threadItems = state.items[event.threadId] ?? [];
    const index = itemId
        ? threadItems.findIndex(candidate => candidate.id === itemId)
        : -1;

    if (index === -1) {
        const fallbackItem: ConversationItem = normalizeItem({
            id: itemId ?? event.id,
            threadId: event.threadId,
            turnId: event.turnId,
            itemType: event.item?.itemType ?? 'raw',
            role: event.item?.role,
            status: 'running',
            content: delta,
            summary: event.item?.summary,
            metadata: { ...(event.item?.metadata ?? {}), ...event.metadata },
            createdAt: event.item?.createdAt ?? event.createdAt,
        });
        state.items[event.threadId] = sortItems([...threadItems, fallbackItem]);
        updateStreamingItem(state, event, fallbackItem.id);
        return;
    }

    state.items[event.threadId] = threadItems.map((item, currentIndex) => {
        if (currentIndex !== index) return item;
        return normalizeItem({
            ...item,
            content: `${item.content ?? ''}${delta}`,
            status: 'running',
            metadata: { ...item.metadata, ...event.metadata },
        });
    });
    updateStreamingItem(state, event, itemId ?? undefined);
}

function completeItemById(
    state: ConversationRuntimeState,
    event: ConversationEvent,
    itemId: string | null,
    status: ConversationItemStatus
): void {
    if (!itemId) return;
    const threadItems = state.items[event.threadId] ?? [];
    state.items[event.threadId] = threadItems.map(item => (
        item.id === itemId
            ? normalizeItem({ ...item, status, completedAt: event.createdAt })
            : item
    ));
}

function completeRunningItems(
    state: ConversationRuntimeState,
    threadId: string,
    turnId: string | undefined,
    completedAt: number
): void {
    settleRunningItems(state, threadId, turnId, completedAt, 'completed');
}

function settleRunningItems(
    state: ConversationRuntimeState,
    threadId: string,
    turnId: string | undefined,
    completedAt: number,
    status: ConversationItemStatus
): void {
    const threadItems = state.items[threadId] ?? [];
    state.items[threadId] = threadItems.map(item => {
        if (item.status !== 'running') return item;
        if (turnId && item.turnId !== turnId) return item;
        return normalizeItem({ ...item, status, completedAt });
    });
}

function normalizeItem(item: ConversationItem): ConversationItem {
    return {
        ...item,
        metadata: item.metadata ?? {},
    };
}

function mergeItem(existing: ConversationItem, nextItem: ConversationItem): ConversationItem {
    return normalizeItem({
        ...existing,
        ...nextItem,
        turnId: nextItem.turnId ?? existing.turnId,
        role: nextItem.role ?? existing.role,
        content: nextItem.content ?? existing.content,
        summary: nextItem.summary ?? existing.summary,
        completedAt: nextItem.completedAt ?? existing.completedAt,
        metadata: { ...existing.metadata, ...nextItem.metadata },
    });
}

function updateStreamingItem(
    state: ConversationRuntimeState,
    event: ConversationEvent,
    itemId: string | undefined
): void {
    const current = state.streaming[event.threadId];
    state.streaming[event.threadId] = {
        threadId: event.threadId,
        turnId: event.turnId ?? current?.turnId,
        itemId: itemId ?? current?.itemId,
        active: true,
        startedAt: current?.startedAt ?? event.createdAt,
        updatedAt: event.createdAt,
    };
}

function clearStreamingItem(
    state: ConversationRuntimeState,
    event: ConversationEvent,
    itemId: string | null
): void {
    const current = state.streaming[event.threadId];
    if (!current) return;
    if (itemId && current.itemId && current.itemId !== itemId) return;

    state.streaming[event.threadId] = {
        threadId: event.threadId,
        turnId: event.turnId ?? current.turnId,
        active: true,
        startedAt: current.startedAt,
        updatedAt: event.createdAt,
    };
}

function resolveItemId(state: ConversationRuntimeState, event: ConversationEvent): string | null {
    return event.item?.id
        ?? metadataString(event.metadata, 'itemId')
        ?? metadataString(event.metadata, 'item_id')
        ?? state.streaming[event.threadId]?.itemId
        ?? null;
}

function resolveApprovalId(event: ConversationEvent): string | null {
    return event.approvalRequest?.id
        ?? event.approvalId
        ?? metadataString(event.metadata, 'approvalId')
        ?? metadataString(event.metadata, 'approval_id')
        ?? null;
}

function removeApproval(state: ConversationRuntimeState, approvalId: string | null): void {
    if (!approvalId) return;
    delete state.pendingApprovals[approvalId];
}

function removeApprovalsByThread(state: ConversationRuntimeState, threadId: string): void {
    state.pendingApprovals = Object.fromEntries(
        Object.entries(state.pendingApprovals).filter(([, approval]) => approval.threadId !== threadId)
    );
}

function addThreadToOrder(threadOrder: string[], threadId: string): string[] {
    return [threadId, ...threadOrder.filter(id => id !== threadId)];
}

function sortItems(items: ConversationItem[]): ConversationItem[] {
    return [...items].sort((left, right) => left.createdAt - right.createdAt);
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
    const value = metadata[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
}
