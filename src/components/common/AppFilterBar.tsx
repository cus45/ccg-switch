import { Monitor } from 'lucide-react';
import { BrandGlyphIcon, type BrandGlyph } from './BrandGlyphIcon';
import { APP_LABELS, type AppType } from '../../types/app';
import { cn } from '../../utils/cn';

const GLYPHS: Partial<Record<AppType, { glyph: BrandGlyph; colored: boolean }>> = {
    claude: { glyph: 'claude-lobehub', colored: true },
    codex: { glyph: 'chatgpt-openai', colored: false },
    gemini: { glyph: 'gemini-google', colored: true },
    opencode: { glyph: 'opencode', colored: false },
    claudedesktop: { glyph: 'claude-lobehub', colored: true },
};

/** 单个应用的裸图标（无底色），Claude Desktop 在 Claude 图标右下角加显示器角标 */
export function AppGlyph({ app, size = 16 }: { app: AppType; size?: number }) {
    const spec = GLYPHS[app];
    if (!spec) {
        return <span className="text-xs font-bold leading-none">{APP_LABELS[app]?.charAt(0) ?? '?'}</span>;
    }
    return (
        <span className="relative inline-flex">
            <BrandGlyphIcon glyph={spec.glyph} size={size} colored={spec.colored} />
            {app === 'claudedesktop' && (
                <Monitor
                    className="absolute -bottom-1 -right-1.5 rounded-sm bg-white p-px text-gray-600 dark:bg-base-100 dark:text-gray-300"
                    style={{ width: size * 0.6, height: size * 0.6 }}
                    strokeWidth={2.5}
                />
            )}
        </span>
    );
}

interface AppFilterBarProps {
    apps: AppType[];
    value: AppType | 'all';
    onChange: (next: AppType | 'all') => void;
    allLabel: string;
    className?: string;
}

/**
 * 应用筛选条：「全部」+ 各应用图标，点击即选中（替代下拉框）
 *
 * 图标按钮的名称通过 title / aria-label 提示。
 */
export default function AppFilterBar({ apps, value, onChange, allLabel, className }: AppFilterBarProps) {
    const item = (active: boolean) =>
        cn(
            'inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-sm transition-all',
            active
                ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5 dark:bg-base-100 dark:text-base-content dark:ring-white/10'
                : 'text-gray-500 opacity-70 hover:bg-white/60 hover:opacity-100 dark:text-gray-400 dark:hover:bg-base-100/60'
        );

    return (
        <div
            role="radiogroup"
            className={cn(
                'inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-base-200',
                className
            )}
        >
            <button
                type="button"
                role="radio"
                aria-checked={value === 'all'}
                data-app-filter="all"
                className={cn(item(value === 'all'), 'px-2.5 font-medium')}
                onClick={() => onChange('all')}
            >
                {allLabel}
            </button>
            {apps.map((app) => (
                <button
                    key={app}
                    type="button"
                    role="radio"
                    aria-checked={value === app}
                    aria-label={APP_LABELS[app]}
                    title={APP_LABELS[app]}
                    data-app-filter={app}
                    className={item(value === app)}
                    onClick={() => onChange(app)}
                >
                    <AppGlyph app={app} />
                </button>
            ))}
        </div>
    );
}
