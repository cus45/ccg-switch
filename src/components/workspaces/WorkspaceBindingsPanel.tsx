import { useEffect, useMemo, useState } from 'react';
import { Plug, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type AppType } from '../../types/app';
import type { CodexConfigSummary, CodexModelInfo } from '../../types/conversation';
import type { McpServerRow } from '../../types/mcpV2';
import type { Workspace, WorkspaceBinding } from '../../types/workspace';
import { listCodexModels, readCodexConfig } from '../../services/codexBridgeService';
import { useMcpStoreV2 } from '../../stores/useMcpStoreV2';
import { useProviderStore } from '../../stores/useProviderStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useVisibleAppOptions } from '../../hooks/useVisibleAppOptions';

type McpBindingMode = 'inherit' | 'enabled' | 'disabled';

const MCP_BINDING_TYPE = 'override';

interface WorkspaceBindingsPanelProps {
    workspace: Workspace | null;
    saving: boolean;
    onSaveDefaults: (
        workspace: Workspace,
        defaultAppType: AppType | null,
        defaultProviderId: string | null
    ) => Promise<void>;
}

export function WorkspaceBindingsPanel({
    workspace,
    saving,
    onSaveDefaults,
}: WorkspaceBindingsPanelProps) {
    const { t } = useTranslation();
    const [pendingMcpServerId, setPendingMcpServerId] = useState<string | null>(null);
    const [codexConfig, setCodexConfig] = useState<CodexConfigSummary | null>(null);
    const [codexModels, setCodexModels] = useState<CodexModelInfo[]>([]);
    const [loadingCodexSummary, setLoadingCodexSummary] = useState(false);
    const [codexSummaryError, setCodexSummaryError] = useState<string | null>(null);
    const {
        providers,
        loading: loadingProviders,
        loadAllProviders,
    } = useProviderStore();
    const {
        servers: mcpServers,
        loading: loadingMcpServers,
        loadServers,
    } = useMcpStoreV2();
    const {
        bindingsByWorkspace,
        loadingBindings,
        bindingError,
        loadWorkspaceBindings,
        setWorkspaceBinding,
        deleteWorkspaceBinding,
    } = useWorkspaceStore();
    const appOptions = useVisibleAppOptions([workspace?.defaultAppType]);

    useEffect(() => {
        if (workspace) {
            void loadAllProviders(true);
            void loadServers();
            void loadWorkspaceBindings(workspace.id, true);
        }
    }, [loadAllProviders, loadServers, loadWorkspaceBindings, workspace?.id]);

    useEffect(() => {
        if (!workspace || workspace.defaultAppType !== 'codex') {
            setCodexConfig(null);
            setCodexModels([]);
            setCodexSummaryError(null);
            setLoadingCodexSummary(false);
            return;
        }

        let cancelled = false;
        setLoadingCodexSummary(true);
        setCodexSummaryError(null);
        void Promise.all([
            readCodexConfig(workspace.id),
            listCodexModels(workspace.defaultProviderId ?? undefined),
        ])
            .then(([config, models]) => {
                if (!cancelled) {
                    setCodexConfig(config);
                    setCodexModels(models);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setCodexConfig(null);
                    setCodexModels([]);
                    setCodexSummaryError(String(error));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingCodexSummary(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [workspace?.id, workspace?.defaultAppType, workspace?.defaultProviderId]);

    const selectedAppType = workspace?.defaultAppType ?? '';
    const selectedProviderId = workspace?.defaultProviderId ?? '';

    const filteredProviders = useMemo(() => {
        if (!workspace?.defaultAppType) return [];
        return providers.filter(provider => provider.appType === workspace.defaultAppType);
    }, [providers, workspace?.defaultAppType]);

    const providerValue = filteredProviders.some(provider => provider.id === selectedProviderId)
        ? selectedProviderId
        : '';
    const mcpBindings = useMemo(() => {
        if (!workspace) return [];
        return (bindingsByWorkspace[workspace.id] ?? []).filter(binding =>
            binding.targetType === 'mcp_server' && binding.bindingType === MCP_BINDING_TYPE
        );
    }, [bindingsByWorkspace, workspace]);
    const mcpBindingMap = useMemo(() => {
        return new Map(mcpBindings.map(binding => [binding.targetId, binding]));
    }, [mcpBindings]);
    const disabled = !workspace || saving;

    if (!workspace) {
        return null;
    }

    const handleAppChange = async (value: string) => {
        const nextAppType = value ? value as AppType : null;
        const nextProviderId = nextAppType === workspace.defaultAppType
            ? workspace.defaultProviderId ?? null
            : null;
        await onSaveDefaults(workspace, nextAppType, nextProviderId);
    };

    const handleProviderChange = async (value: string) => {
        await onSaveDefaults(
            workspace,
            workspace.defaultAppType ?? null,
            value || null
        );
    };

    const handleMcpModeChange = async (server: McpServerRow, mode: McpBindingMode) => {
        const binding = mcpBindingMap.get(server.id);
        setPendingMcpServerId(server.id);
        try {
            if (mode === 'inherit') {
                if (binding) {
                    await deleteWorkspaceBinding(binding.id);
                }
                return;
            }

            await setWorkspaceBinding({
                workspaceId: workspace.id,
                targetType: 'mcp_server',
                targetId: server.id,
                bindingType: MCP_BINDING_TYPE,
                enabled: mode === 'enabled',
                priority: 0,
                config: {},
            });
        } catch (error) {
            console.error('Failed to update workspace MCP binding:', error);
        } finally {
            setPendingMcpServerId(null);
        }
    };

    return (
        <section className="border-b border-gray-200/60 dark:border-base-200 px-3 py-3">
            <div className="mb-2 flex items-center gap-2">
                <Settings2 className="w-3.5 h-3.5 text-gray-400" />
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('workspaces.default_bindings')}
                </h2>
            </div>

            <div className="space-y-2">
                <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-gray-500 dark:text-gray-400">
                        {t('workspaces.default_app')}
                    </span>
                    <select
                        value={selectedAppType}
                        onChange={(event) => void handleAppChange(event.target.value)}
                        disabled={disabled}
                        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-base-300 dark:bg-base-200 dark:text-base-content"
                    >
                        <option value="">{t('workspaces.no_default')}</option>
                        {appOptions.map(({ appType, label }) => (
                            <option key={appType} value={appType}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-gray-500 dark:text-gray-400">
                        {t('workspaces.default_provider')}
                    </span>
                    <select
                        value={providerValue}
                        onChange={(event) => void handleProviderChange(event.target.value)}
                        disabled={disabled || !workspace?.defaultAppType || loadingProviders}
                        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-base-300 dark:bg-base-200 dark:text-base-content"
                    >
                        <option value="">
                            {loadingProviders
                                ? t('common.loading')
                                : t('workspaces.no_default')}
                        </option>
                        {filteredProviders.map(provider => (
                            <option key={provider.id} value={provider.id}>
                                {provider.name}
                            </option>
                        ))}
                    </select>
                </label>

                <div className="border-t border-gray-200/60 pt-3 dark:border-base-200">
                    <div className="mb-2 flex items-center gap-2">
                        <Plug className="w-3.5 h-3.5 text-gray-400" />
                        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {t('workspaces.mcp_bindings')}
                        </h3>
                    </div>

                    {bindingError && (
                        <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                            {bindingError}
                        </div>
                    )}

                    {loadingMcpServers && !mcpServers.length ? (
                        <div className="rounded-md border border-dashed border-gray-200 px-2 py-2 text-[11px] text-gray-500 dark:border-base-300 dark:text-gray-400">
                            {t('common.loading')}
                        </div>
                    ) : mcpServers.length === 0 ? (
                        <div className="rounded-md border border-dashed border-gray-200 px-2 py-2 text-[11px] text-gray-500 dark:border-base-300 dark:text-gray-400">
                            {t('workspaces.no_mcp_servers')}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {mcpServers.map(server => {
                                const binding = mcpBindingMap.get(server.id);
                                const mode = getMcpBindingMode(binding);
                                const rowDisabled = disabled
                                    || loadingBindings
                                    || pendingMcpServerId === server.id;

                                return (
                                    <div
                                        key={server.id}
                                        className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-2 dark:border-base-300 dark:bg-base-200"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-xs font-medium text-gray-900 dark:text-base-content">
                                                {server.name}
                                            </div>
                                            <div className="truncate text-[10px] text-gray-400">
                                                {server.id}
                                            </div>
                                            <div className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                                                {getInheritedMcpLabel(server, workspace.defaultAppType ?? null, t)}
                                            </div>
                                        </div>
                                        <select
                                            value={mode}
                                            onChange={(event) => void handleMcpModeChange(
                                                server,
                                                event.target.value as McpBindingMode
                                            )}
                                            disabled={rowDisabled}
                                            aria-label={`${server.name} MCP binding`}
                                            className="w-28 shrink-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-base-300 dark:bg-base-100 dark:text-base-content"
                                        >
                                            <option value="inherit">
                                                {t('workspaces.mcp_binding_inherit')}
                                            </option>
                                            <option value="enabled">
                                                {t('workspaces.mcp_binding_enabled')}
                                            </option>
                                            <option value="disabled">
                                                {t('workspaces.mcp_binding_disabled')}
                                            </option>
                                        </select>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {workspace.defaultAppType === 'codex' && (
                    <div className="border-t border-gray-200/60 pt-3 dark:border-base-200">
                        <div className="mb-2 flex items-center gap-2">
                            <Settings2 className="w-3.5 h-3.5 text-gray-400" />
                            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                {t('workspaces.codex_readonly')}
                            </h3>
                        </div>

                        {loadingCodexSummary ? (
                            <div className="rounded-md border border-dashed border-gray-200 px-2 py-2 text-[11px] text-gray-500 dark:border-base-300 dark:text-gray-400">
                                {t('common.loading')}
                            </div>
                        ) : codexSummaryError ? (
                            <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                                {codexSummaryError}
                            </div>
                        ) : codexConfig ? (
                            <div className="space-y-1 text-[11px]">
                                <ReadonlyRow
                                    label={t('workspaces.codex_config_status')}
                                    value={codexConfig.configExists
                                        ? t('workspaces.codex_config_found')
                                        : t('workspaces.codex_config_missing')}
                                />
                                <ReadonlyRow
                                    label={t('workspaces.codex_model')}
                                    value={codexConfig.model ?? t('workspaces.no_default')}
                                />
                                <ReadonlyRow
                                    label={t('workspaces.codex_provider')}
                                    value={codexConfig.providerId ?? t('workspaces.no_default')}
                                />
                                <ReadonlyRow
                                    label={t('workspaces.codex_approval_policy')}
                                    value={codexConfig.approvalPolicy ?? t('workspaces.no_default')}
                                />
                                <ReadonlyRow
                                    label={t('workspaces.codex_sandbox_policy')}
                                    value={codexConfig.sandboxPolicy ?? t('workspaces.no_default')}
                                />
                                <ReadonlyRow
                                    label={t('workspaces.codex_models')}
                                    value={formatCodexModels(codexModels, t)}
                                />
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </section>
    );
}

function getMcpBindingMode(binding?: WorkspaceBinding): McpBindingMode {
    if (!binding) {
        return 'inherit';
    }
    return binding.enabled ? 'enabled' : 'disabled';
}

function getInheritedMcpLabel(
    server: McpServerRow,
    appType: AppType | null,
    t: (key: string, options?: Record<string, unknown>) => string
): string {
    const inheritedEnabled = getInheritedMcpEnabled(server, appType);
    if (inheritedEnabled === null) {
        return t('workspaces.mcp_binding_no_default_app');
    }

    return inheritedEnabled
        ? t('workspaces.mcp_binding_global_enabled')
        : t('workspaces.mcp_binding_global_disabled');
}

function getInheritedMcpEnabled(server: McpServerRow, appType: AppType | null): boolean | null {
    switch (appType) {
        case 'claude':
            return server.enabledClaude;
        case 'codex':
            return server.enabledCodex;
        case 'gemini':
            return server.enabledGemini;
        default:
            return null;
    }
}

function ReadonlyRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-2 rounded-md bg-gray-50 px-2 py-1.5 dark:bg-base-200">
            <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
            <span className="min-w-0 truncate text-right text-gray-800 dark:text-base-content">
                {value}
            </span>
        </div>
    );
}

function formatCodexModels(
    models: CodexModelInfo[],
    t: (key: string, options?: Record<string, unknown>) => string
): string {
    if (!models.length) {
        return t('workspaces.no_default');
    }

    const visible = models.slice(0, 3).map(model => model.name);
    const remaining = models.length - visible.length;
    if (remaining <= 0) {
        return visible.join(', ');
    }

    return t('workspaces.codex_models_summary', {
        models: visible.join(', '),
        count: remaining,
    });
}
