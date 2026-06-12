import { useEffect, useState } from 'react';
import { GitBranch, GitFork, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { listWorkspaceWorktrees } from '../../services/workspaceService';
import type { Workspace, WorkspaceWorktree } from '../../types/workspace';

interface WorkspaceWorktreesPanelProps {
    workspace: Workspace;
}

export function WorkspaceWorktreesPanel({ workspace }: WorkspaceWorktreesPanelProps) {
    const { t } = useTranslation();
    const [worktrees, setWorktrees] = useState<WorkspaceWorktree[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        void listWorkspaceWorktrees(workspace.id)
            .then((nextWorktrees) => {
                if (!cancelled) {
                    setWorktrees(nextWorktrees);
                }
            })
            .catch((nextError) => {
                if (!cancelled) {
                    setWorktrees([]);
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
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <GitFork className="h-4 w-4 text-gray-400" />
                    <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-base-content">
                        {t('workspaces.worktrees')}
                    </h3>
                </div>
                {!loading && !error && worktrees.length > 0 && (
                    <span className="shrink-0 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-base-200 dark:text-gray-400">
                        {t('workspaces.worktree_count', { count: worktrees.length })}
                    </span>
                )}
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
            ) : worktrees.length === 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-base-300 dark:text-gray-400">
                    <GitBranch className="h-3.5 w-3.5 text-gray-400" />
                    <span>{t('workspaces.no_worktrees')}</span>
                </div>
            ) : (
                <div className="space-y-2">
                    {worktrees.map(worktree => (
                        <div
                            key={worktree.id}
                            className="min-w-0 rounded-md bg-gray-50 px-3 py-2 dark:bg-base-200"
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 font-mono text-xs text-gray-900 dark:text-base-content">
                                    <div className="truncate" title={worktree.path}>
                                        {worktree.path}
                                    </div>
                                </div>
                                <span className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-base-100 dark:text-gray-400">
                                    {worktree.branch ?? t('workspaces.worktree_detached')}
                                </span>
                            </div>
                            {worktree.ownerThreadId && (
                                <div className="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
                                    {t('workspaces.worktree_owner_thread', {
                                        threadId: worktree.ownerThreadId,
                                    })}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
