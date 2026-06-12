import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronRight, FileText, MessageSquare, PanelLeftClose, PanelLeftOpen, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProviderFilter, SessionMeta } from '../../types/session';
import { getAppLabel } from '../../hooks/useVisibleAppOptions';

interface WorkspaceSessionPanelProps {
    rootPath: string | null;
    providerFilter: ProviderFilter;
    selectedSession: SessionMeta | null;
    collapsed: boolean;
    refreshToken: number;
    onCollapsedChange: (collapsed: boolean) => void;
    onSelectSession: (session: SessionMeta) => void;
}

const providerColors: Record<string, string> = {
    claude: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    codex: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    gemini: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
};

export function WorkspaceSessionPanel({
    rootPath,
    providerFilter,
    selectedSession,
    collapsed,
    refreshToken,
    onCollapsedChange,
    onSelectSession,
}: WorkspaceSessionPanelProps) {
    const { t } = useTranslation();
    const [sessions, setSessions] = useState<SessionMeta[]>([]);
    const [loading, setLoading] = useState(false);
    const requestIdRef = useRef(0);

    const loadSessions = useCallback(async () => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        if (!rootPath) {
            setSessions([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setSessions([]);
        try {
            const data = await invoke<SessionMeta[]>('list_sessions', { projectPath: rootPath });
            if (requestIdRef.current === requestId) {
                setSessions(data);
            }
        } catch (error) {
            if (requestIdRef.current === requestId) {
                console.error('Failed to load sessions:', error);
            }
        } finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }, [rootPath]);

    useEffect(() => {
        void loadSessions();
    }, [loadSessions, refreshToken]);

    const filteredSessions = useMemo(() => {
        if (providerFilter === 'all') return sessions;
        return sessions.filter(session => session.providerId === providerFilter);
    }, [providerFilter, sessions]);

    if (collapsed) {
        return (
            <div
                className="w-10 shrink-0 flex flex-col items-center border-r border-gray-200/50 dark:border-base-200 cursor-pointer hover:bg-gray-50/50 dark:hover:bg-base-200/50 transition-colors"
                onClick={() => onCollapsedChange(false)}
                title={t('workspaces.sessions_title')}
            >
                <div className="py-3">
                    <PanelLeftOpen className="w-4 h-4 text-gray-400" />
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <span className="text-xs text-gray-400 font-medium [writing-mode:vertical-lr]">
                        {t('workspaces.sessions_title')}
                        {filteredSessions.length > 0 && ` (${filteredSessions.length})`}
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className="w-80 shrink-0 flex flex-col border-r border-gray-200/50 dark:border-base-200">
            <div className="py-2 px-3 border-b border-gray-200/50 dark:border-base-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-base-content">
                        {t('workspaces.sessions_title')}
                    </span>
                    {sessions.length > 0 && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
                            {filteredSessions.length}{providerFilter !== 'all' ? `/${sessions.length}` : ''}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => void loadSessions()}
                        disabled={!rootPath || loading}
                        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-base-200 transition-colors disabled:opacity-50"
                        title={t('common.refresh')}
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        type="button"
                        onClick={() => onCollapsedChange(true)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-base-200 transition-colors"
                        title={t('common.collapse', { defaultValue: '收起' })}
                    >
                        <PanelLeftClose className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
                    </div>
                ) : filteredSessions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400 text-sm">
                        <MessageSquare className="w-8 h-8 mb-2 opacity-40" />
                        <p>{rootPath ? t('sessions.no_sessions') : t('workspaces.select_project')}</p>
                    </div>
                ) : (
                    <div key={`list-${providerFilter}-${rootPath ?? 'all'}`} className="p-2 space-y-0.5">
                        {filteredSessions.map((session) => {
                            const isSelected = selectedSession?.providerId === session.providerId &&
                                selectedSession?.sessionId === session.sessionId &&
                                selectedSession?.sourcePath === session.sourcePath;
                            return (
                                <button
                                    key={`${session.providerId}-${session.sessionId}-${session.sourcePath}`}
                                    onClick={() => onSelectSession(session)}
                                    className={`w-full text-left rounded-lg px-3 py-2.5 transition-all group ${
                                        isSelected
                                            ? 'bg-blue-500/10 dark:bg-blue-500/15 border border-blue-500/30'
                                            : 'hover:bg-gray-50 dark:hover:bg-base-200 border border-transparent'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <FileText className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-blue-500' : 'text-gray-400'}`} />
                                        <span
                                            className="text-sm font-medium text-gray-900 dark:text-base-content truncate flex-1"
                                            title={session.title || session.sessionId}
                                        >
                                            {getWorkspaceSessionTitle(session)}
                                        </span>
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${providerColors[session.providerId] || ''}`}>
                                            {getAppLabel(session.providerId)}
                                        </span>
                                        <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${isSelected ? 'text-blue-500 rotate-90' : 'text-gray-300 dark:text-gray-600'}`} />
                                    </div>
                                    {session.summary && (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate ml-[22px] mb-1">
                                            {session.summary}
                                        </p>
                                    )}
                                    <div className="flex items-center gap-2 text-[11px] text-gray-400 ml-[22px]">
                                        <span className="font-mono opacity-60">{session.sessionId.slice(0, 8)}</span>
                                        <span className="text-gray-300 dark:text-gray-600">·</span>
                                        <span>{formatShortDate(session.lastActiveAt)}</span>
                                        <span className="text-gray-300 dark:text-gray-600">·</span>
                                        <span>{formatRelativeTime(session.lastActiveAt)}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

export function getWorkspaceSessionTitle(session: SessionMeta): string {
    if (session.title?.trim()) return session.title.trim();
    return session.sessionId.length <= 18
        ? session.sessionId
        : `${session.sessionId.slice(0, 8)}...${session.sessionId.slice(-6)}`;
}

function formatRelativeTime(dateStr: string | number): string {
    try {
        const date = typeof dateStr === 'number' ? new Date(dateStr) : new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return '刚刚';
        if (diffMin < 60) return `${diffMin} 分钟前`;
        const diffHour = Math.floor(diffMin / 60);
        if (diffHour < 24) return `${diffHour} 小时前`;
        const diffDay = Math.floor(diffHour / 24);
        if (diffDay < 30) return `${diffDay} 天前`;
        const diffMonth = Math.floor(diffDay / 30);
        if (diffMonth < 12) return `${diffMonth} 个月前`;
        return `${Math.floor(diffMonth / 12)} 年前`;
    } catch {
        return String(dateStr);
    }
}

function formatShortDate(dateStr: string | number): string {
    try {
        const d = typeof dateStr === 'number' ? new Date(dateStr) : new Date(dateStr);
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
        return String(dateStr);
    }
}
