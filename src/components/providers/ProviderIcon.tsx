import {APP_COLORS, APP_LABELS, AppType} from '../../types/app';
import {type BrandGlyph, BrandGlyphIcon} from '../common/BrandGlyphIcon';

interface ProviderIconProps {
    appType: AppType;
    size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm',
    lg: 'w-10 h-10 text-base',
};

const glyphSizeMap = {
    sm: 14,
    md: 18,
    lg: 22,
};

const brandClassMap: Partial<Record<AppType, string>> = {
    claude: 'bg-orange-50 text-[#d97757] ring-orange-200 dark:bg-orange-500/10 dark:ring-orange-500/30',
    codex: 'bg-white text-neutral-950 ring-neutral-300 dark:bg-neutral-950 dark:text-white dark:ring-neutral-700',
    gemini: 'bg-blue-50 text-blue-600 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30',
};

const brandGlyphMap: Partial<Record<AppType, BrandGlyph>> = {
    claude: 'claude-lobehub',
    codex: 'chatgpt-openai',
    gemini: 'gemini-google',
};

export default function ProviderIcon({ appType, size = 'md' }: ProviderIconProps) {
    const color = APP_COLORS[appType] || '#6B7280';
    const label = APP_LABELS[appType] || appType;
    const brandClass = brandClassMap[appType];
    const brandGlyph = brandGlyphMap[appType];
    const glyphSize = glyphSizeMap[size] + (appType === 'codex' ? 2 : 0);

    if (brandClass && brandGlyph) {
        return (
            <div
                aria-label={`${label} provider`}
                className={`${sizeMap[size]} ${appType === 'codex' ? 'rounded-md' : 'rounded-full'} flex items-center justify-center shadow-sm shrink-0 ring-1 ${brandClass}`}
                data-provider-brand-icon={appType}
                title={label}
            >
                <BrandGlyphIcon
                    glyph={brandGlyph}
                    size={glyphSize}
                    colored={appType === 'claude'}
                    providerIcon
                />
            </div>
        );
    }

    return (
        <div
            className={`${sizeMap[size]} rounded-full flex items-center justify-center font-bold text-white shadow-sm shrink-0`}
            style={{ backgroundColor: color }}
            title={label}
        >
            {label.charAt(0).toUpperCase()}
        </div>
    );
}
