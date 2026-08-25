import {useEffect, useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {convertFileSrc} from '@tauri-apps/api/core';
import type {ContentBlock, ImageBlock, ToolResultBlock, ToolUseBlock} from '../../types/chat';
import {mergeAdjacentTextContentBlocks} from '../../utils/chatMessageFlow';
import {groupToolBlocks} from '../../utils/toolGrouping';
import {planToolStepFold} from '../../utils/toolStepFolding';
import {getToolType} from '../../types/tools';
import {
    getImageBlockDataUrl,
    getImageBlockFileName,
    getImageBlockMediaType,
    getImageBlockPreviewText,
    getImageBlockUrl,
} from '../../utils/chatImageBlocks';
import {
    AgentGroupBlock,
    BashToolBlock,
    BashToolGroupBlock,
    EditToolBlock,
    EditToolGroupBlock,
    GenericToolBlock,
    PlanToolBlock,
    ReadToolBlock,
    ReadToolGroupBlock,
    SearchToolGroupBlock,
    TaskExecutionBlock,
    TodoToolBlock,
} from '../toolBlocks';
import MarkdownBlock from './MarkdownBlock';
import ThinkingBlock from './ThinkingBlock';

interface ContentBlockRendererProps {
    blocks: ContentBlock[];
    findToolResult: (toolId: string) => ToolResultBlock | null | undefined;
    expandThinkingBlockIndex?: number;
    compact?: boolean;
    imageDisplay?: 'default' | 'compact' | 'user-thumbnail';
    /** 所属消息是否仍在流式输出（mermaid 等重渲染在流式期间跳过） */
    streaming?: boolean;
}

export interface ImageRenderData {
    label: string;
    mediaType: string;
    src: string | null;
}

interface ImageLightboxProps {
    image: ImageRenderData;
    closeLabel: string;
    onClose: () => void;
}

function getToolAnchorProps(toolIds: string[]) {
    const safeToolIds = toolIds.filter(Boolean);
    const anchorProps: {
        className: string;
        tabIndex: number;
        'data-chat-tool-id'?: string;
        'data-chat-tool-ids'?: string;
    } = {
        className: 'chat-tool-anchor scroll-mt-6 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/35',
        tabIndex: -1,
    };

    if (safeToolIds.length === 1) {
        anchorProps['data-chat-tool-id'] = safeToolIds[0];
    } else if (safeToolIds.length > 1) {
        anchorProps['data-chat-tool-ids'] = safeToolIds.join(' ');
    }

    return anchorProps;
}

function normalizeLocalImagePath(url: string): string {
    if (!url.toLowerCase().startsWith('file:')) return url;

    try {
        const parsed = new URL(url);
        const path = decodeURIComponent(parsed.pathname);
        if (parsed.hostname) {
            return `//${parsed.hostname}${path}`;
        }
        if (/^\/[a-zA-Z]:\//.test(path)) {
            return path.slice(1);
        }
        return path || url;
    } catch {
        return url.replace(/^file:\/+/i, '');
    }
}

function resolveImageSrc(block: ImageBlock): string | null {
    const dataUrl = getImageBlockDataUrl(block);
    if (dataUrl) return dataUrl;

    const url = getImageBlockUrl(block);
    if (!url) return null;
    if (/^(data|https?|blob|asset):/i.test(url)) return url;

    try {
        return convertFileSrc(normalizeLocalImagePath(url));
    } catch {
        return url;
    }
}

function resolveImageRenderData(block: ImageBlock): ImageRenderData {
    const fileName = getImageBlockFileName(block);
    return {
        label: fileName ?? getImageBlockPreviewText(block),
        mediaType: getImageBlockMediaType(block),
        src: resolveImageSrc(block),
    };
}

function isImageContentBlock(block: ContentBlock): block is ImageBlock {
    return block.type === 'image' || block.type === 'input_image';
}

function ImageBlockRenderer({
    block,
    imageDisplay,
    onOpen,
}: {
    block: ImageBlock;
    imageDisplay: 'default' | 'compact' | 'user-thumbnail';
    onOpen: (image: ImageRenderData) => void;
}) {
    const image = useMemo(() => resolveImageRenderData(block), [block]);
    const isUserThumbnail = imageDisplay === 'user-thumbnail';
    const frameClassName = isUserThumbnail
        ? 'chat-image-thumbnail-frame-user group block rounded-lg border border-base-300 bg-base-100 p-0.5 text-left shadow-sm transition hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30'
        : 'group block max-w-full rounded-lg border border-base-300 bg-base-100 p-1 text-left shadow-sm transition hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30';
    const imageClassName = isUserThumbnail
        ? 'chat-image-thumbnail chat-image-thumbnail-user block rounded-md object-cover'
        : `chat-image-thumbnail block max-w-full rounded-md object-contain ${imageDisplay === 'compact' ? 'max-h-48' : 'max-h-64'}`;

    return (
        <figure className={`chat-image-block inline-flex max-w-full flex-col gap-1 ${isUserThumbnail ? 'chat-image-block-user items-end' : ''}`}>
            {image.src ? (
                <button
                    type="button"
                    className={frameClassName}
                    title={image.label}
                    aria-label={image.label}
                    onClick={() => onOpen(image)}
                >
                    <img
                        className={imageClassName}
                        src={image.src}
                        alt={image.label}
                        loading="lazy"
                    />
                </button>
            ) : (
                <div className="chat-image-thumbnail rounded-lg border border-dashed border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/55">
                    {image.label}
                </div>
            )}
            <figcaption className="sr-only" title={image.label}>
                {image.label}
            </figcaption>
        </figure>
    );
}

function ImageThumbnailStrip({
    blocks,
    onOpen,
}: {
    blocks: ImageBlock[];
    onOpen: (image: ImageRenderData) => void;
}) {
    return (
        <div className="chat-image-thumbnail-strip">
            {blocks.map((block, index) => (
                <ImageBlockRenderer
                    key={`${block.type}-${index}`}
                    block={block}
                    imageDisplay="user-thumbnail"
                    onOpen={onOpen}
                />
            ))}
        </div>
    );
}

export function ImageLightbox({image, closeLabel, onClose}: ImageLightboxProps) {
    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={image.label}
            onClick={onClose}
        >
            <button
                type="button"
                className="btn btn-ghost btn-sm btn-square absolute right-4 top-4 text-white hover:bg-white/10"
                title={closeLabel}
                aria-label={closeLabel}
                onClick={(event) => {
                    event.stopPropagation();
                    onClose();
                }}
            >
                <X size={18} />
            </button>
            <div className="flex max-h-[92vh] max-w-[94vw] flex-col items-center gap-3">
                <img
                    src={image.src ?? undefined}
                    alt={image.label}
                    className="max-h-[86vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                />
                <div
                    className="chat-image-lightbox-caption max-w-[92vw] truncate rounded-md bg-black/55 px-3 py-1 text-xs text-white/85"
                    title={image.label}
                    onClick={(event) => event.stopPropagation()}
                >
                    {image.label}
                </div>
            </div>
        </div>
    );
}

/**
 * 内容块渲染器 - 根据块类型路由到对应组件
 * 支持 text、image、tool_use、tool_result、thinking 内容块
 * 自动分组连续的同类型工具（3+ 个）
 */
export default function ContentBlockRenderer({
    blocks,
    findToolResult,
    expandThinkingBlockIndex,
    compact = false,
    imageDisplay,
    streaming = false,
}: ContentBlockRendererProps) {
    const { t } = useTranslation();
    const [lightboxImage, setLightboxImage] = useState<ImageRenderData | null>(null);
    // 中间工具步骤是否已展开；按消息实例保存，切消息自然复位
    const [toolStepsExpanded, setToolStepsExpanded] = useState(false);
    const resolvedImageDisplay = imageDisplay ?? (compact ? 'compact' : 'default');

    useEffect(() => {
        if (!lightboxImage) return undefined;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setLightboxImage(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [lightboxImage]);

    const renderableBlocks = useMemo(() => mergeAdjacentTextContentBlocks(blocks), [blocks]);

    // 应用分组算法
    const groupedBlocks = useMemo(() => groupToolBlocks(renderableBlocks), [renderableBlocks]);

    // 中间步骤折叠：一轮几十个工具调用平铺会把正文冲散、把滚动距离拉长。
    // 流式期间不折叠——用户正盯着最新动作看。
    const foldPlan = useMemo(
        () => planToolStepFold(groupedBlocks, toolStepsExpanded || streaming),
        [groupedBlocks, streaming, toolStepsExpanded],
    );
    const foldedStepsLabel = (() => {
        const translated = t('chat.toolSteps.folded', {count: foldPlan.foldedCount});
        return translated === 'chat.toolSteps.folded'
            ? `Show ${foldPlan.foldedCount} collapsed steps`
            : translated;
    })();

    // 渲染单个工具块
    const renderToolBlock = (block: ToolUseBlock, result: ToolResultBlock | null | undefined) => {
        const toolType = getToolType(block.name);

        switch (toolType) {
            case 'bash':
                return (
                    <BashToolBlock
                        name={block.name}
                        input={block.input}
                        result={result}
                        toolId={block.id}
                        compact={compact}
                    />
                );

            case 'read':
                return (
                    <ReadToolBlock
                        name={block.name}
                        input={block.input}
                        result={result}
                        toolId={block.id}
                        compact={compact}
                    />
                );

            case 'edit':
                return (
                    <EditToolBlock
                        name={block.name}
                        input={block.input}
                        result={result}
                        toolId={block.id}
                        compact={compact}
                    />
                );

            case 'search':
                return (
                    <SearchToolGroupBlock
                        blocks={[block]}
                        findToolResult={findToolResult}
                        compact={compact}
                    />
                );

            case 'agent':
                // Agent 工具：检查是否是 Task/spawn_agent
                if (block.name.toLowerCase().includes('task') ||
                    block.name.toLowerCase().includes('spawn')) {
                    return (
                        <TaskExecutionBlock
                            name={block.name}
                            input={block.input}
                            result={result}
                            toolId={block.id}
                            compact={compact}
                        />
                    );
                }
                return (
                    <AgentGroupBlock
                        name={block.name}
                        input={block.input}
                        result={result}
                        toolId={block.id}
                        compact={compact}
                    />
                );

            case 'todo':
                return (
                    <TodoToolBlock
                        name={block.name}
                        input={block.input}
                        result={result}
                        toolId={block.id}
                        compact={compact}
                    />
                );

            case 'plan':
                // ExitPlanMode 的计划正文要按 Markdown 读，落到 GenericToolBlock
                // 会被当成普通入参打印成一坨纯文本。
                return (
                    <PlanToolBlock
                        name={block.name}
                        input={block.input}
                        result={result}
                        toolId={block.id}
                        compact={compact}
                    />
                );

            default:
                // Generic fallback
                return (
                    <GenericToolBlock
                        name={block.name}
                        input={block.input}
                        result={result}
                        toolId={block.id}
                        compact={compact}
                    />
                );
        }
    };

    return (
        <div className={compact ? 'chat-content-blocks chat-content-blocks-compact' : 'chat-content-blocks chat-content-blocks-default'}>
            {groupedBlocks.map((grouped, index) => {
                if (foldPlan.hiddenIndices.has(index)) {
                    // 被折叠的中间步骤：在第一个隐藏位插入一枚可展开 chip，其余静默跳过
                    if (index !== foldPlan.chipAtIndex) return null;

                    return (
                        <button
                            key={`tool-steps-fold-${index}`}
                            type="button"
                            className="chat-tool-steps-fold"
                            title={foldedStepsLabel}
                            aria-label={foldedStepsLabel}
                            aria-expanded={false}
                            onClick={() => setToolStepsExpanded(true)}
                        >
                            <ChevronDown size={12} aria-hidden="true" />
                            <span>{foldedStepsLabel}</span>
                        </button>
                    );
                }

                if (resolvedImageDisplay === 'user-thumbnail' && grouped.type === 'single' && isImageContentBlock(grouped.block)) {
                    const previousBlock = groupedBlocks[index - 1];
                    if (previousBlock?.type === 'single' && isImageContentBlock(previousBlock.block)) {
                        return null;
                    }

                    const imageBlocks: ImageBlock[] = [];
                    for (let cursor = index; cursor < groupedBlocks.length; cursor += 1) {
                        const candidate = groupedBlocks[cursor];
                        if (candidate.type !== 'single' || !isImageContentBlock(candidate.block)) {
                            break;
                        }
                        imageBlocks.push(candidate.block);
                    }

                    return (
                        <ImageThumbnailStrip
                            key={`user-image-strip-${grouped.originalIndex}`}
                            blocks={imageBlocks}
                            onOpen={setLightboxImage}
                        />
                    );
                }

                if (grouped.type === 'single') {
                    const block = grouped.block;

                    switch (block.type) {
                        case 'text':
                            return (
                                <MarkdownBlock
                                    key={grouped.originalIndex}
                                    content={block.text}
                                    isStreaming={streaming}
                                />
                            );

                        case 'thinking':
                            return (
                                <ThinkingBlock
                                    key={grouped.originalIndex}
                                    content={block.thinking}
                                    defaultExpanded={grouped.originalIndex === expandThinkingBlockIndex}
                                    title={t('chat.thinking.title')}
                                    compact={compact}
                                    streaming={grouped.originalIndex === expandThinkingBlockIndex}
                                />
                            );

                        case 'image':
                        case 'input_image':
                            return (
                                <ImageBlockRenderer
                                    key={grouped.originalIndex}
                                    block={block}
                                    imageDisplay={resolvedImageDisplay}
                                    onOpen={setLightboxImage}
                                />
                            );

                        case 'tool_use':
                            const result = findToolResult(block.id);
                            return (
                                <div key={block.id} {...getToolAnchorProps([block.id])}>
                                    {renderToolBlock(block, result)}
                                </div>
                            );

                        case 'tool_result':
                            // 已在 tool_use 中显示，跳过
                            return null;

                        default:
                            console.warn('[ContentBlockRenderer] Unknown block:', block);
                            return (
                                <div key={grouped.originalIndex} className="text-warning text-sm bg-warning/10 px-3 py-2 rounded-lg">
                                    {t('chat.message.unknownBlock')}
                                </div>
                            );
                    }
                } else {
                    // 渲染分组
                    const { toolType, blocks: groupBlocks } = grouped;

                    switch (toolType) {
                        case 'bash':
                            return (
                                <div key={`group-${index}`} {...getToolAnchorProps(groupBlocks.map((block) => block.id))}>
                                    <BashToolGroupBlock
                                        blocks={groupBlocks}
                                        findToolResult={findToolResult}
                                        compact={compact}
                                    />
                                </div>
                            );

                        case 'read':
                            return (
                                <div key={`group-${index}`} {...getToolAnchorProps(groupBlocks.map((block) => block.id))}>
                                    <ReadToolGroupBlock
                                        blocks={groupBlocks}
                                        findToolResult={findToolResult}
                                        compact={compact}
                                    />
                                </div>
                            );

                        case 'edit':
                            return (
                                <div key={`group-${index}`} {...getToolAnchorProps(groupBlocks.map((block) => block.id))}>
                                    <EditToolGroupBlock
                                        blocks={groupBlocks}
                                        findToolResult={findToolResult}
                                        compact={compact}
                                    />
                                </div>
                            );

                        case 'search':
                            return (
                                <div key={`group-${index}`} {...getToolAnchorProps(groupBlocks.map((block) => block.id))}>
                                    <SearchToolGroupBlock
                                        blocks={groupBlocks}
                                        findToolResult={findToolResult}
                                        compact={compact}
                                    />
                                </div>
                            );

                        default:
                            // 不应该到这里（generic 不分组），降级为单个渲染
                            return (
                                <div key={`group-${index}`} className="space-y-2">
                                    {groupBlocks.map(block => {
                                        const result = findToolResult(block.id);
                                        return (
                                            <div key={block.id} {...getToolAnchorProps([block.id])}>
                                                {renderToolBlock(block, result)}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                    }
                }
            })}
            {lightboxImage?.src && typeof document !== 'undefined' && createPortal(
                <ImageLightbox
                    image={lightboxImage}
                    closeLabel={t('common.close')}
                    onClose={() => setLightboxImage(null)}
                />,
                document.body,
            )}
        </div>
    );
}
