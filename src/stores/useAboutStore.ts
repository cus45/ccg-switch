import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import {
    ToolVersion, UpdateInfo, DownloadProgress, InstallProgress,
    ToolAction, ToolInstallState, ToolInstallLog, ToolInstallFinished,
} from '../types/about';

/** 每个工具保留的日志行数上限 */
const MAX_INSTALL_LOG_LINES = 500;

// ── 类型定义 ──────────────────────────────────────────────

interface AboutState {
    // 工具版本
    toolVersions: ToolVersion[];
    loadingTools: boolean;
    lastFetchTime: number;
    // 应用版本
    appVersion: string;
    // 更新检查
    updateInfo: UpdateInfo | null;
    checking: boolean;
    checkError: string | null;
    // 下载
    downloading: boolean;
    downloadProgress: DownloadProgress | null;
    downloadedPath: string | null;
    // 安装
    installing: boolean;
    installStage: string;
    // CLI 工具安装 / 升级：tool → 状态
    toolInstalls: Record<string, ToolInstallState>;

    // actions
    fetchToolVersions: (force?: boolean) => Promise<void>;
    loadAppVersion: () => Promise<void>;
    checkForUpdates: () => Promise<void>;
    downloadUpdate: (url: string) => Promise<void>;
    installUpdate: (filePath: string) => Promise<void>;
    handleRelaunch: () => void;
    setCheckError: (error: string | null) => void;
    setDownloadedPath: (path: string | null) => void;
    initEventListeners: () => void;
    startToolInstall: (tool: string, action: ToolAction) => Promise<void>;
    cancelToolInstall: (tool: string) => Promise<void>;
    dismissToolInstall: (tool: string) => void;
}

// ── 防重入标志 ──────────────────────────────────────────────

let listenersInitialized = false;

// ── Store 实现 ──────────────────────────────────────────────

export const useAboutStore = create<AboutState>((set, get) => ({
    // 初始状态
    toolVersions: [],
    loadingTools: false,
    lastFetchTime: 0,
    appVersion: '',
    updateInfo: null,
    checking: false,
    checkError: null,
    downloading: false,
    downloadProgress: null,
    downloadedPath: null,
    installing: false,
    installStage: 'idle',
    toolInstalls: {},

    fetchToolVersions: async (force = false) => {
        const { toolVersions, lastFetchTime } = get();
        // 5 分钟前端缓存
        if (!force && toolVersions.length > 0 && (Date.now() - lastFetchTime < 300_000)) return;
        set({ loadingTools: true });
        try {
            const data = await invoke<ToolVersion[]>('get_tool_versions', { tools: null, force: force || false });
            if (data.length > 0) {
                set({ toolVersions: data, loadingTools: false, lastFetchTime: Date.now() });
            }
            // 空数组: 保持 loadingTools: true，等待 event 推送
        } catch {
            set({ loadingTools: false });
        }
    },

    loadAppVersion: async () => {
        try {
            const v = await getVersion();
            set({ appVersion: v });
        } catch {
            // 忽略版本获取失败
        }
    },

    checkForUpdates: async () => {
        set({ checking: true, updateInfo: null, checkError: null, downloadedPath: null, downloadProgress: null });
        try {
            const info = await invoke<UpdateInfo>('check_for_updates');
            set({ updateInfo: info, checking: false });
        } catch (e: any) {
            set({
                checkError: typeof e === 'string' ? e : e?.message || '检查更新失败',
                checking: false,
            });
        }
    },

    downloadUpdate: async (url: string) => {
        set({ downloading: true, downloadProgress: null, downloadedPath: null });
        try {
            const path = await invoke<string>('download_update', { url });
            set({ downloadedPath: path, downloading: false });
        } catch (e: any) {
            set({
                checkError: typeof e === 'string' ? e : e?.message || '下载失败',
                downloading: false,
            });
        }
    },

    installUpdate: async (filePath: string) => {
        set({ installing: true, installStage: 'mounting' });
        try {
            await invoke('install_update', { filePath });
        } catch (e: any) {
            set({
                checkError: typeof e === 'string' ? e : e?.message || '安装失败',
                installing: false,
                installStage: 'idle',
            });
        }
    },

    handleRelaunch: () => {
        set({
            checkError: '安装完成！请手动关闭应用并重新打开以使用新版本。',
            installing: false,
            installStage: 'idle',
        });
    },

    startToolInstall: async (tool, action) => {
        set((s) => ({
            toolInstalls: { ...s.toolInstalls, [tool]: { action, status: 'running', logs: [], exitCode: null } },
        }));
        try {
            await invoke('run_tool_install', { tool, action });
        } catch (e: any) {
            const msg = typeof e === 'string' ? e : e?.message || String(e);
            set((s) => ({
                toolInstalls: {
                    ...s.toolInstalls,
                    [tool]: { action, status: 'failed', logs: [msg], exitCode: null },
                },
            }));
        }
    },

    cancelToolInstall: async (tool) => {
        try {
            await invoke('cancel_tool_install', { tool });
        } catch {
            // 任务可能刚好结束，结束事件会更新状态
        }
    },

    dismissToolInstall: (tool) => {
        set((s) => {
            const next = { ...s.toolInstalls };
            delete next[tool];
            return { toolInstalls: next };
        });
    },

    setCheckError: (error) => set({ checkError: error }),
    setDownloadedPath: (path) => set({ downloadedPath: path }),

    initEventListeners: () => {
        if (listenersInitialized) return;
        listenersInitialized = true;

        // 工具版本更新事件
        listen<ToolVersion[]>('tool-versions-updated', (event) => {
            set({ toolVersions: event.payload, loadingTools: false, lastFetchTime: Date.now() });
        });

        // CLI 工具安装日志 / 结束
        listen<ToolInstallLog>('tool-install-log', (event) => {
            const { tool, line } = event.payload;
            set((s) => {
                const cur = s.toolInstalls[tool];
                if (!cur) return {};
                const logs = [...cur.logs, line].slice(-MAX_INSTALL_LOG_LINES);
                return { toolInstalls: { ...s.toolInstalls, [tool]: { ...cur, logs } } };
            });
        });
        listen<ToolInstallFinished>('tool-install-finished', (event) => {
            const { tool, success, cancelled, exitCode, error } = event.payload;
            set((s) => {
                const cur = s.toolInstalls[tool];
                if (!cur) return {};
                const status = cancelled ? 'cancelled' : success ? 'success' : 'failed';
                const logs = error ? [...cur.logs, error] : cur.logs;
                // 安装后后端会强制重新检测版本，先进入加载态等 tool-versions-updated
                return {
                    toolInstalls: { ...s.toolInstalls, [tool]: { ...cur, status, exitCode, logs } },
                    loadingTools: true,
                };
            });
        });

        // 下载进度事件
        listen<DownloadProgress>('update-download-progress', (event) => {
            set({ downloadProgress: event.payload });
        });

        // 安装进度事件
        listen<InstallProgress>('update-install-progress', (event) => {
            set({ installStage: event.payload.stage });
        });
    },
}));
