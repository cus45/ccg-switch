import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { FolderOpen, Save, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
    CreateWorkspaceInput,
    UpdateWorkspaceInput,
    Workspace,
} from '../../types/workspace';

type WorkspaceFormSubmitInput = CreateWorkspaceInput | UpdateWorkspaceInput;

interface WorkspaceFormModalProps {
    isOpen: boolean;
    workspace?: Workspace | null;
    saving?: boolean;
    onClose: () => void;
    onSubmit: (input: WorkspaceFormSubmitInput) => Promise<void> | void;
}

export function WorkspaceFormModal({
    isOpen,
    workspace,
    saving = false,
    onClose,
    onSubmit,
}: WorkspaceFormModalProps) {
    const { t } = useTranslation();
    const isEditing = !!workspace;
    const [name, setName] = useState('');
    const [rootPath, setRootPath] = useState('');
    const [description, setDescription] = useState('');
    const [tagsText, setTagsText] = useState('');
    const [color, setColor] = useState('');
    const [isFavorite, setIsFavorite] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setName(workspace?.name ?? '');
        setRootPath(workspace?.rootPath ?? '');
        setDescription(workspace?.description ?? '');
        setTagsText(workspace?.tags.join(', ') ?? '');
        setColor(workspace?.color ?? '');
        setIsFavorite(workspace?.isFavorite ?? false);
        setError(null);
    }, [isOpen, workspace]);

    const title = useMemo(
        () => isEditing ? t('workspaces.edit_workspace') : t('workspaces.add_workspace'),
        [isEditing, t]
    );

    if (!isOpen) return null;

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const parsed = parseFormState({
            name,
            rootPath,
            description,
            tagsText,
            color,
            isFavorite,
            isEditing,
            t,
        });
        if ('error' in parsed) {
            setError(parsed.error);
            return;
        }

        setError(null);
        await onSubmit(parsed.input);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-base-100">
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-base-200">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                            <FolderOpen className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="truncate text-base font-semibold text-gray-900 dark:text-base-content">
                                {title}
                            </h2>
                            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                                {isEditing
                                    ? t('workspaces.edit_workspace_hint')
                                    : t('workspaces.add_workspace_hint')}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-base-200 dark:hover:text-gray-300"
                        aria-label={t('common.cancel')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                        {error && (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                                {error}
                            </div>
                        )}

                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="space-y-1.5">
                                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                    {t('workspaces.workspace_name')}
                                </span>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(event) => setName(event.target.value)}
                                    placeholder={t('workspaces.workspace_name_placeholder')}
                                    className="input input-bordered input-sm w-full"
                                    disabled={saving}
                                />
                            </label>

                            <label className="space-y-1.5">
                                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                    {t('workspaces.workspace_color')}
                                </span>
                                <div className="flex gap-2">
                                    <span
                                        className="h-8 w-8 shrink-0 rounded-md border border-gray-200 dark:border-base-300"
                                        style={{ backgroundColor: color || '#3b82f6' }}
                                    />
                                    <input
                                        type="text"
                                        value={color}
                                        onChange={(event) => setColor(event.target.value)}
                                        placeholder="#3b82f6"
                                        className="input input-bordered input-sm w-full font-mono"
                                        disabled={saving}
                                    />
                                </div>
                            </label>
                        </div>

                        <label className="space-y-1.5">
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                {t('workspaces.workspace_root_path')}
                            </span>
                            <input
                                type="text"
                                value={rootPath}
                                onChange={(event) => setRootPath(event.target.value)}
                                placeholder={t('workspaces.workspace_root_path_placeholder')}
                                className="input input-bordered input-sm w-full font-mono"
                                disabled={saving}
                                readOnly={isEditing}
                                required={!isEditing}
                            />
                            {isEditing && (
                                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                    {t('workspaces.workspace_root_path_readonly')}
                                </p>
                            )}
                        </label>

                        <label className="space-y-1.5">
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                {t('workspaces.workspace_description')}
                            </span>
                            <textarea
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
                                placeholder={t('workspaces.workspace_description_placeholder')}
                                className="textarea textarea-bordered min-h-20 w-full text-sm"
                                disabled={saving}
                            />
                        </label>

                        <label className="space-y-1.5">
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                {t('workspaces.workspace_tags')}
                            </span>
                            <input
                                type="text"
                                value={tagsText}
                                onChange={(event) => setTagsText(event.target.value)}
                                placeholder={t('workspaces.workspace_tags_placeholder')}
                                className="input input-bordered input-sm w-full"
                                disabled={saving}
                            />
                        </label>

                        <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-base-300">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-sm"
                                checked={isFavorite}
                                onChange={(event) => setIsFavorite(event.target.checked)}
                                disabled={saving}
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                                {t('workspaces.workspace_favorite')}
                            </span>
                        </label>
                    </div>

                    <div className="flex justify-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-base-200">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            className="btn btn-ghost btn-sm"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="btn btn-primary btn-sm gap-2"
                        >
                            <Save className="h-4 w-4" />
                            {saving ? t('common.saving') : t('common.save')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function parseFormState({
    name,
    rootPath,
    description,
    tagsText,
    color,
    isFavorite,
    isEditing,
    t,
}: {
    name: string;
    rootPath: string;
    description: string;
    tagsText: string;
    color: string;
    isFavorite: boolean;
    isEditing: boolean;
    t: (key: string) => string;
}): { input: WorkspaceFormSubmitInput } | { error: string } {
    const trimmedName = name.trim();
    const trimmedRootPath = rootPath.trim();
    const trimmedDescription = description.trim();
    const trimmedColor = color.trim();
    const tags = tagsText
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);

    if (!isEditing && !trimmedRootPath) {
        return { error: t('workspaces.error_root_path_required') };
    }
    if (isEditing && !trimmedName) {
        return { error: t('workspaces.error_name_required') };
    }
    if (trimmedColor && !/^#[0-9a-fA-F]{6}$/.test(trimmedColor)) {
        return { error: t('workspaces.error_color_format') };
    }

    if (isEditing) {
        return {
            input: {
                name: trimmedName,
                description: trimmedDescription || null,
                tags,
                color: trimmedColor || null,
                isFavorite,
            },
        };
    }

    return {
        input: {
            name: trimmedName || undefined,
            rootPath: trimmedRootPath,
            description: trimmedDescription || undefined,
            tags,
            color: trimmedColor || undefined,
            isFavorite,
        },
    };
}
