import {create} from 'zustand';
import {invoke} from '@tauri-apps/api/core';

// ── 类型定义 ──────────────────────────────────────────────

export interface DashboardStats {
    num_startups: number;
    total_projects: number;
    total_sessions: number;
    total_history: number;
}

export interface HistoryEntry {
    date: string;
    count: number;
}

export interface ModelUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUsd: number;
}

export interface DailyModelTokens {
    date: string;
    tokensByModel: Record<string, number>;
}

export interface StatsCache {
    modelUsage: Record<string, ModelUsage>;
    dailyModelTokens: DailyModelTokens[];
    hourCounts: Record<string, number>;
    totalSessions: number;
    totalMessages: number;
}

export interface ProjectTokenStat {
    name: string;
    path: string;
    session_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
}

// ── Store 状态 ──────────────────────────────────────────────

interface DashboardState {
    stats: DashboardStats | null;
    activity: HistoryEntry[];
    tokenStats: StatsCache | null;
    projectTokenStats: ProjectTokenStat[];
    selectedAppType: string;
    hasLoaded: boolean;
    loading: boolean;
    refreshingStats: boolean;

    loadData: (force?: boolean) => Promise<void>;
    setSelectedAppType: (appType: string) => Promise<void>;
    refreshStatsCache: () => Promise<void>;
}

// ── Store 实现 ──────────────────────────────────────────────

export const useDashboardStore = create<DashboardState>((set, get) => ({
    stats: null,
    activity: [],
    tokenStats: null,
    projectTokenStats: [],
    selectedAppType: 'all',
    hasLoaded: false,
    loading: false,
    refreshingStats: false,

    loadData: async (force = false) => {
        if (!force && get().hasLoaded) return;
        set({ loading: true });

        const appTypeParam = get().selectedAppType === 'all' ? null : get().selectedAppType;

        const [statsResult, activityResult, tokenResult, projectResult] = await Promise.allSettled([
            invoke<DashboardStats>('get_dashboard_stats'),
            invoke<HistoryEntry[]>('get_activity_history'),
            invoke<StatsCache>('get_stats_cache_data', { appType: appTypeParam }),
            invoke<ProjectTokenStat[]>('get_project_token_stats', { appType: appTypeParam }),
        ]);

        let tokenStats = tokenResult.status === 'fulfilled' ? tokenResult.value : get().tokenStats;

        // 缓存为空时自动刷新
        if (!tokenStats || Object.keys(tokenStats.modelUsage || {}).length === 0) {
            try {
                tokenStats = await invoke<StatsCache>('refresh_stats_cache', { appType: appTypeParam });
            } catch { /* 静默失败 */ }
        }

        set({
            stats: statsResult.status === 'fulfilled' ? statsResult.value : get().stats,
            activity: activityResult.status === 'fulfilled' ? activityResult.value : get().activity,
            tokenStats,
            projectTokenStats: projectResult.status === 'fulfilled' ? projectResult.value : get().projectTokenStats,
            loading: false,
            hasLoaded: true,
        });
    },

    setSelectedAppType: async (selectedAppType: string) => {
        set({ selectedAppType, loading: true });
        const appTypeParam = selectedAppType === 'all' ? null : selectedAppType;
        try {
            let [tokenStats, projectTokenStats] = await Promise.all([
                invoke<StatsCache>('get_stats_cache_data', { appType: appTypeParam }),
                invoke<ProjectTokenStat[]>('get_project_token_stats', { appType: appTypeParam }),
            ]);

            // 若对应应用类型无缓存数据，自动按需刷新一次
            if (!tokenStats || Object.keys(tokenStats.modelUsage || {}).length === 0) {
                try {
                    tokenStats = await invoke<StatsCache>('refresh_stats_cache', { appType: appTypeParam });
                } catch { /* 静默失败 */ }
            }

            set({ tokenStats, projectTokenStats });
        } catch (e) {
            console.error('Failed to filter dashboard stats by app:', e);
        } finally {
            set({ loading: false });
        }
    },

    refreshStatsCache: async () => {
        set({ refreshingStats: true });
        const appTypeParam = get().selectedAppType === 'all' ? null : get().selectedAppType;
        try {
            const [newStats, newProjects] = await Promise.all([
                invoke<StatsCache>('refresh_stats_cache', { appType: appTypeParam }),
                invoke<ProjectTokenStat[]>('get_project_token_stats', { appType: appTypeParam }),
            ]);
            set({ tokenStats: newStats, projectTokenStats: newProjects });
        } finally {
            set({ refreshingStats: false });
        }
    },
}));
