import { card } from './styles';

/**
 * 趋势图占位
 *
 * 图表组件被 React.lazy 拆包（recharts 体积大），chunk 到达前与首次取数期间
 * 共用同一个占位；高度与图表卡片完全一致（p-5 + 标题行 + 350px），避免切换时页面跳动。
 */
export function UsageChartSkeleton() {
    return (
        <div className={`${card} p-5`} aria-busy="true">
            <div className="mb-6 flex items-center justify-between">
                <div className="skeleton h-7 w-28" />
                <div className="skeleton h-5 w-16" />
            </div>
            <div className="skeleton h-[350px] w-full rounded-lg" />
        </div>
    );
}
