import { useEffect, useState } from 'react';
import { GitBranch, GitCommitHorizontal, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getWorkspaceGitStatus } from '../../services/workspaceService';
import type { Workspace, WorkspaceGitStatus } from '../../types/workspace';

interface WorkspaceGitPanelProps {
    workspace: Workspace;
}

export function WorkspaceGitPanel({ workspace }: WorkspaceGitPanelProps) {
    const { t } = useTranslation();
    const [status, setStatus] = useState<WorkspaceGitStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        void getWorkspaceGitStatus(workspace.id)
            .then((nextStatus) => {
                if (!cancelled) {
                    setStatus(nextStatus);
                }
            })
            .catch((nextError) => {
                if (!cancelled) {
                    setStatus(null);
                    setError(String(nextError));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [workspace.id]);

    return (
        <section className="rounded-lg border border-gray-200/70 bg-white p-4 dark:border-base-200 dark:bg-base-100">
            <div className="mb-3 flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-base-content">
                    {t('workspaces.git_status')}
                </h3>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>{t('common.loading')}</span>
                </div>
            ) : error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                    {error}
                </div>
            ) : status && status.isGitRepository ? (
                <div className="grid gap-2 sm:grid-cols-2">
                    <GitInfoRow
                        label={t('workspaces.git_branch')}
                        value={status.branch ?? t('workspaces.no_default')}
                    />
                    <GitInfoRow
                        label={t('workspaces.git_worktree')}
                        value={status.dirty
                            ? t('workspaces.git_dirty', { count: status.changedFileCount })
                            : t('workspaces.git_clean')}
                    />
                    <GitInfoRow
                        label={t('workspaces.git_origin')}
                        value={status.originUrl ?? t('workspaces.git_no_origin')}
                        wide
                    />
                    <GitInfoRow
                        label={t('workspaces.git_root')}
                        value={status.gitRoot ?? status.rootPath}
                        wide
                        mono
                    />
                </div>
            ) : (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-base-300 dark:text-gray-400">
                    <GitCommitHorizontal className="h-3.5 w-3.5 text-gray-400" />
                    <span>{t('workspaces.git_not_repository')}</span>
                </div>
            )}
        </section>
    );
}

function GitInfoRow({
    label,
    value,
    wide = false,
    mono = false,
}: {
    label: string;
    value: string;
    wide?: boolean;
    mono?: boolean;
}) {
    return (
        <div
            className={`min-w-0 rounded-md bg-gray-50 px-3 py-2 dark:bg-base-200 ${
                wide ? 'sm:col-span-2' : ''
            }`}
        >
            <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                {label}
            </div>
            <div
                className={`mt-1 truncate text-sm text-gray-900 dark:text-base-content ${
                    mono ? 'font-mono text-xs' : ''
                }`}
                title={value}
            >
                {value}
            </div>
        </div>
    );
}
