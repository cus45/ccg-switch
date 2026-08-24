import {memo, useEffect, useMemo, useRef} from 'react';
import {renderMarkdownToHtml} from '../../utils/markdownRuntime';

const COPY_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const CHECK_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';

export interface MarkdownFragmentProps {
    /** 本块的 Markdown 源码切片。 */
    text: string;
    /** 走流式运行时（无语言自动探测、无 KaTeX、补全未闭合 fence）。 */
    streaming: boolean;
    /**
     * 渲染运行时版本号。KaTeX 装载完成后由 MarkdownBlock +1，使已渲染的完成态
     * fragment 重算 HTML 让公式生效。流式期间恒传 0，保证冻结块不被无谓失效。
     */
    runtimeVersion: number;
    copyCodeLabel: string;
    copiedCodeLabel: string;
}

/**
 * Markdown 单块渲染单元。
 *
 * 流式期间正文被 `splitMarkdownBlocks` 切成多块，每块一个本组件实例。冻结块的
 * `text` 在后续追加中保证不变，memo 命中后既不重新解析、也不重建 DOM —— 这是
 * 「流式期间文本选中不丢失」与「单帧成本与正文长度脱钩」两件事的共同前提。
 *
 * 全部 props 都是原始值，因此默认浅比较即可，不需要自定义比较器。
 *
 * 容器是 `display: contents`（见 App.css `.markdown-fragment`），布局上等价于把
 * 块内容平铺进 `.markdown-block`，既不影响既有排版规则，也不引入额外盒子。
 */
function MarkdownFragment({
    text,
    streaming,
    runtimeVersion,
    copyCodeLabel,
    copiedCodeLabel,
}: MarkdownFragmentProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    const html = useMemo(
        () => renderMarkdownToHtml(text, {streaming}),
        // runtimeVersion: KaTeX 装载完成后需重跑解析
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [text, streaming, runtimeVersion],
    );

    // 代码块包装：语言标签头栏 + 常驻复制按钮。
    // 作用域收窄到本 fragment：冻结块的 html 不变 → 这个 effect 只跑一次，
    // 不再像改造前那样每帧对整条消息的所有代码块重做 DOM 手术。
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return undefined;

        const cleanupCallbacks: Array<() => void> = [];
        container.querySelectorAll('pre > code').forEach((codeBlock) => {
            const pre = codeBlock.parentElement;
            if (!pre || pre.closest('.code-block-frame')) return;

            const langMatch = /language-([\w+#.-]+)/.exec(codeBlock.className);
            const lang = langMatch?.[1]?.toLowerCase() ?? '';

            const frame = document.createElement('div');
            frame.className = 'code-block-frame';
            const header = document.createElement('div');
            header.className = 'code-block-header';
            const langLabel = document.createElement('span');
            langLabel.className = 'code-block-lang';
            langLabel.textContent = lang || 'text';
            header.appendChild(langLabel);

            const button = document.createElement('button');
            button.className = 'copy-button';
            button.innerHTML = COPY_ICON_SVG;
            button.title = copyCodeLabel;
            button.setAttribute('aria-label', copyCodeLabel);

            let resetTimer: number | null = null;
            const handleCopy = async () => {
                const code = codeBlock.textContent || '';
                try {
                    await navigator.clipboard.writeText(code);
                    button.innerHTML = CHECK_ICON_SVG;
                    button.classList.add('copied');
                    button.title = copiedCodeLabel;
                    button.setAttribute('aria-label', copiedCodeLabel);
                    resetTimer = window.setTimeout(() => {
                        button.innerHTML = COPY_ICON_SVG;
                        button.classList.remove('copied');
                        button.title = copyCodeLabel;
                        button.setAttribute('aria-label', copyCodeLabel);
                    }, 2000);
                } catch (e) {
                    console.error('[MarkdownFragment] Copy failed:', e);
                }
            };

            button.addEventListener('click', handleCopy);
            header.appendChild(button);

            pre.replaceWith(frame);
            frame.append(header, pre);
            cleanupCallbacks.push(() => {
                button.removeEventListener('click', handleCopy);
                if (resetTimer !== null) {
                    window.clearTimeout(resetTimer);
                }
            });
        });

        return () => cleanupCallbacks.forEach((cleanup) => cleanup());
    }, [copyCodeLabel, copiedCodeLabel, html]);

    return (
        <div
            ref={containerRef}
            className="markdown-fragment"
            dangerouslySetInnerHTML={{__html: html}}
        />
    );
}

export default memo(MarkdownFragment);
