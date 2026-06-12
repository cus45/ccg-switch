import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search, FolderOpen, Terminal, FileText, RefreshCw, ChevronRight, Clock, MessageSquare, Copy, Hash, Play, List, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { showToast } from '../components/common/ToastContainer';
import { ConversationPanel } from '../components/conversation/ConversationPanel';
import { AutomationPanel } from '../components/workspaces/AutomationPanel';
import { WorkspaceActions } from '../components/workspaces/WorkspaceActions';
import { WorkspaceBindingsPanel } from '../components/workspaces/WorkspaceBindingsPanel';
import { WorkspaceFormModal } from '../components/workspaces/WorkspaceFormModal';
import { WorkspaceGitPanel } from '../components/workspaces/WorkspaceGitPanel';
import { WorkspaceList } from '../components/workspaces/WorkspaceList';
import { WorkspaceWorktreesPanel } from '../components/workspaces/WorkspaceWorktreesPanel';
import { LocalEnvironmentPanel } from '../components/workspaces/LocalEnvironmentPanel';
import {
    getWorkspaceSessionTitle,
    WorkspaceSessionPanel,
} from '../components/workspaces/WorkspaceSessionPanel';
import {
    listenCodexConversationEvents,
    readCodexThread,
    startCodexThread,
    startCodexTurn,
    interruptCodexTurn,
    respondCodexApproval,
} from '../services/codexBridgeService';
import { useConversationStore } from '../stores/useConversationStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import type { AppType } from '../types/app';
import type { ApprovalRequest, ThreadStartInput } from '../types/conversation';
import { SessionMeta, UnifiedSessionMessage, ProviderFilter } from '../types/session';
import type { CreateWorkspaceInput, UpdateWorkspaceInput, Workspace } from '../types/workspace';
import { getAppLabel, useVisibleAppOptions } from '../hooks/useVisibleAppOptions';

type WorkspaceTab = 'overview' | 'sessions' | 'chat' | 'bindings';

interface ProjectInfo {
    name: string;
    path: string;
    session_count: number;
    last_active: string | null;
}

function normalizeComparablePath(path: string): string {
    return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

function toProjectInfo(workspace: Workspace, scannedProject?: ProjectInfo): ProjectInfo {
    return {
        name: workspace.name,
        path: workspace.rootPath,
        session_count: scannedProject?.session_count ?? 0,
        last_active: scannedProject?.last_active ?? null,
    };
}

/** 将 ISO/日期字符串转成友好的相对时间 */
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

/** 格式化时间戳为 yyyy/M/d HH:mm:ss */
function formatTimestamp(dateStr: string | number): string {
    try {
        const d = typeof dateStr === 'number' ? new Date(dateStr) : new Date(dateStr);
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    } catch {
        return String(dateStr);
    }
}

const providerColors: Record<string, string> = {
    claude: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    codex: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    gemini: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
};

function WorkspacesPage() {
    const { t } = useTranslation();
    const {
        workspaces,
        selectedWorkspaceId,
        loading: loadingWorkspaces,
        error: workspaceError,
        loadWorkspaces,
        selectWorkspace,
        createWorkspace,
        updateWorkspace,
        updateWorkspaceDefaults,
        deleteWorkspace,
        importProjectAsWorkspace,
        touchWorkspace,
        clearError: clearWorkspaceError,
    } = useWorkspaceStore();
    const [projects, setProjects] = useState<ProjectInfo[]>([]);
    const [selectedProject, setSelectedProject] = useState<ProjectInfo | null>(null);
    const [selectedSession, setSelectedSession] = useState<SessionMeta | null>(null);
    const [messages, setMessages] = useState<UnifiedSessionMessage[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [search, setSearch] = useState('');
    const [loadingProjects, setLoadingProjects] = useState(true);
    const [activeMessageIndex, setActiveMessageIndex] = useState<number | null>(null);
    const [tocDialogOpen, setTocDialogOpen] = useState(false);
    const [tocSearch, setTocSearch] = useState('');
    const [workspaceFormOpen, setWorkspaceFormOpen] = useState(false);
    const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
    const [selectedImportPath, setSelectedImportPath] = useState('');
    const [workspaceActionPending, setWorkspaceActionPending] = useState(false);
    const [sessionRefreshToken, setSessionRefreshToken] = useState(0);
    const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('overview');
    const [chatDraft, setChatDraft] = useState('');
    const [chatSubmitting, setChatSubmitting] = useState(false);
    const [workspaceThreadIds, setWorkspaceThreadIds] = useState<Record<string, string>>({});
    const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messageRequestIdRef = useRef(0);
    const appOptions = useVisibleAppOptions();
    const providerFilterTabs = useMemo(
        () => [
            { value: 'all' as const, label: t('sessions.filter_all') },
            ...appOptions.map(option => ({
                value: option.appType,
                label: option.label,
            })),
        ],
        [appOptions, t]
    );

    // Panel collapse states
    const [projectsCollapsed, setProjectsCollapsed] = useState(false);
    const [sessionsCollapsed, setSessionsCollapsed] = useState(true);

    // Multi-platform states
    const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
    const [providerMap, setProviderMap] = useState<Record<string, string[]>>({});

    const loadMessages = useCallback(async (session: SessionMeta) => {
        const requestId = messageRequestIdRef.current + 1;
        messageRequestIdRef.current = requestId;

        setLoadingMessages(true);
        setMessages([]);
        try {
            const data = await invoke<UnifiedSessionMessage[]>('get_unified_session_messages', {
                providerId: session.providerId,
                sourcePath: session.sourcePath,
            });
            if (messageRequestIdRef.current === requestId) {
                setMessages(data);
            }
        } catch (e) {
            if (messageRequestIdRef.current === requestId) {
                console.error('Failed to load messages:', e);
            }
        } finally {
            if (messageRequestIdRef.current === requestId) {
                setLoadingMessages(false);
            }
        }
    }, []);

    const handleSelectSession = useCallback((session: SessionMeta) => {
        setWorkspaceTab('sessions');
        setSelectedSession(session);
        messageRefs.current.clear();
        setActiveMessageIndex(null);
        setTocSearch('');
        void loadMessages(session);
    }, [loadMessages]);

    const loadProjects = useCallback(async () => {
        setLoadingProjects(true);
        try {
            const data = await invoke<ProjectInfo[]>('get_dashboard_projects');
            setProjects(data);
            // 异步加载 provider 映射（轻量扫描）
            invoke<Record<string, string[]>>('get_project_provider_map', {
                projectPaths: data.map(p => p.path),
            }).then(map => setProviderMap(map)).catch(() => {});
        } catch (e) {
            console.error('Failed to load projects:', e);
        }
        setLoadingProjects(false);
    }, []);

    useEffect(() => {
        loadProjects();
    }, [loadProjects]);

    useEffect(() => {
        void loadWorkspaces();
    }, [loadWorkspaces]);

    useEffect(() => {
        const unlistenPromise = listenCodexConversationEvents((event) => {
            useConversationStore.getState().applyEvent(event);
        });

        return () => {
            void unlistenPromise.then(unlisten => unlisten());
        };
    }, []);

    const showProjectSessions = useCallback((project: ProjectInfo) => {
        messageRequestIdRef.current += 1;
        setSelectedProject(project);
        setSelectedSession(null);
        setMessages([]);
        setLoadingMessages(false);
        messageRefs.current.clear();
        setActiveMessageIndex(null);
        setTocSearch('');
        setSessionsCollapsed(false);
        setSessionRefreshToken(value => value + 1);
    }, []);

    const findScannedProject = useCallback((path: string) => {
        const normalizedPath = normalizeComparablePath(path);
        return projects.find(project => normalizeComparablePath(project.path) === normalizedPath);
    }, [projects]);

    const selectProject = (project: ProjectInfo) => {
        selectWorkspace(null);
        setWorkspaceTab('sessions');
        showProjectSessions(project);
    };

    const handleSelectWorkspace = useCallback((workspace: Workspace) => {
        clearWorkspaceError();
        setWorkspaceTab('overview');
        selectWorkspace(workspace.id);
        showProjectSessions(toProjectInfo(workspace, findScannedProject(workspace.rootPath)));
        void touchWorkspace(workspace.id).catch((error) => {
            console.error('Failed to touch workspace:', error);
        });
    }, [
        clearWorkspaceError,
        findScannedProject,
        selectWorkspace,
        showProjectSessions,
        touchWorkspace,
    ]);

    const openTerminal = async (path: string) => {
        try {
            const config = await invoke<any>('get_config');
            await invoke('open_in_terminal', { path, terminal: config.preferredTerminal || null });
        } catch (e) {
            console.error(t('workspaces.open_terminal_error'), e);
            showToast(`${t('workspaces.open_terminal_error')}: ${String(e)}`, 'error');
        }
    };

    const refreshWorkspacePage = useCallback(async () => {
        await Promise.all([
            loadProjects(),
            loadWorkspaces(true),
        ]);
        setSessionRefreshToken(value => value + 1);
    }, [loadProjects, loadWorkspaces]);

    const handleCreateWorkspace = () => {
        clearWorkspaceError();
        setEditingWorkspace(null);
        setWorkspaceFormOpen(true);
    };

    const handleEditWorkspace = (workspace: Workspace) => {
        clearWorkspaceError();
        setEditingWorkspace(workspace);
        setWorkspaceFormOpen(true);
    };

    const handleWorkspaceFormSubmit = async (
        input: CreateWorkspaceInput | UpdateWorkspaceInput
    ) => {
        setWorkspaceActionPending(true);
        try {
            const workspace = editingWorkspace
                ? await updateWorkspace(editingWorkspace.id, input as UpdateWorkspaceInput)
                : await createWorkspace(input as CreateWorkspaceInput);
            setWorkspaceFormOpen(false);
            setEditingWorkspace(null);
            selectWorkspace(workspace.id);
            setWorkspaceTab('overview');
            showProjectSessions(toProjectInfo(workspace, findScannedProject(workspace.rootPath)));
            showToast(
                editingWorkspace
                    ? t('workspaces.update_workspace_success')
                    : t('workspaces.create_workspace_success'),
                'success'
            );
        } catch (error) {
            showToast(`${t('workspaces.workspace_save_error')}: ${String(error)}`, 'error');
        } finally {
            setWorkspaceActionPending(false);
        }
    };

    const handleDeleteWorkspace = async (workspace: Workspace) => {
        const confirmed = window.confirm(
            t('workspaces.confirm_delete_workspace', { name: workspace.name })
        );
        if (!confirmed) return;

        setWorkspaceActionPending(true);
        try {
            await deleteWorkspace(workspace.id);
            if (
                selectedWorkspaceId === workspace.id ||
                (selectedProject &&
                    normalizeComparablePath(selectedProject.path) === normalizeComparablePath(workspace.rootPath))
            ) {
                setSelectedProject(null);
                setSelectedSession(null);
                setMessages([]);
                setWorkspaceTab('overview');
            }
            showToast(t('workspaces.delete_workspace_success'), 'success');
        } catch (error) {
            showToast(`${t('workspaces.workspace_delete_error')}: ${String(error)}`, 'error');
        } finally {
            setWorkspaceActionPending(false);
        }
    };

    const handleImportProject = async (project: ProjectInfo) => {
        setWorkspaceActionPending(true);
        try {
            const workspace = await importProjectAsWorkspace(project.path);
            setSelectedImportPath('');
            selectWorkspace(workspace.id);
            setWorkspaceTab('overview');
            showProjectSessions(toProjectInfo(workspace, project));
            showToast(t('workspaces.import_workspace_success'), 'success');
        } catch (error) {
            showToast(`${t('workspaces.workspace_import_error')}: ${String(error)}`, 'error');
        } finally {
            setWorkspaceActionPending(false);
        }
    };

    const handleWorkspaceDefaultsChange = useCallback(async (
        workspace: Workspace,
        defaultAppType: AppType | null,
        defaultProviderId: string | null
    ) => {
        setWorkspaceActionPending(true);
        try {
            const updatedWorkspace = await updateWorkspaceDefaults(
                workspace.id,
                defaultAppType,
                defaultProviderId
            );
            if (
                selectedWorkspaceId === workspace.id &&
                selectedProject &&
                normalizeComparablePath(selectedProject.path) === normalizeComparablePath(workspace.rootPath)
            ) {
                setSelectedProject(toProjectInfo(
                    updatedWorkspace,
                    findScannedProject(updatedWorkspace.rootPath)
                ));
            }
            showToast(t('workspaces.update_workspace_success'), 'success');
        } catch (error) {
            showToast(`${t('workspaces.workspace_save_error')}: ${String(error)}`, 'error');
        } finally {
            setWorkspaceActionPending(false);
        }
    }, [
        findScannedProject,
        selectedProject,
        selectedWorkspaceId,
        t,
        updateWorkspaceDefaults,
    ]);

    const resumeSession = async (session: SessionMeta) => {
        if (!session.resumeCommand) {
            showToast(t('sessions.resume_not_available'), 'error');
            return;
        }
        try {
            await invoke('launch_resume_session', {
                command: session.resumeCommand,
                cwd: session.projectDir || null,
            });
            showToast(t('sessions.resume_success'), 'success');
        } catch (e) {
            console.error('Failed to resume session:', e);
            const errorMsg = e instanceof Error ? e.message : String(e);
            showToast(t('sessions.resume_error') + ': ' + errorMsg, 'error');
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // silent
        }
    };

    const getProjectProviders = (projectPath: string): string[] => {
        return providerMap[projectPath] || ['claude'];
    };

    const filteredProjects = useMemo(() => {
        let result = projects;
        // 按 provider 过滤项目
        if (providerFilter !== 'all') {
            result = result.filter(p => {
                const providers = providerMap[p.path] || ['claude'];
                return providers.includes(providerFilter);
            });
        }
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(p =>
                p.name.toLowerCase().includes(q) ||
                p.path.toLowerCase().includes(q)
            );
        }
        return result;
    }, [projects, search, providerFilter, providerMap]);

    const selectedWorkspace = useMemo(
        () => workspaces.find(workspace => workspace.id === selectedWorkspaceId) ?? null,
        [selectedWorkspaceId, workspaces]
    );
    const showSessionPanel = !selectedWorkspace || workspaceTab === 'sessions';
    const chatThreadStartInput = useMemo<ThreadStartInput | null>(() => {
        if (!selectedWorkspace) return null;
        return {
            workspaceId: selectedWorkspace.id,
            cwd: selectedWorkspace.rootPath,
            providerId: selectedWorkspace.defaultProviderId ?? undefined,
            metadata: {
                workspaceName: selectedWorkspace.name,
                defaultAppType: selectedWorkspace.defaultAppType ?? 'codex',
            },
        };
    }, [selectedWorkspace]);
    const activeWorkspaceThreadId = selectedWorkspace
        ? workspaceThreadIds[selectedWorkspace.id] ?? null
        : null;
    const workspaceTabs = useMemo<Array<{ id: WorkspaceTab; label: string }>>(() => [
        { id: 'overview', label: t('workspaces.tab_overview') },
        { id: 'sessions', label: t('workspaces.tab_sessions') },
        { id: 'chat', label: t('workspaces.tab_chat') },
        { id: 'bindings', label: t('workspaces.tab_bindings') },
    ], [t]);

    const importCandidates = useMemo(() => {
        const importedPaths = new Set(
            workspaces.map(workspace => normalizeComparablePath(workspace.rootPath))
        );
        return filteredProjects.filter(project => !importedPaths.has(normalizeComparablePath(project.path)));
    }, [filteredProjects, workspaces]);

    const userMessagesToc = useMemo(() => {
        return messages
            .map((msg, index) => ({ msg, index }))
            .filter(({ msg }) => msg.role.toLowerCase() === 'user')
            .map(({ msg, index }) => ({
                index,
                preview: msg.content.slice(0, 60) + (msg.content.length > 60 ? '...' : ''),
                ts: msg.ts,
            }));
    }, [messages]);

    const filteredToc = useMemo(() => {
        if (!tocSearch.trim()) return userMessagesToc;
        const q = tocSearch.toLowerCase();
        return userMessagesToc.filter(item => item.preview.toLowerCase().includes(q));
    }, [userMessagesToc, tocSearch]);

    const scrollToMessage = useCallback((index: number) => {
        const el = messageRefs.current.get(index);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setActiveMessageIndex(index);
            setTocDialogOpen(false);
            setTimeout(() => setActiveMessageIndex(null), 2000);
        }
    }, []);

    const getResumeCommandDisplay = (session: SessionMeta) => {
        return session.resumeCommand ?? t('sessions.resume_not_available');
    };

    const handleSubmitWorkspacePrompt = useCallback(async (prompt: string) => {
        if (!selectedWorkspace || !chatThreadStartInput) return;

        setChatSubmitting(true);
        try {
            let threadId = workspaceThreadIds[selectedWorkspace.id];
            if (!threadId) {
                const thread = await startCodexThread(chatThreadStartInput);
                useConversationStore.getState().upsertThread(thread);
                useConversationStore.getState().setActiveThread(thread.id);
                setWorkspaceThreadIds(current => ({
                    ...current,
                    [selectedWorkspace.id]: thread.id,
                }));
                threadId = thread.id;
                const snapshot = await readCodexThread(thread.id);
                useConversationStore.getState().loadSnapshot(snapshot);
            }

            await startCodexTurn({
                threadId,
                prompt,
                model: chatThreadStartInput.model,
                approvalPolicy: chatThreadStartInput.approvalPolicy,
                sandboxPolicy: chatThreadStartInput.sandboxPolicy,
            });
            setChatDraft('');
        } catch (error) {
            showToast(`${t('conversation.start_error')}: ${String(error)}`, 'error');
        } finally {
            setChatSubmitting(false);
        }
    }, [
        chatThreadStartInput,
        selectedWorkspace,
        t,
        workspaceThreadIds,
    ]);

    const handleInterruptWorkspaceTurn = useCallback(async (threadId: string, turnId: string) => {
        try {
            await interruptCodexTurn(threadId, turnId);
        } catch (error) {
            showToast(`${t('conversation.interrupt_error')}: ${String(error)}`, 'error');
        }
    }, [t]);

    const handleApproveApproval = useCallback(async (
        request: ApprovalRequest,
        message?: string
    ) => {
        try {
            await respondCodexApproval({
                approvalId: request.id,
                decision: 'approved',
                message,
                metadata: {
                    threadId: request.threadId,
                },
            });
        } catch (error) {
            showToast(`${t('conversation.approval_error')}: ${String(error)}`, 'error');
        }
    }, [t]);

    const handleDenyApproval = useCallback(async (request: ApprovalRequest) => {
        try {
            await respondCodexApproval({
                approvalId: request.id,
                decision: 'denied',
                metadata: {
                    threadId: request.threadId,
                },
            });
        } catch (error) {
            showToast(`${t('conversation.approval_error')}: ${String(error)}`, 'error');
        }
    }, [t]);

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
                        onClick={() => void refreshWorkspacePage()}
                        disabled={loadingProjects || loadingWorkspaces || workspaceActionPending}
                        className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-base-200 transition-colors"
                        title={t('common.refresh')}
                    >
                        <RefreshCw className={`w-4 h-4 ${loadingProjects || loadingWorkspaces ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {/* Main Content - Three Panel Layout */}
                <div className="flex-1 flex min-h-0">
                    {/* Left Panel - Project List */}
                    {projectsCollapsed ? (
                        <div
                            className="w-10 shrink-0 flex flex-col items-center border-r border-gray-200/50 dark:border-base-200 bg-gray-50/50 dark:bg-base-100/50 cursor-pointer hover:bg-gray-100/50 dark:hover:bg-base-200/50 transition-colors"
                            onClick={() => setProjectsCollapsed(false)}
                            title={t('workspaces.title')}
                        >
                            <div className="py-3">
                                <PanelLeftOpen className="w-4 h-4 text-gray-400" />
                            </div>
                            <div className="flex-1 flex items-center justify-center">
                                <span className="text-xs text-gray-400 font-medium [writing-mode:vertical-lr]">
                                    {t('workspaces.title')}
                                </span>
                            </div>
                        </div>
                    ) : (
                    <div className="w-64 shrink-0 flex flex-col border-r border-gray-200/50 dark:border-base-200 bg-gray-50/50 dark:bg-base-100/50">
                        {/* Provider Filter Tabs */}
                        <div className="p-3 pb-2">
                            <div className="flex items-center gap-2">
                                <div className="bg-gray-200/70 dark:bg-base-300 rounded-lg p-0.5 flex flex-1">
                                    {providerFilterTabs.map(tab => (
                                        <button
                                            key={tab.value}
                                            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                                                providerFilter === tab.value
                                                    ? 'bg-white dark:bg-base-100 text-gray-900 dark:text-base-content shadow-sm'
                                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                            }`}
                                            onClick={() => setProviderFilter(tab.value)}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={() => setProjectsCollapsed(true)}
                                    className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-base-300 transition-colors shrink-0"
                                    title={t('common.collapse', { defaultValue: '收起' })}
                                >
                                    <PanelLeftClose className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <WorkspaceList
                            workspaces={workspaces}
                            selectedWorkspaceId={selectedWorkspaceId}
                            loading={loadingWorkspaces}
                            error={workspaceError}
                            onCreate={handleCreateWorkspace}
                            onSelect={handleSelectWorkspace}
                            onEdit={handleEditWorkspace}
                            onDelete={(workspace) => void handleDeleteWorkspace(workspace)}
                        />

                        <WorkspaceActions
                            selectedWorkspace={selectedWorkspace}
                            selectedProject={selectedWorkspace ? null : selectedProject}
                            importCandidates={importCandidates}
                            loading={loadingProjects || loadingWorkspaces}
                            actionPending={workspaceActionPending}
                            selectedImportPath={selectedImportPath}
                            onSelectImportPath={setSelectedImportPath}
                            onImportProject={(project) => void handleImportProject(project)}
                            onOpenTerminal={(path) => void openTerminal(path)}
                            onRefresh={() => void refreshWorkspacePage()}
                        />

                        {/* Search */}
                        <div className="px-3 pb-2">
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
                            <div className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                {t('workspaces.history_projects')}
                            </div>
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
                                        const isSelected = !selectedWorkspace && selectedProject?.path === project.path;
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
                                                    {getProjectProviders(project.path).length > 0 && (
                                                        <div className="flex gap-0.5 shrink-0">
                                                            {getProjectProviders(project.path).map(p => (
                                                                <span key={p} className={`px-1 py-px rounded text-[9px] font-medium leading-tight ${providerColors[p] || ''}`}>
                                                                    {getAppLabel(p).charAt(0).toUpperCase()}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${isSelected ? 'text-blue-500 rotate-90' : 'text-gray-300 dark:text-gray-600'}`} />
                                                </div>
                                                <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-400 ml-6">
                                                    <Clock className="w-3 h-3 shrink-0" />
                                                    <span>{project.session_count} {t('dashboard.projects_sessions')}</span>
                                                    {project.last_active && (
                                                        <span>· {formatRelativeTime(project.last_active)}</span>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                    )}

                    {showSessionPanel && (
                        <WorkspaceSessionPanel
                            rootPath={selectedProject?.path ?? null}
                            providerFilter={providerFilter}
                            selectedSession={selectedSession}
                            collapsed={sessionsCollapsed}
                            refreshToken={sessionRefreshToken}
                            onCollapsedChange={setSessionsCollapsed}
                            onSelectSession={handleSelectSession}
                        />
                    )}

                    {/* Right Panel - Session Detail */}
                    <div className="flex-1 flex min-w-0">
                        <div className="flex-1 flex flex-col min-w-0">
                        {selectedWorkspace && (
                            <div className="shrink-0 border-b border-gray-200/50 px-4 py-3 dark:border-base-200">
                                <div className="flex flex-wrap items-center gap-2">
                                    {workspaceTabs.map(tab => (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            onClick={() => setWorkspaceTab(tab.id)}
                                            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                                                workspaceTab === tab.id
                                                    ? 'bg-blue-600 text-white shadow-sm'
                                                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-base-200 dark:hover:text-base-content'
                                            }`}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {selectedWorkspace && workspaceTab === 'overview' ? (
                            <div className="flex-1 overflow-y-auto p-5">
                                <div className="max-w-4xl space-y-5">
                                    <section className="space-y-2">
                                        <h2 className="text-base font-semibold text-gray-900 dark:text-base-content">
                                            {selectedWorkspace.name}
                                        </h2>
                                        <p className="font-mono text-sm text-gray-500 dark:text-gray-400 break-all">
                                            {selectedWorkspace.rootPath}
                                        </p>
                                        {selectedWorkspace.description && (
                                            <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
                                                {selectedWorkspace.description}
                                            </p>
                                        )}
                                    </section>

                                    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                        <div className="rounded-lg border border-gray-200/70 bg-white px-3 py-2.5 dark:border-base-200 dark:bg-base-100">
                                            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                                {t('workspaces.default_app')}
                                            </div>
                                            <div className="mt-1 text-sm text-gray-900 dark:text-base-content">
                                                {selectedWorkspace.defaultAppType
                                                    ? getAppLabel(selectedWorkspace.defaultAppType)
                                                    : t('workspaces.no_default')}
                                            </div>
                                        </div>
                                        <div className="rounded-lg border border-gray-200/70 bg-white px-3 py-2.5 dark:border-base-200 dark:bg-base-100">
                                            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                                {t('workspaces.default_provider')}
                                            </div>
                                            <div className="mt-1 text-sm text-gray-900 dark:text-base-content">
                                                {selectedWorkspace.defaultProviderId ?? t('workspaces.no_default')}
                                            </div>
                                        </div>
                                        <div className="rounded-lg border border-gray-200/70 bg-white px-3 py-2.5 dark:border-base-200 dark:bg-base-100">
                                            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                                {t('workspaces.permission_policy')}
                                            </div>
                                            <div className="mt-1 text-sm text-gray-900 dark:text-base-content">
                                                {selectedWorkspace.permissionPolicy ?? t('workspaces.no_default')}
                                            </div>
                                        </div>
                                    </section>

                                    <WorkspaceGitPanel workspace={selectedWorkspace} />

                                    <WorkspaceWorktreesPanel workspace={selectedWorkspace} />

                                    <LocalEnvironmentPanel workspace={selectedWorkspace} />

                                    <AutomationPanel workspace={selectedWorkspace} />

                                    {selectedWorkspace.tags.length > 0 && (
                                        <section className="flex flex-wrap gap-2">
                                            {selectedWorkspace.tags.map(tag => (
                                                <span
                                                    key={tag}
                                                    className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-base-200 dark:text-gray-300"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </section>
                                    )}
                                </div>
                            </div>
                        ) : selectedWorkspace && workspaceTab === 'chat' ? (
                            <div className="flex min-h-0 flex-1 flex-col p-4">
                                <ConversationPanel
                                    threadId={activeWorkspaceThreadId}
                                    title={selectedWorkspace.name}
                                    threadStartInput={chatThreadStartInput}
                                    inputValue={chatDraft}
                                    inputDisabled={chatSubmitting}
                                    onInputChange={setChatDraft}
                                    onSubmitPrompt={handleSubmitWorkspacePrompt}
                                    onInterruptTurn={handleInterruptWorkspaceTurn}
                                    onApproveApproval={handleApproveApproval}
                                    onDenyApproval={handleDenyApproval}
                                    className="min-h-0"
                                />
                            </div>
                        ) : selectedWorkspace && workspaceTab === 'bindings' ? (
                            <div className="flex-1 overflow-y-auto p-4">
                                <WorkspaceBindingsPanel
                                    workspace={selectedWorkspace}
                                    saving={workspaceActionPending}
                                    onSaveDefaults={handleWorkspaceDefaultsChange}
                                />
                            </div>
                        ) : !selectedSession ? (
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
                                            <div className="flex items-center gap-2">
                                                <h2 className="text-base font-semibold text-gray-900 dark:text-base-content truncate">
                                                    {getWorkspaceSessionTitle(selectedSession)}
                                                </h2>
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${providerColors[selectedSession.providerId] || ''}`}>
                                                    {selectedSession.providerId}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                                                <div className="flex items-center gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    <span>{formatTimestamp(selectedSession.lastActiveAt)}</span>
                                                </div>
                                                {selectedSession.projectDir && (
                                                    <button
                                                        className="flex items-center gap-1 hover:text-blue-500 transition-colors"
                                                        onClick={() => copyToClipboard(selectedSession.projectDir!)}
                                                        title={selectedSession.projectDir}
                                                    >
                                                        <FolderOpen className="w-3 h-3" />
                                                        <span className="truncate max-w-[200px]">{selectedSession.projectDir.split(/[/\\]/).pop()}</span>
                                                    </button>
                                                )}
                                                <div className="flex items-center gap-1">
                                                    <Hash className="w-3 h-3" />
                                                    <span className="font-mono text-[11px]" title={selectedSession.sessionId}>
                                                        {selectedSession.sessionId.length > 18
                                                            ? `${selectedSession.sessionId.slice(0, 8)}…${selectedSession.sessionId.slice(-6)}`
                                                            : selectedSession.sessionId}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <button
                                                onClick={() => resumeSession(selectedSession)}
                                                disabled={!selectedSession.resumeCommand}
                                                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-all shadow-sm shrink-0 ${
                                                    selectedSession.resumeCommand
                                                        ? 'text-white bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 hover:shadow-md'
                                                        : 'text-gray-400 bg-gray-100 dark:bg-base-200 cursor-not-allowed'
                                                }`}
                                                title={selectedSession.resumeCommand
                                                    ? t('workspaces.resume_session', { defaultValue: '恢复会话' })
                                                    : t('sessions.resume_not_available')}
                                            >
                                                <Play className="w-3.5 h-3.5" />
                                                <span className="hidden sm:inline">{t('workspaces.resume_session', { defaultValue: '恢复会话' })}</span>
                                            </button>
                                            {selectedSession.projectDir && (
                                                <button
                                                    onClick={() => openTerminal(selectedSession.projectDir!)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 bg-gray-100 dark:bg-base-200 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors shrink-0"
                                                    title={t('workspaces.open_terminal')}
                                                >
                                                    <Terminal className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Resume Command Bar */}
                                    <div className="mt-2.5 flex items-center gap-2">
                                        <div className="flex-1 rounded-md bg-gray-50 dark:bg-base-200 px-3 py-1.5 font-mono text-xs text-gray-500 dark:text-gray-400 truncate">
                                            {getResumeCommandDisplay(selectedSession)}
                                        </div>
                                        <button
                                            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-base-200 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                            onClick={() => {
                                                if (selectedSession.resumeCommand) {
                                                    void copyToClipboard(selectedSession.resumeCommand);
                                                }
                                            }}
                                            disabled={!selectedSession.resumeCommand}
                                            title={selectedSession.resumeCommand
                                                ? t('common.copy', { defaultValue: '复制' })
                                                : t('sessions.resume_not_available')}
                                        >
                                            <Copy className="w-3.5 h-3.5" />
                                        </button>
                                    </div>

                                    {/* File Path Bar */}
                                    <div className="mt-1.5 flex items-center gap-2">
                                        <div className="flex-1 rounded-md bg-gray-50 dark:bg-base-200 px-3 py-1.5 font-mono text-xs text-gray-500 dark:text-gray-400 truncate">
                                            {selectedSession.sourcePath}
                                        </div>
                                        <button
                                            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-base-200 transition-colors shrink-0"
                                            onClick={() => copyToClipboard(selectedSession.sourcePath)}
                                            title={t('common.copy', { defaultValue: '复制' })}
                                        >
                                            <Copy className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Messages Area */}
                                <div className="flex-1 overflow-y-auto" ref={messagesContainerRef}>
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
                                                        ref={(el) => {
                                                            if (el) messageRefs.current.set(index, el);
                                                            else messageRefs.current.delete(index);
                                                        }}
                                                        className={`rounded-lg border px-4 py-3 relative group transition-all ${
                                                            activeMessageIndex === index
                                                                ? 'ring-2 ring-blue-500 ring-offset-1'
                                                                : ''
                                                        } ${
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

                        {/* TOC Sidebar - large screens */}
                        {showSessionPanel && selectedSession && userMessagesToc.length > 2 && (
                            <div className="w-56 shrink-0 flex-col border-l border-gray-200/50 dark:border-base-200 bg-gray-50/30 dark:bg-base-100/30 hidden xl:flex">
                                <div className="p-3 border-b border-gray-200/50 dark:border-base-200">
                                    <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                                        <List className="w-3.5 h-3.5" />
                                        <span>{t('workspaces.toc_title', { defaultValue: '用户消息目录' })}</span>
                                        <span className="ml-auto text-[10px] tabular-nums">{filteredToc.length}{tocSearch.trim() ? `/${userMessagesToc.length}` : ''}</span>
                                    </div>
                                </div>
                                <div className="px-2 pt-2 pb-1">
                                    <div className="relative">
                                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                                        <input
                                            type="text"
                                            value={tocSearch}
                                            onChange={(e) => setTocSearch(e.target.value)}
                                            placeholder={t('workspaces.search_toc', { defaultValue: '搜索目录...' })}
                                            className="w-full pl-6 pr-2 py-1 text-xs rounded-md bg-white dark:bg-base-200 border border-gray-200 dark:border-base-300 outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500 text-gray-900 dark:text-base-content placeholder-gray-400 transition-all"
                                        />
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto">
                                    <div className="p-2 pt-1 space-y-0.5">
                                        {filteredToc.map((item, tocIndex) => (
                                            <button
                                                key={item.index}
                                                type="button"
                                                onClick={() => scrollToMessage(item.index)}
                                                className="w-full text-left px-2 py-1.5 rounded text-xs transition-colors hover:bg-gray-100 dark:hover:bg-base-200 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-start gap-2"
                                            >
                                                <span className="shrink-0 w-4 h-4 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] flex items-center justify-center font-medium">
                                                    {tocIndex + 1}
                                                </span>
                                                <span className="line-clamp-2 leading-snug">{item.preview}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* TOC Floating Button + Dialog - small screens */}
                        {showSessionPanel && selectedSession && userMessagesToc.length > 2 && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setTocDialogOpen(true)}
                                    className="xl:hidden fixed bottom-20 right-4 w-10 h-10 rounded-full shadow-lg z-30 bg-gradient-to-r from-blue-500 to-purple-500 text-white flex items-center justify-center hover:shadow-xl transition-all"
                                >
                                    <List className="w-4 h-4" />
                                </button>

                                {tocDialogOpen && (
                                    <div className="xl:hidden fixed inset-0 z-50 flex items-end justify-center sm:items-center">
                                        <div className="fixed inset-0 bg-black/40" onClick={() => setTocDialogOpen(false)} />
                                        <div className="relative w-full max-w-md max-h-[70vh] flex flex-col bg-white dark:bg-base-100 rounded-t-2xl sm:rounded-2xl shadow-2xl mx-4 mb-0 sm:mb-0">
                                            <div className="px-4 py-3 border-b border-gray-200/50 dark:border-base-200 flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-base-content">
                                                    <List className="w-4 h-4 text-blue-500" />
                                                    {t('workspaces.toc_title', { defaultValue: '用户消息目录' })}
                                                </div>
                                                <button
                                                    onClick={() => setTocDialogOpen(false)}
                                                    className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-base-200 transition-colors"
                                                >
                                                    <X className="w-4 h-4 text-gray-400" />
                                                </button>
                                            </div>
                                            <div className="px-3 pt-3 pb-1">
                                                <div className="relative">
                                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                                    <input
                                                        type="text"
                                                        value={tocSearch}
                                                        onChange={(e) => setTocSearch(e.target.value)}
                                                        placeholder={t('workspaces.search_toc', { defaultValue: '搜索目录...' })}
                                                        className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-gray-50 dark:bg-base-200 border border-gray-200 dark:border-base-300 outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-gray-900 dark:text-base-content placeholder-gray-400 transition-all"
                                                    />
                                                </div>
                                            </div>
                                            <div className="overflow-y-auto flex-1">
                                                <div className="p-3 space-y-1">
                                                    {filteredToc.map((item, tocIndex) => (
                                                        <button
                                                            key={item.index}
                                                            type="button"
                                                            onClick={() => scrollToMessage(item.index)}
                                                            className="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all hover:bg-blue-500/10 text-gray-700 dark:text-gray-300 flex items-start gap-3"
                                                        >
                                                            <span className="shrink-0 w-6 h-6 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 text-white text-xs flex items-center justify-center font-semibold">
                                                                {tocIndex + 1}
                                                            </span>
                                                            <span className="line-clamp-2 leading-relaxed pt-0.5">{item.preview}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
                <WorkspaceFormModal
                    isOpen={workspaceFormOpen}
                    workspace={editingWorkspace}
                    saving={workspaceActionPending}
                    onClose={() => {
                        setWorkspaceFormOpen(false);
                        setEditingWorkspace(null);
                    }}
                    onSubmit={handleWorkspaceFormSubmit}
                />
            </div>
        </div>
    );
}

export default WorkspacesPage;
