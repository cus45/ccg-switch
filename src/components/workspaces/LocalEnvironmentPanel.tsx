import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileCode2, RefreshCw, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    readLocalEnvironment,
    saveLocalEnvironment,
} from '../../services/workspaceService';
import type { LocalEnvironmentConfig, Workspace } from '../../types/workspace';

interface LocalEnvironmentPanelProps {
    workspace: Workspace;
}

export function LocalEnvironmentPanel({ workspace }: LocalEnvironmentPanelProps) {
    const { t } = useTranslation();
    const [config, setConfig] = useState<LocalEnvironmentConfig | null>(null);
    const [draft, setDraft] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setSaved(false);

        void readLocalEnvironment(workspace.id)
            .then((nextConfig) => {
                if (!cancelled) {
                    setConfig(nextConfig);
                    setDraft(nextConfig.setupScript ?? '');
                }
            })
            .catch((nextError) => {
                if (!cancelled) {
                    setConfig(null);
                    setDraft('');
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

    const dirty = draft !== (config?.setupScript ?? '');

    const handleRefresh = async () => {
        setLoading(true);
        setError(null);
        setSaved(false);
        try {
            const nextConfig = await readLocalEnvironment(workspace.id);
            setConfig(nextConfig);
            setDraft(nextConfig.setupScript ?? '');
        } catch (nextError) {
            setConfig(null);
            setDraft('');
            setError(String(nextError));
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setSaved(false);
        try {
            const nextConfig = await saveLocalEnvironment({
                workspaceId: workspace.id,
                setupScript: draft.trim().length > 0 ? draft : undefined,
            });
            setConfig(nextConfig);
            setDraft(nextConfig.setupScript ?? '');
            setSaved(true);
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
                    <FileCode2 className="h-4 w-4 text-gray-400" />
                    <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-base-content">
                        {t('workspaces.local_environment')}
                    </h3>
                </div>
                <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={handleRefresh}
                    disabled={loading || saving}
                    title={t('common.refresh')}
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {error && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                    {error}
                </div>
            )}

            {config?.parseError && (
                <div className="mb-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 break-words">
                        {t('workspaces.environment_parse_error')}: {config.parseError}
                    </span>
                </div>
            )}

            <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0 rounded-md bg-gray-50 px-3 py-2 dark:bg-base-200">
                        <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                            {t('workspaces.local_environment_path')}
                        </div>
                        <div
                            className="mt-1 truncate font-mono text-xs text-gray-900 dark:text-base-content"
                            title={config?.path ?? ''}
                        >
                            {config?.path ?? t('common.loading')}
                        </div>
                    </div>
                    <div className="rounded-md bg-gray-50 px-3 py-2 dark:bg-base-200">
                        <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                            {t('workspaces.local_environment_status')}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-900 dark:text-base-content">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            <span>
                                {config?.exists
                                    ? t('workspaces.local_environment_exists')
                                    : t('workspaces.local_environment_missing')}
                            </span>
                        </div>
                    </div>
                </div>

                <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                        {t('workspaces.setup_script')}
                    </span>
                    <textarea
                        className="textarea textarea-bordered min-h-32 w-full resize-y font-mono text-xs"
                        value={draft}
                        onChange={(event) => {
                            setDraft(event.target.value);
                            setSaved(false);
                        }}
                        disabled={loading || saving}
                        placeholder={t('workspaces.setup_script_placeholder')}
                    />
                </label>

                {config?.rawToml && (
                    <div className="rounded-md bg-gray-50 px-3 py-2 dark:bg-base-200">
                        <div className="mb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                            {t('workspaces.environment_raw_toml')}
                        </div>
                        <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-gray-700 dark:text-gray-300">
                            {config.rawToml}
                        </pre>
                    </div>
                )}

                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 text-xs text-gray-500 dark:text-gray-400">
                        {saved
                            ? t('workspaces.environment_saved')
                            : dirty
                                ? t('workspaces.environment_unsaved')
                                : ''}
                    </div>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleSave}
                        disabled={loading || saving || !dirty}
                    >
                        {saving ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="h-4 w-4" />
                        )}
                        <span>{saving ? t('common.saving') : t('common.save')}</span>
                    </button>
                </div>
            </div>
        </section>
    );
}
