import {invoke} from '@tauri-apps/api/core';
import {type DirEntryPayload, type FileTreeEntry, normalizeDirEntries} from '../utils/fileTreeUtils';

/**
 * Thin typed wrappers around the right-dock backend commands
 * (`commands/chat_commands.rs`). Field names mirror the Rust structs, which use
 * `#[serde(rename_all = "camelCase")]`; payloads are lightly normalized so a
 * future serialization change cannot silently produce `undefined` values.
 */

export interface GitChangedFile {
    path: string;
    status: string;
    additions: number;
    deletions: number;
}

export interface GitChangedFiles {
    isGit: boolean;
    files: GitChangedFile[];
}

export interface GitFileContents {
    oldContent: string;
    newContent: string;
}

export interface ReadTextFileResult {
    content: string;
    truncated: boolean;
    binary: boolean;
}

interface RawGitChangedFile {
    path?: unknown;
    status?: unknown;
    additions?: unknown;
    deletions?: unknown;
}

interface RawGitChangedFiles {
    isGit?: unknown;
    is_git?: unknown;
    files?: unknown;
}

interface RawGitFileContents {
    oldContent?: unknown;
    old_content?: unknown;
    newContent?: unknown;
    new_content?: unknown;
}

interface RawReadTextFile {
    content?: unknown;
    truncated?: unknown;
    binary?: unknown;
}

export const EMPTY_GIT_CHANGED_FILES: GitChangedFiles = {isGit: false, files: []};

function toCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function normalizeGitChangedFile(raw: RawGitChangedFile): GitChangedFile | null {
    const path = typeof raw.path === 'string' ? raw.path : null;
    if (!path) return null;
    return {
        path,
        status: typeof raw.status === 'string' && raw.status.length > 0 ? raw.status : 'M',
        additions: toCount(raw.additions),
        deletions: toCount(raw.deletions),
    };
}

export function normalizeGitChangedFiles(raw: RawGitChangedFiles | null | undefined): GitChangedFiles {
    if (!raw) return EMPTY_GIT_CHANGED_FILES;
    const isGit = raw.isGit === true || raw.is_git === true;
    const files = Array.isArray(raw.files)
        ? raw.files
            .map((file) => normalizeGitChangedFile(file as RawGitChangedFile))
            .filter((file): file is GitChangedFile => file !== null)
        : [];
    return {isGit, files};
}

/** List a single directory level (lazy tree expansion). */
export async function listChatDirectory(path: string): Promise<FileTreeEntry[]> {
    const raw = await invoke<DirEntryPayload[]>('chat_list_directory', {path});
    return normalizeDirEntries(Array.isArray(raw) ? raw : []);
}

/** Read a text file for read-only preview (binary / oversize are flagged). */
export async function readChatTextFile(path: string, maxBytes?: number): Promise<ReadTextFileResult> {
    const raw = await invoke<RawReadTextFile>('chat_read_text_file', {path, maxBytes});
    return {
        content: toText(raw?.content),
        truncated: raw?.truncated === true,
        binary: raw?.binary === true,
    };
}

/** List git working-tree changes for the current workspace. */
export async function getChatGitChangedFiles(cwd: string): Promise<GitChangedFiles> {
    const raw = await invoke<RawGitChangedFiles>('chat_git_changed_files', {cwd});
    return normalizeGitChangedFiles(raw);
}

/** Get a file's HEAD content and working-tree content (for review diff). */
export async function getChatGitFileContents(cwd: string, path: string): Promise<GitFileContents> {
    const raw = await invoke<RawGitFileContents>('chat_git_file_contents', {cwd, path});
    return {
        oldContent: toText(raw?.oldContent ?? raw?.old_content),
        newContent: toText(raw?.newContent ?? raw?.new_content),
    };
}
