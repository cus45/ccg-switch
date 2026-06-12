import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Bot, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    createWorkspaceAutomation,
    deleteWorkspaceAutomation,
    listWorkspaceAutomations,
    updateWorkspaceAutomation,
} from '../../services/workspaceService';
import type {
    CreateWorkspaceAutomationInput,
    UpdateWorkspaceAutomationInput,
    Workspace,
    WorkspaceAutomation,
} from '../../types/workspace';

interface AutomationPanelProps {
    workspace: Workspace;
}

interface AutomationFormState {
    title: string;
    schedule: string;
    prompt: string;
    memoryPath: string;
    enabled: boolean;
}

const EMPTY_FORM: AutomationFormState = {
    title: '',
    schedule: '',
    prompt: '',
    memoryPath: '',
    enabled: false,
};

export function AutomationPanel({ workspace }: AutomationPanelProps) {
    const { t } = useTranslation();
    const [automations, setAutomations] = useState<WorkspaceAutomation[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<AutomationFormState>(EMPTY_FORM);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setEditingId(null);
        setForm(EMPTY_FORM);

        void listWorkspaceAutomations(workspace.id)
            .then((nextAutomations) => {
                if (!cancelled) {
                    setAutomations(nextAutomations);
                }
            })
            .catch((nextError) => {
                if (!cancelled) {
                    setAutomations([]);
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

    const editingAutomation = useMemo(
        () => automations.find(automation => automation.id === editingId) ?? null,
        [automations, editingId]
    );

    const loadAutomations = async () => {
        setLoading(true);
        setError(null);
        try {
            setAutomations(await listWorkspaceAutomations(workspace.id));
        } catch (nextError) {
            setAutomations([]);
            setError(String(nextError));
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = () => {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setError(null);
    };

    const handleEdit = (automation: WorkspaceAutomation) => {
        setEditingId(automation.id);
        setForm({
            title: automation.title,
            schedule: automation.schedule,
            prompt: automation.prompt,
            memoryPath: automation.memoryPath ?? '',
            enabled: automation.enabled,
        });
        setError(null);
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setError(null);
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const parsed = parseAutomationForm(form, workspace.id, editingAutomation);
        if ('error' in parsed) {
            setError(parsed.error);
            return;
        }

        setSaving(true);
        setError(null);
        try {
            if (parsed.mode === 'update') {
                await updateWorkspaceAutomation(parsed.id, parsed.input);
            } else {
                await createWorkspaceAutomation(parsed.input);
            }
            setAutomations(await listWorkspaceAutomations(workspace.id));
            setEditingId(null);
            setForm(EMPTY_FORM);
        } catch (nextError) {
            setError(String(nextError));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (automation: WorkspaceAutomation) => {
        const confirmed = window.confirm(
            t('workspaces.automation_confirm_delete', { title: automation.title })
        );
        if (!confirmed) return;

        setSaving(true);
        setError(null);
        try {
            await deleteWorkspaceAutomation(automation.id);
            setAutomations(await listWorkspaceAutomations(workspace.id));
            if (editingId === automation.id) {
                setEditingId(null);
                setForm(EMPTY_FORM);
            }
        } catch (nextError) {
            setError(String(nextError));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="rounded-lg border border-gray-200/70 bg-white p-4 dark:border-base-200 dark:bg-base-100">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <Bot className="h-4 w-4 text-gray-400" />
                    <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-base-content">
                        {t('workspaces.automations')}
                    </h3>
                    {!loading && automations.length > 0 && (
                        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-base-200 dark:text-gray-400">
                            {t('workspaces.automation_count', { count: automations.length })}
                        </span>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={loadAutomations}
                        disabled={loading || saving}
                        title={t('common.refresh')}
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={handleCreate}
                        disabled={saving}
                        title={t('workspaces.automation_new')}
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                    {error}
                </div>
            )}

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
                <div className="min-w-0 space-y-2">
                    {loading ? (
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            <span>{t('common.loading')}</span>
                        </div>
                    ) : automations.length === 0 ? (
                        <div className="rounded-md border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-base-300 dark:text-gray-400">
                            {t('workspaces.no_automations')}
                        </div>
                    ) : (
                        automations.map(automation => (
                            <div
                                key={automation.id}
                                className="rounded-md bg-gray-50 px-3 py-2 dark:bg-base-200"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className="truncate text-sm font-medium text-gray-900 dark:text-base-content">
                                                {automation.title}
                                            </span>
                                            <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                                                automation.enabled
                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                                                    : 'bg-gray-100 text-gray-500 dark:bg-base-300 dark:text-gray-400'
                                            }`}>
                                                {automation.enabled
                                                    ? t('workspaces.automation_enabled')
                                                    : t('workspaces.automation_disabled')}
                                            </span>
                                        </div>
                                        <div className="mt-1 truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
                                            {automation.schedule}
                                        </div>
                                        <div className="mt-1 line-clamp-2 text-xs text-gray-600 dark:text-gray-300">
                                            {automation.prompt}
                                        </div>
                                        {automation.memoryPath && (
                                            <div className="mt-1 truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
                                                {automation.memoryPath}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-xs"
                                            onClick={() => handleEdit(automation)}
                                            disabled={saving}
                                            title={t('common.edit')}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-xs text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                                            onClick={() => handleDelete(automation)}
                                            disabled={saving}
                                            title={t('common.delete')}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <form
                    onSubmit={handleSubmit}
                    className="space-y-3 rounded-md border border-gray-200 px-3 py-3 dark:border-base-300"
                >
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            {editingAutomation
                                ? t('workspaces.automation_edit')
                                : t('workspaces.automation_new')}
                        </div>
                        {editingAutomation && (
                            <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                onClick={handleCancelEdit}
                                disabled={saving}
                                title={t('common.cancel')}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                            {t('workspaces.automation_title')}
                        </span>
                        <input
                            className="input input-bordered input-sm w-full"
                            value={form.title}
                            onChange={(event) => setForm({ ...form, title: event.target.value })}
                            disabled={saving}
                        />
                    </label>

                    <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                            {t('workspaces.automation_schedule')}
                        </span>
                        <input
                            className="input input-bordered input-sm w-full font-mono text-xs"
                            value={form.schedule}
                            onChange={(event) => setForm({ ...form, schedule: event.target.value })}
                            placeholder={t('workspaces.automation_schedule_placeholder')}
                            disabled={saving}
                        />
                    </label>

                    <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                            {t('workspaces.automation_prompt')}
                        </span>
                        <textarea
                            className="textarea textarea-bordered min-h-28 w-full resize-y text-xs"
                            value={form.prompt}
                            onChange={(event) => setForm({ ...form, prompt: event.target.value })}
                            disabled={saving}
                        />
                    </label>

                    <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                            {t('workspaces.automation_memory_path')}
                        </span>
                        <input
                            className="input input-bordered input-sm w-full font-mono text-xs"
                            value={form.memoryPath}
                            onChange={(event) => setForm({ ...form, memoryPath: event.target.value })}
                            placeholder={t('workspaces.automation_memory_path_placeholder')}
                            disabled={saving}
                        />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:bg-base-200 dark:text-gray-300">
                        <span>{t('workspaces.automation_enabled')}</span>
                        <input
                            type="checkbox"
                            className="toggle toggle-primary toggle-sm"
                            checked={form.enabled}
                            onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                            disabled={saving}
                        />
                    </label>

                    <button
                        type="submit"
                        className="btn btn-primary btn-sm w-full"
                        disabled={saving}
                    >
                        {saving ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="h-4 w-4" />
                        )}
                        <span>{saving ? t('common.saving') : t('common.save')}</span>
                    </button>
                </form>
            </div>
        </section>
    );
}

function parseAutomationForm(
    form: AutomationFormState,
    workspaceId: string,
    editingAutomation: WorkspaceAutomation | null
):
    | { mode: 'create'; input: CreateWorkspaceAutomationInput }
    | { mode: 'update'; id: string; input: UpdateWorkspaceAutomationInput }
    | { error: string } {
    const title = form.title.trim();
    if (!title) {
        return { error: 'title cannot be empty' };
    }
    const prompt = form.prompt.trim();
    if (!prompt) {
        return { error: 'prompt cannot be empty' };
    }
    const schedule = form.schedule.trim();
    if (!schedule) {
        return { error: 'schedule cannot be empty' };
    }
    const memoryPath = form.memoryPath.trim();

    if (editingAutomation) {
        return {
            mode: 'update',
            id: editingAutomation.id,
            input: {
                title,
                prompt,
                schedule,
                enabled: form.enabled,
                memoryPath: memoryPath || null,
            },
        };
    }

    return {
        mode: 'create',
        input: {
            workspaceId,
            title,
            prompt,
            schedule,
            enabled: form.enabled,
            memoryPath: memoryPath || undefined,
        },
    };
}
