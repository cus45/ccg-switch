import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { ProxyConfig, ProxyState } from '../types/proxy';

const DEFAULT_CONFIG: ProxyConfig = {
    port: 8080,
    host: '0.0.0.0',
    enabled: false,
    takeoverMode: false,
};

interface ProxyStoreState {
    proxyState: ProxyState | null;
    config: ProxyConfig;
    loading: boolean;
    error: string | null;

    loadStatus: () => Promise<void>;
    startProxy: (host: string, port: number) => Promise<void>;
    stopProxy: () => Promise<void>;
    loadConfig: () => Promise<void>;
    updateConfig: (config: Partial<ProxyConfig>) => void;
}

export const useProxyStore = create<ProxyStoreState>((set, get) => {
    let pollTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let pollCount = 0;

    const stopPolling = () => {
        if (pollTimer !== null) {
            globalThis.clearTimeout(pollTimer);
            pollTimer = null;
        }
        pollCount = 0;
    };

    const startPolling = () => {
        stopPolling();
        const tick = async () => {
            if (pollCount >= 30) {
                stopPolling();
                return;
            }
            pollCount++;
            await get().loadStatus();
            const state = get().proxyState;
            if (state?.running) {
                stopPolling();
                return;
            }
            pollTimer = globalThis.setTimeout(tick, 3000);
        };
        pollTimer = globalThis.setTimeout(tick, 3000);
    };

    return {
        proxyState: null,
        config: DEFAULT_CONFIG,
        loading: false,
        error: null,

        loadStatus: async () => {
            try {
                const state = await invoke<ProxyState>('get_proxy_status');
                set({ proxyState: state, error: null });
            } catch (error) {
                set({ error: String(error) });
            }
        },

        startProxy: async (host, port) => {
            set({ loading: true, error: null });
            try {
                const currentConfig = get().config;
                await invoke('start_proxy', {
                    config: { ...currentConfig, host, port, enabled: true },
                });
                await get().loadStatus();
                startPolling();
            } catch (error) {
                set({ error: String(error) });
                throw error;
            } finally {
                set({ loading: false });
            }
        },

        stopProxy: async () => {
            set({ loading: true, error: null });
            stopPolling();
            try {
                await invoke('stop_proxy');
                await get().loadStatus();
            } catch (error) {
                set({ error: String(error) });
                throw error;
            } finally {
                set({ loading: false });
            }
        },

        loadConfig: async () => {
            try {
                const config = await invoke<ProxyConfig>('get_proxy_config');
                set({ config });
            } catch {
                // 后端命令可能未实现，使用默认值
                set({ config: DEFAULT_CONFIG });
            }
        },

        updateConfig: (partial) => {
            set((s) => ({ config: { ...s.config, ...partial } }));
        },
    };
});
