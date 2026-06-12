import { Clock, Edit2, FolderOpen, Plus, Star, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Workspace } from '../../types/workspace';

interface WorkspaceListProps {
    workspaces: Workspace[];
    selectedWorkspaceId: string | null;
    loading: boolean;
    error: string | null;
    onCreate: () => void;
    onSelect: (workspace: Workspace) => void;
    onEdit: (workspace: Workspace) => void;
    onDelete: (workspace: Workspace) => void;
}

export function WorkspaceList({
    workspaces,
    selectedWorkspaceId,
    loading,
    error,
    onCreate,
    onSelect,
    onEdit,
    onDelete,
}: WorkspaceListProps) {
    const { t } = useTranslation();

    return (
        <section className="border-b border-gray-200/60 dark:border-base-200">
            <div className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {t('workspaces.persistent_workspaces')}
                    </h2>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
                        {t('workspaces.workspace_count', { count: workspaces.length })}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onCreate}
                    className="shrink-0 p-1.5 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                    title={t('workspaces.add_workspace')}
                    aria-label={t('workspaces.add_workspace')}
                >
                    <Plus className="w-4 h-4" />
                </button>
            </div>

            {error && (
                <div className="mx-3 mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                    {error}
                </div>
            )}

            <div className="max-h-72 overflow-y-auto px-2 pb-2">
                {loading && workspaces.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-gray-400">
                        {t('common.loading')}
                    </div>
                ) : workspaces.length === 0 ? (
                    <div className="px-3 py-5 text-center">
                        <FolderOpen className="mx-auto mb-2 w-7 h-7 text-gray-300 dark:text-gray-600" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            {t('workspaces.no_workspaces')}
                        </p>
                        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                            {t('workspaces.no_workspaces_hint')}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {workspaces.map(workspace => {
                            const isSelected = selectedWorkspaceId === workspace.id;
                            const visibleTags = workspace.tags.slice(0, 3);
                            const hiddenTagCount = workspace.tags.length - visibleTags.length;
                            return (
                                <div
                                    key={workspace.id}
                                    className={`group flex items-start gap-1 rounded-lg border px-3 py-2 transition-all ${
                                        isSelected
                                            ? 'border-blue-500/30 bg-blue-500/10 dark:bg-blue-500/15'
                                            : 'border-transparent hover:bg-gray-100 dark:hover:bg-base-200'
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => onSelect(workspace)}
                                        className="min-w-0 flex-1 text-left"
                                    >
                                        <div className="flex items-start gap-2">
                                            <span
                                                className="mt-0.5 h-3 w-3 rounded-full border border-white shadow-sm shrink-0"
                                                style={{ backgroundColor: workspace.color || '#3b82f6' }}
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="truncate text-sm font-medium text-gray-900 dark:text-base-content">
                                                        {workspace.name}
                                                    </span>
                                                    {workspace.isFavorite && (
                                                        <Star className="w-3 h-3 shrink-0 fill-amber-400 text-amber-400" />
                                                    )}
                                                </div>
                                                <p className="mt-0.5 truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">
                                                    {workspace.rootPath}
                                                </p>
                                                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                                                    <Clock className="w-3 h-3" />
                                                    <span>{formatWorkspaceTime(workspace.lastOpenedAt, t)}</span>
                                                </div>
                                                {workspace.tags.length > 0 && (
                                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                                        {visibleTags.map(tag => (
                                                            <span
                                                                key={tag}
                                                                className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-base-300 dark:text-gray-400"
                                                            >
                                                                {tag}
                                                            </span>
                                                        ))}
                                                        {hiddenTagCount > 0 && (
                                                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-base-300 dark:text-gray-400">
                                                                +{hiddenTagCount}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                    <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onEdit(workspace);
                                            }}
                                            className="rounded p-1 text-gray-400 hover:bg-white hover:text-blue-600 dark:hover:bg-base-100 dark:hover:text-blue-400"
                                            title={t('common.edit')}
                                            aria-label={t('common.edit')}
                                        >
                                            <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onDelete(workspace);
                                            }}
                                            className="rounded p-1 text-gray-400 hover:bg-white hover:text-red-600 dark:hover:bg-base-100 dark:hover:text-red-400"
                                            title={t('common.delete')}
                                            aria-label={t('common.delete')}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </section>
    );
}

function formatWorkspaceTime(
    timestamp: number | undefined,
    t: (key: string, options?: Record<string, unknown>) => string
): string {
    if (!timestamp) {
        return t('workspaces.never_opened');
    }

    const date = new Date(timestamp * 1000);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t('workspaces.just_now');
    if (diffMin < 60) return t('workspaces.minutes_ago', { count: diffMin });
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return t('workspaces.hours_ago', { count: diffHour });
    const diffDay = Math.floor(diffHour / 24);
    return t('workspaces.days_ago', { count: diffDay });
}
