import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useVisibleAppOptions } from '../../hooks/useVisibleAppOptions';

// 简化的 Provider 接口
interface Provider {
    id: string;
    name: string;
    appType: string;
    isActive: boolean;
}

function MultiAppStatsCard() {
    const { t } = useTranslation();
    const [providers, setProviders] = useState<Provider[]>([]);
    const appOptions = useVisibleAppOptions();

    useEffect(() => {
        invoke<Provider[]>('get_all_providers').then(setProviders).catch(() => {});
    }, []);

    const appGroups = appOptions.map(({ appType: app, label, color }) => {
        const appProviders = providers.filter(p => p.appType === app);
        const active = appProviders.find(p => p.isActive);
        return { app, label, color, count: appProviders.length, activeName: active?.name || null };
    });

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <div className="flex items-center gap-2 mb-4">
                <Layers className="w-5 h-5 text-cyan-500" />
                <h3 className="font-semibold text-gray-900 dark:text-base-content">
                    {t('dashboard.multiAppStats')}
                </h3>
            </div>
            <div className="space-y-2.5">
                {appGroups.map(group => (
                    <div key={group.app} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: group.color }} />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{group.label}</span>
                            <span className="text-xs text-gray-400">({group.count})</span>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[140px]" title={group.activeName || undefined}>
                            {group.activeName || t('dashboard.noActive')}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default MultiAppStatsCard;
