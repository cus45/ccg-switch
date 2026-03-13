import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { ToolVersion, UpdateInfo, DownloadProgress, InstallProgress } from '../types/about';

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

    setCheckError: (error) => set({ checkError: error }),
    setDownloadedPath: (path) => set({ downloadedPath: path }),

    initEventListeners: () => {
        if (listenersInitialized) return;
        listenersInitialized = true;

        // 工具版本更新事件
        listen<ToolVersion[]>('tool-versions-updated', (event) => {
            set({ toolVersions: event.payload, loadingTools: false, lastFetchTime: Date.now() });
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
