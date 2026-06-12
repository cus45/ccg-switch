import { useEffect, useMemo } from 'react';
import { APP_COLORS, APP_LABELS, APP_TYPES, VISIBLE_APP_TYPES, type AppType } from '../types/app';
import type { AppIntegration } from '../types/adapter';
import { useAdapterRegistryStore } from '../stores/useAdapterRegistryStore';

export interface VisibleAppOption {
    appType: AppType;
    label: string;
    color: string;
    mcpSyncSupported: boolean;
}

const appTypeSet = new Set<string>(APP_TYPES);
const EMPTY_EXTRA_APP_TYPES: Array<AppType | null | undefined> = [];

export function isKnownAppType(value: string): value is AppType {
    return appTypeSet.has(value);
}

export function getAppLabel(appType: AppType | string): string {
    return isKnownAppType(appType) ? APP_LABELS[appType] : appType;
}

export function getAppColor(appType: AppType | string): string {
    return isKnownAppType(appType) ? APP_COLORS[appType] : '#6B7280';
}

export function getFallbackVisibleAppOptions(): VisibleAppOption[] {
    return VISIBLE_APP_TYPES.map(appType => ({
        appType,
        label: APP_LABELS[appType],
        color: APP_COLORS[appType],
        mcpSyncSupported: appType === 'claude' || appType === 'codex' || appType === 'gemini',
    }));
}

export function buildVisibleAppOptions(
    appIntegrations: AppIntegration[],
    extraAppTypes: Array<AppType | null | undefined> = []
): VisibleAppOption[] {
    const options: VisibleAppOption[] = appIntegrations
        .flatMap(app => {
            if (!app.visible || !app.enabled || !isKnownAppType(app.appId)) {
                return [];
            }

            return [{
                appType: app.appId,
                label: app.displayName || APP_LABELS[app.appId],
                color: APP_COLORS[app.appId],
                mcpSyncSupported: app.mcpSyncSupported,
            }];
        });

    const visible = options.length > 0 ? options : getFallbackVisibleAppOptions();
    const existing = new Set(visible.map(option => option.appType));
    const withExtras = [...visible];

    for (const appType of extraAppTypes) {
        if (!appType || existing.has(appType)) continue;
        withExtras.push({
            appType,
            label: getAppLabel(appType),
            color: getAppColor(appType),
            mcpSyncSupported: false,
        });
        existing.add(appType);
    }

    return withExtras;
}

export function useVisibleAppOptions(extraAppTypes: Array<AppType | null | undefined> = EMPTY_EXTRA_APP_TYPES): VisibleAppOption[] {
    const appIntegrations = useAdapterRegistryStore(state => state.appIntegrations);
    const hasLoaded = useAdapterRegistryStore(state => state.hasLoaded);
    const loading = useAdapterRegistryStore(state => state.loading);
    const loadRegistry = useAdapterRegistryStore(state => state.loadRegistry);

    useEffect(() => {
        if (!hasLoaded && !loading) {
            void loadRegistry().catch(() => {
                // registry 读取失败时保持 legacy fallback，避免阻断核心 UI。
            });
        }
    }, [hasLoaded, loadRegistry, loading]);

    return useMemo(
        () => buildVisibleAppOptions(appIntegrations, extraAppTypes),
        [appIntegrations, extraAppTypes]
    );
}

export function useVisibleAppOptionMap(extraAppTypes: Array<AppType | null | undefined> = EMPTY_EXTRA_APP_TYPES): Record<AppType, VisibleAppOption> {
    const options = useVisibleAppOptions(extraAppTypes);

    return useMemo(() => {
        return options.reduce((acc, option) => {
            acc[option.appType] = option;
            return acc;
        }, {} as Record<AppType, VisibleAppOption>);
    }, [options]);
}
