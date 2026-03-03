// MCP v2 数据库版类型

export interface McpServerConfig {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    type?: string;
    url?: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
}

export interface McpServerRow {
    id: string;
    name: string;
    serverConfig: McpServerConfig;
    description: string | null;
    tags: string[];
    homepage?: string;
    docs?: string;
    enabledClaude: boolean;
    enabledCodex: boolean;
    enabledGemini: boolean;
}

export const MCP_V2_APPS: { key: keyof Pick<McpServerRow, 'enabledClaude' | 'enabledCodex' | 'enabledGemini'>; label: string; app: string }[] = [
    { key: 'enabledClaude', label: 'Claude', app: 'claude' },
    { key: 'enabledCodex', label: 'Codex', app: 'codex' },
    { key: 'enabledGemini', label: 'Gemini', app: 'gemini' },
];
