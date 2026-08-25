import {memo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ChevronDown, ChevronRight, ClipboardList} from 'lucide-react';
import type {ToolResultBlock} from '../../types/chat';
import type {ToolInput} from '../../types/tools';
import {useIsToolDenied} from '../../hooks/useIsToolDenied';
import {getToolDisplayStatus} from '../../utils/toolPresentation';
import MarkdownBlock from '../chat/MarkdownBlock';

export interface PlanToolBlockProps {
    name?: string;
    input?: ToolInput;
    result?: ToolResultBlock | null;
    toolId?: string;
    compact?: boolean;
}

function translateWithFallback(
    t: (key: string, options?: Record<string, unknown>) => string,
    key: string,
    fallback: string,
    options?: Record<string, unknown>,
): string {
    const translated = t(key, options);
    return translated === key ? fallback : translated;
}

/** 从 ExitPlanMode 的入参里取计划正文，兼容几种字段写法。 */
export function extractPlanText(input?: ToolInput | null): string {
    if (!input) return '';

    const candidates = [input.plan, input.content, input.description, input.prompt];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }

    return '';
}

/**
 * ExitPlanMode 卡片。
 *
 * 改造前这个工具落到 GenericToolBlock，计划正文作为普通入参被打印成一坨纯文本
 * ——而它恰恰是这一轮里最需要被读懂的内容（用户要据此决定批不批）。这里默认展开
 * 并按 Markdown 渲染，与 PlanApprovalDialog 里看到的是同一份东西。
 */
const PlanToolBlock = memo(function PlanToolBlock({
    name,
    input,
    result,
    toolId,
    compact = false,
}: PlanToolBlockProps) {
    const {t} = useTranslation();
    const isDenied = useIsToolDenied(toolId);
    const planText = extractPlanText(input);
    // 计划是本轮的决策依据，默认展开；用户读完可以收起。
    const [expanded, setExpanded] = useState(true);

    if (!planText) return null;

    const status = getToolDisplayStatus(result, isDenied);
    const title = translateWithFallback(t, 'tools.planProposed', 'Proposed plan');
    const toggleLabel = expanded
        ? translateWithFallback(t, 'tools.collapsePlan', 'Collapse plan')
        : translateWithFallback(t, 'tools.expandPlan', 'Expand plan');

    return (
        <div
            className={`tool-block plan-tool-block ${compact ? 'tool-block-compact' : ''}`}
            data-tool-status={status}
            data-tool-name={name}
        >
            <button
                type="button"
                className="tool-header plan-tool-header"
                aria-expanded={expanded}
                aria-label={toggleLabel}
                title={toggleLabel}
                onClick={() => setExpanded((current) => !current)}
            >
                {expanded
                    ? <ChevronDown size={13} className="tool-title-lucide" aria-hidden="true" />
                    : <ChevronRight size={13} className="tool-title-lucide" aria-hidden="true" />}
                <ClipboardList size={13} className="tool-title-lucide" aria-hidden="true" />
                <span className="tool-title-text">{title}</span>
                <span className="tool-command-chip tool-command-plan">Plan</span>
            </button>

            {expanded && (
                <div className="plan-tool-body">
                    <MarkdownBlock content={planText} />
                </div>
            )}
        </div>
    );
});

export default PlanToolBlock;
