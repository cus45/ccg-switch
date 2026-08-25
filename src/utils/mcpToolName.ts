/**
 * MCP 工具名解析。
 *
 * MCP 工具经 SDK 传下来的名字是 `mcp__<server>__<tool>`，例如
 * `mcp__context7__query-docs`。改造前这类工具全部落到 `GenericToolBlock`，
 * 卡片标题就是这串原始名 + 一个扳手图标——实际使用中 MCP 调用往往占一轮的大半，
 * 却是识别度最差的一类。
 *
 * 解析出 server 与 tool 之后，卡片可以做成「server 徽标 + 干净工具名」。
 */

const MCP_PREFIX = 'mcp__';
const MCP_SEPARATOR = '__';

export interface McpToolName {
    /** MCP server 名（`mcp__` 后的第一段）。 */
    server: string;
    /** 工具名（其余段拼回，保留其中的 `__`）。 */
    tool: string;
}

export function isMcpToolName(name: string | undefined): boolean {
    return typeof name === 'string' && name.trim().toLowerCase().startsWith(MCP_PREFIX);
}

/**
 * 解析 `mcp__<server>__<tool>`。
 *
 * 宽松处理几种畸形输入：缺工具段（`mcp__server`）、空段（`mcp____tool`）、
 * 以及工具名里本身带 `__` 的情况（多余分隔符归给工具名，不再继续切）。
 * 无法解析出 server 时返回 null，调用方回退到原始名显示。
 *
 * @param name 原始工具名。
 */
export function parseMcpToolName(name: string | undefined): McpToolName | null {
    if (!isMcpToolName(name)) return null;

    const body = (name as string).trim().slice(MCP_PREFIX.length);
    const separatorIndex = body.indexOf(MCP_SEPARATOR);

    // 没有第二个分隔符：整体当 server，工具名留空由调用方兜底
    if (separatorIndex < 0) {
        const server = body.trim();
        return server ? {server, tool: ''} : null;
    }

    const server = body.slice(0, separatorIndex).trim();
    const tool = body.slice(separatorIndex + MCP_SEPARATOR.length).trim();
    if (!server) return null;

    return {server, tool};
}

/**
 * MCP 工具的展示名：把 `snake_case` / `kebab-case` 拆成空格分词。
 * 保持原始大小写，不做首字母大写——工具名常含缩写（`sql`、`api`），
 * 强制 Title Case 反而更难认。
 */
export function formatMcpToolLabel(tool: string): string {
    return tool.replace(/[_-]+/g, ' ').trim();
}

/**
 * 卡片标题用的一行摘要：`server · tool label`。
 * 解析失败时返回原始名，保证不会渲染出空标题。
 */
export function describeMcpTool(name: string | undefined): string {
    const parsed = parseMcpToolName(name);
    if (!parsed) return name?.trim() ?? '';

    const label = formatMcpToolLabel(parsed.tool);
    return label ? `${parsed.server} · ${label}` : parsed.server;
}
