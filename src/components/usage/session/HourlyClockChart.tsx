import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';

interface HourlyClockChartProps {
    hourData: { hour: number; count: number }[];
    maxHourCount: number;
}

export default function HourlyClockChart({ hourData, maxHourCount }: HourlyClockChartProps) {
    const { t } = useTranslation();
    const [hoveredHour, setHoveredHour] = useState<number | null>(null);

    const cx = 150;
    const cy = 150;
    const outerR = 120;
    const innerR = 40;
    const labelR = outerR + 18;

    const segments = hourData.map((h) => {
        const ratio = maxHourCount > 0 ? h.count / maxHourCount : 0;
        const r = innerR + (outerR - innerR) * Math.max(ratio, 0.04);
        const startAngle = (h.hour / 24) * 360 - 90;
        const endAngle = ((h.hour + 1) / 24) * 360 - 90;
        const gap = 0.8;
        const a1 = ((startAngle + gap / 2) * Math.PI) / 180;
        const a2 = ((endAngle - gap / 2) * Math.PI) / 180;
        return { ...h, ratio, r, a1, a2 };
    });

    const toPath = (s: (typeof segments)[0]) => {
        const x1i = cx + innerR * Math.cos(s.a1);
        const y1i = cy + innerR * Math.sin(s.a1);
        const x1o = cx + s.r * Math.cos(s.a1);
        const y1o = cy + s.r * Math.sin(s.a1);
        const x2o = cx + s.r * Math.cos(s.a2);
        const y2o = cy + s.r * Math.sin(s.a2);
        const x2i = cx + innerR * Math.cos(s.a2);
        const y2i = cy + innerR * Math.sin(s.a2);
        return `M${x1i},${y1i} L${x1o},${y1o} A${s.r},${s.r} 0 0,1 ${x2o},${y2o} L${x2i},${y2i} A${innerR},${innerR} 0 0,0 ${x1i},${y1i}Z`;
    };

    const hourLabels = [0, 3, 6, 9, 12, 15, 18, 21];

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 pb-3 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <div className="flex items-center gap-2 mb-1">
                <Clock className="w-5 h-5 text-indigo-500" />
                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                    {t('token_usage.hourly_title')}
                </h2>
            </div>
            <div className="flex items-center justify-center">
                <svg viewBox="0 0 300 300" className="w-full max-w-[300px]">
                    {/* 刻度圆环参考线 */}
                    {[0.25, 0.5, 0.75, 1].map((pct) => (
                        <circle
                            key={pct}
                            cx={cx} cy={cy}
                            r={innerR + (outerR - innerR) * pct}
                            fill="none"
                            stroke="currentColor"
                            className="text-gray-100 dark:text-base-300"
                            strokeWidth={0.5}
                        />
                    ))}
                    {/* 数据扇形 */}
                    {segments.map((s) => {
                        const isHovered = hoveredHour === s.hour;
                        return (
                            <path
                                key={s.hour}
                                d={toPath(s)}
                                className={`transition-all duration-150 cursor-pointer ${
                                    isHovered
                                        ? 'fill-indigo-500 dark:fill-indigo-400'
                                        : s.count > 0
                                            ? 'fill-indigo-400/70 dark:fill-indigo-500/70'
                                            : 'fill-gray-200 dark:fill-base-300'
                                }`}
                                style={isHovered ? { filter: 'drop-shadow(0 0 4px rgba(99,102,241,0.5))' } : undefined}
                                onMouseEnter={() => setHoveredHour(s.hour)}
                                onMouseLeave={() => setHoveredHour(null)}
                            />
                        );
                    })}
                    {/* 小时标签 */}
                    {hourLabels.map((h) => {
                        const angle = ((h / 24) * 360 - 90) * Math.PI / 180;
                        const x = cx + labelR * Math.cos(angle);
                        const y = cy + labelR * Math.sin(angle);
                        return (
                            <text
                                key={h}
                                x={x} y={y}
                                textAnchor="middle"
                                dominantBaseline="central"
                                className="fill-gray-400 dark:fill-gray-500"
                                style={{ fontSize: '13px', fontWeight: 500 }}
                            >
                                {String(h).padStart(2, '0')}
                            </text>
                        );
                    })}
                    {/* 中心数字 */}
                    <text x={cx} y={cy - 8} textAnchor="middle" dominantBaseline="central"
                        className="fill-gray-900 dark:fill-base-content font-bold" style={{ fontSize: '18px' }}>
                        {hoveredHour !== null ? segments[hoveredHour].count : hourData.reduce((s, h) => s + h.count, 0)}
                    </text>
                    <text x={cx} y={cy + 12} textAnchor="middle" dominantBaseline="central"
                        className="fill-gray-400 dark:fill-gray-500" style={{ fontSize: '11px' }}>
                        {hoveredHour !== null ? `${String(hoveredHour).padStart(2, '0')}:00` : t('token_usage.total_messages')}
                    </text>
                </svg>
            </div>
        </div>
    );
}
