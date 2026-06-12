import { create } from 'zustand';
import type { AdapterRegistry, AppIntegration, ModelAdapter } from '../types/adapter';
import * as adapterRegistryService from '../services/adapterRegistryService';

interface AdapterRegistryState {
    registry: AdapterRegistry | null;
    appIntegrations: AppIntegration[];
    modelAdapters: ModelAdapter[];
    hasLoaded: boolean;
    loading: boolean;
    error: string | null;

    loadRegistry: (force?: boolean) => Promise<AdapterRegistry>;
    clearError: () => void;
}

export const useAdapterRegistryStore = create<AdapterRegistryState>((set, get) => ({
    registry: null,
    appIntegrations: [],
    modelAdapters: [],
    hasLoaded: false,
    loading: false,
    error: null,

    loadRegistry: async (force = false) => {
        const cached = get().registry;
        if (!force && get().hasLoaded && cached) return cached;

        set({ loading: true, error: null });
        try {
            const registry = await adapterRegistryService.getAdapterRegistry();
            set({
                registry,
                appIntegrations: registry.appIntegrations,
                modelAdapters: registry.modelAdapters,
                loading: false,
                hasLoaded: true,
            });
            return registry;
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    clearError: () => {
        set({ error: null });
    },
}));
