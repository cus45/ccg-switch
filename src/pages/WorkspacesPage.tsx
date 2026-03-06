import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search, FolderOpen, Terminal, FileText, RefreshCw, ChevronRight, Clock, MessageSquare, Copy, Hash, Play } from 'lucide-react';

interface ProjectInfo {
    name: string;
    path: string;
    session_count: number;
    last_active: string | null;
}

interface SessionInfo {
    session_id: string;
    file_path: string;
    last_modified: string | null;
    file_size: number;
    session_title?: string;
    session_preview?: string;
    session_slug?: string;
    last_message?: string;
    last_message_role?: string;
    last_message_at?: string;
}

interface SessionMessage {
    role: string;
    content: string;
    ts?: string;
}

/** 将 ISO/日期字符串转成友好的相对时间 */
function formatRelativeTime(dateStr: string): string {
    try {
        const date = new Date(dateStr);
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
        return dateStr;
    }
}

/** 格式化时间戳为 yyyy/M/d HH:mm:ss */
function formatTimestamp(dateStr: string): string {
    try {
        const d = new Date(dateStr);
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    } catch {
        return dateStr;
    }
}

function WorkspacesPage() {
    const { t } = useTranslation();
    const [projects, setProjects] = useState<ProjectInfo[]>([]);
    const [sessions, setSessions] = useState<SessionInfo[]>([]);
    const [selectedProject, setSelectedProject] = useState<ProjectInfo | null>(null);
    const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
    const [messages, setMessages] = useState<SessionMessage[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [search, setSearch] = useState('');
    const [loadingProjects, setLoadingProjects] = useState(true);
    const [loadingSessions, setLoadingSessions] = useState(false);

    const loadMessages = useCallback(async (session: SessionInfo) => {
        setLoadingMessages(true);
        setMessages([]);
        try {
            const data = await invoke<SessionMessage[]>('get_session_messages', { filePath: session.file_path });
            setMessages(data);
        } catch (e) {
            console.error('Failed to load messages:', e);
        }
        setLoadingMessages(false);
    }, []);

    const handleSelectSession = useCallback((session: SessionInfo) => {
        setSelectedSession(session);
        loadMessages(session);
    }, [loadMessages]);

    const loadProjects = useCallback(async () => {
        setLoadingProjects(true);
        try {
            const data = await invoke<ProjectInfo[]>('get_dashboard_projects');
            setProjects(data);
        } catch (e) {
            console.error('Failed to load projects:', e);
        }
        setLoadingProjects(false);
    }, []);

    useEffect(() => {
        loadProjects();
    }, [loadProjects]);

    const loadSessions = useCallback(async (project: ProjectInfo) => {
        setLoadingSessions(true);
        setSessions([]);
        setSelectedSession(null);
        setMessages([]);
        try {
            const data = await invoke<SessionInfo[]>('get_project_sessions', { projectPath: project.path });
            setSessions(data);
            // 自动选中第一个会话并加载消息
            if (data.length > 0) {
                setSelectedSession(data[0]);
                loadMessages(data[0]);
            }
        } catch (e) {
            console.error('Failed to load sessions:', e);
        }
        setLoadingSessions(false);
    }, [loadMessages]);

    const selectProject = (project: ProjectInfo) => {
        setSelectedProject(project);
        loadSessions(project);
    };

    const openTerminal = async (path: string) => {
        try {
            await invoke('open_in_terminal', { path });
        } catch (e) {
            console.error(t('workspaces.open_terminal_error'), e);
        }
    };

    const resumeSession = async (sessionId: string, projectPath?: string) => {
        try {
            const command = `claude --resume ${sessionId}`;
            await invoke('launch_resume_session', { command, cwd: projectPath || null });
        } catch (e) {
            console.error('Failed to resume session:', e);
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // silent
        }
    };

    const filteredProjects = useMemo(() =>
        projects.filter(p =>
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.path.toLowerCase().includes(search.toLowerCase())
        ), [projects, search]
    );

    const formatSize = (bytes: number) => {
        if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + ' MB';
        if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return bytes + ' B';
    };

    const getSessionTitle = (session: SessionInfo) => {
        if (session.session_title?.trim()) return session.session_title.trim();
        if (session.session_slug?.trim()) return session.session_slug.trim();
        return session.session_id.length <= 18
            ? session.session_id
            : `${session.session_id.slice(0, 8)}…${session.session_id.slice(-6)}`;
    };

    return (
        <div className="h-full w-full overflow-hidden">
            <div className="h-full flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200/50 dark:border-base-200">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <FolderOpen className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-gray-900 dark:text-base-content">
                                {t('workspaces.title')}
                            </h1>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {t('workspaces.subtitle')}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={loadProjects}
                        disabled={loadingProjects}
                        className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-base-200 transition-colors"
                        title={t('common.refresh')}
                    >
                        <RefreshCw className={`w-4 h-4 ${loadingProjects ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {/* Main Content - Three Panel Layout */}
                <div className="flex-1 flex min-h-0">
                    {/* Left Panel - Project List */}
                    <div className="w-64 shrink-0 flex flex-col border-r border-gray-200/50 dark:border-base-200 bg-gray-50/50 dark:bg-base-100/50">
                        {/* Search */}
                        <div className="p-3">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder={t('workspaces.search_placeholder')}
                                    className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-white dark:bg-base-200 border border-gray-200 dark:border-base-300 outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-gray-900 dark:text-base-content placeholder-gray-400 transition-all"
                                />
                            </div>
                        </div>

                        {/* Project List */}
                        <div className="flex-1 overflow-y-auto">
                            {loadingProjects ? (
                                <div className="flex items-center justify-center py-12">
                                    <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
                                </div>
                            ) : filteredProjects.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-gray-400 text-sm">
                                    <FolderOpen className="w-8 h-8 mb-2 opacity-40" />
                                    <p>{t('dashboard.projects_empty')}</p>
                                </div>
                            ) : (
                                <div className="px-2 space-y-0.5">
                                    {filteredProjects.map((project) => {
                                        const isSelected = selectedProject?.path === project.path;
                                        return (
                                            <button
                                                key={project.path}
                                                onClick={() => selectProject(project)}
                                                className={`w-full text-left rounded-lg px-3 py-2.5 transition-all group ${
                                                    isSelected
                                                        ? 'bg-blue-500/10 dark:bg-blue-500/15 border border-blue-500/30'
                                                        : 'hover:bg-gray-100 dark:hover:bg-base-200 border border-transparent'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <FolderOpen className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-500' : 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300'}`} />
                                                    <span className="font-medium text-sm text-gray-900 dark:text-base-content truncate flex-1">
                                                        {project.name}
                                                    </span>
                                                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${isSelected ? 'text-blue-500 rotate-90' : 'text-gray-300 dark:text-gray-600'}`} />
                                                </div>
                                                <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-400 ml-6">
                                                    <Clock className="w-3 h-3" />
                                                    <span>{project.session_count} {t('dashboard.projects_sessions')}</span>
                                                    {project.last_active && (
                                                        <span className="ml-1">· {formatRelativeTime(project.last_active)}</span>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Middle Panel - Sessions List */}
                    <div className="w-80 shrink-0 flex flex-col border-r border-gray-200/50 dark:border-base-200">
                        {!selectedProject ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                                <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
                                <p className="text-sm">{t('workspaces.select_project')}</p>
                            </div>
                        ) : (
                            <>
                                {/* Session List Header */}
                                <div className="py-2 px-3 border-b border-gray-200/50 dark:border-base-200 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-gray-900 dark:text-base-content">
                                            {t('workspaces.sessions_title', { defaultValue: '会话列表' })}
                                        </span>
                                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
                                            {sessions.length}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => selectedProject && loadSessions(selectedProject)}
                                        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-base-200 transition-colors"
                                    >
                                        <RefreshCw className={`w-3.5 h-3.5 ${loadingSessions ? 'animate-spin' : ''}`} />
                                    </button>
                                </div>

                                {/* Session List */}
                                <div className="flex-1 overflow-y-auto">
                                    {loadingSessions ? (
                                        <div className="flex items-center justify-center py-12">
                                            <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
                                        </div>
                                    ) : sessions.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-12 text-gray-400 text-sm">
                                            <MessageSquare className="w-8 h-8 mb-2 opacity-40" />
                                            <p>{t('workspaces.no_sessions')}</p>
                                        </div>
                                    ) : (
                                        <div className="p-2 space-y-0.5">
                                            {sessions.map((session) => {
                                                const isSelected = selectedSession?.session_id === session.session_id;
                                                return (
                                                    <button
                                                        key={session.session_id}
                                                        onClick={() => handleSelectSession(session)}
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
                                                                title={session.session_title || session.session_slug || session.session_id}
                                                            >
                                                                {getSessionTitle(session)}
                                                            </span>
                                                            <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${isSelected ? 'text-blue-500 rotate-90' : 'text-gray-300 dark:text-gray-600'}`} />
                                                        </div>
                                                        {/* Preview */}
                                                        {(session.last_message || session.session_preview) && (
                                                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate ml-[22px] mb-1">
                                                                {session.last_message
                                                                    ? `${session.last_message_role === 'assistant' ? t('workspaces.role_assistant') : t('workspaces.role_user')}: ${session.last_message}`
                                                                    : session.session_preview}
                                                            </p>
                                                        )}
                                                        <div className="flex items-center gap-2 text-[11px] text-gray-400 ml-[22px]">
                                                            <Clock className="w-3 h-3" />
                                                            <span>{session.last_message_at ? formatRelativeTime(session.last_message_at) : (session.last_modified ? formatRelativeTime(session.last_modified) : '')}</span>
                                                            <span className="text-gray-300 dark:text-gray-600">·</span>
                                                            <span>{formatSize(session.file_size)}</span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Right Panel - Session Detail */}
                    <div className="flex-1 flex flex-col min-w-0">
                        {!selectedSession ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                                <FileText className="w-12 h-12 mb-3 opacity-20" />
                                <p className="text-sm">{t('workspaces.select_session', { defaultValue: '选择一个会话查看详情' })}</p>
                            </div>
                        ) : (
                            <>
                                {/* Detail Header */}
                                <div className="px-5 py-3 border-b border-gray-200/50 dark:border-base-200 shrink-0">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0 flex-1">
                                            <h2 className="text-base font-semibold text-gray-900 dark:text-base-content truncate">
                                                {getSessionTitle(selectedSession)}
                                            </h2>
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                                                {selectedSession.last_message_at && (
                                                    <div className="flex items-center gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        <span>{formatTimestamp(selectedSession.last_message_at)}</span>
                                                    </div>
                                                )}
                                                {selectedProject && (
                                                    <button
                                                        className="flex items-center gap-1 hover:text-blue-500 transition-colors"
                                                        onClick={() => copyToClipboard(selectedProject.path)}
                                                        title={selectedProject.path}
                                                    >
                                                        <FolderOpen className="w-3 h-3" />
                                                        <span className="truncate max-w-[200px]">{selectedProject.name}</span>
                                                    </button>
                                                )}
                                                <div className="flex items-center gap-1">
                                                    <Hash className="w-3 h-3" />
                                                    <span className="font-mono text-[11px]" title={selectedSession.session_id}>
                                                        {selectedSession.session_id.length > 18
                                                            ? `${selectedSession.session_id.slice(0, 8)}…${selectedSession.session_id.slice(-6)}`
                                                            : selectedSession.session_id}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <FileText className="w-3 h-3" />
                                                    <span>{formatSize(selectedSession.file_size)}</span>
                                                </div>
                                            </div>
                                        </div>
                                        {selectedProject && (
                                            <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                    onClick={() => resumeSession(selectedSession.session_id, selectedProject.path)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 rounded-lg transition-all shadow-sm hover:shadow-md shrink-0"
                                                    title={t('workspaces.resume_session', { defaultValue: '恢复会话' })}
                                                >
                                                    <Play className="w-3.5 h-3.5" />
                                                    <span className="hidden sm:inline">{t('workspaces.resume_session', { defaultValue: '恢复会话' })}</span>
                                                </button>
                                                <button
                                                    onClick={() => openTerminal(selectedProject.path)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 bg-gray-100 dark:bg-base-200 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors shrink-0"
                                                    title={t('workspaces.open_terminal')}
                                                >
                                                    <Terminal className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Resume Command Bar */}
                                    <div className="mt-2.5 flex items-center gap-2">
                                        <div className="flex-1 rounded-md bg-gray-50 dark:bg-base-200 px-3 py-1.5 font-mono text-xs text-gray-500 dark:text-gray-400 truncate">
                                            <span className="text-blue-500 dark:text-blue-400">claude</span> --resume {selectedSession.session_id}
                                        </div>
                                        <button
                                            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-base-200 transition-colors shrink-0"
                                            onClick={() => copyToClipboard(`claude --resume ${selectedSession.session_id}`)}
                                            title={t('common.copy', { defaultValue: '复制' })}
                                        >
                                            <Copy className="w-3.5 h-3.5" />
                                        </button>
                                    </div>

                                    {/* File Path Bar */}
                                    <div className="mt-1.5 flex items-center gap-2">
                                        <div className="flex-1 rounded-md bg-gray-50 dark:bg-base-200 px-3 py-1.5 font-mono text-xs text-gray-500 dark:text-gray-400 truncate">
                                            {selectedSession.file_path}
                                        </div>
                                        <button
                                            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-base-200 transition-colors shrink-0"
                                            onClick={() => copyToClipboard(selectedSession.file_path)}
                                            title={t('common.copy', { defaultValue: '复制' })}
                                        >
                                            <Copy className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Messages Area */}
                                <div className="flex-1 overflow-y-auto">
                                    <div className="p-5">
                                        {/* Conversation History Header */}
                                        <div className="flex items-center gap-2 mb-4">
                                            <MessageSquare className="w-4 h-4 text-gray-400" />
                                            <span className="text-sm font-medium text-gray-900 dark:text-base-content">
                                                {t('workspaces.conversation_history', { defaultValue: '对话记录' })}
                                            </span>
                                            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-base-300 text-gray-500 dark:text-gray-400 font-medium">
                                                {messages.length}
                                            </span>
                                        </div>

                                        {loadingMessages ? (
                                            <div className="flex items-center justify-center py-12">
                                                <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
                                            </div>
                                        ) : messages.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                                                <MessageSquare className="w-8 h-8 mb-2 opacity-40" />
                                                <p className="text-sm">{t('workspaces.session_preview_empty')}</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {messages.map((msg, index) => (
                                                    <div
                                                        key={`${msg.role}-${index}`}
                                                        className={`rounded-lg border px-4 py-3 relative group transition-all ${
                                                            msg.role === 'user'
                                                                ? 'bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/20 ml-8'
                                                                : 'bg-purple-500/5 dark:bg-purple-500/10 border-purple-500/20 mr-8'
                                                        }`}
                                                    >
                                                        <button
                                                            className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white/50 dark:hover:bg-black/20 transition-all"
                                                            onClick={() => copyToClipboard(msg.content)}
                                                        >
                                                            <Copy className="w-3 h-3" />
                                                        </button>
                                                        <div className="flex items-center justify-between text-xs mb-1.5 pr-6">
                                                            <span className={`font-semibold ${
                                                                msg.role === 'user'
                                                                    ? 'text-blue-600 dark:text-blue-400'
                                                                    : 'text-purple-600 dark:text-purple-400'
                                                            }`}>
                                                                {msg.role === 'assistant'
                                                                    ? t('workspaces.role_assistant')
                                                                    : t('workspaces.role_user')}
                                                            </span>
                                                            {msg.ts && (
                                                                <span className="text-gray-400">
                                                                    {formatTimestamp(msg.ts)}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 leading-relaxed break-words">
                                                            {msg.content}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default WorkspacesPage;
