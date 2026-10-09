/**
 * 用量模块共用的视觉基元
 *
 * 与项目其它页面保持同一套语言（见 ProvidersPage / Dashboard）：
 * - 卡片：白底 + gray-100 细边；深色主题下 base-100 面 + base-200 边。
 *   深色主题里 base-300 是最深的页面底色，拿它当边框等于没有边框。
 * - 主按钮蓝紫渐变，次按钮 ghost；页内切换用分段控件，不用 DaisyUI 默认的灰色 btn-group。
 * - 状态 / 用时用低饱和软色徽章，不用实心 badge-success 那种高饱和色块。
 * - 数字一律 tabular-nums，轮询刷新时列不抖。
 */
import { cn } from '../../utils/cn';

/** 卡片容器 */
export const card =
    'rounded-xl border border-gray-100 bg-white shadow-sm dark:border-base-200 dark:bg-base-100';

/** 带悬浮上浮的卡片（统计卡） */
export const cardHover = cn(
    card,
    'transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg'
);

/** 表格外框 */
export const tableWrap = cn(card, 'overflow-x-auto');

/**
 * 表头：浅灰底 + 小号大写字母间距
 *
 * DaisyUI 的 `.table th` 直接给 th 设了字号与颜色，写在 thead 上继承不到，
 * 所以用 `[&_th]:` 任意变体直接命中 th。
 */
export const thead =
    'bg-gray-50/80 dark:bg-base-200/40 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-gray-500 dark:[&_th]:text-gray-400';

/** 数据行：悬浮浅底 */
export const row = 'transition-colors hover:bg-gray-50/80 dark:hover:bg-base-200/40';

/** 主按钮（与 ProvidersPage 的「添加」一致） */
export const primaryBtn =
    'btn btn-sm gap-2 border-none bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-sm hover:from-blue-600 hover:to-purple-600 disabled:bg-none';

/** 次按钮 */
export const ghostBtn = 'btn btn-ghost btn-sm gap-2';

/** 仅图标的方形按钮 */
export const iconBtn = 'btn btn-ghost btn-sm btn-square';

/** 分段控件容器；配合 segmentItem 使用 */
export const segment = 'inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-base-200';

/**
 * 分段控件选项
 *
 * 默认高度与 btn-sm 对齐（容器 p-0.5 + h-7 = 32px）；`large` 用于页面级标签页。
 */
export function segmentItem(active: boolean, large = false): string {
    return cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
        large ? 'h-9 px-4 text-sm' : 'h-7 px-3 text-xs',
        active
            ? 'bg-white text-gray-900 shadow-sm dark:bg-base-100 dark:text-base-content'
            : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-base-content'
    );
}

/** 软色徽章的色调 */
export type ChipTone = 'success' | 'warning' | 'error' | 'info' | 'violet' | 'neutral';

const CHIP_TONES: Record<ChipTone, string> = {
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    error: 'bg-red-500/10 text-red-600 dark:text-red-400',
    info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    neutral: 'bg-gray-500/10 text-gray-600 dark:text-gray-300',
};

/** 软色徽章 */
export function chip(tone: ChipTone, extra?: string): string {
    return cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
        CHIP_TONES[tone],
        extra
    );
}

/** 分页页码按钮 */
export function pageBtn(active: boolean): string {
    return cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm tabular-nums transition-colors disabled:opacity-30',
        active
            ? 'bg-gray-900 text-white dark:bg-base-content dark:text-base-100'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-base-200'
    );
}

/** 表单字段小标签（作为 label 内的 span 使用） */
export const fieldLabel = 'mb-1 block text-[11px] font-medium text-gray-500 dark:text-gray-400';

/** 表单控件 */
export const input = 'input input-bordered input-sm w-full';
export const select = 'select select-bordered select-sm w-full';

/** 次要文字 */
export const muted = 'text-gray-500 dark:text-gray-400';

/** 空态 */
export const emptyState =
    'flex flex-col items-center justify-center gap-2 py-12 text-sm text-gray-400 dark:text-gray-500';
