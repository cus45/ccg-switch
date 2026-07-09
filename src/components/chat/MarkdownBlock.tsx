import {marked} from 'marked';
import DOMPurify from 'dompurify';
import {memo, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import hljs from 'highlight.js/lib/core';
import {markedHighlight} from 'marked-highlight';
import MermaidViewer from './MermaidViewer';

// 导入常用语言
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

// 导入样式：以 github(浅色) 为基底，深色主题下由 App.css 的
// [data-theme="dark"] .hljs 覆盖为 github-dark 调色板，使代码块跟随主题。
import 'highlight.js/styles/github.css';

// 注册语言
const languages = [
    ['bash', bash],
    ['css', css],
    ['diff', diff],
    ['go', go],
    ['java', java],
    ['javascript', javascript],
    ['json', json],
    ['kotlin', kotlin],
    ['python', python],
    ['rust', rust],
    ['sql', sql],
    ['typescript', typescript],
    ['xml', xml],
    ['yaml', yaml],
] as const;

languages.forEach(([name, lang]) => {
    hljs.registerLanguage(name, lang);
});

// 注册别名
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['sh', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['html'], { languageName: 'xml' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });

// 配置 marked 使用语法高亮
marked.use(
    markedHighlight({
        highlight(code: string, lang: string) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch {
                    // Fall through
                }
            }
            return hljs.highlightAuto(code).value;
        },
    })
);

// 配置 marked 选项
marked.setOptions({
    gfm: true, // GitHub Flavored Markdown
    breaks: true, // 换行符转换为 <br>
});

// ============================================================
// KaTeX 数学公式（懒加载：首次检测到公式才拉取扩展与样式）
// ============================================================

/** 块级 $$...$$ 或成对内联 $...$（内容不以空白开头/结尾，排除货币写法误伤） */
const MATH_PATTERN = /\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]*?[^\s$]\$/;

let katexReady = false;
let katexLoading: Promise<void> | null = null;

function ensureKatexLoaded(): Promise<void> {
    if (!katexLoading) {
        katexLoading = Promise.all([
            import('marked-katex-extension'),
            import('katex/dist/katex.min.css'),
        ]).then(([extension]) => {
            marked.use(extension.default({throwOnError: false}));
            katexReady = true;
        }).catch((e) => {
            console.error('[MarkdownBlock] Failed to load KaTeX:', e);
            katexLoading = null;
        });
    }
    return katexLoading;
}

export function containsMathSyntax(content: string): boolean {
    return content.includes('$') && MATH_PATTERN.test(content);
}

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

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'file:']);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;

function isSafeHref(href: string): boolean {
    const trimmedHref = href.trim();

    if (!trimmedHref || CONTROL_CHARACTER_PATTERN.test(trimmedHref)) {
        return false;
    }

    if (
        trimmedHref.startsWith('#')
        || trimmedHref.startsWith('/')
        || trimmedHref.startsWith('./')
        || trimmedHref.startsWith('../')
        || WINDOWS_DRIVE_PATH_PATTERN.test(trimmedHref)
    ) {
        return true;
    }

    if (!URL_SCHEME_PATTERN.test(trimmedHref)) {
        return true;
    }

    try {
        return SAFE_LINK_PROTOCOLS.has(new URL(trimmedHref).protocol);
    } catch {
        return false;
    }
}

function sanitizeMarkdownHtml(rawHtml: string): string {
    const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
        ALLOW_UNKNOWN_PROTOCOLS: true,
    });

    if (typeof document === 'undefined') {
        return sanitizedHtml;
    }

    const template = document.createElement('template');
    template.innerHTML = sanitizedHtml;

    template.content.querySelectorAll('a[href]').forEach((link) => {
        const href = link.getAttribute('href');

        if (!href || !isSafeHref(href)) {
            link.removeAttribute('href');
            return;
        }

        if (/^https?:/i.test(href)) {
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
        }
    });

    return template.innerHTML;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
 * Markdown 渲染组件
 * 支持代码高亮、GFM、代码复制按钮
 */
function MarkdownBlock({ content, isStreaming = false }: MarkdownBlockProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const {copyCodeLabel, copiedCodeLabel} = useMemo(() => getMarkdownCodeCopyLabels(t), [t]);
    // katex 扩展装载完成后 +1，触发重算 html 使公式生效
    const [mathRuntimeVersion, setMathRuntimeVersion] = useState(katexReady ? 1 : 0);
    // 全屏查看中的 mermaid SVG（点击图表打开）
    const [mermaidViewerSvg, setMermaidViewerSvg] = useState<string | null>(null);

    const needsMath = useMemo(() => containsMathSyntax(content), [content]);
    useEffect(() => {
        if (!needsMath || katexReady) return;
        let cancelled = false;
        void ensureKatexLoaded().then(() => {
            if (!cancelled && katexReady) setMathRuntimeVersion((v) => v + 1);
        });
        return () => {
            cancelled = true;
        };
    }, [needsMath]);

    // 渲染 Markdown
    const html = useMemo(() => {
        let markdown = content;

        // 流式渲染：自动补全未闭合的代码块
        if (isStreaming && content.includes('```')) {
            const openCount = (content.match(/```/g) || []).length;
            if (openCount % 2 === 1) {
                markdown = content + '\n```';
            }
        }

        try {
            const rawHtml = marked.parse(markdown) as string;
            return sanitizeMarkdownHtml(rawHtml);
        } catch (e) {
            console.error('[MarkdownBlock] Parse error:', e);
            return escapeHtml(content);
        }
        // mathRuntimeVersion: katex 装载完成后需重跑 marked.parse
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content, isStreaming, mathRuntimeVersion]);

    // Mermaid 图表渲染：流式期间跳过（图源不完整），完成后把代码块替换为 SVG
    useEffect(() => {
        if (isStreaming) return undefined;
        const container = containerRef.current;
        if (!container || !html.includes('language-mermaid')) return undefined;

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
    }, [html, isStreaming]);

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

    // 代码块包装：语言标签头栏 + 常驻复制按钮（替代原悬浮按钮）
    useEffect(() => {
        if (!containerRef.current) return;

        const cleanupCallbacks: Array<() => void> = [];
        const codeBlocks = containerRef.current.querySelectorAll('pre > code');
        codeBlocks.forEach((codeBlock) => {
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

            // 复制按钮（挪入头栏，常驻显示）
            const button = document.createElement('button');
            button.className = 'copy-button';
            button.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
            button.title = copyCodeLabel;
            button.setAttribute('aria-label', copyCodeLabel);

            let resetTimer: number | null = null;
            const handleCopy = async () => {
                const code = codeBlock.textContent || '';
                try {
                    await navigator.clipboard.writeText(code);
                    button.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                    button.classList.add('copied');
                    button.title = copiedCodeLabel;
                    button.setAttribute('aria-label', copiedCodeLabel);
                    resetTimer = window.setTimeout(() => {
                        button.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
                        button.classList.remove('copied');
                        button.title = copyCodeLabel;
                        button.setAttribute('aria-label', copyCodeLabel);
                    }, 2000);
                } catch (e) {
                    console.error('[MarkdownBlock] Copy failed:', e);
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
        <>
            <div
                ref={containerRef}
                className="markdown-block"
                dangerouslySetInnerHTML={{ __html: html }}
            />
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
