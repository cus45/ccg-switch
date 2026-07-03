import {useEffect, useId, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ChevronDown, Loader2, MessageCircle} from 'lucide-react';
import MarkdownBlock from './MarkdownBlock';

interface ThinkingBlockProps {
    content: string;
    defaultExpanded?: boolean;
    title?: string;
    compact?: boolean;
    /** 该思考块正在流式产出（最后一条流式 assistant 消息的活跃思考块）。 */
    streaming?: boolean;
}

/**
 * Thinking 块组件 - 显示 Claude 的推理过程
 * 默认折叠，点击展开显示完整 Markdown 内容
 */
export default function ThinkingBlock({
    content,
    defaultExpanded = false,
    title,
    compact = false,
    streaming = false,
}: ThinkingBlockProps) {
    const { t } = useTranslation();
    const panelId = useId();
    const manualToggleRef = useRef(false);
    const [expanded, setExpanded] = useState(defaultExpanded);

    useEffect(() => {
        if (defaultExpanded && !manualToggleRef.current) {
            setExpanded(true);
        }
    }, [defaultExpanded]);

    const handleToggle = () => {
        manualToggleRef.current = true;
        setExpanded((current) => !current);
    };

    return (
        <div
            className={compact
                ? 'thinking-block my-1.5 rounded-md border border-base-300/70 bg-base-200/20'
                : 'thinking-block my-2 rounded-lg border border-base-300 bg-base-200/30'}
        >
            <button
                type="button"
                className={compact
                    ? 'flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-base-200/40'
                    : 'flex w-full items-center gap-2 rounded-lg p-3 text-left transition-colors hover:bg-base-200/50'}
                onClick={handleToggle}
                aria-expanded={expanded}
                aria-controls={panelId}
            >
                {streaming ? (
                    <Loader2 size={compact ? 14 : 16} className="flex-shrink-0 animate-spin text-primary/70" />
                ) : (
                    <MessageCircle size={compact ? 14 : 16} className="text-base-content/60 flex-shrink-0" />
                )}
                <span
                    className={`${compact ? 'flex-1 text-[11.5px] text-base-content/65' : 'flex-1 text-sm text-base-content/70'}${streaming ? ' animate-pulse' : ''}`}
                >
                    {title ?? t('chat.thinking.title')}
                </span>
                <ChevronDown
                    size={compact ? 14 : 16}
                    className={`text-base-content/60 transition-transform duration-200 flex-shrink-0 ${
                        expanded ? 'rotate-180' : ''
                    }`}
                />
            </button>

            {expanded && (
                <div
                    id={panelId}
                    className={compact
                        ? 'border-t border-base-300/70 px-2.5 pb-2.5 pt-1 animate-fadeIn'
                        : 'border-t border-base-300 px-3 pb-3 pt-1 animate-fadeIn'}
                >
                    <MarkdownBlock content={content} />
                </div>
            )}
        </div>
    );
}
