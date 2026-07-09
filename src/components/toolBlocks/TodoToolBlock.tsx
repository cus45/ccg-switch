// TodoToolBlock - TodoWrite 计划可视化块（对标 desktop-cc-gui PlanPanel）

import {memo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Check, Circle, ListTodo, Loader2} from 'lucide-react';
import type {ToolResultBlock} from '../../types/chat';
import type {TodoItem, ToolInput} from '../../types/tools';
import {parseTodoItems} from '../../types/tools';
import {useIsToolDenied} from '../../hooks/useIsToolDenied';
import {getToolDisplayStatus} from '../../utils/toolPresentation';
import {isToolBlockToggleActivationKey} from '../../utils/toolGrouping';

export interface TodoToolBlockProps {
  name?: string;
  input?: ToolInput;
  result?: ToolResultBlock | null;
  toolId?: string;
  compact?: boolean;
}

function todoItemIcon(status: TodoItem['status']) {
  switch (status) {
    case 'completed':
      return <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />;
    case 'in_progress':
      return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />;
    default:
      return <Circle className="h-3 w-3 shrink-0 text-base-content/30" aria-hidden="true" />;
  }
}

function todoItemTextClass(status: TodoItem['status']): string {
  switch (status) {
    case 'completed':
      return 'text-base-content/45 line-through';
    case 'in_progress':
      return 'text-base-content font-medium';
    default:
      return 'text-base-content/70';
  }
}

const TodoToolBlock = memo(function TodoToolBlock({
  name: _name,
  input,
  result,
  toolId,
  compact = false,
}: TodoToolBlockProps) {
  const { t } = useTranslation();
  // 计划清单默认展开：进度可视是该块的核心价值
  const [expanded, setExpanded] = useState(true);
  const isDenied = useIsToolDenied(toolId);

  const todos = parseTodoItems(input);
  if (todos.length === 0) {
    return null;
  }

  const completedCount = todos.filter((item) => item.status === 'completed').length;
  const inProgress = todos.find((item) => item.status === 'in_progress');
  const progressLabel = t('tools.todoProgress', { completed: completedCount, total: todos.length });
  const progressPct = Math.round((completedCount / todos.length) * 100);
  const currentLabel = inProgress ? (inProgress.activeForm || inProgress.content) : '';
  const status = getToolDisplayStatus(result, isDenied);
  const headerToggleLabel = t('tools.todoDetailsToggle');

  const toggleExpanded = () => setExpanded((prev) => !prev);

  const handleHeaderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isToolBlockToggleActivationKey(event.key)) return;
    event.preventDefault();
    toggleExpanded();
  };

  return (
    <div className={`task-container ${compact ? 'task-container-compact' : ''}`}>
      <div
        className={compact ? 'task-header task-header-compact' : 'task-header'}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={headerToggleLabel}
        title={headerToggleLabel}
        onClick={toggleExpanded}
        onKeyDown={handleHeaderKeyDown}
        style={{ cursor: 'pointer' }}
      >
        <div className="task-title-section">
          <ListTodo className="tool-title-lucide" aria-hidden="true" />
          <span className="tool-title-text">{t('tools.todo')}</span>
          <span className="tool-title-summary" title={progressLabel} aria-label={progressLabel}>
            {progressLabel}
          </span>
          <span
            className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-base-content/10"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              className={`block h-full rounded-full transition-all duration-300 ${
                progressPct >= 100 ? 'bg-success' : 'bg-primary'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </span>
          {!expanded && currentLabel && (
            <span className="tool-title-summary" title={currentLabel}>
              {currentLabel}
            </span>
          )}
          {isDenied && <span className="tool-title-summary text-error">• {t('tools.denied')}</span>}
        </div>
        <div className={`tool-status-indicator ${status}`} />
      </div>

      {expanded && (
        <div className={`task-details ${compact ? 'task-details-compact' : ''}`}>
          <div className="task-content-wrapper">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {todos.map((item, index) => (
                <li key={`${index}-${item.content}`} className="flex items-start gap-2 text-sm leading-5">
                  <span className="mt-0.5 flex h-4 w-4 items-center justify-center">
                    {todoItemIcon(item.status)}
                  </span>
                  <span className={todoItemTextClass(item.status)}>
                    {item.status === 'in_progress' && item.activeForm ? item.activeForm : item.content}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
});

export default TodoToolBlock;
