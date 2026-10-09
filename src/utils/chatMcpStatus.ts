import type {McpServerRow} from '../types/mcpV2';

export interface ChatMcpAvailabilityServerSummary {
    id: string;
    name: string;
    enabled: boolean;
    transport: string | null;
}

export interface ChatMcpAvailabilitySummary {
    totalServers: number;
    enabledServers: number;
    loading: boolean;
    error: string | null;
    servers: ChatMcpAvailabilityServerSummary[];
}

interface BuildChatMcpAvailabilitySummaryInput {
    servers: McpServerRow[];
    provider: string;
    loading: boolean;
    error?: string | null;
}

const MCP_ERROR_MAX_LENGTH = 140;

function getProviderEnabledKey(provider: string): keyof Pick<McpServerRow, 'enabledClaude' | 'enabledCodex' | 'enabledGemini' | 'enabledOpencode'> | null {
    const normalizedProvider = provider.trim().toLowerCase();
    if (normalizedProvider === 'claude') return 'enabledClaude';
    if (normalizedProvider === 'codex') return 'enabledCodex';
    if (normalizedProvider === 'gemini') return 'enabledGemini';
    if (normalizedProvider === 'opencode') return 'enabledOpencode';
    return null;
}

function normalizeMcpError(error?: string | null): string | null {
    const normalized = error?.replace(/\s+/g, ' ').trim() ?? '';
    if (!normalized) return null;
    if (normalized.length <= MCP_ERROR_MAX_LENGTH) return normalized;
    return `${normalized.slice(0, MCP_ERROR_MAX_LENGTH - 3)}...`;
}

function getMcpServerTransport(server: McpServerRow): string | null {
    const type = typeof server.serverConfig.type === 'string' ? server.serverConfig.type.trim() : '';
    if (type) return type;
    if (typeof server.serverConfig.url === 'string' && server.serverConfig.url.trim()) return 'http';
    if (typeof server.serverConfig.command === 'string' && server.serverConfig.command.trim()) return 'stdio';
    return null;
}

export function getMcpServerEnabledForProvider(server: McpServerRow, provider: string): boolean {
    const key = getProviderEnabledKey(provider);
    return key ? Boolean(server[key]) : false;
}

export function buildChatMcpAvailabilitySummary({
    servers,
    provider,
    loading,
    error,
}: BuildChatMcpAvailabilitySummaryInput): ChatMcpAvailabilitySummary {
    const serverSummaries = servers.map((server) => ({
        id: server.id,
        name: server.name || server.id,
        enabled: getMcpServerEnabledForProvider(server, provider),
        transport: getMcpServerTransport(server),
    }));

    return {
        totalServers: servers.length,
        enabledServers: serverSummaries.filter((server) => server.enabled).length,
        loading,
        error: normalizeMcpError(error),
        servers: serverSummaries,
    };
}
