import {describe, expect, it} from 'vitest';
import type {McpServerRow} from '../types/mcpV2';
import {buildChatMcpAvailabilitySummary, getMcpServerEnabledForProvider} from './chatMcpStatus';

function createServer(overrides: Partial<McpServerRow>): McpServerRow {
    return {
        id: overrides.id ?? 'server-id',
        name: overrides.name ?? 'Server',
        serverConfig: overrides.serverConfig ?? {command: 'node'},
        description: overrides.description ?? null,
        tags: overrides.tags ?? [],
        enabledClaude: overrides.enabledClaude ?? false,
        enabledCodex: overrides.enabledCodex ?? false,
        enabledGemini: overrides.enabledGemini ?? false,
        enabledOpencode: overrides.enabledOpencode ?? false,
    };
}

describe('chatMcpStatus', () => {
    it('maps provider-specific MCP enablement flags', () => {
        const server = createServer({
            enabledClaude: true,
            enabledCodex: false,
            enabledGemini: true,
        });

        expect(getMcpServerEnabledForProvider(server, 'claude')).toBe(true);
        expect(getMcpServerEnabledForProvider(server, 'codex')).toBe(false);
        expect(getMcpServerEnabledForProvider(server, 'gemini')).toBe(true);
        expect(getMcpServerEnabledForProvider(server, 'unknown')).toBe(false);
    });

    it('builds a compact availability summary for the active provider', () => {
        const summary = buildChatMcpAvailabilitySummary({
            provider: 'codex',
            loading: false,
            error: null,
            servers: [
                createServer({id: 'a', name: 'filesystem', serverConfig: {type: 'stdio', command: 'node'}, enabledCodex: true}),
                createServer({id: 'b', name: 'browser', serverConfig: {type: 'sse', url: 'http://localhost:3000'}, enabledCodex: false}),
                createServer({id: 'c', name: 'memory', serverConfig: {command: 'python'}, enabledCodex: true}),
            ],
        });

        expect(summary).toEqual({
            totalServers: 3,
            enabledServers: 2,
            loading: false,
            error: null,
            servers: [
                {id: 'a', name: 'filesystem', enabled: true, transport: 'stdio'},
                {id: 'b', name: 'browser', enabled: false, transport: 'sse'},
                {id: 'c', name: 'memory', enabled: true, transport: 'stdio'},
            ],
        });
    });

    it('normalizes loading errors before rendering diagnostics', () => {
        const summary = buildChatMcpAvailabilitySummary({
            provider: 'claude',
            loading: true,
            error: `  ${'mcp config failed '.repeat(20)}  `,
            servers: [createServer({enabledClaude: true})],
        });

        expect(summary.enabledServers).toBe(1);
        expect(summary.totalServers).toBe(1);
        expect(summary.servers).toEqual([
            {id: 'server-id', name: 'Server', enabled: true, transport: 'stdio'},
        ]);
        expect(summary.error).not.toContain('  ');
        expect(summary.error?.length).toBeLessThanOrEqual(140);
        expect(summary.error?.endsWith('...')).toBe(true);
    });
});
