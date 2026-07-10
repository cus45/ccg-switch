// CompactSummaryBlock - 上下文压缩续接摘要的折叠展示
//
// 压缩后 Claude Code 会注入一条很长的"This session is being continued…"
// user 消息（历史与实时流都有）。它是系统生成的上下文交接材料而非用户
// 发言，默认折叠成一张摘要卡，需要时展开查看全文。

import {useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Check, ChevronDown, ChevronRight, Copy, Layers} from 'lucide-react';
import MarkdownBlock from './MarkdownBlock';

interface CompactSummaryBlockProps {
    content: string;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function translateWithFallback(
    t: TranslateFn,
    key: string,
    fallback: string,
    options?: Record<string, unknown>,
): string {
    const translated = t(key, options);
    return translated === key ? fallback : translated;
}

export default function CompactSummaryBlock({content}: CompactSummaryBlockProps) {
    const {t} = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    const copyTimerRef = useRef<number | null>(null);

    const title = translateWithFallback(t, 'chat.compactSummary.title', 'Compacted context summary');
    const toggleLabel = expanded
        ? translateWithFallback(t, 'chat.compactSummary.collapse', 'Hide summary')
        : translateWithFallback(t, 'chat.compactSummary.expand', 'Show summary');
    const charCountLabel = translateWithFallback(
        t,
        'chat.compactSummary.charCount',
        `${content.length} chars`,
        {count: content.length},
    );
    const copyLabel = translateWithFallback(t, 'chat.message.copy', 'Copy');
    const copiedLabel = translateWithFallback(t, 'chat.message.copied', 'Copied');

    const handleCopy = async (event: React.MouseEvent) => {
        event.stopPropagation();
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            if (copyTimerRef.current !== null) {
                window.clearTimeout(copyTimerRef.current);
            }
            copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
        } catch (e) {
            console.error('[CompactSummaryBlock] Copy failed:', e);
        }
    };

    return (
        <div
            className="w-full overflow-hidden rounded-xl border border-base-300/70 bg-base-200/35"
            data-testid="chat-compact-summary"
        >
            <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-base-200/70"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                title={toggleLabel}
            >
                {expanded
                    ? <ChevronDown size={14} className="shrink-0 text-base-content/45" aria-hidden="true" />
                    : <ChevronRight size={14} className="shrink-0 text-base-content/45" aria-hidden="true" />}
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-base-content/10 text-base-content/55">
                    <Layers size={13} aria-hidden="true" />
                </span>
                <span className="text-xs font-medium text-base-content/75">{title}</span>
                <span className="shrink-0 rounded-full bg-base-content/10 px-1.5 py-0.5 text-[10px] leading-none text-base-content/45">
                    {charCountLabel}
                </span>
                {!expanded && (
                    <span className="min-w-0 flex-1 truncate text-[11px] text-base-content/40">
                        {content.replace(/\s+/g, ' ').trim()}
                    </span>
                )}
                <span
                    role="button"
                    tabIndex={0}
                    className={`btn btn-ghost btn-xs ml-auto h-6 min-h-0 shrink-0 px-1.5 ${copied ? 'text-success' : 'text-base-content/50'}`}
                    onClick={handleCopy}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            void handleCopy(event as unknown as React.MouseEvent);
                        }
                    }}
                    title={copied ? copiedLabel : copyLabel}
                    aria-label={copied ? copiedLabel : copyLabel}
                >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                </span>
            </button>

            {expanded && (
                <div className="max-h-[420px] overflow-y-auto border-t border-base-300/60 px-4 py-3 text-sm">
                    <MarkdownBlock content={content} />
                </div>
            )}
        </div>
    );
}
