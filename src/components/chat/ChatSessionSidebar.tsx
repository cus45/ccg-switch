import {type MouseEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {invoke} from '@tauri-apps/api/core';
import {
    ChevronDown,
    ChevronRight,
    ChevronUp,
    Clock,
    FolderOpen,
    History,
    Loader2,
    MessageSquare,
    PanelLeftClose,
    Pin,
    Plus,
    RefreshCw,
    Search,
} from 'lucide-react';
import {useShallow} from 'zustand/react/shallow';
import {useChatStore} from '../../stores/useChatStore';
import {showToast} from '../common/ToastContainer';
import {getSessionSelectionKey, type SessionMeta} from '../../types/session';
import {openChatPathInExplorer, renameChatSessionTitle} from '../../utils/chatWorkspaceStatus';
import {
    markProjectAllRead,
    removeProject,
    renameProject,
    setProjectArchived,
    setProjectPinned,
    setSessionArchived,
    setSessionPinned,
    setSessionUnread,
} from '../../services/workspaceMetadataService';
import {
    buildRecentChatProjectGroups,
    filterSessionsByProvider,
    formatShortDate,
    getCachedProjectSessions,
    getProjectParentPath,
    getSessionProviderLabel,
    getVisibleProjectSessions,
    normalizeProjectPathForCache,
    rememberProjectSessions,
    sessionTitle,
    type SessionProviderFilter,
    shouldAcceptSessionListResponse,
    shouldIgnoreSessionClick,
    shouldShowSessionRefreshStatus,
    shouldSyncProjectFromCurrentCwd,
    toggleSessionProviderFilter,
} from './chatSessionSidebarUtils';
import {ProviderBrandIcon} from './composer/ModelIcon';
import {
    type ChatSessionSidebarPanelMode,
    type ChatSessionSidebarState,
    loadChatSessionSidebarState,
    saveChatSessionSidebarState,
} from '../../utils/chatSessionSidebarState';

interface ProjectInfo {
    name: string;
    path: string;
    session_count: number;
    last_active: string | null;
    pinned?: boolean;
    archived?: boolean;
}

interface ChatSessionSidebarProps {
    activeSession: SessionMeta | null;
    currentCwd: string | null;
    pendingSessionKey: string | null;
    onSessionSelect: (session: SessionMeta) => void;
    onNewSession: (cwd?: string | null) => void;
    onCollapse?: () => void;
    collapseLabel?: string;
}

interface SessionProviderBadgeProps {
    providerId: string;
    providerLabel: string;
    selected: boolean;
}

type ContextMenuState =
    | {type: 'project'; x: number; y: number; project: ProjectInfo}
    | {type: 'session'; x: number; y: number; session: SessionMeta}
    | null;
const RECENT_CHAT_WINDOW_DAYS = 7;
const RECENT_CHAT_WINDOW_MS = RECENT_CHAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
/** 每个文件夹在「最近聊天」里默认展示的会话条数，其余折叠在「展开更多」后面。 */
const RECENT_CHAT_DEFAULT_VISIBLE = 4;

export function SessionProviderBadge({
    providerId,
    providerLabel,
    selected,
}: SessionProviderBadgeProps) {
    const normalizedProviderId = providerId.trim().toLowerCase();
    const iconProviderId = normalizedProviderId === 'claude'
        || normalizedProviderId === 'codex'
        || normalizedProviderId === 'gemini'
        ? normalizedProviderId
        : null;

    if (iconProviderId) {
        return (
            <span
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ${selected ? 'bg-primary/10' : 'bg-base-200/80'}`}
                title={providerLabel}
                aria-label={providerLabel}
            >
                <ProviderBrandIcon provider={iconProviderId} size={14} colored />
            </span>
        );
    }

    return (
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${selected ? 'bg-primary/12 text-primary/80' : 'bg-base-200 text-base-content/50'}`}>
            {providerLabel}
        </span>
    );
}

export default function ChatSessionSidebar({
    activeSession,
    currentCwd,
    pendingSessionKey,
    onSessionSelect,
    onNewSession,
    onCollapse,
    collapseLabel,
}: ChatSessionSidebarProps) {
    const {t} = useTranslation();
    const [projects, setProjects] = useState<ProjectInfo[]>([]);
    const [sessions, setSessions] = useState<SessionMeta[]>([]);
    const [sessionsProjectPath, setSessionsProjectPath] = useState<string | null>(currentCwd);
    const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(currentCwd);
    const [projectQuery, setProjectQuery] = useState('');
    const [sessionQuery, setSessionQuery] = useState('');
    const [sessionProviderFilter, setSessionProviderFilter] = useState<SessionProviderFilter>('all');
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [loadingSessions, setLoadingSessions] = useState(false);
    const [sidebarState, setSidebarState] = useState(loadChatSessionSidebarState);
    const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
    const [expandedRecentMoreKeys, setExpandedRecentMoreKeys] = useState<Set<string>>(() => new Set());
    const sessionCacheRef = useRef<Map<string, SessionMeta[]>>(new Map());
    const sessionRequestSeqRef = useRef(0);
    const sessionInFlightKeyRef = useRef<string | null>(null);
    const selectedProjectKeyRef = useRef(normalizeProjectPathForCache(currentCwd));
    const hasManualProjectSelectionRef = useRef(false);
    const recentProjectPrefetchKeysRef = useRef<Set<string>>(new Set());
    const panelMode = sidebarState.panelMode;
    const collapsedRecentProjectKeys = useMemo(
        () => new Set(sidebarState.collapsedRecentProjectKeys),
        [sidebarState.collapsedRecentProjectKeys],
    );

    const updateSidebarState = useCallback((
        resolveNextState: (current: ChatSessionSidebarState) => ChatSessionSidebarState,
    ) => {
        setSidebarState((current) => {
            const next = resolveNextState(current);
            saveChatSessionSidebarState(next);
            return next;
        });
    }, []);

    const handlePanelModeChange = useCallback((mode: ChatSessionSidebarPanelMode) => {
        updateSidebarState((current) => ({
            ...current,
            panelMode: mode,
        }));
    }, [updateSidebarState]);

    const loadProjects = useCallback(async () => {
        setLoadingProjects(true);
        try {
            const data = await invoke<ProjectInfo[]>('get_dashboard_projects');
            setProjects(data);
        } catch (error) {
            console.error('[ChatSessionSidebar] load projects failed:', error);
        } finally {
            setLoadingProjects(false);
        }
    }, []);

    const loadSessions = useCallback(async (
        projectPath: string,
        options: {clearOnMiss?: boolean; force?: boolean} = {},
    ) => {
        const projectCacheKey = normalizeProjectPathForCache(projectPath);
        const cached = getCachedProjectSessions(sessionCacheRef.current, projectPath, options.force);
        if (cached) {
            sessionRequestSeqRef.current += 1;
            sessionInFlightKeyRef.current = null;
            setLoadingSessions(false);
            setSessionsProjectPath(projectPath);
            setSessions(cached);
            return;
        }

        if (!options.force && projectCacheKey && sessionInFlightKeyRef.current === projectCacheKey) {
            return;
        }

        if (options.clearOnMiss) {
            setSessionsProjectPath(projectPath);
            setSessions([]);
        }

        const requestSeq = sessionRequestSeqRef.current + 1;
        sessionRequestSeqRef.current = requestSeq;
        sessionInFlightKeyRef.current = projectCacheKey;
        setLoadingSessions(true);
        try {
            const data = await invoke<SessionMeta[]>('list_sessions', {projectPath});
            if (!shouldAcceptSessionListResponse({
                requestSeq,
                latestRequestSeq: sessionRequestSeqRef.current,
                requestProjectPath: projectPath,
                selectedProjectPath: selectedProjectKeyRef.current,
            })) return;

            const supportedSessions = rememberProjectSessions(sessionCacheRef.current, projectPath, data);
            setSessionsProjectPath(projectPath);
            setSessions(supportedSessions);
        } catch (error) {
            if (!shouldAcceptSessionListResponse({
                requestSeq,
                latestRequestSeq: sessionRequestSeqRef.current,
                requestProjectPath: projectPath,
                selectedProjectPath: selectedProjectKeyRef.current,
            })) return;
            console.error('[ChatSessionSidebar] load sessions failed:', error);
            sessionCacheRef.current.delete(normalizeProjectPathForCache(projectPath));
            setSessionsProjectPath(projectPath);
            if (!options.force) {
                setSessions([]);
            }
        } finally {
            if (sessionRequestSeqRef.current === requestSeq) {
                sessionInFlightKeyRef.current = null;
                setLoadingSessions(false);
            }
        }
    }, []);

    useEffect(() => {
        selectedProjectKeyRef.current = normalizeProjectPathForCache(selectedProjectPath);
    }, [selectedProjectPath]);

    useEffect(() => {
        void loadProjects();
    }, [loadProjects]);

    useEffect(() => {
        if (!contextMenu) return undefined;

        const closeMenu = () => setContextMenu(null);
        window.addEventListener('click', closeMenu);
        window.addEventListener('keydown', closeMenu);
        return () => {
            window.removeEventListener('click', closeMenu);
            window.removeEventListener('keydown', closeMenu);
        };
    }, [contextMenu]);

    useEffect(() => {
        if (!currentCwd) return;
        const currentProjectKey = normalizeProjectPathForCache(currentCwd);
        const selectedProjectKey = normalizeProjectPathForCache(selectedProjectPath);
        const visibleSessions = getVisibleProjectSessions(sessions, selectedProjectPath, sessionsProjectPath);
        const cachedSessions = getCachedProjectSessions(sessionCacheRef.current, currentCwd);
        const shouldSync = shouldSyncProjectFromCurrentCwd({
            currentCwd,
            selectedProjectPath,
            hasManualProjectSelection: hasManualProjectSelectionRef.current,
            visibleSessionCount: visibleSessions.length,
            hasCachedCurrentProjectSessions: Boolean(cachedSessions),
        });

        if (!shouldSync) {
            if (currentProjectKey && currentProjectKey === selectedProjectKey) {
                hasManualProjectSelectionRef.current = false;
            }
            return;
        }

        hasManualProjectSelectionRef.current = false;
        selectedProjectKeyRef.current = currentProjectKey;
        setSelectedProjectPath(currentCwd);
        setSessionQuery('');
        void loadSessions(currentCwd, {clearOnMiss: true});
    }, [currentCwd, loadSessions, selectedProjectPath, sessions, sessionsProjectPath]);

    useEffect(() => {
        projects.slice(0, 6).forEach((project) => {
            const projectKey = normalizeProjectPathForCache(project.path);
            if (!projectKey || recentProjectPrefetchKeysRef.current.has(projectKey)) return;
            recentProjectPrefetchKeysRef.current.add(projectKey);
            void invoke<SessionMeta[]>('list_sessions', {projectPath: project.path})
                .then((data) => {
                    rememberProjectSessions(sessionCacheRef.current, project.path, data);
                    setSessions((current) => [...current]);
                })
                .catch((error) => {
                    recentProjectPrefetchKeysRef.current.delete(projectKey);
                    console.error('[ChatSessionSidebar] load recent sessions failed:', error);
                });
        });
    }, [projects]);

    const filteredProjects = useMemo(() => {
        const query = projectQuery.trim().toLowerCase();
        if (!query) return projects;

        return projects.filter((project) => (
            project.name.toLowerCase().includes(query)
            || project.path.toLowerCase().includes(query)
        ));
    }, [projectQuery, projects]);

    const visibleSessions = useMemo(
        () => getVisibleProjectSessions(sessions, selectedProjectPath, sessionsProjectPath),
        [selectedProjectPath, sessions, sessionsProjectPath],
    );

    const filteredSessions = useMemo(() => {
        const providerScopedSessions = filterSessionsByProvider(visibleSessions, sessionProviderFilter);
        const query = sessionQuery.trim().toLowerCase();
        if (!query) return providerScopedSessions;

        return providerScopedSessions.filter((session) => (
            sessionTitle(session).toLowerCase().includes(query)
            || session.sessionId.toLowerCase().includes(query)
            || session.providerId.toLowerCase().includes(query)
        ));
    }, [sessionProviderFilter, sessionQuery, visibleSessions]);

    const activeSessionKey = activeSession ? getSessionSelectionKey(activeSession) : null;
    const showSessionRefreshStatus = shouldShowSessionRefreshStatus(loadingSessions, visibleSessions.length);
    const recentChatGroups = useMemo(
        () => buildRecentChatProjectGroups({
            projects,
            sessionsByProject: sessionCacheRef.current,
            recentSince: Date.now() - RECENT_CHAT_WINDOW_MS,
        }),
        [projects, sessions],
    );
    const translateWithFallback = (key: string, fallback: string, options?: Record<string, unknown>) => {
        const translated = options ? t(key, options) : t(key);
        return translated === key ? fallback : translated;
    };
    // 正在工作（流式/排队）的会话 key：活跃 tab 读顶层投影，背景 tab 读快照。
    // 用于给侧边栏对应会话项加 loading 指示。
    const busySessionKeys = useChatStore(useShallow((state) => {
        const keys: string[] = [];
        const activeBusy = Boolean(state.activeRequestId)
            || state.messages.some((message) => message.streaming);
        if (activeBusy && state.activeSession) {
            keys.push(getSessionSelectionKey(state.activeSession));
        }
        for (const tab of state.openTabs) {
            if (tab.key === state.activeTabKey || !tab.activeSession) continue;
            if (tab.status === 'running' || tab.status === 'queued' || Boolean(tab.activeRequestId)) {
                keys.push(getSessionSelectionKey(tab.activeSession));
            }
        }
        return keys;
    }));
    const panelTitleLabel = translateWithFallback('chat.sessionPanel.title', 'Session Management');
    const newChatLabel = translateWithFallback('chat.sessionPanel.newChat', 'New chat');
    const refreshLabel = translateWithFallback('common.refresh', 'Refresh');
    const loadingLabel = translateWithFallback('common.loading', 'Loading...');
    const workingLabel = translateWithFallback('chat.sessionPanel.working', 'Working…');
    const searchProjectsLabel = translateWithFallback('chat.sessionPanel.searchProjects', 'Search projects...');
    const projectsLabel = translateWithFallback('chat.sessionPanel.projects', 'Projects');
    const noProjectsLabel = translateWithFallback('chat.sessionPanel.noProjects', 'No projects');
    const sessionsLabel = translateWithFallback('chat.sessionPanel.sessions', 'Sessions');
    const recentChatsLabel = translateWithFallback('chat.sessionPanel.recentChats', 'Recent chats');
    const showLessRecentLabel = translateWithFallback('chat.sessionPanel.showLessRecent', 'Show less');
    const getShowMoreRecentLabel = (count: number) => translateWithFallback(
        'chat.sessionPanel.showMoreRecent',
        `Show ${count} more`,
        {count},
    );
    const projectSessionsLabel = translateWithFallback('chat.sessionPanel.projectSessions', 'Project sessions');
    const selectProjectLabel = translateWithFallback(
        'chat.sessionPanel.selectProject',
        'Select a project to view sessions',
    );
    const noSessionsLabel = translateWithFallback('chat.sessionPanel.noSessions', 'No sessions');
    const refreshingSessionsLabel = translateWithFallback('chat.sessionPanel.refreshingSessions', 'Refreshing sessions...');
    const searchSessionsLabel = translateWithFallback('chat.sessionPanel.searchSessions', 'Search sessions...');
    const filterCodexOnlyLabel = translateWithFallback('chat.sessionPanel.filterCodexOnly', 'Show Codex sessions only');
    const filterClaudeOnlyLabel = translateWithFallback('chat.sessionPanel.filterClaudeOnly', 'Show Claude sessions only');
    const noMatchingSessionsLabel = translateWithFallback('chat.sessionPanel.noMatchingSessions', 'No matching sessions');
    const getProjectSessionCountLabel = (count: number) => translateWithFallback(
        'chat.sessionPanel.projectSessionCount',
        `${count} session${count === 1 ? '' : 's'}`,
        {count},
    );
    const projectPinLabel = translateWithFallback('chat.sessionPanel.context.projectPin', 'Pin project');
    const openInExplorerLabel = translateWithFallback('chat.sessionPanel.context.openInExplorer', 'Open in Explorer');
    const openInTerminalLabel = translateWithFallback('chat.sessionPanel.context.openInTerminal', 'Open in Terminal');
    const resumeInTerminalLabel = translateWithFallback('chat.sessionPanel.context.resumeInTerminal', 'Resume Session in Terminal');
    const projectCreateWorktreeLabel = translateWithFallback(
        'chat.sessionPanel.context.projectCreateWorktree',
        'Create permanent worktree',
    );
    const projectRenameLabel = translateWithFallback('chat.sessionPanel.context.projectRename', 'Rename project');
    const projectMarkAllReadLabel = translateWithFallback('chat.sessionPanel.context.projectMarkAllRead', 'Mark all as read');
    const projectArchiveConversationsLabel = translateWithFallback(
        'chat.sessionPanel.context.projectArchiveConversations',
        'Archive conversations',
    );
    const projectRemoveLabel = translateWithFallback('chat.sessionPanel.context.projectRemove', 'Remove');
    const sessionPinLabel = translateWithFallback('chat.sessionPanel.context.sessionPin', 'Pin session');
    const sessionRenameLabel = translateWithFallback('chat.sessionPanel.context.sessionRename', 'Rename session');
    const sessionArchiveLabel = translateWithFallback('chat.sessionPanel.context.sessionArchive', 'Archive session');
    const sessionMarkUnreadLabel = translateWithFallback('chat.sessionPanel.context.sessionMarkUnread', 'Mark as unread');
    const sessionForkLocalLabel = translateWithFallback('chat.sessionPanel.context.sessionForkLocal', 'Fork locally');
    const sessionForkWorktreeLabel = translateWithFallback(
        'chat.sessionPanel.context.sessionForkWorktree',
        'Fork to new worktree',
    );
    const renamePromptLabel = translateWithFallback('chat.sessionPanel.context.renamePrompt', 'Rename session');
    const projectRenamePromptLabel = translateWithFallback('chat.sessionPanel.context.projectRenamePrompt', 'Rename project');
    const projectUnpinLabel = translateWithFallback('chat.sessionPanel.context.projectUnpin', 'Unpin project');
    const projectUnarchiveLabel = translateWithFallback('chat.sessionPanel.context.projectUnarchive', 'Unarchive');
    const projectActionFailedLabel = translateWithFallback('chat.sessionPanel.context.projectActionFailed', 'Project action failed');
    const projectRemoveConfirmLabel = translateWithFallback(
        'chat.sessionPanel.context.projectRemoveConfirm',
        'Remove this project from the list? Session files are not deleted.',
    );
    const sessionUnpinLabel = translateWithFallback('chat.sessionPanel.context.sessionUnpin', 'Unpin session');
    const sessionUnarchiveLabel = translateWithFallback('chat.sessionPanel.context.sessionUnarchive', 'Unarchive session');
    const sessionMarkReadLabel = translateWithFallback('chat.sessionPanel.context.sessionMarkRead', 'Mark as read');
    const sessionActionFailedLabel = translateWithFallback('chat.sessionPanel.context.sessionActionFailed', 'Session action failed');
    const openExplorerFailedLabel = translateWithFallback(
        'chat.sessionPanel.context.openExplorerFailed',
        'Open in Explorer failed',
    );
    const renameFailedLabel = translateWithFallback(
        'chat.sessionPanel.context.renameFailed',
        'Rename session failed',
    );

    const handleProjectSelect = (project: ProjectInfo) => {
        const nextProjectKey = normalizeProjectPathForCache(project.path);
        const selectedProjectKey = normalizeProjectPathForCache(selectedProjectPath);
        if (nextProjectKey === selectedProjectKey && visibleSessions.length > 0) {
            return;
        }

        hasManualProjectSelectionRef.current = true;
        selectedProjectKeyRef.current = nextProjectKey;
        setSelectedProjectPath(project.path);
        setSessionQuery('');
        void loadSessions(project.path, {clearOnMiss: true});
    };

    const handleNewSession = () => {
        onNewSession(selectedProjectPath ?? currentCwd);
    };

    const handleRefreshSessions = () => {
        if (!selectedProjectPath) return;
        void loadSessions(selectedProjectPath, {force: true});
    };

    const handleSessionSelect = (session: SessionMeta) => {
        if (shouldIgnoreSessionClick(session, activeSessionKey, pendingSessionKey)) {
            return;
        }
        onSessionSelect(session);
    };

    const handleSessionProviderFilterToggle = (target: Exclude<SessionProviderFilter, 'all'>) => {
        setSessionProviderFilter((current) => toggleSessionProviderFilter(current, target));
    };

    const toggleRecentProject = (projectPath: string) => {
        const projectKey = normalizeProjectPathForCache(projectPath);
        updateSidebarState((current) => {
            const next = new Set(current.collapsedRecentProjectKeys);
            if (next.has(projectKey)) {
                next.delete(projectKey);
            } else {
                next.add(projectKey);
            }
            return {
                ...current,
                collapsedRecentProjectKeys: Array.from(next),
            };
        });
    };

    const toggleRecentMore = (projectPath: string) => {
        const projectKey = normalizeProjectPathForCache(projectPath);
        setExpandedRecentMoreKeys((current) => {
            const next = new Set(current);
            if (next.has(projectKey)) {
                next.delete(projectKey);
            } else {
                next.add(projectKey);
            }
            return next;
        });
    };

    const handleProjectContextMenu = (
        event: MouseEvent<HTMLButtonElement>,
        project: ProjectInfo,
    ) => {
        event.preventDefault();
        setContextMenu({
            type: 'project',
            x: event.clientX,
            y: event.clientY,
            project,
        });
    };

    const handleSessionContextMenu = (
        event: MouseEvent<HTMLButtonElement>,
        session: SessionMeta,
    ) => {
        event.preventDefault();
        setContextMenu({
            type: 'session',
            x: event.clientX,
            y: event.clientY,
            session,
        });
    };

    const handleOpenExplorer = (path: string | null | undefined) => {
        const trimmedPath = path?.trim();
        if (!trimmedPath) return;
        void openChatPathInExplorer(trimmedPath)
            .catch((error) => {
                console.error('[ChatSessionSidebar] open explorer failed:', error);
                showToast(`${openExplorerFailedLabel}: ${String(error)}`, 'error', 5000);
            });
        setContextMenu(null);
    };

    const handleOpenInTerminal = (projectDir: string | null | undefined) => {
        const trimmedPath = projectDir?.trim();
        if (!trimmedPath) {
            showToast(t('chat.sessionPanel.context.noProjectDir', '会话无有效工作目录'), 'error', 3000);
            setContextMenu(null);
            return;
        }
        void invoke<void>('chat_open_project_in_terminal', {projectDir: trimmedPath})
            .then(() => {
                setContextMenu(null);
            })
            .catch((error) => {
                console.error('[ChatSessionSidebar] open in terminal failed:', error);
                showToast(`${t('chat.sessionPanel.context.openInTerminalFailed', '打开终端失败')}: ${String(error)}`, 'error', 5000);
            });
    };

    const handleResumeInTerminal = (session: SessionMeta) => {
        const resumeCmd = session.resumeCommand?.trim();
        if (!resumeCmd) {
            showToast(t('chat.sessionPanel.context.noResumeCommand', '会话无恢复命令'), 'error', 3000);
            setContextMenu(null);
            return;
        }
        void invoke<void>('chat_resume_session_in_terminal', {
            resumeCommand: resumeCmd,
            projectDir: session.projectDir || null,
        })
            .then(() => {
                setContextMenu(null);
            })
            .catch((error) => {
                console.error('[ChatSessionSidebar] resume in terminal failed:', error);
                showToast(`${t('chat.sessionPanel.context.resumeInTerminalFailed', '恢复终端会话失败')}: ${String(error)}`, 'error', 5000);
            });
    };

    const handleRenameSession = (session: SessionMeta) => {
        if (typeof window === 'undefined') return;
        const title = window.prompt(renamePromptLabel, sessionTitle(session))?.trim();
        if (!title) {
            setContextMenu(null);
            return;
        }

        void renameChatSessionTitle(session.providerId, session.sessionId, title)
            .then(() => {
                const projectPath = session.projectDir ?? selectedProjectPath;
                if (!projectPath) return;
                sessionCacheRef.current.delete(normalizeProjectPathForCache(projectPath));
                selectedProjectKeyRef.current = normalizeProjectPathForCache(projectPath);
                void loadSessions(projectPath, {force: true});
            })
            .catch((error) => {
                console.error('[ChatSessionSidebar] rename session failed:', error);
                showToast(`${renameFailedLabel}: ${String(error)}`, 'error', 5000);
            });
        setContextMenu(null);
    };

    const reloadSessionsForPath = (projectPath: string | null | undefined) => {
        const trimmed = projectPath?.trim();
        if (!trimmed) return;
        sessionCacheRef.current.delete(normalizeProjectPathForCache(trimmed));
        selectedProjectKeyRef.current = normalizeProjectPathForCache(trimmed);
        void loadSessions(trimmed, {force: true});
    };

    const runProjectAction = (
        project: ProjectInfo,
        action: () => Promise<unknown>,
        failureLabel: string,
        options: {reloadSessions?: boolean} = {},
    ) => {
        setContextMenu(null);
        void action()
            .then(() => {
                void loadProjects();
                if (options.reloadSessions) {
                    reloadSessionsForPath(project.path);
                }
            })
            .catch((error) => {
                console.error('[ChatSessionSidebar] project action failed:', error);
                showToast(`${failureLabel}: ${String(error)}`, 'error', 5000);
            });
    };

    const runSessionAction = (
        session: SessionMeta,
        action: () => Promise<unknown>,
        failureLabel: string,
    ) => {
        setContextMenu(null);
        void action()
            .then(() => {
                reloadSessionsForPath(session.projectDir ?? selectedProjectPath);
            })
            .catch((error) => {
                console.error('[ChatSessionSidebar] session action failed:', error);
                showToast(`${failureLabel}: ${String(error)}`, 'error', 5000);
            });
    };

    const handleRenameProject = (project: ProjectInfo) => {
        if (typeof window === 'undefined') return;
        const name = window.prompt(projectRenamePromptLabel, project.name)?.trim();
        if (!name) {
            setContextMenu(null);
            return;
        }
        runProjectAction(project, () => renameProject(project.path, name), projectActionFailedLabel);
    };

    const renderSessionRow = (session: SessionMeta, compact = false) => {
        const sessionKey = getSessionSelectionKey(session);
        const isPending = pendingSessionKey === sessionKey;
        const isActive = activeSessionKey === sessionKey;
        const isWorking = !isPending && busySessionKeys.includes(sessionKey);
        const selected = isPending || (!pendingSessionKey && isActive);
        const providerLabel = getSessionProviderLabel(t, session.providerId);
        return (
            <button
                key={sessionKey}
                type="button"
                onClick={() => handleSessionSelect(session)}
                onContextMenu={(event) => handleSessionContextMenu(event, session)}
                data-chat-session-key={sessionKey}
                className={`${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'} w-full rounded-md border text-left transition-colors ${
                    selected
                        ? 'border-primary/25 bg-primary/10 text-base-content shadow-[inset_0_0_0_1px_rgba(59,130,246,0.05)]'
                        : 'border-transparent hover:bg-base-200/80'
                }`}
                title={isPending ? loadingLabel : isWorking ? `${sessionTitle(session)} · ${workingLabel}` : session.sessionId}
            >
                <div className={compact ? 'flex items-center gap-1.5' : 'flex items-center gap-2'}>
                    {isPending ? (
                        <RefreshCw size={compact ? 13 : 14} className="animate-spin text-primary"/>
                    ) : isWorking ? (
                        <Loader2
                            size={compact ? 13 : 14}
                            className="animate-spin text-primary"
                            aria-label={workingLabel}
                        />
                    ) : (
                        <MessageSquare size={compact ? 13 : 14} className={selected ? 'text-primary' : 'text-base-content/40'}/>
                    )}
                    {session.unread && (
                        <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                            aria-label={sessionMarkUnreadLabel}
                            title={sessionMarkUnreadLabel}
                        />
                    )}
                    <span className={`${compact ? 'text-[11px]' : 'text-xs'} min-w-0 flex-1 truncate ${session.unread ? 'font-semibold' : 'font-medium'}`}>
                        {sessionTitle(session)}
                    </span>
                    {session.pinned && (
                        <Pin
                            size={compact ? 10 : 11}
                            className="shrink-0 text-primary/70"
                            aria-label={sessionPinLabel}
                        />
                    )}
                    <SessionProviderBadge
                        providerId={session.providerId}
                        providerLabel={providerLabel}
                        selected={selected}
                    />
                </div>
                <div className={`${compact ? 'pl-4 text-[10px]' : 'pl-5 text-[11px]'} mt-0.5 flex items-center gap-1 text-base-content/40`}>
                    {isPending && (
                        <>
                            <span className="shrink-0 text-primary/80">{loadingLabel}</span>
                            <span className="shrink-0">·</span>
                        </>
                    )}
                    {isWorking && (
                        <>
                            <span className="shrink-0 text-primary/80">{workingLabel}</span>
                            <span className="shrink-0">·</span>
                        </>
                    )}
                    {!compact && (session.summary?.trim() && session.summary.trim() !== sessionTitle(session) ? (
                        <span className="min-w-0 flex-1 truncate">
                            {session.summary.trim()}
                        </span>
                    ) : (
                        <span className="min-w-0 flex-1 truncate font-mono">
                            {session.sessionId}
                        </span>
                    ))}
                    {!compact && <span className="shrink-0">·</span>}
                    <Clock size={compact ? 10 : 11}/>
                    <span className="shrink-0">{formatShortDate(session.lastActiveAt)}</span>
                </div>
            </button>
        );
    };

    const renderMenuButton = (
        action: string,
        label: string,
        disabled: boolean,
        onClick?: () => void,
    ) => (
        <button
            key={action}
            type="button"
            role="menuitem"
            data-chat-menu-action={action}
            aria-disabled={disabled}
            className={`block w-full rounded px-2 py-1.5 text-left text-xs ${
                disabled
                    ? 'cursor-not-allowed text-base-content/35'
                    : 'text-base-content/75 hover:bg-base-200 hover:text-base-content'
            }`}
            onClick={(event) => {
                event.stopPropagation();
                if (disabled) return;
                onClick?.();
            }}
        >
            {label}
        </button>
    );

    const renderContextMenu = () => {
        if (!contextMenu) return null;

        const style = {
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
        };

        if (contextMenu.type === 'project') {
            const project = contextMenu.project;
            return (
                <div
                    className="fixed z-50 w-56 rounded-md border border-base-300 bg-base-100 p-1 shadow-lg"
                    style={style}
                    role="menu"
                    data-chat-context-menu="project"
                    onClick={(event) => event.stopPropagation()}
                >
                    {renderMenuButton(
                        'project-pin',
                        project.pinned ? projectUnpinLabel : projectPinLabel,
                        false,
                        () => runProjectAction(
                            project,
                            () => setProjectPinned(project.path, !project.pinned),
                            projectActionFailedLabel,
                        ),
                    )}
                    {renderMenuButton('project-open-explorer', openInExplorerLabel, false, () => {
                        handleOpenExplorer(project.path);
                    })}
                    {renderMenuButton('project-create-worktree', projectCreateWorktreeLabel, true)}
                    {renderMenuButton('project-rename', projectRenameLabel, false, () => {
                        handleRenameProject(project);
                    })}
                    {renderMenuButton('project-mark-all-read', projectMarkAllReadLabel, false, () => {
                        runProjectAction(
                            project,
                            () => markProjectAllRead(project.path),
                            projectActionFailedLabel,
                            {reloadSessions: true},
                        );
                    })}
                    {renderMenuButton(
                        'project-archive-conversations',
                        project.archived ? projectUnarchiveLabel : projectArchiveConversationsLabel,
                        false,
                        () => runProjectAction(
                            project,
                            () => setProjectArchived(project.path, !project.archived),
                            projectActionFailedLabel,
                        ),
                    )}
                    {renderMenuButton('project-remove', projectRemoveLabel, false, () => {
                        if (typeof window !== 'undefined' && !window.confirm(projectRemoveConfirmLabel)) {
                            setContextMenu(null);
                            return;
                        }
                        runProjectAction(project, () => removeProject(project.path), projectActionFailedLabel);
                    })}
                </div>
            );
        }

        const session = contextMenu.session;
        const sessionExplorerPath = session.sourcePath?.trim()
            || session.projectDir;

        return (
            <div
                className="fixed z-50 w-56 rounded-md border border-base-300 bg-base-100 p-1 shadow-lg"
                style={style}
                role="menu"
                data-chat-context-menu="session"
                onClick={(event) => event.stopPropagation()}
            >
                {renderMenuButton(
                    'session-pin',
                    session.pinned ? sessionUnpinLabel : sessionPinLabel,
                    false,
                    () => runSessionAction(
                        session,
                        () => setSessionPinned(session.sessionId, !session.pinned),
                        sessionActionFailedLabel,
                    ),
                )}
                {renderMenuButton('session-rename', sessionRenameLabel, false, () => {
                    handleRenameSession(session);
                })}
                {renderMenuButton(
                    'session-archive',
                    session.archived ? sessionUnarchiveLabel : sessionArchiveLabel,
                    false,
                    () => runSessionAction(
                        session,
                        () => setSessionArchived(session.sessionId, !session.archived),
                        sessionActionFailedLabel,
                    ),
                )}
                {renderMenuButton(
                    'session-mark-unread',
                    session.unread ? sessionMarkReadLabel : sessionMarkUnreadLabel,
                    false,
                    () => runSessionAction(
                        session,
                        () => setSessionUnread(session.sessionId, !session.unread),
                        sessionActionFailedLabel,
                    ),
                )}
                {renderMenuButton('session-open-explorer', openInExplorerLabel, false, () => {
                    handleOpenExplorer(sessionExplorerPath);
                })}
                {renderMenuButton('session-open-terminal', openInTerminalLabel, false, () => {
                    handleOpenInTerminal(session.projectDir);
                })}
                {renderMenuButton('session-resume-terminal', resumeInTerminalLabel, false, () => {
                    handleResumeInTerminal(session);
                })}
                {renderMenuButton('session-fork-local', sessionForkLocalLabel, true)}
                {renderMenuButton('session-fork-worktree', sessionForkWorktreeLabel, true)}
            </div>
        );
    };

    return (
        <aside className="hidden w-72 shrink-0 border-r border-base-200/60 bg-base-100/80 lg:flex lg:flex-col">
            <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-base-content">
                    <MessageSquare size={15}/>
                    {panelTitleLabel}
                </div>
                <div className="flex items-center gap-1" data-chat-session-sidebar-header-actions="true">
                    <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-square"
                        onClick={() => void loadProjects()}
                        title={refreshLabel}
                        aria-label={refreshLabel}
                        disabled={loadingProjects}
                    >
                        <RefreshCw size={14} className={loadingProjects ? 'animate-spin' : ''}/>
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary btn-xs btn-square"
                        onClick={handleNewSession}
                        title={newChatLabel}
                        aria-label={newChatLabel}
                    >
                        <Plus size={14}/>
                    </button>
                    {onCollapse && collapseLabel && (
                        <button
                            type="button"
                            className="btn btn-ghost btn-xs btn-square"
                            data-chat-session-sidebar-action="collapse"
                            onClick={onCollapse}
                            title={collapseLabel}
                            aria-label={collapseLabel}
                        >
                            <PanelLeftClose size={14}/>
                        </button>
                    )}
                </div>
            </div>

            <div className="p-2">
                <div className="chat-session-sidebar-mode-switch grid grid-cols-2 gap-1 rounded-md bg-base-200/60 p-1">
                    <button
                        type="button"
                        data-chat-session-panel-mode="project"
                        className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                            panelMode === 'project'
                                ? 'bg-base-100 text-base-content shadow-sm'
                                : 'text-base-content/55 hover:text-base-content'
                        }`}
                        onClick={() => handlePanelModeChange('project')}
                        aria-pressed={panelMode === 'project'}
                    >
                        {projectSessionsLabel}
                    </button>
                    <button
                        type="button"
                        data-chat-session-panel-mode="recent"
                        className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                            panelMode === 'recent'
                                ? 'bg-base-100 text-base-content shadow-sm'
                                : 'text-base-content/55 hover:text-base-content'
                        }`}
                        onClick={() => handlePanelModeChange('recent')}
                        aria-pressed={panelMode === 'recent'}
                    >
                        {recentChatsLabel}
                    </button>
                </div>
                {panelMode === 'project' && (
                    <label className="relative mt-2 block">
                        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-base-content/35"/>
                        <input
                            type="text"
                            value={projectQuery}
                            onChange={(event) => setProjectQuery(event.target.value)}
                            placeholder={searchProjectsLabel}
                            aria-label={searchProjectsLabel}
                            className="input input-bordered input-xs w-full pl-7 text-xs"
                        />
                    </label>
                )}
            </div>

            <div className="min-h-0 flex-1">
                <div className="flex h-full min-h-0 flex-col">
                    {panelMode === 'recent' ? (
                        <section className="min-h-0 flex-1 overflow-y-auto pb-2">
                            <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-base-content/35">
                                <History size={12}/>
                                {recentChatsLabel}
                            </div>
                            {recentChatGroups.length === 0 ? (
                                <div className="px-3 py-5 text-center text-xs text-base-content/40">
                                    {noSessionsLabel}
                                </div>
                            ) : (
                                <div className="space-y-1.5 px-1.5">
                                    {recentChatGroups.map((group) => {
                                        const projectKey = normalizeProjectPathForCache(group.projectPath);
                                        const parentPath = getProjectParentPath(group.projectPath);
                                        const expanded = !collapsedRecentProjectKeys.has(projectKey);
                                        const showAllSessions = expandedRecentMoreKeys.has(projectKey);
                                        const visibleSessions = showAllSessions
                                            ? group.sessions
                                            : group.sessions.slice(0, RECENT_CHAT_DEFAULT_VISIBLE);
                                        const hiddenSessionCount = group.sessions.length - visibleSessions.length;
                                        return (
                                            <div
                                                key={group.projectPath}
                                                data-chat-recent-project-group={group.projectPath}
                                            >
                                                <button
                                                    type="button"
                                                    className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-base-200 bg-base-100/95 px-1.5 py-1.5 text-left backdrop-blur-sm transition-colors hover:bg-base-200/70"
                                                    title={group.projectPath}
                                                    data-chat-recent-project-toggle={group.projectPath}
                                                    aria-expanded={expanded}
                                                    onClick={() => toggleRecentProject(group.projectPath)}
                                                >
                                                    {expanded ? (
                                                        <ChevronDown size={13} className="shrink-0 text-base-content/45"/>
                                                    ) : (
                                                        <ChevronRight size={13} className="shrink-0 text-base-content/45"/>
                                                    )}
                                                    <FolderOpen size={13} className="shrink-0 text-primary/70"/>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-xs font-semibold text-base-content/85">
                                                            {group.projectName}
                                                        </span>
                                                        {parentPath && (
                                                            <span
                                                                className="mt-0.5 block truncate text-[10px] font-normal text-base-content/40"
                                                                data-chat-recent-project-parent-path
                                                            >
                                                                {parentPath}
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span
                                                        className="shrink-0 rounded-full bg-base-200 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-base-content/55 dark:bg-base-200/80"
                                                        data-chat-recent-project-count-badge
                                                    >
                                                        {group.sessions.length}
                                                    </span>
                                                </button>
                                                {expanded && (
                                                    <div
                                                        className="ml-[15px] space-y-0.5 border-l-2 border-base-200 py-1 pl-2.5"
                                                        data-chat-recent-session-list
                                                    >
                                                        {visibleSessions.map((session) => renderSessionRow(session, true))}
                                                        {group.sessions.length > RECENT_CHAT_DEFAULT_VISIBLE && (
                                                            <button
                                                                type="button"
                                                                className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[11px] font-medium text-base-content/45 transition-colors hover:bg-base-200/60 hover:text-base-content/70"
                                                                data-chat-recent-show-more={group.projectPath}
                                                                aria-expanded={showAllSessions}
                                                                onClick={() => toggleRecentMore(group.projectPath)}
                                                            >
                                                                {showAllSessions ? (
                                                                    <ChevronUp size={12} className="shrink-0"/>
                                                                ) : (
                                                                    <ChevronDown size={12} className="shrink-0"/>
                                                                )}
                                                                <span className="truncate">
                                                                    {showAllSessions ? showLessRecentLabel : getShowMoreRecentLabel(hiddenSessionCount)}
                                                                </span>
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    ) : (
                    <>
                    <section className="min-h-0 basis-2/5 overflow-y-auto border-b border-base-300 pb-2">
                        <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-base-content/35">
                            {projectsLabel}
                        </div>

                        {loadingProjects ? (
                            <div className="flex items-center justify-center py-6 text-base-content/40">
                                <RefreshCw size={16} className="animate-spin"/>
                            </div>
                        ) : filteredProjects.length === 0 ? (
                            <div className="px-3 py-5 text-center text-xs text-base-content/40">
                                {noProjectsLabel}
                            </div>
                        ) : (
                            <div className="space-y-0.5 px-2">
                                {filteredProjects.map((project) => {
                                    const selected = normalizeProjectPathForCache(selectedProjectPath)
                                        === normalizeProjectPathForCache(project.path);
                                    return (
                                        <button
                                            key={project.path}
                                            type="button"
                                            onClick={() => handleProjectSelect(project)}
                                            onContextMenu={(event) => handleProjectContextMenu(event, project)}
                                            data-chat-project-path={project.path}
                                            className={`w-full rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                                                selected
                                                    ? 'border-primary/25 bg-primary/10 text-base-content'
                                                    : 'border-transparent hover:bg-base-200/80'
                                            }`}
                                            title={project.path}
                                        >
                                            <div className="flex items-center gap-2">
                                                <FolderOpen size={14} className={selected ? 'text-primary' : 'text-base-content/40'}/>
                                                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                                    {project.name}
                                                </span>
                                                {project.pinned && (
                                                    <Pin size={11} className="shrink-0 text-primary/70" aria-label={projectPinLabel}/>
                                                )}
                                                <ChevronRight size={13} className={selected ? 'text-primary' : 'text-base-content/25'}/>
                                            </div>
                                            <div className="mt-0.5 flex items-center gap-1 pl-5 text-[11px] text-base-content/40">
                                                <Clock size={11}/>
                                                <span>{getProjectSessionCountLabel(project.session_count)}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <section className="min-h-0 flex-1 overflow-y-auto">
                        <div className="flex items-center justify-between px-2 pb-1 pt-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-base-content/35">
                                {sessionsLabel}
                            </div>
                            <button
                                type="button"
                                className="btn btn-ghost btn-xs btn-square"
                                onClick={handleRefreshSessions}
                                title={refreshLabel}
                                aria-label={refreshLabel}
                                disabled={!selectedProjectPath || loadingSessions}
                            >
                                <RefreshCw size={13} className={loadingSessions ? 'animate-spin' : ''}/>
                            </button>
                        </div>

                        {!selectedProjectPath ? (
                            <div className="px-3 py-5 text-center text-xs text-base-content/40">
                                {selectProjectLabel}
                            </div>
                        ) : loadingSessions && visibleSessions.length === 0 ? (
                            <div className="flex items-center justify-center py-6 text-base-content/40">
                                <RefreshCw size={16} className="animate-spin"/>
                            </div>
                        ) : visibleSessions.length === 0 ? (
                            <div className="px-3 py-5 text-center text-xs text-base-content/40">
                                {noSessionsLabel}
                            </div>
                        ) : (
                            <div className="pb-3">
                                {showSessionRefreshStatus && (
                                    <div
                                        className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-base-300 bg-base-200/45 px-2 py-1.5 text-[11px] text-base-content/45"
                                        role="status"
                                    >
                                        <RefreshCw size={12} className="animate-spin text-primary/70"/>
                                        <span className="min-w-0 flex-1 truncate">
                                            {refreshingSessionsLabel}
                                        </span>
                                    </div>
                                )}
                                <div className="px-2 pb-2">
                                    <div className="flex items-center gap-1.5">
                                        <label className="relative block min-w-0 flex-1">
                                            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-base-content/35"/>
                                            <input
                                                type="text"
                                                value={sessionQuery}
                                                onChange={(event) => setSessionQuery(event.target.value)}
                                                placeholder={searchSessionsLabel}
                                                aria-label={searchSessionsLabel}
                                                className="input input-bordered input-xs w-full pl-7 text-xs"
                                            />
                                        </label>
                                        <div
                                            className="flex shrink-0 items-center gap-0.5"
                                            data-chat-session-provider-filter-group="true"
                                        >
                                            <button
                                                type="button"
                                                data-chat-session-provider-filter="codex"
                                                aria-pressed={sessionProviderFilter === 'codex'}
                                                title={filterCodexOnlyLabel}
                                                aria-label={filterCodexOnlyLabel}
                                                onClick={() => handleSessionProviderFilterToggle('codex')}
                                                className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
                                                    sessionProviderFilter === 'codex'
                                                        ? 'border-primary/30 bg-primary/10'
                                                        : 'border-base-300 bg-base-100 hover:bg-base-200/80'
                                                }`}
                                            >
                                                <ProviderBrandIcon provider="codex" size={14} colored/>
                                            </button>
                                            <button
                                                type="button"
                                                data-chat-session-provider-filter="claude"
                                                aria-pressed={sessionProviderFilter === 'claude'}
                                                title={filterClaudeOnlyLabel}
                                                aria-label={filterClaudeOnlyLabel}
                                                onClick={() => handleSessionProviderFilterToggle('claude')}
                                                className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
                                                    sessionProviderFilter === 'claude'
                                                        ? 'border-primary/30 bg-primary/10'
                                                        : 'border-base-300 bg-base-100 hover:bg-base-200/80'
                                                }`}
                                            >
                                                <ProviderBrandIcon provider="claude" size={14} colored/>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {filteredSessions.length === 0 ? (
                                    <div className="px-3 py-5 text-center text-xs text-base-content/40">
                                        {noMatchingSessionsLabel}
                                    </div>
                                ) : (
                                    <div className="space-y-0.5 px-2">
                                        {filteredSessions.map((session) => renderSessionRow(session))}
                                    </div>
                                )}
                            </div>
                        )}
                    </section>
                    </>
                    )}
                </div>
            </div>
            {renderContextMenu()}
        </aside>
    );
}
