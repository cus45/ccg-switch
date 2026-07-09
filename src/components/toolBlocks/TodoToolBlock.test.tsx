import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {ToolResultBlock} from '../../types/chat';
import TodoToolBlock from './TodoToolBlock';

const mockUseState = vi.hoisted(() => vi.fn());

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: mockUseState,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      options && 'completed' in options
        ? `${key}: ${String(options.completed)}/${String(options.total)}`
        : key
    ),
  }),
}));

vi.mock('../../hooks/useIsToolDenied', () => ({
  useIsToolDenied: () => false,
}));

beforeEach(() => {
  mockUseState.mockReset();
});

function mockComponentState(expanded: boolean) {
  mockUseState.mockImplementation(() => [expanded, vi.fn()]);
}

const SAMPLE_TODOS = [
  { content: '扫描代码', status: 'completed', activeForm: '正在扫描代码' },
  { content: '实现功能', status: 'in_progress', activeForm: '正在实现功能' },
  { content: '运行测试', status: 'pending', activeForm: '正在运行测试' },
];

const SUCCESS_RESULT: ToolResultBlock = {
  type: 'tool_result',
  tool_use_id: 'todo-1',
  content: 'Todos have been modified successfully',
};

describe('TodoToolBlock', () => {
  it('输入缺失或 todos 为空时渲染 null', () => {
    mockComponentState(true);
    expect(renderToStaticMarkup(createElement(TodoToolBlock, {}))).toBe('');
    expect(renderToStaticMarkup(createElement(TodoToolBlock, {
      input: { todos: [] },
    }))).toBe('');
    expect(renderToStaticMarkup(createElement(TodoToolBlock, {
      input: { todos: [{ status: 'pending' }, 42, null] },
    }))).toBe('');
  });

  it('展开时渲染全部计划项并按状态区分样式', () => {
    mockComponentState(true);
    const html = renderToStaticMarkup(createElement(TodoToolBlock, {
      input: { todos: SAMPLE_TODOS },
      result: SUCCESS_RESULT,
      toolId: 'todo-1',
    }));

    expect(html).toContain('tools.todo');
    expect(html).toContain('tools.todoProgress: 1/3');
    expect(html).toContain('扫描代码');
    // in_progress 项优先展示 activeForm
    expect(html).toContain('正在实现功能');
    expect(html).not.toContain('>实现功能<');
    expect(html).toContain('运行测试');
    expect(html).toContain('line-through');
    expect(html).toContain('animate-spin');
  });

  it('收起时头部显示当前进行中的项', () => {
    mockComponentState(false);
    const html = renderToStaticMarkup(createElement(TodoToolBlock, {
      input: { todos: SAMPLE_TODOS },
      result: SUCCESS_RESULT,
      toolId: 'todo-1',
    }));

    expect(html).toContain('正在实现功能');
    expect(html).not.toContain('扫描代码');
  });

  it('未知状态归为 pending 并保留渲染', () => {
    mockComponentState(true);
    const html = renderToStaticMarkup(createElement(TodoToolBlock, {
      input: { todos: [{ content: '异常状态项', status: 'weird' }] },
    }));

    expect(html).toContain('异常状态项');
    expect(html).toContain('tools.todoProgress: 0/1');
  });
});
