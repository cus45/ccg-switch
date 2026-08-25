import {describe, expect, it} from 'vitest';
import {getToolType} from '../types/tools';
import {summarizeGenericTool} from './toolPresentation';
import {extractPlanText} from '../components/toolBlocks/PlanToolBlock';

describe('getToolType 对 MCP / Web / Plan 的分类', () => {
    it.each([
        'mcp__context7__query-docs',
        'mcp__chrome-devtools__take_screenshot',
        'mcp__dbhub__execute_sql_qa_ai_writer',
    ])('%s 归为 mcp', (name) => {
        expect(getToolType(name)).toBe('mcp');
    });

    it('MCP 判定早于名称集合：尾段撞上 read/search 也不会被误分类', () => {
        expect(getToolType('mcp__files__read')).toBe('mcp');
        expect(getToolType('mcp__engine__search')).toBe('mcp');
    });

    it.each(['WebFetch', 'WebSearch', 'web_read'])('%s 归为 web', (name) => {
        expect(getToolType(name)).toBe('web');
    });

    it.each(['ExitPlanMode', 'exit_plan_mode', 'SubmitPlan'])('%s 归为 plan', (name) => {
        expect(getToolType(name)).toBe('plan');
    });

    it('既有分类不受影响', () => {
        expect(getToolType('Read')).toBe('read');
        expect(getToolType('MultiEdit')).toBe('edit');
        expect(getToolType('Bash')).toBe('bash');
        expect(getToolType('Grep')).toBe('search');
        expect(getToolType('Task')).toBe('agent');
        expect(getToolType('TodoWrite')).toBe('todo');
        expect(getToolType('SomethingElse')).toBe('generic');
    });
});

describe('summarizeGenericTool 的 MCP 分支', () => {
    it('chip 显示 server，摘要显示可读的工具名', () => {
        expect(summarizeGenericTool('mcp__context7__query-docs', {})).toEqual({
            label: 'context7',
            accentClass: 'tool-command-mcp',
            summary: 'query docs',
        });
    });

    it('带 file_path 的 MCP 工具仍按 MCP 呈现，不退化成普通文件操作', () => {
        const summary = summarizeGenericTool('mcp__idea__read_file', {
            file_path: 'src/main.ts',
        });

        expect(summary.accentClass).toBe('tool-command-mcp');
        expect(summary.label).toBe('idea');
    });

    it('工具段缺失时回退到 server 名，不产生空摘要', () => {
        const summary = summarizeGenericTool('mcp__chrome-devtools', {});

        expect(summary.label).toBe('chrome-devtools');
        expect(summary.summary).toBe('chrome-devtools');
    });

    it('非 MCP 工具走原有分支', () => {
        expect(summarizeGenericTool('WebSearch', {query: 'tauri ipc'})).toMatchObject({
            label: 'Web',
            accentClass: 'tool-command-web',
            summary: 'tauri ipc',
        });
    });

    // 回归：WebSearch 的入参就是 query，此前会先命中 summarizeSearchInput，
    // 导致联网搜索和本地 Grep 在转录里完全一样，websearch 分支成了死代码。
    it('联网搜索不被误显示成本地搜索', () => {
        const web = summarizeGenericTool('WebSearch', {query: 'zustand v5'});
        const local = summarizeGenericTool('Grep', {pattern: 'zustand v5'});

        expect(web.accentClass).not.toBe(local.accentClass);
        expect(web.label).toBe('Web');
    });

    it('WebFetch 摘要显示 URL', () => {
        expect(summarizeGenericTool('WebFetch', {
            url: 'https://example.com/docs',
            prompt: '读文档',
        })).toMatchObject({
            label: 'Fetch',
            accentClass: 'tool-command-web',
            summary: 'https://example.com/docs',
        });
    });
});

describe('extractPlanText', () => {
    it('优先取 plan 字段', () => {
        expect(extractPlanText({plan: '## 步骤\n1. 做事', content: '备用'})).toBe('## 步骤\n1. 做事');
    });

    it.each([
        [{content: '来自 content'}, '来自 content'],
        [{description: '来自 description'}, '来自 description'],
        [{prompt: '来自 prompt'}, '来自 prompt'],
    ])('缺 plan 时按顺序回退', (input, expected) => {
        expect(extractPlanText(input)).toBe(expected);
    });

    it('全空或缺失时返回空串（卡片据此不渲染）', () => {
        expect(extractPlanText({plan: '   '})).toBe('');
        expect(extractPlanText({})).toBe('');
        expect(extractPlanText(null)).toBe('');
        expect(extractPlanText(undefined)).toBe('');
    });
});
