// MermaidViewer - Mermaid 图全屏查看器（缩放 / 拖拽平移 / Esc 关闭）

import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Minus, Plus, RotateCcw, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';

export const MERMAID_VIEWER_MIN_SCALE = 0.2;
export const MERMAID_VIEWER_MAX_SCALE = 8;

export function clampMermaidScale(scale: number): number {
    if (!Number.isFinite(scale)) return 1;
    return Math.min(MERMAID_VIEWER_MAX_SCALE, Math.max(MERMAID_VIEWER_MIN_SCALE, scale));
}

interface MermaidViewerProps {
    /** mermaid 渲染产物（可信 SVG，来自本地 mermaid.render） */
    svg: string;
    onClose: () => void;
}

function translateWithFallback(t: (key: string) => string, key: string, fallback: string): string {
    const translated = t(key);
    return translated === key ? fallback : translated;
}

/**
 * 全屏图表查看：滚轮缩放、按住拖拽平移、工具栏 +/-/重置。
 * 点击背景或 Esc 关闭。
 */
export default function MermaidViewer({svg, onClose}: MermaidViewerProps) {
    const {t} = useTranslation();
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({x: 0, y: 0});
    const stageRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{pointerId: number; startX: number; startY: number; baseX: number; baseY: number} | null>(null);

    const zoomInLabel = translateWithFallback(t, 'chat.diagram.zoomIn', 'Zoom in');
    const zoomOutLabel = translateWithFallback(t, 'chat.diagram.zoomOut', 'Zoom out');
    const resetLabel = translateWithFallback(t, 'chat.diagram.reset', 'Reset view');
    const closeLabel = translateWithFallback(t, 'common.close', 'Close');

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // 滚轮缩放要 preventDefault，必须用非 passive 的原生监听
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return undefined;
        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
            setScale((current) => clampMermaidScale(current * factor));
        };
        stage.addEventListener('wheel', handleWheel, {passive: false});
        return () => stage.removeEventListener('wheel', handleWheel);
    }, []);

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            baseX: offset.x,
            baseY: offset.y,
        };
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        setOffset({
            x: drag.baseX + (event.clientX - drag.startX),
            y: drag.baseY + (event.clientY - drag.startY),
        });
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId === event.pointerId) {
            dragRef.current = null;
        }
    };

    const resetView = () => {
        setScale(1);
        setOffset({x: 0, y: 0});
    };

    const viewer = (
        <div
            className="fixed inset-0 z-[80] flex flex-col bg-black/75 backdrop-blur-[2px]"
            role="dialog"
            aria-modal="true"
            aria-label={translateWithFallback(t, 'chat.diagram.viewerTitle', 'Diagram viewer')}
            onClick={onClose}
        >
            <div
                className="flex items-center justify-end gap-1 p-3"
                onClick={(event) => event.stopPropagation()}
            >
                <button
                    type="button"
                    className="btn btn-ghost btn-sm h-8 min-h-0 w-8 p-0 text-white/85 hover:bg-white/15"
                    onClick={() => setScale((current) => clampMermaidScale(current / 1.25))}
                    title={zoomOutLabel}
                    aria-label={zoomOutLabel}
                >
                    <Minus size={15} />
                </button>
                <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-white/70">
                    {Math.round(scale * 100)}%
                </span>
                <button
                    type="button"
                    className="btn btn-ghost btn-sm h-8 min-h-0 w-8 p-0 text-white/85 hover:bg-white/15"
                    onClick={() => setScale((current) => clampMermaidScale(current * 1.25))}
                    title={zoomInLabel}
                    aria-label={zoomInLabel}
                >
                    <Plus size={15} />
                </button>
                <button
                    type="button"
                    className="btn btn-ghost btn-sm h-8 min-h-0 w-8 p-0 text-white/85 hover:bg-white/15"
                    onClick={resetView}
                    title={resetLabel}
                    aria-label={resetLabel}
                >
                    <RotateCcw size={14} />
                </button>
                <button
                    type="button"
                    className="btn btn-ghost btn-sm ml-2 h-8 min-h-0 w-8 p-0 text-white/85 hover:bg-white/15"
                    onClick={onClose}
                    title={closeLabel}
                    aria-label={closeLabel}
                >
                    <X size={16} />
                </button>
            </div>
            <div
                ref={stageRef}
                className="flex flex-1 cursor-grab items-center justify-center overflow-hidden active:cursor-grabbing"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                <div
                    className="mermaid-viewer-canvas rounded-lg bg-white p-4 shadow-2xl"
                    style={{
                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                        transformOrigin: 'center center',
                    }}
                    dangerouslySetInnerHTML={{__html: svg}}
                />
            </div>
        </div>
    );

    if (typeof document === 'undefined') return viewer;
    return createPortal(viewer, document.body);
}
