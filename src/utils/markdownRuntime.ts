/**
 * Markdown 渲染运行时：语言注册、双 `Marked` 实例、HTML 净化、KaTeX 懒加载。
 *
 * 为什么是「双实例」：`hljs.highlightAuto` 会遍历全部已注册语言，单次可达数十
 * 毫秒。流式期间每帧都要解析尾部块，这个成本必须从热路径移出；但历史消息里
 * 自动探测确实有用，不能一刀切删掉。`marked@18` 导出 `Marked` 类，因此建两个
 * 互不干扰的实例：
 *
 * | 实例              | 用途                     | highlight 策略                       |
 * |-------------------|--------------------------|--------------------------------------|
 * | `streamingMarked` | 流式期间的块级 fragment  | 仅已知语言精确高亮，未知语言不高亮   |
 * | `fullMarked`      | 流式结束 / 历史消息      | 已知语言精确高亮 + 未知语言自动探测  |
 *
 * KaTeX 扩展只挂到 `fullMarked`：流式期间公式按字面显示，settle 后成型。
 */

import {Marked} from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import {markedHighlight} from 'marked-highlight';

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

hljs.registerAliases(['js', 'jsx'], {languageName: 'javascript'});
hljs.registerAliases(['ts', 'tsx'], {languageName: 'typescript'});
hljs.registerAliases(['sh', 'zsh'], {languageName: 'bash'});
hljs.registerAliases(['html'], {languageName: 'xml'});
hljs.registerAliases(['yml'], {languageName: 'yaml'});

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * `marked-highlight` 不会转义回调返回值（它直接替换代码块内容），因此不高亮的
 * 分支必须自己转义，否则代码里的 `<` 会被当作标签（净化器会吃掉它）。
 */
function createHighlightExtension({autoDetect}: {autoDetect: boolean}) {
    return markedHighlight({
        highlight(code: string, lang: string) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, {language: lang}).value;
                } catch {
                    // Fall through
                }
            }
            if (!autoDetect) return escapeHtml(code);
            return hljs.highlightAuto(code).value;
        },
    });
}

const MARKED_OPTIONS = {
    gfm: true, // GitHub Flavored Markdown
    breaks: true, // 换行符转换为 <br>
} as const;

/** 流式热路径专用：不做语言自动探测。 */
const streamingMarked = new Marked(
    createHighlightExtension({autoDetect: false}),
    {...MARKED_OPTIONS},
);

/** 完成态 / 历史消息：保留自动探测，KaTeX 扩展也只挂在这个实例上。 */
const fullMarked = new Marked(
    createHighlightExtension({autoDetect: true}),
    {...MARKED_OPTIONS},
);

// ============================================================
// KaTeX 数学公式（懒加载：首次检测到公式才拉取扩展与样式）
// ============================================================

/** 块级 $$...$$ 或成对内联 $...$（内容不以空白开头/结尾，排除货币写法误伤） */
const MATH_PATTERN = /\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]*?[^\s$]\$/;

let katexReady = false;
let katexLoading: Promise<void> | null = null;

export function isKatexReady(): boolean {
    return katexReady;
}

export function ensureKatexLoaded(): Promise<void> {
    if (!katexLoading) {
        katexLoading = Promise.all([
            import('marked-katex-extension'),
            import('katex/dist/katex.min.css'),
        ]).then(([extension]) => {
            fullMarked.use(extension.default({throwOnError: false}));
            katexReady = true;
        }).catch((e) => {
            console.error('[markdownRuntime] Failed to load KaTeX:', e);
            katexLoading = null;
        });
    }
    return katexLoading;
}

export function containsMathSyntax(content: string): boolean {
    return content.includes('$') && MATH_PATTERN.test(content);
}

// ============================================================
// HTML 净化
// ============================================================

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

export function sanitizeMarkdownHtml(rawHtml: string): string {
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

// ============================================================
// 渲染入口
// ============================================================

/**
 * 流式期间自动补全未闭合的代码块，避免尾部 fence 把后续内容整段吞进代码块。
 * 冻结块的 fence 必然成对，因此对全部块统一应用是安全的。
 */
function closeUnterminatedFence(source: string): string {
    if (!source.includes('```')) return source;

    const fenceCount = (source.match(/```/g) ?? []).length;
    return fenceCount % 2 === 1 ? `${source}\n\`\`\`` : source;
}

export interface RenderMarkdownOptions {
    /** true 走 streamingMarked（无自动探测、无 KaTeX）并补全未闭合 fence。 */
    streaming?: boolean;
}

/** Markdown → 净化后的 HTML；解析失败时降级为转义纯文本。 */
export function renderMarkdownToHtml(
    source: string,
    {streaming = false}: RenderMarkdownOptions = {},
): string {
    const markdown = streaming ? closeUnterminatedFence(source) : source;

    try {
        const runtime = streaming ? streamingMarked : fullMarked;
        return sanitizeMarkdownHtml(runtime.parse(markdown, {async: false}) as string);
    } catch (e) {
        console.error('[markdownRuntime] Parse error:', e);
        return escapeHtml(source);
    }
}
