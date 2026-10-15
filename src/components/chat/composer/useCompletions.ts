import {useCallback, useEffect, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import type {CompletionItem, CompletionItemKind} from './CompletionMenu';

/** 触发符类型。 */
export type CompletionTrigger = '@' | '#' | '!' | '/';

interface SlashCommand {
    id: string;
    label: string;
    description: string;
    source?: string;
}

/** 内置 Slash 命令兜底，对齐 cc-gui 的 SlashCommandRegistry 常用项。 */
const SLASH_COMMANDS: SlashCommand[] = [
    { id: 'clear', label: '/clear', description: '清空当前会话并新建会话', source: 'local' },
    { id: 'provider', label: '/provider', description: '切换当前活跃的 API 服务商配置 (Provider Switcher)', source: 'local' },
    { id: 'model', label: '/model', description: '切换当前会话调用的 AI 模型 (Model Switcher)', source: 'local' },
    { id: 'fork', label: '/fork', description: '分叉当前会话到新标签页 (Fork Session)', source: 'local' },
    { id: 'compact', label: '/compact', description: 'Summarize conversation to free context/tokens', source: 'builtin' },
    { id: 'context', label: '/context', description: 'Visualize current context usage as a colored grid', source: 'builtin' },
    { id: 'init', label: '/init', description: 'Initialize a new CLAUDE.md or AGENTS.md file', source: 'builtin' },
    { id: 'plan', label: '/plan', description: 'Switch to plan mode', source: 'builtin' },
    { id: 'resume', label: '/resume', description: 'Resume a previous conversation', source: 'builtin' },
    { id: 'review', label: '/review', description: 'Review a pull request or working tree changes', source: 'builtin' },
    { id: 'batch', label: '/batch', description: 'Execute large-scale changes in parallel across isolated worktrees', source: 'bundled' },
    { id: 'claude-api', label: '/claude-api', description: 'Build apps with the Claude API or Anthropic SDK', source: 'bundled' },
    { id: 'debug', label: '/debug', description: 'Enable debug logging and diagnose session issues', source: 'bundled' },
    { id: 'loop', label: '/loop', description: 'Run a prompt or command on a recurring interval', source: 'bundled' },
    { id: 'simplify', label: '/simplify', description: 'Review changed code for reuse, quality, and efficiency', source: 'bundled' },
    { id: 'update-config', label: '/update-config', description: 'Configure settings.json hooks, permissions, and env vars', source: 'bundled' },
    { id: 'diff', label: '/diff', description: 'Show pending changes diff including untracked files', source: 'builtin' },
    { id: 'help', label: '/help', description: '查看可用命令', source: 'local' },
];

interface WorkspaceFile {
    relPath: string;
    name: string;
    isDir: boolean;
}

interface WorkspaceFilePayload {
    relPath?: unknown;
    rel_path?: unknown;
    name?: unknown;
    isDir?: unknown;
    is_dir?: unknown;
}

interface SlashCommandPayload {
    id?: unknown;
    name?: unknown;
    label?: unknown;
    description?: unknown;
    source?: unknown;
    category?: unknown;
}

interface PromptPreset {
    name: string;
    content: string;
    filePath?: string;
    file_path?: string;
}

interface Subagent {
    name: string;
    content: string;
    filePath: string;
}

/** 当前激活的补全状态。 */
interface ActiveCompletion {
    trigger: CompletionTrigger;
    /** 触发符在文本中的起始下标 */
    start: number;
    /** 触发符后已输入的查询词 */
    query: string;
}

/**
 * 扫描光标前文本，判断是否处于某个触发符的补全上下文。
 * 规则：触发符需位于行首或空白后；查询词内不含空白。
 */
function detectTrigger(text: string, caret: number): ActiveCompletion | null {
    const triggers: CompletionTrigger[] = ['@', '#', '!', '/'];
    // 从光标往前找最近的触发符
    for (let i = caret - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === ' ' || ch === '\n' || ch === '\t') return null;
        if ((triggers as string[]).includes(ch)) {
            const before = i === 0 ? '' : text[i - 1];
            const atBoundary = i === 0 || before === ' ' || before === '\n' || before === '\t';
            if (!atBoundary) return null;
            // `/` 仅在输入起始处作为 slash 命令（避免误触路径）
            if (ch === '/' && i !== 0) return null;
            return {
                trigger: ch as CompletionTrigger,
                start: i,
                query: text.slice(i + 1, caret),
            };
        }
    }
    return null;
}

function stringField(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function basename(path: string): string {
    const parts = path.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] ?? path;
}

function normalizeSlashCommand(command: SlashCommandPayload): SlashCommand | null {
    const rawLabel = stringField(command.label)
        ?? stringField(command.name)
        ?? stringField(command.id);
    if (!rawLabel) return null;

    const label = rawLabel.startsWith('/') ? rawLabel : `/${rawLabel}`;
    const id = stringField(command.id) ?? label.replace(/^\//, '');
    const description = stringField(command.description) ?? '';
    const source = stringField(command.source) ?? stringField(command.category) ?? undefined;

    return {
        id: id.replace(/^\//, ''),
        label,
        description,
        source,
    };
}

function formatSlashDescription(description: string, source?: string): string | undefined {
    if (!source) return description || undefined;
    const suffix = `[${source}]`;
    if (!description) return suffix;
    if (description.includes(suffix)) return description;
    return `${description} ${suffix}`;
}

export function getSlashCommandCompletions(
    query: string,
    commands: SlashCommandPayload[] = SLASH_COMMANDS,
): CompletionItem[] {
    const q = query.trim().replace(/^\//, '').toLowerCase();
    const seen = new Set<string>();
    return commands
        .map(normalizeSlashCommand)
        .filter((c): c is SlashCommand => c !== null)
        .filter((c) => {
            const key = c.label.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .filter((c) => {
            if (!q) return true;
            return c.id.toLowerCase().includes(q)
                || c.label.toLowerCase().includes(q)
                || c.description.toLowerCase().includes(q)
                || (c.source?.toLowerCase().includes(q) ?? false);
        })
        .map((c) => ({
            id: c.label,
            label: c.label,
            description: formatSlashDescription(c.description, c.source),
            insertText: c.label,
            kind: 'command' as const,
        }));
}

export function normalizeWorkspaceFile(file: WorkspaceFilePayload): WorkspaceFile | null {
    const relPath = stringField(file.relPath) ?? stringField(file.rel_path);
    if (!relPath) return null;

    const name = stringField(file.name) ?? basename(relPath);
    const isDirSource = file.isDir ?? file.is_dir;
    const isDir = typeof isDirSource === 'boolean' ? isDirSource : false;

    return { relPath, name, isDir };
}

interface UseCompletionsOptions {
    /** 工作目录（@ 文件补全用，缺省主目录） */
    cwd?: string;
    /** 当前 AI provider，用于按 Claude/Codex 返回对应 slash command。 */
    provider?: string;
}

export interface CompletionState {
    isOpen: boolean;
    items: CompletionItem[];
    activeIndex: number;
    loading: boolean;
    trigger: CompletionTrigger | null;
    /** 文本/光标变化时调用，刷新补全上下文 */
    onTextChange: (text: string, caret: number) => void;
    /** 键盘事件预处理；返回 true 表示已消费（阻止默认） */
    handleKeyDown: (e: React.KeyboardEvent) => boolean;
    setActiveIndex: (i: number) => void;
    /** 选中第 index 项，返回替换后的 {text, caret}，由调用方写回 */
    applySelection: (
        index: number,
        text: string,
    ) => { text: string; caret: number; fileMeta?: { filePath: string; isDir: boolean; triggerStart: number; queryLength: number } } | null;
    close: () => void;
}

export function shouldConsumeCompletionKey(
    key: string,
    isOpen: boolean,
    _itemCount: number,
): boolean {
    if (!isOpen) return false;
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Escape') return true;
    if (key === 'Enter' || key === 'Tab') return true;
    return false;
}

/**
 * 输入框补全控制器。集中处理 @ / # / ! / / 四类触发的检测、数据拉取、
 * 键盘导航与文本替换。数据源：
 *   @  → chat_list_workspace_files（Rust）
 *   #  → list_subagents
 *   !  → list_prompts
 *   /  → chat_list_slash_commands（Rust），失败时回退内置命令
 */
export function useCompletions({ cwd, provider }: UseCompletionsOptions = {}): CompletionState {
    const [active, setActive] = useState<ActiveCompletion | null>(null);
    const [items, setItems] = useState<CompletionItem[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const reqSeq = useRef(0);

    const close = useCallback(() => {
        setActive(null);
        setItems([]);
        setActiveIndex(0);
        setLoading(false);
    }, []);

    // 拉取补全项（带请求序号防竞态 + 防抖，避免快速输入时对后端发起大量
    // 文件系统扫描请求，导致主线程拥塞/界面卡死）。
    useEffect(() => {
        if (!active) return;
        const seq = ++reqSeq.current;
        setLoading(true);

        const fetchItems = async (): Promise<CompletionItem[]> => {
            const q = active.query.toLowerCase();
            switch (active.trigger) {
                case '/': {
                    try {
                        const commands = await invoke<SlashCommandPayload[]>(
                            'chat_list_slash_commands',
                            { cwd, provider },
                        );
                        const result = getSlashCommandCompletions(active.query, [...commands, ...SLASH_COMMANDS]);
                        return result.length > 0 ? result : getSlashCommandCompletions(active.query);
                    } catch {
                        return getSlashCommandCompletions(active.query);
                    }
                }
                case '@': {
                    const files = await invoke<WorkspaceFilePayload[]>(
                        'chat_list_workspace_files',
                        { dir: cwd, query: active.query || undefined },
                    );
                    return files
                        .map(normalizeWorkspaceFile)
                        .filter((f): f is WorkspaceFile => f !== null)
                        .map<CompletionItem>((f) => {
                            // 拆分文件名与所在路径：主文本显示文件名（目录追加 /），
                            // 副文本以弱化样式显示其父级目录路径。
                            const parent = f.relPath.slice(0, f.relPath.length - f.name.length).replace(/[/\\]$/, '');
                            const kind: CompletionItemKind = f.isDir ? 'directory' : 'file';
                            return {
                                id: f.relPath,
                                label: f.name + (f.isDir ? '/' : ''),
                                description: parent || undefined,
                                insertText: f.relPath,
                                kind,
                            };
                        });
                }
                case '#': {
                    const agents = await invoke<Subagent[]>('list_subagents');
                    return agents
                        .filter((a) => a.name.toLowerCase().includes(q))
                        .map((a) => ({
                            id: a.name,
                            label: a.name,
                            insertText: a.name,
                            kind: 'agent' as const,
                        }));
                }
                case '!': {
                    const prompts = await invoke<PromptPreset[]>('list_prompts');
                    return prompts
                        .filter((p) => (
                            p.name.toLowerCase().includes(q)
                            || p.content.toLowerCase().includes(q)
                        ))
                        .map((p) => ({
                            id: p.name,
                            label: p.name,
                            description: p.content
                                ? (p.content.length > 80 ? `${p.content.slice(0, 80)}…` : p.content)
                                : undefined,
                            insertText: p.content || p.name,
                            kind: 'prompt' as const,
                        }));
                }
                default:
                    return [];
            }
        };

        // `@` 文件补全要遍历文件系统，开销最大 → 给更长的防抖；
        // 其余触发符走内存/轻量数据源，短防抖即可保持响应。
        const debounceMs = active.trigger === '@' ? 220 : 60;
        const timer = setTimeout(() => {
            fetchItems()
                .then((result) => {
                    if (seq !== reqSeq.current) return;
                    setItems(result);
                    setActiveIndex(0);
                    setLoading(false);
                })
                .catch(() => {
                    if (seq !== reqSeq.current) return;
                    setItems([]);
                    setLoading(false);
                });
        }, debounceMs);

        return () => clearTimeout(timer);
    }, [active, cwd, provider]);

    const onTextChange = useCallback(
        (text: string, caret: number) => {
            const detected = detectTrigger(text, caret);
            setActive((prev) => {
                if (!detected) return null;
                if (
                    prev &&
                    prev.trigger === detected.trigger &&
                    prev.start === detected.start &&
                    prev.query === detected.query
                ) {
                    return prev;
                }
                return detected;
            });
        },
        [],
    );

    const applySelection = useCallback(
        (index: number, text: string) => {
            if (!active || !items[index]) return null;
            const item = items[index];
            const insert = item.insertText ?? item.label;
            const before = text.slice(0, active.start);
            const after = text.slice(active.start + 1 + active.query.length);
            // 文件/代理保留触发符；slash 命令和 Prompt 预设直接替换为正文。
            const replacement =
                active.trigger === '/' || active.trigger === '!' ? insert : `${active.trigger}${insert}`;
            const newText = `${before}${replacement} ${after}`;
            const caret = before.length + replacement.length + 1;
            // For @ file completions, also return metadata for chip rendering
            const fileMeta = active.trigger === '@'
                ? {
                    filePath: insert,
                    isDir: item.label.endsWith('/'),
                    triggerStart: active.start,
                    queryLength: active.query.length,
                }
                : undefined;
            close();
            return { text: newText, caret, fileMeta };
        },
        [active, items, close],
    );

    const isOpen = active !== null && (loading || items.length > 0);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent): boolean => {
            if (!isOpen) return false;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % Math.max(items.length, 1));
                return true;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => (i - 1 + items.length) % Math.max(items.length, 1));
                return true;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
                return true;
            }
            // Enter / Tab 确认由调用方负责文本替换（需要拿到 textarea 值），
            // 这里只标记“已消费”，交给 ChatComposer 调 applySelection。
            if (shouldConsumeCompletionKey(e.key, isOpen, items.length)) {
                e.preventDefault();
                return true;
            }
            return false;
        },
        [isOpen, items.length, close],
    );

    return {
        isOpen,
        items,
        activeIndex,
        loading,
        trigger: active?.trigger ?? null,
        onTextChange,
        handleKeyDown,
        setActiveIndex,
        applySelection,
        close,
    };
}
