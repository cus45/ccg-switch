/**
 * 右侧 dock 的文档 tab 模型（Stage C：DockShell tab 外壳）。
 *
 * 文档 = dock 里一个可切换/可关闭的 tab：文件浏览(files)、单文件预览(file)、
 * 审查(review)、侧边聊天(sideChat)。files/review 是单例；file 按路径去重；
 * sideChat 按 chatTabKey 去重（引用 useChatStore.openTabs 池里的 tab）。
 */

export type DockDocumentKind = 'files' | 'file' | 'review' | 'sideChat';

export interface DockDocument {
    id: string;
    kind: DockDocumentKind;
    title: string;
    /** kind === 'file' 时的绝对路径。 */
    filePath?: string;
    /** kind === 'sideChat' 时引用的 ChatSessionTab key。 */
    chatTabKey?: string;
}

export interface DockDocumentsState {
    documents: DockDocument[];
    activeDocId: string | null;
}

export const DOCK_DOCUMENTS_STORAGE_KEY = 'ccg-chat-dock-documents';
export const DOCK_SHELL_FLAG_STORAGE_KEY = 'ccg-chat-dock-shell';

export const EMPTY_DOCK_DOCUMENTS_STATE: DockDocumentsState = {
    documents: [],
    activeDocId: null,
};

function baseName(path: string): string {
    const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
    return segments[segments.length - 1] ?? path;
}

export function createFilesDocument(title = 'Files'): DockDocument {
    return {id: 'files', kind: 'files', title};
}

export function createReviewDocument(title = 'Review'): DockDocument {
    return {id: 'review', kind: 'review', title};
}

export function createFileDocument(filePath: string): DockDocument {
    return {
        id: `file:${filePath}`,
        kind: 'file',
        title: baseName(filePath),
        filePath,
    };
}

export function createSideChatDocument(chatTabKey: string, title: string): DockDocument {
    return {
        id: `sideChat:${chatTabKey}`,
        kind: 'sideChat',
        title,
        chatTabKey,
    };
}

/** 打开（或聚焦已存在的）文档：按 id 去重，更新元数据并置为活跃。 */
export function openDockDocument(state: DockDocumentsState, doc: DockDocument): DockDocumentsState {
    const exists = state.documents.some((existing) => existing.id === doc.id);
    return {
        documents: exists
            ? state.documents.map((existing) => (existing.id === doc.id ? doc : existing))
            : [...state.documents, doc],
        activeDocId: doc.id,
    };
}

/** 关闭文档：若关闭的是活跃文档，优先激活同位置的下一个，否则前一个，否则清空。 */
export function closeDockDocument(state: DockDocumentsState, id: string): DockDocumentsState {
    const index = state.documents.findIndex((doc) => doc.id === id);
    if (index < 0) return state;

    const documents = state.documents.filter((doc) => doc.id !== id);
    if (state.activeDocId !== id) {
        return {documents, activeDocId: state.activeDocId};
    }

    const fallback = documents[index] ?? documents[index - 1] ?? null;
    return {documents, activeDocId: fallback?.id ?? null};
}

/** 激活文档；id 不存在时保持原状态。 */
export function activateDockDocument(state: DockDocumentsState, id: string): DockDocumentsState {
    if (state.activeDocId === id) return state;
    if (!state.documents.some((doc) => doc.id === id)) return state;
    return {documents: state.documents, activeDocId: id};
}

function isDockDocumentKind(value: unknown): value is DockDocumentKind {
    return value === 'files' || value === 'file' || value === 'review' || value === 'sideChat';
}

function isDockDocument(value: unknown): value is DockDocument {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<DockDocument>;
    return typeof candidate.id === 'string'
        && candidate.id.length > 0
        && isDockDocumentKind(candidate.kind)
        && typeof candidate.title === 'string'
        && (candidate.filePath === undefined || typeof candidate.filePath === 'string')
        && (candidate.chatTabKey === undefined || typeof candidate.chatTabKey === 'string');
}

/**
 * 恢复持久化的文档结构。sideChat 文档引用的聊天 tab 池不跨应用重启存在，
 * 载入时丢弃（侧聊恢复语义在 Stage E 单独处理）。
 */
export function loadDockDocumentsState(): DockDocumentsState {
    try {
        const raw = window.localStorage.getItem(DOCK_DOCUMENTS_STORAGE_KEY);
        if (!raw) return EMPTY_DOCK_DOCUMENTS_STATE;

        const parsed = JSON.parse(raw) as Partial<DockDocumentsState> | null;
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.documents)) {
            return EMPTY_DOCK_DOCUMENTS_STATE;
        }

        const documents = parsed.documents
            .filter(isDockDocument)
            .filter((doc) => doc.kind !== 'sideChat');
        const activeDocId = typeof parsed.activeDocId === 'string'
            && documents.some((doc) => doc.id === parsed.activeDocId)
            ? parsed.activeDocId
            : (documents[documents.length - 1]?.id ?? null);
        return {documents, activeDocId};
    } catch {
        return EMPTY_DOCK_DOCUMENTS_STATE;
    }
}

export function saveDockDocumentsState(state: DockDocumentsState): void {
    try {
        window.localStorage.setItem(DOCK_DOCUMENTS_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // localStorage 在受限 WebView 环境可能不可用。
    }
}

/**
 * DockShell 回滚开关：默认启用；localStorage 置 '0' | 'false' | 'off'
 * 时回退旧 RightDock（卡片菜单）。
 */
export function isDockShellEnabled(): boolean {
    try {
        const raw = window.localStorage.getItem(DOCK_SHELL_FLAG_STORAGE_KEY);
        if (!raw) return true;
        const normalized = raw.trim().toLowerCase();
        return !(normalized === '0' || normalized === 'false' || normalized === 'off');
    } catch {
        return true;
    }
}
