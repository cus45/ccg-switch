import { Download, RefreshCw, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Workspace } from '../../types/workspace';

export interface WorkspaceProjectCandidate {
    name: string;
    path: string;
    session_count: number;
    last_active: string | null;
}

interface WorkspaceActionsProps {
    selectedWorkspace: Workspace | null;
    selectedProject: WorkspaceProjectCandidate | null;
    importCandidates: WorkspaceProjectCandidate[];
    loading?: boolean;
    actionPending?: boolean;
    selectedImportPath: string;
    onSelectImportPath: (path: string) => void;
    onImportProject: (project: WorkspaceProjectCandidate) => Promise<void> | void;
    onOpenTerminal: (path: string) => Promise<void> | void;
    onRefresh: () => Promise<void> | void;
}

export function WorkspaceActions({
    selectedWorkspace,
    selectedProject,
    importCandidates,
    loading = false,
    actionPending = false,
    selectedImportPath,
    onSelectImportPath,
    onImportProject,
    onOpenTerminal,
    onRefresh,
}: WorkspaceActionsProps) {
    const { t } = useTranslation();
    const terminalPath = selectedWorkspace?.rootPath ?? selectedProject?.path ?? null;
    const selectedImportProject = importCandidates.find(project => project.path === selectedImportPath) ?? null;
    const disabled = loading || actionPending;

    return (
        <section className="border-b border-gray-200/60 px-3 py-3 dark:border-base-200">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {t('workspaces.workspace_actions')}
                    </h2>
                    <p className="truncate text-[11px] text-gray-400 dark:text-gray-500">
                        {terminalPath ?? t('workspaces.no_workspace_selected')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void onRefresh()}
                    disabled={disabled}
                    className="shrink-0 rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:hover:bg-base-200 dark:hover:text-gray-300"
                    title={t('common.refresh')}
                    aria-label={t('common.refresh')}
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="mt-3 grid gap-2">
                <button
                    type="button"
                    onClick={() => terminalPath && void onOpenTerminal(terminalPath)}
                    disabled={disabled || !terminalPath}
                    className="btn btn-sm justify-start gap-2"
                    title={t('workspaces.open_terminal')}
                >
                    <Terminal className="h-4 w-4" />
                    {t('workspaces.open_terminal')}
                </button>

                <div className="grid gap-2">
                    <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                        {t('workspaces.import_history_project')}
                    </label>
                    <div className="flex gap-2">
                        <select
                            value={selectedImportPath}
                            onChange={(event) => onSelectImportPath(event.target.value)}
                            disabled={disabled || importCandidates.length === 0}
                            className="select select-bordered select-sm min-w-0 flex-1"
                        >
                            <option value="">
                                {importCandidates.length === 0
                                    ? t('workspaces.no_import_candidates')
                                    : t('workspaces.select_import_project')}
                            </option>
                            {importCandidates.map(project => (
                                <option key={project.path} value={project.path}>
                                    {project.name}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={() => selectedImportProject && void onImportProject(selectedImportProject)}
                            disabled={disabled || !selectedImportProject}
                            className="btn btn-primary btn-sm shrink-0 gap-2"
                            title={t('workspaces.import_history_project')}
                        >
                            <Download className="h-4 w-4" />
                            <span className="hidden sm:inline">{t('common.import')}</span>
                        </button>
                    </div>
                    {selectedImportProject && (
                        <p className="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">
                            {selectedImportProject.path}
                        </p>
                    )}
                </div>
            </div>
        </section>
    );
}
