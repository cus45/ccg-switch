// 工具展示相关的实用函数

import type {ToolResultBlock, ToolUseBlock} from '../types/chat';
import type {LineInfo, ToolInput, ToolTargetInfo} from '../types/tools';
import {formatMcpToolLabel, parseMcpToolName} from './mcpToolName';

interface PatchOperation {
  filePath: string;
  oldString: string;
  newString: string;
  diffPreviewLines: DiffPreviewLine[];
  startLine?: number;
  endLine?: number;
}

interface ExpandedEditInput {
  input: ToolInput;
  diffPreviewLines?: DiffPreviewLine[];
}

interface HunkLineInfo extends LineInfo {
  oldStart?: number;
  newStart?: number;
}

export type DiffPreviewLineKind = 'context' | 'removed' | 'added';

export interface DiffPreviewLine {
  kind: DiffPreviewLineKind;
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface EditToolItem {
  id: string;
  toolId: string;
  name: string;
  input: ToolInput;
  result: ToolResultBlock | null | undefined;
  filePath: string;
  displayPath: string;
  openPath: string;
  cleanFileName: string;
  oldString: string;
  newString: string;
  additions: number;
  deletions: number;
  diffPreviewLines: DiffPreviewLine[];
  lineStart?: number;
  lineEnd?: number;
  isCompleted: boolean;
  isError: boolean;
}

export interface CommandSummary {
  label: string;
  icon: string;
  accentClass: string;
  summary: string;
}

export interface BashGroupHeaderSummary {
  primarySummary: string;
  completedCount: number;
  errorCount: number;
  pendingCount: number;
  totalCount: number;
}

export interface ToolActionSummary {
  label: string;
  accentClass: string;
  summary: string;
}

export interface SearchResultFile {
  path: string;
  lineStart?: number;
  snippet?: string;
}

export interface SearchResultSummary {
  matchCount: number;
  fileCount: number;
  files: SearchResultFile[];
  omittedResultCount?: number;
}

export interface ReadGroupHeaderSummary {
  primarySummary: string;
  secondarySummary: string;
}

export interface SearchGroupHeaderSummary {
  primarySummary: string;
  secondarySummary: string;
  firstFileSummary: string;
}

export interface AgentToolMeta {
  description: string;
  prompt: string;
  subagentType: string;
  nickname: string;
  model: string;
  reasoningEffort: string;
  agentId: string;
}

export interface AgentToolTranscriptSummary {
  headerSummary: string;
  identitySummary: string;
  runtimeSummary: string;
  resultSummary: string;
  hasVisibleMeta: boolean;
}

export interface AgentToolHeaderSummary {
  primarySummary: string;
  secondarySummary: string;
  runtimeSummary: string;
  hasVisibleMeta: boolean;
}

export type ToolDisplayStatus = 'error' | 'completed' | 'pending';

export function getToolDisplayStatus(
  result: ToolResultBlock | null | undefined,
  isDenied = false,
): ToolDisplayStatus {
  const isCompleted = (result !== undefined && result !== null) || isDenied;
  const isError = isDenied || (isCompleted && result?.is_error === true);

  if (isError) return 'error';
  return isCompleted ? 'completed' : 'pending';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function trimmedStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function parseResultObject(result?: ToolResultBlock | null): Record<string, unknown> | null {
  const text = result ? extractResultText(result).trim() : '';
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) {
    return null;
  }

  try {
    const candidate = JSON.parse(text);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

export function shortenToolIdentifier(value?: string): string {
  if (!value) return '';
  return value.length > 8 ? `${value.slice(0, 8)}…` : value;
}

export function extractAgentToolMeta(
  input: ToolInput | Record<string, unknown>,
  result?: ToolResultBlock | null,
): AgentToolMeta {
  const parsed = parseResultObject(result);
  const resultText = result ? extractResultText(result) : '';

  const pick = (...values: unknown[]): string => {
    for (const value of values) {
      const normalized = trimmedStringValue(value);
      if (normalized) return normalized;
    }
    return '';
  };

  const extractedAgentId = resultText.match(/\b([0-9a-f]{8}-[0-9a-f-]{27})\b/i)?.[1] ?? '';
  const extractedModelGroups = resultText.match(/\(([A-Za-z0-9._:-]+)(?:\s+(low|medium|high|xhigh|max))?\)/i);

  return {
    description: pick(input.description, input.message),
    prompt: pick(input.prompt),
    subagentType: pick(input.subagent_type, input.subagentType, input.agent_type, input.agentType, input.name),
    nickname: pick(parsed?.nickname, parsed?.name, input.nickname, input.name),
    model: pick(parsed?.model, input.model, extractedModelGroups?.[1]),
    reasoningEffort: pick(
      parsed?.reasoning_effort,
      parsed?.reasoningEffort,
      input.reasoning_effort,
      input.reasoningEffort,
      extractedModelGroups?.[2],
    ),
    agentId: pick(
      parsed?.agent_id,
      parsed?.agentId,
      parsed?.agent_path,
      parsed?.agentPath,
      input.agent_id,
      input.agentId,
      extractedAgentId,
    ),
  };
}

const AGENT_TOOL_IGNORED_INPUT_KEYS = new Set([
  'description',
  'message',
  'prompt',
  'model',
  'reasoning_effort',
  'reasoningEffort',
  'nickname',
  'name',
  'agent_id',
  'agentId',
  'agent_path',
  'agentPath',
  'subagent_type',
  'subagentType',
  'agent_type',
  'agentType',
]);

export function getAgentToolExtraParams(input: ToolInput | Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(input).filter(([key]) => !AGENT_TOOL_IGNORED_INPUT_KEYS.has(key));
}

export function summarizeAgentToolMeta(
  meta: AgentToolMeta,
  result?: ToolResultBlock | null,
  toolKind: 'agent' | 'task' = 'agent',
): AgentToolTranscriptSummary {
  const resultSummary = summarizeToolResultText(result ? extractResultText(result) : '');
  const identitySummary = [
    toolKind === 'agent' ? meta.subagentType : '',
    meta.nickname,
  ].filter(Boolean).join(' · ');
  const modelSummary = [meta.model, meta.reasoningEffort].filter(Boolean).join(' ');
  const runtimeSummary = [
    modelSummary,
    shortenToolIdentifier(meta.agentId),
  ].filter(Boolean).join(' · ');
  const headerSummary = meta.description || meta.prompt || resultSummary;

  return {
    headerSummary,
    identitySummary,
    runtimeSummary,
    resultSummary,
    hasVisibleMeta: Boolean(
      meta.description
      || meta.prompt
      || meta.agentId
      || meta.model
      || meta.reasoningEffort
      || meta.subagentType
      || meta.nickname
      || resultSummary,
    ),
  };
}

export function summarizeAgentToolHeader(
  meta: AgentToolMeta,
  result?: ToolResultBlock | null,
  toolKind: 'agent' | 'task' = 'agent',
): AgentToolHeaderSummary {
  const summary = summarizeAgentToolMeta(meta, result, toolKind);

  return {
    primarySummary: summary.headerSummary,
    secondarySummary: summary.identitySummary || summary.resultSummary,
    runtimeSummary: summary.runtimeSummary,
    hasVisibleMeta: summary.hasVisibleMeta,
  };
}

function stripLineSuffix(filePath: string): string {
  return filePath.replace(/:\d+(?::\d+|-\d+)?$/, '');
}

function parseLineSuffix(filePath: string): LineInfo {
  const match = filePath.match(/:(\d+)(?:(-)(\d+)|:(\d+))?$/);
  if (!match) return {};

  const end = match[2] === '-' && match[3]
    ? Number(match[3])
    : undefined;

  return {
    start: Number(match[1]),
    end,
  };
}

function extractPatchContent(input: ToolInput): string | undefined {
  return stringValue(input.patch)
    ?? stringValue(input.input)
    ?? stringValue(input.content)
    ?? stringValue(input.command);
}

export function extractPathsFromPatch(patchContent: string): string[] {
  const paths: string[] = [];

  patchContent.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/);
    if (match?.[1]) {
      paths.push(match[1].trim());
      return;
    }

    const moveMatch = line.match(/^\*\*\* Move to:\s*(.+)$/);
    if (moveMatch?.[1] && paths.length > 0) {
      paths[paths.length - 1] = moveMatch[1].trim();
    }
  });

  return paths;
}

function parseHunkHeader(line: string): {
  start?: number;
  end?: number;
  oldStart?: number;
  newStart?: number;
} {
  const match = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!match) return {};

  const oldStart = Number(match[1]);
  const oldCount = match[2] ? Number(match[2]) : 1;
  const newStart = Number(match[3]);
  const newCount = match[4] ? Number(match[4]) : 1;
  const start = oldCount > 0 ? oldStart : newStart;
  const effectiveCount = oldCount > 0 ? oldCount : newCount;

  return {
    start,
    end: effectiveCount > 1 ? start + effectiveCount - 1 : undefined,
    oldStart,
    newStart,
  };
}

function parsePatchOperations(patchContent: string): PatchOperation[] {
  const operations: PatchOperation[] = [];
  let filePath: string | null = null;
  let oldLines: string[] = [];
  let newLines: string[] = [];
  let diffPreviewLines: DiffPreviewLine[] = [];
  let lineInfo: HunkLineInfo = {};
  let oldLineNumber: number | undefined;
  let newLineNumber: number | undefined;

  const flush = () => {
    if (!filePath) return;
    operations.push({
      filePath,
      oldString: oldLines.join('\n'),
      newString: newLines.join('\n'),
      diffPreviewLines,
      startLine: lineInfo.start,
      endLine: lineInfo.end,
    });
    oldLines = [];
    newLines = [];
    diffPreviewLines = [];
    lineInfo = {};
    oldLineNumber = undefined;
    newLineNumber = undefined;
  };

  patchContent.split(/\r?\n/).forEach((line) => {
    const fileMatch = line.match(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/);
    if (fileMatch?.[1]) {
      flush();
      filePath = fileMatch[1].trim();
      return;
    }

    const moveMatch = line.match(/^\*\*\* Move to:\s*(.+)$/);
    if (moveMatch?.[1] && filePath) {
      filePath = moveMatch[1].trim();
      return;
    }

    if (line.startsWith('*** End Patch')) {
      flush();
      filePath = null;
      return;
    }

    if (!filePath) return;

    if (line.startsWith('@@')) {
      flush();
      lineInfo = parseHunkHeader(line);
      oldLineNumber = lineInfo.oldStart;
      newLineNumber = lineInfo.newStart;
      return;
    }

    if (line.startsWith('+')) {
      const text = line.slice(1);
      newLines.push(text);
      diffPreviewLines.push({
        kind: 'added',
        text,
        ...(newLineNumber !== undefined ? { newLineNumber } : {}),
      });
      if (newLineNumber !== undefined) newLineNumber += 1;
    } else if (line.startsWith('-')) {
      const text = line.slice(1);
      oldLines.push(text);
      diffPreviewLines.push({
        kind: 'removed',
        text,
        ...(oldLineNumber !== undefined ? { oldLineNumber } : {}),
      });
      if (oldLineNumber !== undefined) oldLineNumber += 1;
    } else if (line.startsWith(' ')) {
      const text = line.slice(1);
      diffPreviewLines.push({
        kind: 'context',
        text,
        ...(oldLineNumber !== undefined ? { oldLineNumber } : {}),
        ...(newLineNumber !== undefined ? { newLineNumber } : {}),
      });
      if (oldLineNumber !== undefined) oldLineNumber += 1;
      if (newLineNumber !== undefined) newLineNumber += 1;
    }
  });

  flush();

  return operations.filter((operation) => (
    operation.filePath.trim().length > 0
    && (operation.oldString.length > 0 || operation.newString.length > 0)
  ));
}

function computeDiffStats(oldString: string, newString: string): { additions: number; deletions: number } {
  const oldLines = oldString ? oldString.split('\n') : [];
  const newLines = newString ? newString.split('\n') : [];

  if (oldLines.length === 0) return { additions: newLines.length, deletions: 0 };
  if (newLines.length === 0) return { additions: 0, deletions: oldLines.length };

  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  let additions = 0;
  let deletions = 0;
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      additions += 1;
      j -= 1;
    } else {
      deletions += 1;
      i -= 1;
    }
  }

  return { additions, deletions };
}

export function buildDiffPreviewLines(
  oldString: string,
  newString: string,
  startLine = 1,
): DiffPreviewLine[] {
  const oldLines = oldString ? oldString.split('\n') : [];
  const newLines = newString ? newString.split('\n') : [];
  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const reversed: DiffPreviewLine[] = [];
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({
        kind: 'context',
        oldLineNumber: startLine + i - 1,
        newLineNumber: startLine + j - 1,
        text: oldLines[i - 1],
      });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({
        kind: 'added',
        newLineNumber: startLine + j - 1,
        text: newLines[j - 1],
      });
      j -= 1;
    } else {
      reversed.push({
        kind: 'removed',
        oldLineNumber: startLine + i - 1,
        text: oldLines[i - 1],
      });
      i -= 1;
    }
  }

  return reversed.reverse();
}

function firstCommandToken(command: string): string {
  const token = command.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return token.replace(/^['"]?\.?[\\/]/, '').replace(/['"]$/g, '');
}

function truncateInline(text: string, maxLength = 96): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function summarizeToolResultText(resultText: string, maxLength = 84): string {
  const normalized = resultText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => (
      Boolean(line)
      && !/^Wall time:/i.test(line)
      && line.toLowerCase() !== 'output:'
    ));

  if (normalized.length === 0) {
    return '';
  }

  const firstLine = normalized[0].replace(/\s+/g, ' ').trim();
  if (!firstLine) {
    return '';
  }

  const hasMoreContent = normalized.length > 1;
  const truncated = truncateInline(firstLine, maxLength);

  if (hasMoreContent && !truncated.endsWith('…')) {
    return `${truncated}…`;
  }

  return truncated;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decodeEscapedToolText(text: string): string {
  const escapedLineBreaks = text.match(/\\r\\n|\\n/g)?.length ?? 0;
  if (escapedLineBreaks === 0 || /\r?\n/.test(text)) return text;

  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

function stringifyToolJson(value: unknown): string {
  if (typeof value === 'string') return decodeEscapedToolText(value);
  return JSON.stringify(value, null, 2) ?? String(value);
}

function textFromMcpTextBlocks(value: unknown): string | null {
  if (Array.isArray(value)) {
    const parts = value.map((item) => {
      if (isRecord(item) && typeof item.text === 'string') return decodeEscapedToolText(item.text);
      if (isRecord(item) && Array.isArray(item.content)) {
        return textFromMcpTextBlocks(item.content) ?? stringifyToolJson(item);
      }
      return stringifyToolJson(item);
    }).filter((part) => part.trim().length > 0);

    return parts.length > 0 ? parts.join('\n') : null;
  }

  if (isRecord(value) && typeof value.text === 'string') {
    return decodeEscapedToolText(value.text);
  }

  if (isRecord(value) && Array.isArray(value.content)) {
    return textFromMcpTextBlocks(value.content);
  }

  return null;
}

function parseJsonToolText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const textBlocks = textFromMcpTextBlocks(parsed);
    return textBlocks ?? stringifyToolJson(parsed);
  } catch {
    return null;
  }
}

function decodeToolOutputJsonSection(text: string): string | null {
  const markerMatch = /(?:^|\r?\n)Output:\s*/.exec(text);
  if (!markerMatch || markerMatch.index === undefined) return null;

  const markerStart = markerMatch.index + (text[markerMatch.index] === '\n' || text[markerMatch.index] === '\r' ? 1 : 0);
  const outputStart = markerMatch.index + markerMatch[0].length;
  const prefix = text.slice(0, markerStart).trimEnd();
  const outputJson = text.slice(outputStart).trim();
  const decodedOutput = parseJsonToolText(outputJson);
  if (!decodedOutput) return null;

  return prefix ? `${prefix}\nOutput:\n${decodedOutput}` : decodedOutput;
}

export function formatToolResultDisplayText(resultText: string): string {
  if (!resultText.trim()) return resultText;

  return decodeToolOutputJsonSection(resultText)
    ?? parseJsonToolText(resultText)
    ?? decodeEscapedToolText(resultText);
}

export interface BashHeaderResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function summarizeBashHeaderResult(result: BashHeaderResult): string {
  const preferredText = result.exitCode === 0 ? result.stdout : result.stderr || result.stdout;
  const summary = summarizeToolResultText(preferredText);

  if (summary) {
    return summary;
  }

  return `Exit ${result.exitCode}`;
}

export function summarizeGroupBashItemResult(result: ToolResultBlock | null | undefined): string {
  if (!result) {
    return '';
  }

  const text = extractResultText(result);

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return summarizeBashHeaderResult({
      exitCode: typeof parsed.exit_code === 'number'
        ? parsed.exit_code
        : typeof parsed.exitCode === 'number'
          ? parsed.exitCode
          : result.is_error
            ? 1
            : 0,
      stdout: typeof parsed.stdout === 'string' ? parsed.stdout : '',
      stderr: typeof parsed.stderr === 'string' ? parsed.stderr : '',
    });
  } catch {
    return summarizeBashHeaderResult({
      exitCode: result.is_error ? 1 : 0,
      stdout: text,
      stderr: '',
    });
  }
}

export function summarizeBashGroupHeader(
  blocks: ToolUseBlock[],
  findToolResult: (toolId: string) => ToolResultBlock | null | undefined,
): BashGroupHeaderSummary {
  const firstCommand = blocks[0]?.input?.command;
  const primarySummary = typeof firstCommand === 'string'
    ? summarizeCommand(firstCommand).summary
    : '';

  let completedCount = 0;
  let errorCount = 0;
  let pendingCount = 0;

  blocks.forEach((block) => {
    const result = findToolResult(block.id);
    if (!result) {
      pendingCount += 1;
      return;
    }

    if (result.is_error) {
      errorCount += 1;
      return;
    }

    completedCount += 1;
  });

  return {
    primarySummary,
    completedCount,
    errorCount,
    pendingCount,
    totalCount: blocks.length,
  };
}

export function summarizeCommand(command: string): CommandSummary {
  const trimmed = command.trim();
  const token = firstCommandToken(trimmed);
  const lower = trimmed.toLowerCase();
  const words = lower.split(/\s+/).map((word) => word.replace(/^['"]|['"]$/g, ''));

  if (lower.includes('apply_patch') || lower.includes('*** begin patch')) {
    return {
      label: 'Patch',
      icon: 'diff',
      accentClass: 'tool-command-patch',
      summary: 'Apply patch',
    };
  }

  if (token === 'npm' || token === 'pnpm' || token === 'yarn' || token === 'bun') {
    const script = words.slice(1).join(' ');
    if (/\b(install|add|update|upgrade|ci)\b/.test(script)) {
      return {
        label: 'Install',
        icon: 'pkg',
        accentClass: 'tool-command-install',
        summary: truncateInline(trimmed),
      };
    }

    if (/\b(test|vitest|jest|playwright)\b/.test(script)) {
      return {
        label: 'Test',
        icon: 'test',
        accentClass: 'tool-command-test',
        summary: truncateInline(trimmed),
      };
    }

    if (/\b(build|compile|tsc|vite build)\b/.test(script)) {
      return {
        label: 'Build',
        icon: 'build',
        accentClass: 'tool-command-build',
        summary: truncateInline(trimmed),
      };
    }

    if (/\b(dev|start|serve|preview)\b/.test(script)) {
      return {
        label: 'Run',
        icon: 'run',
        accentClass: 'tool-command-run',
        summary: truncateInline(trimmed),
      };
    }

    return {
      label: 'Package',
      icon: 'pkg',
      accentClass: 'tool-command-package',
      summary: truncateInline(trimmed),
    };
  }

  if (token === 'git') {
    return {
      label: 'Git',
      icon: 'git',
      accentClass: 'tool-command-git',
      summary: truncateInline(trimmed),
    };
  }

  if (token === 'cargo' || token === 'rustup') {
    if (words.includes('test')) {
      return {
        label: 'Test',
        icon: 'test',
        accentClass: 'tool-command-test',
        summary: truncateInline(trimmed),
      };
    }

    if (words.some((word) => ['build', 'check', 'clippy'].includes(word))) {
      return {
        label: 'Build',
        icon: 'rs',
        accentClass: 'tool-command-build',
        summary: truncateInline(trimmed),
      };
    }

    return {
      label: 'Rust',
      icon: 'rs',
      accentClass: 'tool-command-rust',
      summary: truncateInline(trimmed),
    };
  }

  if (['vitest', 'jest', 'playwright'].includes(token)) {
    return {
      label: 'Test',
      icon: 'test',
      accentClass: 'tool-command-test',
      summary: truncateInline(trimmed),
    };
  }

  if (token === 'tsc' || token === 'vite' || token === 'webpack') {
    return {
      label: 'Build',
      icon: 'build',
      accentClass: 'tool-command-build',
      summary: truncateInline(trimmed),
    };
  }

  if (token === 'rg' || token === 'grep' || lower.includes('select-string') || lower.includes('findstr')) {
    return {
      label: 'Search',
      icon: 'find',
      accentClass: 'tool-command-search',
      summary: truncateInline(trimmed),
    };
  }

  if (['cat', 'type', 'gc', 'get-content'].includes(token)) {
    return {
      label: 'Read',
      icon: 'read',
      accentClass: 'tool-command-read',
      summary: truncateInline(trimmed),
    };
  }

  if (['ls', 'dir', 'get-childitem', 'gci'].includes(token)) {
    return {
      label: 'List',
      icon: 'list',
      accentClass: 'tool-command-list',
      summary: truncateInline(trimmed),
    };
  }

  if (['pwd', 'cd', 'set-location'].includes(token)) {
    return {
      label: 'Shell',
      icon: 'sh',
      accentClass: 'tool-command-shell',
      summary: truncateInline(trimmed),
    };
  }

  return {
    label: 'Command',
    icon: '$',
    accentClass: 'tool-command-default',
    summary: truncateInline(trimmed || 'command'),
  };
}

export function summarizeSearchInput(input: ToolInput): string {
  return stringValue(input.pattern)
    ?? stringValue(input.query)
    ?? stringValue(input.search_term)
    ?? stringValue(input.searchTerm)
    ?? stringValue(input.glob)
    ?? stringValue(input.path)
    ?? stringValue(input.file_pattern)
    ?? stringValue(input.filePattern)
    ?? '';
}

function parseSearchResultLine(line: string): SearchResultFile | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(.+\.(?:ts|tsx|js|jsx|rs|py|java|json|md|css|scss|sass|less|toml|yaml|yml|html|xml|vue|svelte|go|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|rb|sh|ps1|sql)):(\d+)(?::\d+)?:\s*(.*)$/i);
  if (match?.[1]) {
    const snippet = match[3]?.trim();
    return {
      path: match[1],
      lineStart: Number(match[2]),
      ...(snippet ? {snippet: truncateInline(snippet, 120)} : {}),
    };
  }

  const fileOnly = trimmed.match(/^(.+\.(?:ts|tsx|js|jsx|rs|py|java|json|md|css|scss|sass|less|toml|yaml|yml|html|xml|vue|svelte|go|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|rb|sh|ps1|sql))(?:\s|$)/i);
  if (fileOnly?.[1]) {
    return { path: fileOnly[1] };
  }

  return null;
}

export function summarizeSearchResultText(text: string): SearchResultSummary {
  const files: SearchResultFile[] = [];
  const visibleResultKeys = new Set<string>();
  const filePaths = new Set<string>();
  let parsedMatchLines = 0;

  text.split(/\r?\n/).forEach((line) => {
    const file = parseSearchResultLine(line);
    if (!file) return;

    parsedMatchLines += 1;
    filePaths.add(file.path.toLowerCase());

    const key = [
      file.path.toLowerCase(),
      file.lineStart ?? '',
      file.snippet ?? '',
    ].join(':');
    if (!visibleResultKeys.has(key)) {
      visibleResultKeys.add(key);
      files.push(file);
    }
  });

  const explicitMatches = text.match(/(\d+)\s+matches?/i);
  const explicitFiles = text.match(/(\d+)\s+files?/i);

  const visibleFiles = files.slice(0, 8);
  const totalResultRows = explicitMatches ? Number(explicitMatches[1]) : files.length;
  const omittedResultCount = Math.max(0, totalResultRows - visibleFiles.length);

  return {
    matchCount: explicitMatches ? Number(explicitMatches[1]) : parsedMatchLines,
    fileCount: explicitFiles ? Number(explicitFiles[1]) : filePaths.size,
    files: visibleFiles,
    ...(omittedResultCount ? {omittedResultCount} : {}),
  };
}

export function summarizeReadGroupHeader(blocks: ToolUseBlock[]): ReadGroupHeaderSummary {
  const firstTarget = resolveToolTarget(blocks[0]?.input ?? {});

  return {
    primarySummary: firstTarget?.displayPath ?? '',
    secondarySummary: `${blocks.length} ${blocks.length === 1 ? 'file' : 'files'}`,
  };
}

export function summarizeSearchGroupHeader(
  _label: string,
  pattern: string,
  summary: SearchResultSummary,
): SearchGroupHeaderSummary {
  const secondaryParts: string[] = [];
  if (summary.matchCount > 0) {
    secondaryParts.push(`${summary.matchCount} ${summary.matchCount === 1 ? 'match' : 'matches'}`);
  }
  if (summary.fileCount > 0) {
    secondaryParts.push(`${summary.fileCount} ${summary.fileCount === 1 ? 'file' : 'files'}`);
  }

  return {
    primarySummary: pattern,
    secondarySummary: secondaryParts.join(' · '),
    firstFileSummary: summary.files[0]?.path ?? '',
  };
}

function normalizeDisplayName(name: string): string {
  if (!name) return 'Tool';
  if (name.includes('_') || name.includes('-')) {
    return name
      .split(/[_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }
  return name.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function summarizeGenericTool(name: string | undefined, input: ToolInput): ToolActionSummary {
  const toolName = normalizeDisplayName(name ?? 'Tool');
  const lowerName = (name ?? '').toLowerCase().replace(/[-_]/g, '');
  const target = resolveToolTarget(input);
  const command = typeof input.command === 'string'
    ? input.command
    : typeof input.cmd === 'string'
      ? input.cmd
      : '';

  // MCP 工具优先按 server/tool 呈现：入参形态由第三方 server 决定，无法穷举，
  // 而「哪个 server 的哪个能力」才是用户唯一能靠它认出这次调用的信息。
  // 必须早于 target/command 判定——否则带 file_path 的 MCP 工具会被显示成普通文件操作，
  // 看不出是外部服务调用。
  const mcpName = parseMcpToolName(name);
  if (mcpName) {
    const toolLabel = formatMcpToolLabel(mcpName.tool);
    return {
      label: mcpName.server,
      accentClass: 'tool-command-mcp',
      summary: truncateInline(
        toolLabel
          || stringValue(input.description)
          || stringValue(input.prompt)
          || target?.displayPath
          || mcpName.server,
      ),
    };
  }

  if (target) {
    return {
      label: 'File',
      accentClass: 'tool-command-read',
      summary: target.displayPath,
    };
  }

  if (command) {
    const commandSummary = summarizeCommand(command);
    return {
      label: commandSummary.label,
      accentClass: commandSummary.accentClass,
      summary: commandSummary.summary,
    };
  }

  // Web 判定必须早于 summarizeSearchInput：WebSearch 的入参就是 `query`，
  // 会先命中搜索分支，导致联网搜索和本地 Grep 在转录里长得一模一样
  // （原来的 websearch 分支因此是死代码）。
  if (lowerName.includes('webfetch')) {
    return {
      label: 'Fetch',
      accentClass: 'tool-command-web',
      summary: truncateInline(stringValue(input.url) ?? stringValue(input.prompt) ?? toolName),
    };
  }

  if (lowerName.includes('websearch')) {
    return {
      label: 'Web',
      accentClass: 'tool-command-web',
      summary: truncateInline(stringValue(input.query) ?? toolName),
    };
  }

  const searchSummary = summarizeSearchInput(input);
  if (searchSummary) {
    return {
      label: lowerName.includes('glob') ? 'Glob' : 'Search',
      accentClass: 'tool-command-search',
      summary: truncateInline(searchSummary),
    };
  }

  if (lowerName.includes('todo') || lowerName.includes('plan')) {
    return {
      label: 'Plan',
      accentClass: 'tool-command-plan',
      summary: stringValue(input.description) ?? stringValue(input.prompt) ?? toolName,
    };
  }

  return {
    label: 'Tool',
    accentClass: 'tool-command-default',
    summary: stringValue(input.description) ?? stringValue(input.prompt) ?? toolName,
  };
}

/**
 * 解析工具的文件路径目标
 * @param input 工具输入参数
 * @returns 文件路径目标信息，如果无法解析则返回 null
 */
export function resolveToolTarget(
  input: ToolInput,
): ToolTargetInfo | null {
  // 优先级：file_path > path > target_file
  const standardPath = stringValue(input.file_path)
    ?? stringValue(input.filePath)
    ?? stringValue(input.path)
    ?? stringValue(input.target_file)
    ?? stringValue(input.targetFile);
  const patchContent = standardPath ? undefined : extractPatchContent(input);
  const rawPath = standardPath ?? (patchContent ? extractPathsFromPatch(patchContent)[0] : undefined);

  if (!rawPath || typeof rawPath !== 'string') {
    return null;
  }

  const openPath = stripLineSuffix(rawPath);

  // 判断是否是绝对路径
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(openPath) || openPath.startsWith('/') || openPath.startsWith('\\');

  // 提取文件名
  const cleanFileName = openPath.split(/[/\\]/).pop() || openPath;

  // 判断是否是目录（以 / 或 \ 结尾）
  const isDirectory = rawPath.endsWith('/') || rawPath.endsWith('\\');

  // 显示路径（如果是绝对路径，尝试转为相对路径）
  let displayPath = rawPath;
  if (isAbsolute) {
    // 尝试提取 src/ 之后的路径
    const match = openPath.match(/[/\\](src|pages|components|utils|styles|hooks|stores|types)[/\\].*/);
    if (match) {
      displayPath = match[0].substring(1); // 移除开头的 /
    }
  }

  const lineInfo = parseLineSuffix(rawPath);

  return {
    rawPath,
    cleanFileName,
    displayPath: stripLineSuffix(displayPath),
    openPath,
    isFile: !isDirectory,
    isDirectory,
    ...(lineInfo.start !== undefined ? { lineStart: lineInfo.start } : {}),
    ...(lineInfo.end !== undefined ? { lineEnd: lineInfo.end } : {}),
  };
}

/**
 * 提取工具调用的行号信息
 * @param input 工具输入参数
 * @returns 行号信息
 */
export function getToolLineInfo(
  input: ToolInput,
  target?: ToolTargetInfo | null,
): LineInfo {
  const offset = numberValue(input.offset);
  const limit = numberValue(input.limit);
  if (offset !== undefined && limit !== undefined) {
    return {
      start: offset + 1,
      end: offset + limit,
    };
  }

  const line = numberValue(input.line);
  if (line !== undefined) {
    return { start: line };
  }

  const start = numberValue(input.start_line);
  const end = numberValue(input.end_line);

  return {
    start: start ?? target?.lineStart,
    end: end ?? target?.lineEnd,
  };
}

function buildEditItem(
  block: ToolUseBlock,
  input: ToolInput,
  result: ToolResultBlock | null | undefined,
  index: number,
  diffPreviewLines?: DiffPreviewLine[],
): EditToolItem | null {
  const target = resolveToolTarget(input);
  if (!target) return null;

  const oldString = stringValue(input.old_string)
    ?? stringValue(input.oldString)
    ?? stringValue(input.oldText)
    ?? '';
  const newString = stringValue(input.new_string)
    ?? stringValue(input.newString)
    ?? stringValue(input.newText)
    ?? stringValue(input.content)
    ?? '';
  const stats = computeDiffStats(oldString, newString);
  const lineInfo = getToolLineInfo(input, target);
  const previewLines = diffPreviewLines && diffPreviewLines.length > 0
    ? diffPreviewLines
    : buildDiffPreviewLines(oldString, newString, lineInfo.start ?? target.lineStart ?? 1);
  const isCompleted = result !== undefined && result !== null;
  const isError = isCompleted && result?.is_error === true;

  return {
    id: `${block.id}-${index}`,
    toolId: block.id,
    name: block.name,
    input,
    result,
    filePath: target.rawPath,
    displayPath: target.displayPath,
    openPath: target.openPath,
    cleanFileName: target.cleanFileName,
    oldString,
    newString,
    additions: stats.additions,
    deletions: stats.deletions,
    diffPreviewLines: previewLines,
    lineStart: lineInfo.start ?? target.lineStart,
    lineEnd: lineInfo.end ?? target.lineEnd,
    isCompleted,
    isError,
  };
}

function expandEditInputs(block: ToolUseBlock): ExpandedEditInput[] {
  const patchContent = extractPatchContent(block.input);
  if (patchContent?.includes('*** Begin Patch')) {
    return parsePatchOperations(patchContent).map((operation) => ({
      input: {
        ...block.input,
        file_path: operation.filePath,
        old_string: operation.oldString,
        new_string: operation.newString,
        start_line: operation.startLine,
        end_line: operation.endLine,
      },
      diffPreviewLines: operation.diffPreviewLines,
    }));
  }

  if (Array.isArray(block.input.edits) && block.input.edits.length > 0) {
    return block.input.edits
      .map((edit): ExpandedEditInput | null => {
        if (!edit || typeof edit !== 'object') return null;
        const editInput = edit as ToolInput;
        return {
          input: {
            ...block.input,
            ...editInput,
            file_path: stringValue(editInput.file_path)
              ?? stringValue(editInput.filePath)
              ?? stringValue(editInput.path)
              ?? stringValue(block.input.file_path)
              ?? stringValue(block.input.filePath)
              ?? stringValue(block.input.path),
            old_string: stringValue(editInput.old_string)
              ?? stringValue(editInput.oldString)
              ?? stringValue(editInput.oldText)
              ?? stringValue(block.input.old_string)
              ?? stringValue(block.input.oldString),
            new_string: stringValue(editInput.new_string)
              ?? stringValue(editInput.newString)
              ?? stringValue(editInput.newText)
              ?? stringValue(block.input.new_string)
              ?? stringValue(block.input.newString),
          },
        };
      })
      .filter((item): item is ExpandedEditInput => item !== null);
  }

  return [{ input: block.input }];
}

export function collectEditToolItems(
  blocks: ToolUseBlock[],
  findToolResult: (toolId: string) => ToolResultBlock | null | undefined,
): EditToolItem[] {
  return blocks.flatMap((block) => {
    const result = findToolResult(block.id);
    return expandEditInputs(block)
      .map(({ input, diffPreviewLines }, index) => buildEditItem(block, input, result, index, diffPreviewLines))
      .filter((item): item is EditToolItem => item !== null);
  });
}

function normalizeEditMergeKey(item: EditToolItem): string {
  return (item.openPath || item.filePath || item.displayPath)
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function mergeLineStart(current: number | undefined, next: number | undefined): number | undefined {
  if (current === undefined) return next;
  if (next === undefined) return current;
  return Math.min(current, next);
}

function mergeLineEnd(current: number | undefined, next: number | undefined): number | undefined {
  if (current === undefined) return next;
  if (next === undefined) return current;
  return Math.max(current, next);
}

interface MergeEditToolItemsOptions {
  order?: 'first' | 'last';
  diffPreviewLineLimit?: number;
}

interface MergedEditItemEntry {
  item: EditToolItem;
  firstIndex: number;
  lastIndex: number;
}

export function mergeEditToolItemsByFile(
  items: EditToolItem[],
  options: MergeEditToolItemsOptions = {},
): EditToolItem[] {
  const mergedByFile = new Map<string, EditToolItem>();
  const mergedEntries: MergedEditItemEntry[] = [];

  items.forEach((item, index) => {
    const key = normalizeEditMergeKey(item);
    const existing = mergedByFile.get(key);

    if (!existing) {
      const firstItem: EditToolItem = {
        ...item,
        id: `${item.id}-file`,
        diffPreviewLines: [...item.diffPreviewLines],
      };
      mergedByFile.set(key, firstItem);
      mergedEntries.push({
        item: firstItem,
        firstIndex: index,
        lastIndex: index,
      });
      return;
    }

    const entry = mergedEntries.find((candidate) => candidate.item === existing);
    if (entry) {
      entry.lastIndex = index;
    }

    existing.id = `${existing.id}+${item.id}`;
    existing.oldString = [existing.oldString, item.oldString].filter(Boolean).join('\n');
    existing.newString = [existing.newString, item.newString].filter(Boolean).join('\n');
    existing.additions += item.additions;
    existing.deletions += item.deletions;
    existing.diffPreviewLines = [
      ...existing.diffPreviewLines,
      ...item.diffPreviewLines,
    ].slice(0, options.diffPreviewLineLimit);
    existing.lineStart = mergeLineStart(existing.lineStart, item.lineStart);
    existing.lineEnd = mergeLineEnd(existing.lineEnd, item.lineEnd);
    existing.isCompleted = existing.isCompleted && item.isCompleted;
    existing.isError = existing.isError || item.isError;
    if (item.isError) {
      existing.result = item.result;
    }
  });

  return [...mergedEntries]
    .sort((left, right) => (
      options.order === 'last'
        ? right.lastIndex - left.lastIndex
        : left.firstIndex - right.firstIndex
    ))
    .map((entry) => entry.item);
}

/**
 * 提取工具结果的文本内容
 * @param result 工具结果对象
 * @returns 文本内容
 */
export function extractResultText(result: { content?: unknown }): string {
  if (!result.content) return '';

  if (typeof result.content === 'string') {
    return result.content;
  }

  return textFromMcpTextBlocks(result.content) ?? stringifyToolJson(result.content);
}

/**
 * 截断过长的文本内容
 * @param content 原始内容
 * @param maxLength 最大长度（默认 10000）
 * @returns 截断后的内容
 */
export function truncateContent(content: string, maxLength = 10000): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength) + '\n\n... (内容过长，已截断)';
}

/**
 * 格式化行号范围显示
 * @param lineInfo 行号信息
 * @param t 国际化函数
 * @returns 格式化字符串（如 "L50-L100" 或 "L50"）
 */
export function formatLineRange(lineInfo: LineInfo, t?: (key: string, params?: Record<string, unknown>) => string): string {
  if (!lineInfo.start) return '';

  if (lineInfo.end && lineInfo.end !== lineInfo.start) {
    return t
      ? t('tools.lineRange', { start: lineInfo.start, end: lineInfo.end })
      : `L${lineInfo.start}-L${lineInfo.end}`;
  }

  return t
    ? t('tools.lineSingle', { line: lineInfo.start })
    : `L${lineInfo.start}`;
}
