import {memo, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
    containsMathSyntax,
    ensureKatexLoaded,
    isKatexReady,
} from '../../utils/markdownRuntime';
import {splitMarkdownBlocks} from '../../utils/markdownBlocks';
import MarkdownFragment from './MarkdownFragment';
import MermaidViewer from './MermaidViewer';

export {containsMathSyntax};

/**
 * 流式期间是否启用块级增量渲染。置 false 走改造前的「整条消息全量重解析」路径，
 * 作为出问题时的一键回滚开关。
 */
const INCREMENTAL_MARKDOWN = true;

// ============================================================
// Mermaid 图表（懒加载：渲染完成的 ```mermaid 代码块为 SVG）
// ============================================================

let mermaidSeq = 0;

async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
    const nodes = Array.from(container.querySelectorAll('pre > code.language-mermaid'));
    if (nodes.length === 0) return;

    const mermaid = (await import('mermaid')).default;
    const isDark = typeof document !== 'undefined'
        && document.documentElement.getAttribute('data-theme') === 'dark';
    mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDark ? 'dark' : 'default',
    });

    for (const node of nodes) {
        const pre = node.parentElement;
        // 容器可能已被后续渲染替换/卸载
        if (!pre || !pre.isConnected) continue;
        const source = node.textContent ?? '';
        if (!source.trim()) continue;
        mermaidSeq += 1;
        try {
            const {svg} = await mermaid.render(`ccg-mermaid-${mermaidSeq}`, source);
            if (!pre.isConnected) continue;
            const wrapper = document.createElement('div');
            wrapper.className = 'mermaid-diagram';
            wrapper.innerHTML = svg;
            wrapper.setAttribute('data-mermaid-source', source);
            // 代码块若已被语言标签头包裹，连同外框一起替换
            const host = pre.closest('.code-block-frame') ?? pre;
            host.replaceWith(wrapper);
        } catch {
            // 语法错误等：保留原代码块展示源码（mermaid.render 失败会遗留
            // 临时错误节点，清理掉避免污染页面）
            document.getElementById(`dccg-mermaid-${mermaidSeq}`)?.remove();
        }
    }
}

interface MarkdownBlockProps {
    content: string;
    isStreaming?: boolean;
}

function translateWithFallback(t: (key: string) => string, key: string, fallback: string): string {
    const translated = t(key);
    return translated === key ? fallback : translated;
}

export function getMarkdownCodeCopyLabels(t: (key: string) => string) {
    return {
        copyCodeLabel: translateWithFallback(t, 'chat.markdown.copyCode', 'Copy code'),
        copiedCodeLabel: translateWithFallback(t, 'chat.markdown.copiedCode', 'Copied code'),
    };
}

/**
 * Markdown 渲染编排器。
 *
 * 流式期间把正文按 CommonMark 块边界切开（{@link splitMarkdownBlocks}），每块交给
 * memo 的 {@link MarkdownFragment}：冻结块文本不变 → 不重新解析、DOM 不重建。
 * 单帧排版成本因此与已累积正文长度脱钩（改造前是整条消息全量 re-parse）。
 *
 * 流式结束 / 历史消息走单一 fragment 的全量渲染，语言自动探测、KaTeX、Mermaid
 * 都在这条路径上生效——流式期间的刻意降级在这里自愈。
 */
function MarkdownBlock({content, isStreaming = false}: MarkdownBlockProps) {
    const {t} = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const {copyCodeLabel, copiedCodeLabel} = useMemo(() => getMarkdownCodeCopyLabels(t), [t]);
    // katex 扩展装载完成后 +1，触发完成态 fragment 重算 html 使公式生效
    const [mathRuntimeVersion, setMathRuntimeVersion] = useState(isKatexReady() ? 1 : 0);
    // 全屏查看中的 mermaid SVG（点击图表打开）
    const [mermaidViewerSvg, setMermaidViewerSvg] = useState<string | null>(null);

    const incremental = INCREMENTAL_MARKDOWN && isStreaming;

    // 提前装载：流式期间也开始拉 KaTeX，settle 时公式可以直接成型，
    // 避免「先看到一坨 TeX 源码、过一会才变公式」的二段跳。
    const needsMath = useMemo(() => containsMathSyntax(content), [content]);
    useEffect(() => {
        if (!needsMath || isKatexReady()) return undefined;
        let cancelled = false;
        void ensureKatexLoaded().then(() => {
            if (!cancelled && isKatexReady()) setMathRuntimeVersion((v) => v + 1);
        });
        return () => {
            cancelled = true;
        };
    }, [needsMath]);

    const fragments = useMemo(
        () => (incremental ? splitMarkdownBlocks(content) : null),
        [content, incremental],
    );

    // Mermaid 图表渲染：流式期间跳过（图源不完整），完成后把代码块替换为 SVG
    useEffect(() => {
        if (isStreaming) return undefined;
        const container = containerRef.current;
        if (!container || !content.includes('mermaid')) return undefined;

        let cancelled = false;
        // 延迟一拍：连续快速更新（如历史批量载入）时合并渲染
        const timer = window.setTimeout(() => {
            if (cancelled) return;
            void renderMermaidBlocks(container).catch((e) => {
                console.error('[MarkdownBlock] Mermaid render failed:', e);
            });
        }, 80);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [content, isStreaming, mathRuntimeVersion]);

    // 点击 mermaid 图 → 全屏查看（缩放/平移）。事件委托，重渲染后的 DOM 仍生效。
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return undefined;
        const handleClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            const diagram = target?.closest?.('.mermaid-diagram');
            if (!diagram || !container.contains(diagram)) return;
            const svg = diagram.innerHTML;
            if (svg.trim()) setMermaidViewerSvg(svg);
        };
        container.addEventListener('click', handleClick);
        return () => container.removeEventListener('click', handleClick);
    }, []);

    return (
        <>
            <div ref={containerRef} className="markdown-block">
                {fragments
                    ? fragments.map((fragment) => (
                        <MarkdownFragment
                            key={fragment.key}
                            text={fragment.text}
                            streaming
                            runtimeVersion={0}
                            copyCodeLabel={copyCodeLabel}
                            copiedCodeLabel={copiedCodeLabel}
                        />
                    ))
                    : (
                        <MarkdownFragment
                            text={content}
                            streaming={isStreaming}
                            runtimeVersion={mathRuntimeVersion}
                            copyCodeLabel={copyCodeLabel}
                            copiedCodeLabel={copiedCodeLabel}
                        />
                    )}
            </div>
            {mermaidViewerSvg && (
                <MermaidViewer
                    svg={mermaidViewerSvg}
                    onClose={() => setMermaidViewerSvg(null)}
                />
            )}
        </>
    );
}

export default memo(MarkdownBlock);
