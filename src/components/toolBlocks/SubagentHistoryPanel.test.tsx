import {beforeEach, describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import SubagentHistoryPanel, {SubagentProcessSummary} from './SubagentHistoryPanel';
import type {ToolResultBlock} from '../../types/chat';
import {buildSubagentProcessModel} from './subagentHistoryUtils';

interface MockChatState {
  provider: 'claude' | 'codex';
  activeSession: { providerId?: 'claude' | 'codex'; sourcePath?: string | null } | null;
  sessionId: string | null;
  currentCwd: string | null;
}

const useChatStoreMock = vi.fn();

vi.mock('../../services/subagentHistoryService', () => ({
  loadClaudeSubagentHistory: vi.fn(),
}));

vi.mock('../../stores/useChatStore', () => ({
  useChatStore: (selector: (state: MockChatState) => unknown) => useChatStoreMock(selector),
  // 面板在无 pane 上下文（tab 未命中）时回退全局投影。
  useChatTab: () => null,
}));

function mockStoreState(overrides: Partial<MockChatState> = {}) {
  const state = {
    provider: 'claude',
    activeSession: null,
    sessionId: 'session-42',
    currentCwd: 'C:/guodevelop/ccg-switch',
    ...overrides,
  } as MockChatState;

  useChatStoreMock.mockImplementation((selector: (input: MockChatState) => unknown) => selector(state));
}

describe('SubagentHistoryPanel', () => {
  beforeEach(() => {
    useChatStoreMock.mockReset();
  });

  it('renders a lightweight unavailable placeholder when the provider is not claude', () => {
    mockStoreState({ provider: 'codex' });

    const html = renderToStaticMarkup(
      <SubagentHistoryPanel
        agentId="agent-42"
        description="inspect chat ui"
        enabled
      />,
    );

    expect(html).toContain('子代理历史');
    expect(html).toContain('当前会话缺少可匹配的子代理历史');
  });

  it('renders runtime stats and full output affordance when task result metadata exists', () => {
    mockStoreState();
    const result = {
      type: 'tool_result',
      tool_use_id: 'task-1',
      is_error: false,
      content: JSON.stringify({
        agent_id: 'agent-42',
        totalDurationMs: 1200,
        totalTokens: 3456,
        totalToolUseCount: 7,
      }) + '\n最终输出第一行\n最终输出第二行',
    } satisfies ToolResultBlock;

    const html = renderToStaticMarkup(
      <SubagentHistoryPanel
        agentId="agent-42"
        description="inspect chat ui"
        enabled
        result={result}
      />,
    );

    expect(html).toContain('执行过程');
    expect(html).toContain('7 次工具调用');
    expect(html).toContain('3,456');
    expect(html).toContain('查看完整输出');
  });

  it('renders clickable subagent file affordances and structured tool rows in process summary', () => {
    const process = buildSubagentProcessModel([
      {
        id: 'm1',
        role: 'assistant',
        content: '已读取文件并完成检查',
        raw: {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-read-1',
                name: 'Read',
                input: {
                  file_path: 'C:/guodevelop/ccg-switch/src/components/chat/MessageList.tsx',
                  start_line: 24,
                  end_line: 48,
                },
              },
              {
                type: 'tool_use',
                id: 'tool-grep-1',
                name: 'Grep',
                input: {
                  pattern: 'subagentHistory',
                },
              },
              {
                type: 'tool_result',
                tool_use_id: 'tool-grep-1',
                content: [
                  'src/components/toolBlocks/SubagentHistoryPanel.tsx:146: subagentHistory',
                  'src/components/toolBlocks/subagentHistoryUtils.ts:432: subagentHistory',
                ].join('\n'),
                is_error: false,
              },
              {
                type: 'tool_use',
                id: 'tool-edit-1',
                name: 'Edit',
                input: {
                  file_path: 'C:/guodevelop/ccg-switch/src/components/chat/MessageItem.tsx',
                  old_string: 'before',
                  new_string: 'after',
                },
              },
            ],
          },
        },
        createdAt: 1,
      },
    ], {
      totalDurationMs: 1200,
      totalTokens: 3456,
      totalToolUseCount: 2,
      fullResultText: '最终输出第一行\n最终输出第二行',
      summaryText: '最终输出第一行\n最终输出第二行',
    });

    const html = renderToStaticMarkup(
      <SubagentProcessSummary
        agentId="agent-42"
        requestSessionId="session-42"
        currentCwd="C:/guodevelop/ccg-switch"
        process={process}
      />,
    );

    expect(html).toContain('打开文件：…/src/components/chat/MessageList.tsx');
    expect(html).toContain('L24-L48');
    expect(html).toContain('打开文件：src/components/toolBlocks/SubagentHistoryPanel.tsx');
    expect(html).toContain('L146');
    expect(html).toContain('subagentHistory');
    expect(html).toContain('2 matches in 2 files');
    expect(html).toContain('3,456');
    expect(html).toContain('tool-command-search');
    expect(html).toContain('subagent-tool-row');
    expect(html).toContain('subagent-tool-row-target');
  });

  it('renders list-like process rows with clickable result files instead of generic text blobs', () => {
    const process = buildSubagentProcessModel([
      {
        id: 'm1',
        role: 'assistant',
        content: '已列出目录内容。',
        raw: {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-list-1',
                name: 'List',
                input: {},
              },
              {
                type: 'tool_result',
                tool_use_id: 'tool-list-1',
                content: [
                  'src/components/toolBlocks/subagentHistoryUtils.ts',
                  'src/components/toolBlocks/SubagentHistoryPanel.tsx',
                ].join('\n'),
                is_error: false,
              },
            ],
          },
        },
        createdAt: 1,
      },
    ]);

    const html = renderToStaticMarkup(
      <SubagentProcessSummary
        agentId="agent-42"
        requestSessionId="session-42"
        currentCwd="C:/guodevelop/ccg-switch"
        process={process}
      />,
    );

    expect(html).toContain('tool-command-list');
    expect(html).toContain('打开文件：src/components/toolBlocks/subagentHistoryUtils.ts');
    expect(html).toContain('2 files');
  });

  it('renders parsed command output summaries for bash-like process rows', () => {
    const process = buildSubagentProcessModel([
      {
        id: 'm1',
        role: 'assistant',
        content: '已执行命令。',
        raw: {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-bash-1',
                name: 'Bash',
                input: {
                  command: 'npm run build',
                },
              },
              {
                type: 'tool_result',
                tool_use_id: 'tool-bash-1',
                content: JSON.stringify({
                  stdout: 'Build completed successfully\nGenerated dist bundle',
                  stderr: '',
                  exit_code: 0,
                }),
                is_error: false,
              },
            ],
          },
        },
        createdAt: 1,
      },
    ]);

    const html = renderToStaticMarkup(
      <SubagentProcessSummary
        agentId="agent-42"
        requestSessionId="session-42"
        currentCwd="C:/guodevelop/ccg-switch"
        process={process}
      />,
    );

    expect(html).toContain('tool-command-build');
    expect(html).toContain('npm run build');
    expect(html).toContain('Build completed successfully…');
    expect(html).not.toContain('&quot;stdout&quot;');
  });

  it('renders readable summaries for fetch-like process rows', () => {
    const process = buildSubagentProcessModel([
      {
        id: 'm1',
        role: 'assistant',
        content: '已抓取页面。',
        raw: {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-web-1',
                name: 'Fetch',
                input: {
                  url: 'https://example.com/docs',
                },
              },
              {
                type: 'tool_result',
                tool_use_id: 'tool-web-1',
                content: JSON.stringify({
                  title: 'Example Domain',
                  status: 200,
                  content: 'Example Domain\nThis domain is for use in illustrative examples.',
                }),
                is_error: false,
              },
            ],
          },
        },
        createdAt: 1,
      },
    ]);

    const html = renderToStaticMarkup(
      <SubagentProcessSummary
        agentId="agent-42"
        requestSessionId="session-42"
        currentCwd="C:/guodevelop/ccg-switch"
        process={process}
      />,
    );

    expect(html).toContain('tool-command-web');
    expect(html).toContain('https://example.com/docs');
    expect(html).toContain('Example Domain');
    expect(html).not.toContain('&quot;status&quot;');
  });

  it('renders glob-like process rows with file-count summaries instead of match counts', () => {
    const process = buildSubagentProcessModel([
      {
        id: 'm1',
        role: 'assistant',
        content: '已列出匹配文件。',
        raw: {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-glob-1',
                name: 'Glob',
                input: {
                  pattern: 'src/components/**/*.tsx',
                },
              },
              {
                type: 'tool_result',
                tool_use_id: 'tool-glob-1',
                content: [
                  'src/components/toolBlocks/SubagentHistoryPanel.tsx',
                  'src/components/toolBlocks/subagentHistoryUtils.ts',
                ].join('\n'),
                is_error: false,
              },
            ],
          },
        },
        createdAt: 1,
      },
    ]);

    const html = renderToStaticMarkup(
      <SubagentProcessSummary
        agentId="agent-42"
        requestSessionId="session-42"
        currentCwd="C:/guodevelop/ccg-switch"
        process={process}
      />,
    );

    expect(html).toContain('tool-command-search');
    expect(html).toContain('src/components/**/*.tsx');
    expect(html).toContain('打开文件：src/components/toolBlocks/SubagentHistoryPanel.tsx');
    expect(html).toContain('2 files');
    expect(html).not.toContain('2 matches in 2 files');
  });

  it('renders human-readable summaries for generic json tool rows', () => {
    const process = buildSubagentProcessModel([
      {
        id: 'm1',
        role: 'assistant',
        content: '已完成部署。',
        raw: {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-generic-1',
                name: 'ToolSearch',
                input: {
                  query: 'deployment logs',
                },
              },
              {
                type: 'tool_result',
                tool_use_id: 'tool-generic-1',
                content: JSON.stringify({
                  status: 'ok',
                  message: 'Deployment finished successfully',
                  details: '2 services restarted',
                }),
                is_error: false,
              },
            ],
          },
        },
        createdAt: 1,
      },
    ]);

    const html = renderToStaticMarkup(
      <SubagentProcessSummary
        agentId="agent-42"
        requestSessionId="session-42"
        currentCwd="C:/guodevelop/ccg-switch"
        process={process}
      />,
    );

    expect(html).toContain('deployment logs');
    expect(html).toContain('Deployment finished successfully');
    expect(html).not.toContain('&quot;details&quot;');
  });

  it('does not repeat raw json detail text once a readable result summary exists', () => {
    const process = buildSubagentProcessModel([
      {
        id: 'm1',
        role: 'assistant',
        content: '已完成部署。',
        raw: {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-generic-2',
                name: 'SomeTool',
                input: {
                  description: 'sync metadata',
                },
              },
              {
                type: 'tool_result',
                tool_use_id: 'tool-generic-2',
                content: JSON.stringify({
                  message: 'Metadata sync completed',
                  details: '12 records updated',
                }),
                is_error: false,
              },
            ],
          },
        },
        createdAt: 1,
      },
    ]);

    const html = renderToStaticMarkup(
      <SubagentProcessSummary
        agentId="agent-42"
        requestSessionId="session-42"
        currentCwd="C:/guodevelop/ccg-switch"
        process={process}
      />,
    );

    expect(html).toContain('Metadata sync completed');
    expect(html).not.toContain('&quot;details&quot;');
    expect(html).not.toContain('&quot;message&quot;');
  });
});
