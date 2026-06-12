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

export type McpV2LegacyApp = 'claude' | 'codex' | 'gemini';
export type McpV2EnabledKey = keyof Pick<McpServerRow, 'enabledClaude' | 'enabledCodex' | 'enabledGemini'>;

export const MCP_V2_LEGACY_APP_BINDINGS: { key: McpV2EnabledKey; app: McpV2LegacyApp }[] = [
    { key: 'enabledClaude', app: 'claude' },
    { key: 'enabledCodex', app: 'codex' },
    { key: 'enabledGemini', app: 'gemini' },
];

export const MCP_V2_APPS: { key: McpV2EnabledKey; label: string; app: McpV2LegacyApp }[] = [
    { key: 'enabledClaude', label: 'Claude', app: 'claude' },
    { key: 'enabledCodex', label: 'Codex', app: 'codex' },
    { key: 'enabledGemini', label: 'Gemini', app: 'gemini' },
];
