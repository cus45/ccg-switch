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
