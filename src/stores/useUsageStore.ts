import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface ProviderDailySummary {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}

interface ModelDailySummary {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}

export interface UsageDailySummary {
    date: string;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    byProvider: Record<string, ProviderDailySummary>;
    byModel: Record<string, ModelDailySummary>;
}

interface UsageState {
    summaries: UsageDailySummary[];
    loading: boolean;
    days: number;
    hasLoaded: boolean;
    loadSummaries: (days?: number) => Promise<void>;
    setDays: (days: number) => void;
}

export const useUsageStore = create<UsageState>((set, get) => ({
    summaries: [],
    loading: false,
    days: 7,
    hasLoaded: false,

    loadSummaries: async (days?: number) => {
        const d = days ?? get().days;
        set({ loading: true });
        try {
            const data = await invoke<UsageDailySummary[]>('get_usage_summaries', { days: d });
            set({ summaries: data, loading: false, days: d, hasLoaded: true });
        } catch {
            set({ loading: false });
        }
    },

    setDays: (days: number) => {
        set({ days });
        get().loadSummaries(days);
    },
}));
