import type { AppType } from './app';

export interface SessionMeta {
    providerId: AppType;
    sessionId: string;
    title: string | null;
    summary: string | null;
    projectDir: string | null;
    createdAt: number;
    lastActiveAt: number;
    sourcePath: string;
    resumeCommand: string | null;
}

export interface UnifiedSessionMessage {
    role: string;
    content: string;
    ts?: string;
}

export type ProviderFilter = 'all' | AppType;
export type ViewMode = 'project' | 'all';
