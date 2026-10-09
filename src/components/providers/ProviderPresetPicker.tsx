import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search, Sparkles } from 'lucide-react';
import type { AppType } from '../../types/app';
import { matchesPreset, presetsForApp, type ProviderPresetData } from '../../config/providerPresets';

interface ProviderPresetPickerProps {
    appType: AppType;
    selected: ProviderPresetData | null;
    onSelect: (preset: ProviderPresetData) => void;
}

const CATEGORY_KEYS: Record<string, string> = {
    official: 'providers.presetCategory.official',
    cn_official: 'providers.presetCategory.cn_official',
    aggregator: 'providers.presetCategory.aggregator',
    third_party: 'providers.presetCategory.third_party',
};

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

/** 可搜索的供应商预设选择器：按当前应用过滤，支持按名称和域名搜索 */
export default function ProviderPresetPicker({ appType, selected, onSelect }: ProviderPresetPickerProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const presets = useMemo(() => presetsForApp(appType), [appType]);
    const filtered = useMemo(() => presets.filter((p) => matchesPreset(p, query)), [presets, query]);

    useEffect(() => {
        if (!open) return;
        inputRef.current?.focus();
        const onDown = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    if (presets.length === 0) return null;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex h-8 w-full items-center gap-2 rounded-md border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 px-3 text-xs shadow-sm hover:bg-gray-100 dark:hover:bg-slate-800"
                data-provider-preset-trigger
            >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <span className="truncate text-gray-700 dark:text-slate-200">
                    {selected
                        ? selected.name
                        : t('providers.presetPicker.placeholder', { count: presets.length, defaultValue: `从 ${presets.length} 个预设中选择…` })}
                </span>
                <ChevronDown className="ml-auto h-3.5 w-3.5 opacity-60" />
            </button>

            {open && (
                <div className="absolute left-0 right-0 z-40 mt-1 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl">
                    <div className="relative border-b border-gray-100 dark:border-slate-800 p-2">
                        <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('providers.presetPicker.search', '搜索名称或域名')}
                            className="h-8 w-full rounded-md border border-gray-200 dark:border-slate-700 bg-transparent pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                    <ul className="max-h-72 overflow-y-auto p-1" role="listbox">
                        {filtered.length === 0 ? (
                            <li className="px-3 py-4 text-center text-xs text-gray-400">
                                {t('providers.presetPicker.empty', '没有匹配的预设')}
                            </li>
                        ) : (
                            filtered.map((p) => (
                                <li key={`${p.name}|${p.url}`}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={selected?.name === p.name && selected?.url === p.url}
                                        onClick={() => {
                                            onSelect(p);
                                            setOpen(false);
                                            setQuery('');
                                        }}
                                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-slate-800"
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-xs font-medium text-gray-900 dark:text-slate-100">
                                                {p.name}
                                            </span>
                                            <span className="block truncate font-mono text-[10px] text-gray-400">
                                                {hostOf(p.url)}
                                            </span>
                                        </span>
                                        {CATEGORY_KEYS[p.category] && (
                                            <span className="shrink-0 rounded bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-gray-500 dark:text-slate-400">
                                                {t(CATEGORY_KEYS[p.category])}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}
