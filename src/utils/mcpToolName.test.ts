import {describe, expect, it} from 'vitest';
import {
    describeMcpTool,
    formatMcpToolLabel,
    isMcpToolName,
    parseMcpToolName,
} from './mcpToolName';

describe('isMcpToolName', () => {
    it.each([
        ['mcp__context7__query-docs', true],
        ['MCP__Context7__QueryDocs', true],
        ['  mcp__a__b', true],
        ['Read', false],
        ['mcp', false],
        ['not_mcp__server__tool', false],
        [undefined, false],
    ])('%s → %s', (name, expected) => {
        expect(isMcpToolName(name as string | undefined)).toBe(expected);
    });
});

describe('parseMcpToolName', () => {
    it('拆出 server 与 tool', () => {
        expect(parseMcpToolName('mcp__context7__query-docs')).toEqual({
            server: 'context7',
            tool: 'query-docs',
        });
    });

    it('工具名里的 __ 归工具名，不再继续切', () => {
        expect(parseMcpToolName('mcp__dbhub__execute_sql__qa')).toEqual({
            server: 'dbhub',
            tool: 'execute_sql__qa',
        });
    });

    it('缺工具段时整体当 server', () => {
        expect(parseMcpToolName('mcp__chrome-devtools')).toEqual({
            server: 'chrome-devtools',
            tool: '',
        });
    });

    it('server 段为空时解析失败，调用方回退原始名', () => {
        expect(parseMcpToolName('mcp____query')).toBeNull();
        expect(parseMcpToolName('mcp__')).toBeNull();
    });

    it('非 MCP 名返回 null', () => {
        expect(parseMcpToolName('Bash')).toBeNull();
        expect(parseMcpToolName(undefined)).toBeNull();
    });
});

describe('formatMcpToolLabel', () => {
    it.each([
        ['query-docs', 'query docs'],
        ['execute_sql_qa_ai_writer', 'execute sql qa ai writer'],
        ['take_screenshot', 'take screenshot'],
        ['', ''],
    ])('%s → %s', (tool, expected) => {
        expect(formatMcpToolLabel(tool)).toBe(expected);
    });

    it('保留原始大小写（工具名常含缩写）', () => {
        expect(formatMcpToolLabel('execute_SQL')).toBe('execute SQL');
    });
});

describe('describeMcpTool', () => {
    it('拼成 server · tool 形式', () => {
        expect(describeMcpTool('mcp__context7__query-docs')).toBe('context7 · query docs');
    });

    it('没有工具段时只显示 server', () => {
        expect(describeMcpTool('mcp__chrome-devtools')).toBe('chrome-devtools');
    });

    it('解析失败时回退原始名，绝不返回空标题', () => {
        expect(describeMcpTool('Bash')).toBe('Bash');
        expect(describeMcpTool('mcp____x')).toBe('mcp____x');
    });
});
