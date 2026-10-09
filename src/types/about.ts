export interface ToolVersion {
    name: string;
    version: string | null;
    latestVersion: string | null;
    error: string | null;
}

export interface UpdateInfo {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion: string;
    releaseNotes: string;
    downloadUrl: string | null;
    fileSize: number | null;
    publishedAt: string | null;
}

export interface DownloadProgress {
    downloaded: number;
    total: number;
    percentage: number;
}

export interface InstallProgress {
    stage: string;
    message: string;
    percentage: number;
}

// ── CLI 工具一键安装 / 升级 ──────────────────────────────

export type ToolAction = 'install' | 'upgrade';

/** 后端白名单生成的执行计划，确认框展示 command */
export interface InstallPlan {
    tool: string;
    action: ToolAction;
    command: string;
    needsNpm: boolean;
}

/** 事件 tool-install-log */
export interface ToolInstallLog {
    tool: string;
    line: string;
    stream: 'stdout' | 'stderr';
}

/** 事件 tool-install-finished */
export interface ToolInstallFinished {
    tool: string;
    success: boolean;
    exitCode: number | null;
    cancelled: boolean;
    error: string | null;
}

export type ToolInstallStatus = 'running' | 'success' | 'failed' | 'cancelled';

export interface ToolInstallState {
    action: ToolAction;
    status: ToolInstallStatus;
    logs: string[];
    exitCode: number | null;
}
