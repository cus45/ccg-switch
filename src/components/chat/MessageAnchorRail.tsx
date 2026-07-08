import {type RefObject, useEffect, useMemo} from 'react';
import {ArrowDown, ArrowUp, Circle, ListTree} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {TFunction} from 'i18next';
import {cn} from '../../utils/cn';
import {getChatNavigationControlLabel} from '../../utils/chatUiBehavior';
import type {AnchorPreviewKind} from '../../utils/chatNavigation';

interface MessageAnchorItem {
    id: string;
    label: string;
    kind?: AnchorPreviewKind;
    sequence?: number;
    total?: number;
    createdAt?: number;
}

interface PositionedAnchorItem extends MessageAnchorItem {
    originalIndex: number;
    top: string;
}

interface MessageAnchorRailProps {
    hasMessages: boolean;
    anchors?: MessageAnchorItem[];
    activeAnchorId?: string | null;
    activeAnchorLabel?: string;
    containerRef?: RefObject<HTMLDivElement | null>;
    messageNodeMap?: RefObject<Map<string, HTMLElement>>;
    onActiveAnchorChange?: (anchorId: string | null) => void;
    onScrollToTop: () => void;
    onScrollToBottom: () => void;
}

const MAX_VISIBLE_ANCHOR_POINTS = 48;

const ANCHOR_KIND_CLASS: Record<AnchorPreviewKind, string> = {
    text: 'border-base-content/25 bg-base-content/35 hover:border-primary/45 hover:bg-primary/35',
    image: 'border-info/50 bg-info/70 hover:border-info hover:bg-info',
    mixed: 'border-success/50 bg-success/70 hover:border-success hover:bg-success',
    empty: 'border-base-content/30 bg-base-content/40 hover:border-primary/40 hover:bg-primary/30',
};

const ANCHOR_KIND_FALLBACK: Record<AnchorPreviewKind, string> = {
    text: 'Text',
    image: 'Image',
    mixed: 'Text + image',
    empty: 'Empty',
};

function getAnchorPositionLabel(current: number, total: number, t: TFunction): string {
    const label = t('chat.layout.anchorPosition', { current, total });
    return label === 'chat.layout.anchorPosition' ? `${current} / ${total}` : label;
}

function getAnchorKindLabel(kind: AnchorPreviewKind | undefined, t: TFunction): string {
    const safeKind = kind ?? 'text';
    const key = `chat.layout.anchorKind.${safeKind}`;
    const label = t(key);
    return label === key ? ANCHOR_KIND_FALLBACK[safeKind] : label;
}

function formatAnchorTime(createdAt?: number): string | null {
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt <= 0) {
        return null;
    }

    return new Date(createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function getAnchorPosition(index: number, count: number): string {
    if (count <= 1) return '50%';
    const normalized = 0.04 + (index / (count - 1)) * 0.92;
    return `${normalized * 100}%`;
}

function isContentAnchor(anchor: MessageAnchorItem): boolean {
    return (anchor.kind ?? 'text') !== 'empty';
}

export function getVisibleAnchorRailItems(
    anchors: MessageAnchorItem[],
    activeAnchorId?: string | null,
    maxVisible = MAX_VISIBLE_ANCHOR_POINTS,
): PositionedAnchorItem[] {
    if (anchors.length === 0) return [];
    const safeMax = Math.max(3, maxVisible);
    const contentIndexes = anchors
        .map((anchor, index) => isContentAnchor(anchor) ? index : -1)
        .filter((index) => index >= 0);
    const candidateIndexes = contentIndexes.length > 0
        ? contentIndexes
        : anchors.map((_, index) => index);
    const selectedIndexes = new Set<number>();
    const activeIndex = activeAnchorId
        ? anchors.findIndex((anchor) => anchor.id === activeAnchorId)
        : -1;

    selectedIndexes.add(candidateIndexes[0] ?? 0);
    selectedIndexes.add(candidateIndexes[candidateIndexes.length - 1] ?? anchors.length - 1);

    if (activeIndex >= 0) {
        selectedIndexes.add(activeIndex);
    }

    if (candidateIndexes.length <= safeMax) {
        candidateIndexes.forEach((index) => selectedIndexes.add(index));
    } else {
        const denominator = safeMax - 1;
        for (let slot = 0; selectedIndexes.size < safeMax && slot < safeMax * 2; slot += 1) {
            const candidateIndex = Math.round((slot / denominator) * (candidateIndexes.length - 1));
            selectedIndexes.add(candidateIndexes[candidateIndex]);
        }
    }

    return Array.from(selectedIndexes)
        .sort((left, right) => left - right)
        .map((originalIndex) => ({
            ...anchors[originalIndex],
            originalIndex,
            top: getAnchorPosition(originalIndex, anchors.length),
        }));
}

function resolveAnchorFromScroll(
    anchors: MessageAnchorItem[],
    container: HTMLDivElement,
    nodeMap: Map<string, HTMLElement>,
): string | null {
    const threshold = container.scrollTop + (container.clientHeight * 0.28);
    let currentId = anchors[0]?.id ?? null;

    for (const anchor of anchors) {
        const node = nodeMap.get(anchor.id);
        if (!node) continue;
        if (node.offsetTop <= threshold) {
            currentId = anchor.id;
            continue;
        }
        break;
    }

    return currentId;
}

export default function MessageAnchorRail({
    hasMessages,
    anchors = [],
    activeAnchorId,
    activeAnchorLabel,
    containerRef,
    messageNodeMap,
    onActiveAnchorChange,
    onScrollToTop,
    onScrollToBottom,
}: MessageAnchorRailProps) {
    const { t } = useTranslation();
    const anchorCount = anchors.length;
    const positionedAnchors = useMemo(
        () => getVisibleAnchorRailItems(anchors, activeAnchorId),
        [activeAnchorId, anchors],
    );
    const anchorRailLabel = getChatNavigationControlLabel({
        control: 'anchor-rail',
        translate: (key, options) => t(key, options),
    });
    const currentAnchorLabel = getChatNavigationControlLabel({
        control: 'current-anchor',
        translate: (key, options) => t(key, options),
    });
    const scrollToTopLabel = getChatNavigationControlLabel({
        control: 'scroll-to-top',
        translate: (key, options) => t(key, options),
    });
    const scrollToBottomLabel = getChatNavigationControlLabel({
        control: 'scroll-to-bottom',
        translate: (key, options) => t(key, options),
    });

    useEffect(() => {
        const container = containerRef?.current;
        const nodeMap = messageNodeMap?.current;
        if (!container || !nodeMap || anchors.length === 0) {
            onActiveAnchorChange?.(null);
            return;
        }

        const syncActiveAnchor = () => {
            onActiveAnchorChange?.(resolveAnchorFromScroll(anchors, container, nodeMap));
        };

        syncActiveAnchor();

        if (typeof IntersectionObserver === 'undefined') {
            return;
        }

        const visibleSet = new Set<string>();
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const id = (entry.target as HTMLElement).dataset.messageAnchorId;
                    if (!id) continue;
                    if (entry.isIntersecting) {
                        visibleSet.add(id);
                    } else {
                        visibleSet.delete(id);
                    }
                }

                for (const anchor of anchors) {
                    if (visibleSet.has(anchor.id)) {
                        onActiveAnchorChange?.(anchor.id);
                        return;
                    }
                }

                syncActiveAnchor();
            },
            {
                root: container,
                rootMargin: '0px 0px -72% 0px',
                threshold: 0,
            },
        );

        for (const anchor of anchors) {
            const node = nodeMap.get(anchor.id);
            if (node) observer.observe(node);
        }

        return () => observer.disconnect();
    }, [anchors, containerRef, messageNodeMap, onActiveAnchorChange]);

    const scrollToAnchor = (anchorId: string) => {
        const container = containerRef?.current;
        const node = messageNodeMap?.current?.get(anchorId);
        if (!container || !node) return;

        container.scrollTo({
            top: Math.max(0, node.offsetTop - (container.clientHeight * 0.28)),
            behavior: 'smooth',
        });
        onActiveAnchorChange?.(anchorId);
    };

    return (
        <aside
            className="relative z-40 hidden w-14 flex-shrink-0 bg-transparent lg:flex lg:flex-col lg:items-center lg:gap-3 lg:py-4"
            aria-label={anchorRailLabel}
        >
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-base-300 bg-base-100 text-base-content/50 shadow-sm">
                <ListTree size={15} />
            </div>
            <div className="flex flex-col items-center gap-1 text-[10px] text-base-content/45">
                <span>{anchorCount}</span>
                <span className="leading-none">{anchorRailLabel}</span>
            </div>
            {activeAnchorLabel && (
                <div className="w-full px-2 text-center text-[10px] leading-tight text-base-content/45" title={activeAnchorLabel}>
                    <div className="mb-1 inline-flex items-center gap-1 text-success/70">
                        <Circle size={7} />
                        <span>{currentAnchorLabel}</span>
                    </div>
                    <div className="line-clamp-3 break-words">{activeAnchorLabel}</div>
                </div>
            )}
            <div className="relative flex min-h-0 w-full flex-1 justify-center py-2">
                <div className="absolute bottom-2 top-2 w-px rounded-full bg-base-content/15" aria-hidden="true" />
                {positionedAnchors.map((anchor) => {
                    const isActive = activeAnchorId === anchor.id;
                    const anchorKind = anchor.kind ?? 'text';
                    const sequence = anchor.sequence ?? anchor.originalIndex + 1;
                    const total = anchor.total ?? anchorCount;
                    const positionLabel = getAnchorPositionLabel(sequence, total, t);
                    const kindLabel = getAnchorKindLabel(anchorKind, t);
                    const jumpToMessageLabel = getChatNavigationControlLabel({
                        control: 'jump-to-message',
                        index: sequence,
                        translate: (key, options) => t(key, options),
                    });
                    const anchorTime = formatAnchorTime(anchor.createdAt);
                    return (
                        <button
                            key={anchor.id}
                            type="button"
                            data-anchor-id={anchor.id}
                            className={cn(
                                'group absolute left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/35',
                                isActive
                                    ? 'h-4 w-4 border-primary/80 bg-primary shadow-primary/30'
                                    : ANCHOR_KIND_CLASS[anchorKind],
                            )}
                            style={{ top: anchor.top }}
                            title={`${positionLabel} · ${anchor.label}`}
                            aria-label={jumpToMessageLabel}
                            onClick={() => scrollToAnchor(anchor.id)}
                        >
                            <span className="pointer-events-none absolute left-6 top-1/2 z-50 hidden w-64 max-w-[calc(100vw-8rem)] -translate-y-1/2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-left text-[10px] leading-tight text-base-content/75 shadow-2xl ring-1 ring-base-300/60 group-hover:block group-focus-visible:block">
                                <span className="mb-1 flex items-center justify-between gap-2 text-base-content/55">
                                    <span>{anchorTime ? `${positionLabel} · ${anchorTime}` : positionLabel}</span>
                                    <span className="rounded-full bg-base-200 px-1.5 py-0.5">{kindLabel}</span>
                                </span>
                                <span className="line-clamp-4 break-words text-[11px] text-base-content/85">
                                    {anchor.label}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>
            <button
                type="button"
                className="btn btn-ghost btn-xs h-7 min-h-0 w-7 rounded-full p-0 text-base-content/45 hover:text-base-content disabled:opacity-30"
                title={scrollToTopLabel}
                aria-label={scrollToTopLabel}
                onClick={onScrollToTop}
                disabled={!hasMessages}
            >
                <ArrowUp size={14} />
            </button>
            <button
                type="button"
                className="btn btn-ghost btn-xs h-7 min-h-0 w-7 rounded-full p-0 text-base-content/45 hover:text-base-content disabled:opacity-30"
                title={scrollToBottomLabel}
                aria-label={scrollToBottomLabel}
                onClick={onScrollToBottom}
                disabled={!hasMessages}
            >
                <ArrowDown size={14} />
            </button>
        </aside>
    );
}
