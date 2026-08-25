// GenericToolBlock - 通用工具块组件

import {memo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Globe, Plug, Wrench} from 'lucide-react';
import type {ToolResultBlock} from '../../types/chat';
import type {ToolInput} from '../../types/tools';
import {getToolType} from '../../types/tools';
import {formatMcpToolLabel, parseMcpToolName} from '../../utils/mcpToolName';
import {useIsToolDenied} from '../../hooks/useIsToolDenied';
import {
    extractResultText,
    formatToolResultDisplayText,
    getToolDisplayStatus,
    resolveToolTarget,
    summarizeGenericTool,
    summarizeToolResultText,
    truncateContent,
} from '../../utils/toolPresentation';
import {copyToClipboard, openFile} from '../../utils/bridge';
import {useChatStore} from '../../stores/useChatStore';
import {isToolBlockToggleActivationKey} from '../../utils/toolGrouping';

export interface GenericToolBlockProps {
  name?: string;
  input?: ToolInput;
  result?: ToolResultBlock | null;
  toolId?: string;
  compact?: boolean;
}

type GenericCopiedTarget = 'input' | 'output' | null;

function isAskUserQuestionTool(name?: string): boolean {
  const normalizedName = name?.toLowerCase();
  return normalizedName === 'askuserquestion' || normalizedName === 'ask_user_question';
}

const GenericToolBlock = memo(function GenericToolBlock({
  name,
  input,
  result,
  toolId,
  compact = false,
}: GenericToolBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<GenericCopiedTarget>(null);
  const copiedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDenied = useIsToolDenied(toolId);
  const currentCwd = useChatStore((state) => state.currentCwd);

  if (!input) {
    return null;
  }

  // 工具名称
  const toolName = name || t('tools.unknown');
  // MCP 工具的原始名是 mcp__<server>__<tool>，直接当标题既长又认不出来；
  // 拆成「插头图标 + 干净工具名」，server 由 actionSummary 的 chip 承担。
  const mcpName = parseMcpToolName(name);
  const displayToolName = mcpName
    ? (formatMcpToolLabel(mcpName.tool) || mcpName.server)
    : toolName;
  const TitleIcon = mcpName
    ? Plug
    : getToolType(name ?? '') === 'web'
      ? Globe
      : Wrench;
  const target = resolveToolTarget(input);
  const actionSummary = summarizeGenericTool(name, input);
  const command = typeof input.command === 'string'
    ? input.command
    : typeof input.cmd === 'string'
      ? input.cmd
      : '';
  const status = isAskUserQuestionTool(name) && result && !isDenied
    ? 'completed'
    : getToolDisplayStatus(result, isDenied);
  const isError = status === 'error';

  // 提取输入参数（排除内部字段）
  const inputParams = Object.entries(input).filter(
    ([key]) => ![
      'description',
      'command',
      'cmd',
      'workdir',
      'file_path',
      'filePath',
      'path',
      'target_file',
      'targetFile',
    ].includes(key)
  );

  // 提取结果文本
  const resultText = result ? extractResultText(result) : null;
  const displayResultText = resultText ? formatToolResultDisplayText(resultText) : null;
  const truncatedResult = displayResultText ? truncateContent(displayResultText, 10000) : null;
  const resultSummary = displayResultText ? summarizeToolResultText(displayResultText) : '';
  const hasExpandableContent = inputParams.length > 0 || Boolean(truncatedResult);
  const detailResultLabel = isError ? t('tools.errorOutput') : t('tools.result');
  const primarySummary = target
    ? target.displayPath
    : command
      ? actionSummary.summary
      : actionSummary.summary;
  const showResultSummary = Boolean(resultSummary) && resultSummary !== primarySummary;
  const openFileLabel = target?.isFile ? `${t('tools.openFile')}: ${target.displayPath}` : '';
  const headerToggleTarget = primarySummary || displayToolName;
  const headerToggleLabel = hasExpandableContent
    ? t('tools.genericDetailsToggle', { target: headerToggleTarget })
    : undefined;
  const copyInputLabel = t('tools.copyInput');
  const copyOutputLabel = t('tools.copyOutput');
  const copyInputActionLabel = t('tools.copyInputForTool', { target: headerToggleTarget });
  const copyOutputActionLabel = t('tools.copyOutputForTool', { target: headerToggleTarget });

  const markCopied = (target: Exclude<GenericCopiedTarget, null>) => {
    if (copiedResetTimerRef.current) {
      clearTimeout(copiedResetTimerRef.current);
    }
    setCopiedTarget(target);
    copiedResetTimerRef.current = setTimeout(() => {
      setCopiedTarget(null);
      copiedResetTimerRef.current = null;
    }, 2000);
  };

  // 复制功能
  const handleCopyInput = async (event?: React.MouseEvent) => {
    event?.stopPropagation();
    await copyToClipboard(JSON.stringify(input, null, 2));
    markCopied('input');
  };

  const handleCopyOutput = async (event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (displayResultText) {
      await copyToClipboard(displayResultText);
      markCopied('output');
    }
  };

  const toggleExpanded = () => setExpanded((prev) => !prev);

  const handleHeaderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasExpandableContent || !isToolBlockToggleActivationKey(event.key)) return;
    event.preventDefault();
    toggleExpanded();
  };

  if (compact && !hasExpandableContent) {
    return null;
  }

  const detailContent = (
    <div className="task-content-wrapper">
      {inputParams.length > 0 && (
        <div className="tool-section">
          <div className="tool-section-label">{t('tools.inputParameters')}:</div>
          <div className="tool-params">
            {inputParams.map(([key, value]) => (
              <div key={key} className="tool-param-row">
                <span className="tool-param-key">{key}:</span>
                <span className="tool-param-value">
                  {typeof value === 'object' && value !== null
                    ? JSON.stringify(value, null, 2)
                    : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {truncatedResult && (
        <div className="tool-section">
          <div className="tool-section-label">{detailResultLabel}:</div>
          <div className={`tool-result ${isError ? 'tool-result-error' : ''}`}>
            <pre className="tool-result-text">{truncatedResult}</pre>
          </div>
        </div>
      )}

      <div className="tool-actions">
        <button
          type="button"
          className={`btn btn-sm ${copiedTarget === 'input' ? 'btn-success' : 'btn-ghost'}`}
          title={copyInputActionLabel}
          aria-label={copyInputActionLabel}
          onClick={handleCopyInput}
        >
          {copiedTarget === 'input' ? t('tools.copied') : copyInputLabel}
        </button>
        {displayResultText && (
          <button
            type="button"
            className={`btn btn-sm ${copiedTarget === 'output' ? 'btn-success' : 'btn-ghost'}`}
            title={copyOutputActionLabel}
            aria-label={copyOutputActionLabel}
            onClick={handleCopyOutput}
          >
            {copiedTarget === 'output' ? t('tools.copied') : copyOutputLabel}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className={`task-container ${compact ? 'task-container-compact' : ''}`}>
      <div
        className={compact ? 'task-header task-header-compact' : 'task-header'}
        role={hasExpandableContent ? 'button' : undefined}
        tabIndex={hasExpandableContent ? 0 : undefined}
        aria-expanded={hasExpandableContent ? expanded : undefined}
        aria-label={headerToggleLabel}
        title={headerToggleLabel}
        onClick={hasExpandableContent ? toggleExpanded : undefined}
        onKeyDown={handleHeaderKeyDown}
        style={{ cursor: hasExpandableContent ? 'pointer' : 'default' }}
      >
        <div className="task-title-section">
          <TitleIcon className="tool-title-lucide" aria-hidden="true" />
          <span className="tool-title-text" title={mcpName ? toolName : undefined}>
            {displayToolName}
          </span>
          <span className={`tool-command-chip ${actionSummary.accentClass}`}>
            {actionSummary.label}
          </span>
          {target?.isFile ? (
            <button
              type="button"
              className="tool-title-summary file-path-link file-path-button clickable-file"
              title={openFileLabel}
              aria-label={openFileLabel}
              onClick={(event) => {
                event.stopPropagation();
                void openFile(target.openPath, target.lineStart, target.lineEnd, currentCwd);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
              }}
            >
              {target.displayPath}
            </button>
          ) : target ? (
            <span
              className="tool-title-summary file-path-link"
              title={target.rawPath}
              aria-label={target.rawPath}
            >
              {target.displayPath}
            </span>
          ) : command ? (
            <span
              className="tool-title-summary bash-command"
              title={command}
              aria-label={command}
            >
              {actionSummary.summary}
            </span>
          ) : actionSummary.summary ? (
            <span
              className="tool-title-summary task-group-item-pattern"
              title={actionSummary.summary}
              aria-label={actionSummary.summary}
            >
              {actionSummary.summary}
            </span>
          ) : null}
          {showResultSummary && (
            <span
              className={[
                'tool-title-secondary-summary',
                isError ? 'tool-title-secondary-summary-error' : '',
              ].filter(Boolean).join(' ')}
              title={displayResultText ?? resultSummary}
              aria-label={displayResultText ?? resultSummary}
            >
              {resultSummary}
            </span>
          )}
          {isDenied && <span className="tool-title-summary text-error">• {t('tools.denied')}</span>}
        </div>
        <div className={`tool-status-indicator ${status}`} />
      </div>

      {expanded && hasExpandableContent && (
        <div className={`task-details ${compact ? 'task-details-compact' : ''}`}>
          {detailContent}
        </div>
      )}
    </div>
  );
});

export default GenericToolBlock;
