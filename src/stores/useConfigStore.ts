import { create } from 'zustand';
import { Config } from '../types/config';
import * as configService from '../services/configService';

interface ConfigState {
    config: Config | null;
    loading: boolean;
    error: string | null;

    // Actions
    loadConfig: () => Promise<void>;
    saveConfig: (config: Config) => Promise<void>;
    updateTheme: (theme: Config['theme']) => Promise<void>;
    updateLanguage: (language: Config['language']) => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
    config: null,
    loading: false,
    error: null,

    loadConfig: async () => {
        set({ loading: true, error: null });
        try {
            const config = await configService.loadConfig();
            set({ config, loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
        }
    },

    saveConfig: async (config: Config) => {
        set({ loading: true, error: null });
        try {
            await configService.saveConfig(config);
            set({ config, loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    updateTheme: async (theme: Config['theme']) => {
        const { config } = get();
        if (!config) return;

        const newConfig = { ...config, theme };
        await get().saveConfig(newConfig);
    },

    updateLanguage: async (language: Config['language']) => {
        const { config } = get();
        if (!config) return;

        const newConfig = { ...config, language };
        await get().saveConfig(newConfig);
    },
}));
