import { useTranslation } from 'react-i18next';
import { Brain } from 'lucide-react';
import { chip, type ChipTone } from './styles';

/**
 * 思考强度色调：越高越醒目
 *
 * 值原样来自客户端（Claude Code：low / medium / high / xhigh / max；
 * Codex：minimal / low / medium / high / xhigh / ultra），不认识的值按中性色显示原文。
 */
const EFFORT_TONES: Record<string, ChipTone> = {
    none: 'neutral',
    minimal: 'neutral',
    low: 'neutral',
    medium: 'info',
    high: 'violet',
    xhigh: 'warning',
    max: 'error',
    ultra: 'error',
};

/** 思考强度徽章；没有数据时显示「—」 */
export function EffortChip({ effort }: { effort?: string | null }) {
    const { t } = useTranslation();
    if (!effort) {
        return <span className="text-xs text-gray-400 dark:text-gray-500">—</span>;
    }
    const key = effort.toLowerCase();
    return (
        <span className={chip(EFFORT_TONES[key] ?? 'neutral')} title={t('usage.reasoningEffort')}>
            <Brain className="h-3 w-3" />
            {t(`usage.effortLevel.${key}`, { defaultValue: effort })}
        </span>
    );
}
