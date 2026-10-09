// Prompts v2 数据库版类型

export interface PromptRow {
    id: string;
    appType: string;
    name: string;
    content: string;
    description: string | null;
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
}

export const PROMPT_APPS: { key: string; label: string; file: string }[] = [
    { key: 'claude', label: 'Claude', file: 'CLAUDE.md' },
    { key: 'codex', label: 'Codex', file: 'AGENTS.md' },
    { key: 'gemini', label: 'Gemini', file: 'GEMINI.md' },
    { key: 'opencode', label: 'OpenCode', file: 'AGENTS.md' },
];
