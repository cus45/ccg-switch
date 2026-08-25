// 工具分类与常量定义

import {isMcpToolName} from '../utils/mcpToolName';

/** 工具输入参数（通用） */
export interface ToolInput {
  [key: string]: unknown;
  // 常见字段
  file_path?: string;
  filePath?: string;
  path?: string;
  target_file?: string;
  targetFile?: string;
  command?: string;
  old_string?: string;
  oldString?: string;
  oldText?: string;
  new_string?: string;
  newString?: string;
  newText?: string;
  edits?: unknown[];
  patch?: string;
  input?: string;
  content?: string;
  offset?: number;
  limit?: number;
  line?: number;
  start_line?: number;
  end_line?: number;
  description?: string;
  prompt?: string;
  model?: string;
  reasoning_effort?: string;
  reasoningEffort?: string;
  subagent_type?: string;
  name?: string;
  agent_id?: string;
  agentId?: string;
  todos?: unknown[];
}

/** TodoWrite 单条计划项状态 */
export type TodoItemStatus = 'pending' | 'in_progress' | 'completed';

/** TodoWrite 单条计划项（宽松解析后的规范形态） */
export interface TodoItem {
  content: string;
  status: TodoItemStatus;
  activeForm?: string;
}

/**
 * 从 TodoWrite 工具入参宽松解析计划项列表。
 * 非法条目跳过，未知状态归为 pending。
 */
export function parseTodoItems(input?: ToolInput | null): TodoItem[] {
  const rawList = input?.todos;
  if (!Array.isArray(rawList)) return [];

  const items: TodoItem[] = [];
  for (const raw of rawList) {
    if (typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const content = typeof record.content === 'string' ? record.content.trim() : '';
    if (!content) continue;
    const rawStatus = typeof record.status === 'string' ? record.status : '';
    const status: TodoItemStatus = rawStatus === 'completed' || rawStatus === 'in_progress'
      ? rawStatus
      : 'pending';
    const activeForm = typeof record.activeForm === 'string' && record.activeForm.trim()
      ? record.activeForm.trim()
      : undefined;
    items.push({ content, status, activeForm });
  }
  return items;
}

/** Read 工具名称集合 */
export const READ_TOOL_NAMES = new Set([
  'read',
  'Read',
  'readfile',
  'ReadFile',
  'read_file',
]);

/** Edit 工具名称集合 */
export const EDIT_TOOL_NAMES = new Set([
  'edit',
  'Edit',
  'editfile',
  'edit_file',
  'write',
  'Write',
  'writefile',
  'WriteFile',
  'write_file',
  'writetofile',
  'write_to_file',
  'replace',
  'replacestring',
  'replace_string',
  'multiedit',
  'MultiEdit',
  'notebookedit',
  'NotebookEdit',
  'applypatch',
  'apply_patch',
]);

/** Bash 工具名称集合 */
export const BASH_TOOL_NAMES = new Set([
  'bash',
  'Bash',
  'executecommand',
  'ExecuteCommand',
  'execute_command',
]);

/** Search 工具名称集合 */
export const SEARCH_TOOL_NAMES = new Set([
  'grep',
  'Grep',
  'search',
  'Search',
  'glob',
  'Glob',
]);

/** Agent 工具名称集合 */
export const AGENT_TOOL_NAMES = new Set([
  'agent',
  'Agent',
  'spawnagent',
  'spawn_agent',
  'task',
  'Task',
]);

/** Todo 计划工具名称集合（集合内为规范化后的名称） */
export const TODO_TOOL_NAMES = new Set([
  'todowrite',
]);

/** 网络读取工具名称集合（规范化后） */
export const WEB_TOOL_NAMES = new Set([
  'webfetch',
  'websearch',
  'fetch',
  'webread',
]);

/** 计划提交工具名称集合（规范化后）。plan 正文需要按 Markdown 渲染，不能当普通参数打印。 */
export const PLAN_TOOL_NAMES = new Set([
  'exitplanmode',
  'exitplan',
  'submitplan',
]);

/** 工具类型 */
export type ToolType =
  | 'bash'
  | 'read'
  | 'edit'
  | 'search'
  | 'agent'
  | 'todo'
  | 'web'
  | 'plan'
  | 'mcp'
  | 'generic';

/**
 * 规范化工具名称（小写 + 移除下划线和连字符）
 * @param name 原始工具名称
 * @returns 规范化后的名称
 */
export function normalizeToolName(name?: string): string {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/[-_]/g, '');
}

/**
 * 判断工具名称是否属于指定工具集合
 * @param name 工具名称
 * @param toolNames 工具名称集合
 * @returns 是否匹配
 */
export function isToolName(name: string | undefined, toolNames: Set<string>): boolean {
  if (!name) return false;
  const normalized = normalizeToolName(name);
  return toolNames.has(normalized);
}

/**
 * 获取工具类型
 * @param name 工具名称
 * @returns 工具类型
 */
export function getToolType(name: string): ToolType {
  // MCP 工具名形如 mcp__<server>__<tool>，server/tool 段无法穷举，
  // 因此靠前缀判定而不是名称集合。必须排在其它判定之前：
  // 某些 MCP 工具名尾段恰好是 read/search 之类，会被误分类。
  if (isMcpToolName(name)) return 'mcp';

  const normalized = normalizeToolName(name);

  if (READ_TOOL_NAMES.has(normalized)) return 'read';
  if (EDIT_TOOL_NAMES.has(normalized)) return 'edit';
  if (BASH_TOOL_NAMES.has(normalized)) return 'bash';
  if (SEARCH_TOOL_NAMES.has(normalized)) return 'search';
  if (AGENT_TOOL_NAMES.has(normalized)) return 'agent';
  if (TODO_TOOL_NAMES.has(normalized)) return 'todo';
  if (WEB_TOOL_NAMES.has(normalized)) return 'web';
  if (PLAN_TOOL_NAMES.has(normalized)) return 'plan';

  return 'generic';
}

/** 文件路径目标信息 */
export interface ToolTargetInfo {
  /** 原始路径（input 中的值） */
  rawPath: string;
  /** 文件名（不含路径） */
  cleanFileName: string;
  /** 显示路径（相对路径优先） */
  displayPath: string;
  /** 打开路径（绝对路径） */
  openPath: string;
  /** 是否是文件 */
  isFile: boolean;
  /** 是否是目录 */
  isDirectory: boolean;
  /** 可选起始行 */
  lineStart?: number;
  /** 可选结束行 */
  lineEnd?: number;
}

/** 行号信息 */
export interface LineInfo {
  start?: number;
  end?: number;
}
