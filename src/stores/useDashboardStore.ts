import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface DashboardStats {
    num_startups: number;
    total_projects: number;
    total_sessions: number;
    total_history: number;
}

interface HistoryEntry {
    date: string;
    count: number;
}

interface ModelUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUsd: number;
}

interface DailyModelTokens {
    date: string;
    tokensByModel: Record<string, number>;
}

interface StatsCache {
    modelUsage: Record<string, ModelUsage>;
    dailyModelTokens: DailyModelTokens[];
    hourCounts: Record<string, number>;
    totalSessions: number;
    totalMessages: number;
}

interface ProjectTokenStat {
    name: string;
    path: string;
    session_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
}

interface DashboardState {
    stats: DashboardStats | null;
    activity: HistoryEntry[];
    tokenStats: StatsCache | null;
    projectTokenStats: ProjectTokenStat[];
    hasLoaded: boolean;
    loading: boolean;
    refreshingStats: boolean;

    loadData: (force?: boolean) => Promise<void>;
    refreshStatsCache: () => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
    stats: null,
    activity: [],
    tokenStats: null,
    projectTokenStats: [],
    hasLoaded: false,
    loading: false,
    refreshingStats: false,

    loadData: async (force = false) => {
        if (!force && get().hasLoaded) {
            return;
        }
        set({ loading: true });

        const [statsResult, activityResult, tokenResult, projectResult] = await Promise.allSettled([
            invoke<DashboardStats>('get_dashboard_stats'),
            invoke<HistoryEntry[]>('get_activity_history'),
            invoke<StatsCache>('get_stats_cache_data'),
            invoke<ProjectTokenStat[]>('get_project_token_stats'),
        ]);

        set({
            stats: statsResult.status === 'fulfilled' ? statsResult.value : get().stats,
            activity: activityResult.status === 'fulfilled' ? activityResult.value : get().activity,
            tokenStats: tokenResult.status === 'fulfilled' ? tokenResult.value : get().tokenStats,
            projectTokenStats: projectResult.status === 'fulfilled' ? projectResult.value : get().projectTokenStats,
            loading: false,
            hasLoaded: true,
        });
    },

    refreshStatsCache: async () => {
        set({ refreshingStats: true });
        try {
            const newStats = await invoke<StatsCache>('refresh_stats_cache');
            set({ tokenStats: newStats });
        } finally {
            set({ refreshingStats: false });
        }
    },
}));
