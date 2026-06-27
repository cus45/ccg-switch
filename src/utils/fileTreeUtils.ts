/**
 * Pure helpers for the right dock file tree.
 *
 * The tree is rooted at the active chat workspace directory and loaded lazily:
 * `chat_list_directory(dirPath)` returns only the direct children of a directory,
 * so each expandable folder fetches its children on demand. State is modeled as a
 * flat record keyed by absolute, forward-slash directory paths to keep the update
 * helpers pure and unit-testable independent of React.
 */

/** Raw directory entry payload from the backend (tolerates snake/camel case). */
export interface DirEntryPayload {
    name?: unknown;
    isDir?: unknown;
    is_dir?: unknown;
}

/** A normalized directory entry (single tree level). */
export interface FileTreeEntry {
    name: string;
    isDir: boolean;
}

/** A node projected into the visible (flattened) tree for rendering. */
export interface FileTreeNode {
    /** Absolute path, forward-slash separated. */
    path: string;
    name: string;
    isDir: boolean;
    /** Depth relative to the root; the root's direct children are depth 0. */
    depth: number;
}

export interface FileTreeState {
    /** Absolute, normalized root path (the workspace cwd). */
    rootPath: string;
    /** Directory path -> its direct children, present only once loaded. */
    childrenByDir: Record<string, FileTreeEntry[]>;
    /** Directory path -> whether it is expanded. */
    expanded: Record<string, boolean>;
    /** Directory path -> whether its children are currently loading. */
    loading: Record<string, boolean>;
}

/** Normalize a path to forward slashes without a trailing separator. */
export function normalizeTreePath(path: string): string {
    const forward = path.replace(/\\/g, '/');
    // Keep single-character roots (e.g. "/") intact.
    return forward.length > 1 ? forward.replace(/\/+$/, '') : forward;
}

/** Join a child name onto a parent directory path (forward-slash result). */
export function joinTreePath(parent: string, name: string): string {
    const base = parent.replace(/\\/g, '/').replace(/\/+$/, '');
    return `${base}/${name}`;
}

/** Case-insensitive comparable form of a path (for change-set matching). */
export function normalizeComparePath(path: string): string {
    return normalizeTreePath(path).toLowerCase();
}

export function normalizeDirEntry(payload: DirEntryPayload): FileTreeEntry | null {
    const name = typeof payload.name === 'string' ? payload.name : null;
    if (!name) return null;
    const isDir = payload.isDir === true || payload.is_dir === true;
    return {name, isDir};
}

/** Normalize and sort entries: directories first, then case-insensitive by name. */
export function normalizeDirEntries(payloads: DirEntryPayload[]): FileTreeEntry[] {
    return payloads
        .map(normalizeDirEntry)
        .filter((entry): entry is FileTreeEntry => entry !== null)
        .sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });
}

export function createFileTreeState(rootPath: string): FileTreeState {
    return {
        rootPath: normalizeTreePath(rootPath),
        childrenByDir: {},
        expanded: {},
        loading: {},
    };
}

export function isDirLoaded(state: FileTreeState, dirPath: string): boolean {
    return state.childrenByDir[normalizeTreePath(dirPath)] !== undefined;
}

export function setDirLoading(state: FileTreeState, dirPath: string, loading: boolean): FileTreeState {
    const key = normalizeTreePath(dirPath);
    return {
        ...state,
        loading: {...state.loading, [key]: loading},
    };
}

export function setDirChildren(
    state: FileTreeState,
    dirPath: string,
    entries: DirEntryPayload[],
): FileTreeState {
    const key = normalizeTreePath(dirPath);
    return {
        ...state,
        childrenByDir: {...state.childrenByDir, [key]: normalizeDirEntries(entries)},
        loading: {...state.loading, [key]: false},
    };
}

export function toggleDirExpanded(state: FileTreeState, dirPath: string): FileTreeState {
    const key = normalizeTreePath(dirPath);
    return {
        ...state,
        expanded: {...state.expanded, [key]: !state.expanded[key]},
    };
}

/** Walk the loaded + expanded tree into an ordered, indented list for rendering. */
export function flattenVisibleTree(state: FileTreeState): FileTreeNode[] {
    const out: FileTreeNode[] = [];

    const walk = (dirPath: string, depth: number): void => {
        const children = state.childrenByDir[normalizeTreePath(dirPath)];
        if (!children) return;

        for (const entry of children) {
            const path = joinTreePath(dirPath, entry.name);
            out.push({path, name: entry.name, isDir: entry.isDir, depth});
            if (entry.isDir && state.expanded[normalizeTreePath(path)]) {
                walk(path, depth + 1);
            }
        }
    };

    walk(state.rootPath, 0);
    return out;
}

/** Build the set of changed paths (comparable form) from git-relative paths. */
export function buildChangedPathSet(gitRoot: string | null, paths: string[]): Set<string> {
    const set = new Set<string>();
    for (const relPath of paths) {
        if (!relPath) continue;
        const abs = gitRoot ? joinTreePath(gitRoot, relPath) : relPath;
        set.add(normalizeComparePath(abs));
    }
    return set;
}

export function isPathChanged(changed: Set<string>, nodePath: string): boolean {
    return changed.has(normalizeComparePath(nodePath));
}
