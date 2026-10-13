import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ChevronDown,
    ChevronRight,
    Coins,
    Database,
    Download,
    Pencil,
    Plus,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import {
    useModelPricing,
    useDeleteModelPricing,
    useImportModelsDevPricing,
    useGlobalPricingConfig,
    useSetGlobalPricingConfig,
    useUsageRetention,
    useSetUsageRetention,
    useCleanupUsageLogs,
    useUsageLoggingEnabled,
    useSetUsageLoggingEnabled,
} from '../../hooks/useUsageQueries';
import { PricingEditModal } from './PricingEditModal';
import type { ModelPricingInfo, PricingModelSource } from '../../types/usage';
import { showToast } from '../common/ToastContainer';
import { cn } from '../../utils/cn';
import { card, emptyState, ghostBtn, muted, primaryBtn, row, tableWrap, thead } from './styles';

interface GroupDef {
    key: string;
    label: string;
    match: (id: string, name: string) => boolean;
}

const MODEL_GROUPS: GroupDef[] = [
    {
        key: 'anthropic',
        label: 'Anthropic (Claude)',
        match: (id, name) => {
            const s = `${id} ${name}`.toLowerCase();
            return s.includes('claude') || s.startsWith('anthropic/');
        },
    },
    {
        key: 'openai',
        label: 'OpenAI (GPT / o1 / o3)',
        match: (id, name) => {
            const s = `${id} ${name}`.toLowerCase();
            return (
                s.includes('gpt-') ||
                s.startsWith('gpt') ||
                s.includes('o1') ||
                s.includes('o3') ||
                s.includes('chatgpt') ||
                s.startsWith('openai/') ||
                s.includes('text-embedding') ||
                s.includes('dall-e')
            );
        },
    },
    {
        key: 'google',
        label: 'Google (Gemini)',
        match: (id, name) => {
            const s = `${id} ${name}`.toLowerCase();
            return s.includes('gemini') || s.startsWith('google/');
        },
    },
    {
        key: 'deepseek',
        label: 'DeepSeek',
        match: (id, name) => {
            const s = `${id} ${name}`.toLowerCase();
            return s.includes('deepseek');
        },
    },
    {
        key: 'qwen',
        label: '通义千问 (Qwen)',
        match: (id, name) => {
            const s = `${id} ${name}`.toLowerCase();
            return s.includes('qwen') || s.includes('tongyi') || s.startsWith('alibaba/');
        },
    },
    {
        key: 'glm',
        label: '智谱 AI (GLM)',
        match: (id, name) => {
            const s = `${id} ${name}`.toLowerCase();
            return s.includes('glm') || s.includes('zhipu');
        },
    },
    {
        key: 'mistral',
        label: 'Mistral AI',
        match: (id, name) => {
            const s = `${id} ${name}`.toLowerCase();
            return s.includes('mistral') || s.includes('codestral') || s.startsWith('mistralai/');
        },
    },
    {
        key: 'meta',
        label: 'Meta (Llama)',
        match: (id, name) => {
            const s = `${id} ${name}`.toLowerCase();
            return s.includes('llama') || s.startsWith('meta/');
        },
    },
    {
        key: 'moonshot',
        label: 'Moonshot (Kimi)',
        match: (id, name) => {
            const s = `${id} ${name}`.toLowerCase();
            return s.includes('moonshot') || s.includes('kimi');
        },
    },
    {
        key: 'minimax',
        label: 'MiniMax',
        match: (id, name) => {
            const s = `${id} ${name}`.toLowerCase();
            return s.includes('minimax') || s.includes('abab');
        },
    },
    {
        key: 'xai',
        label: 'xAI (Grok)',
        match: (id, name) => {
            const s = `${id} ${name}`.toLowerCase();
            return s.includes('grok') || s.startsWith('xai/');
        },
    },
];

function resolveModelGroup(model: ModelPricingInfo): { key: string; label: string } {
    for (const g of MODEL_GROUPS) {
        if (g.match(model.modelId, model.displayName)) {
            return { key: g.key, label: g.label };
        }
    }
    if (model.modelId.includes('/')) {
        const prefix = model.modelId.split('/')[0];
        return {
            key: prefix.toLowerCase(),
            label: prefix.charAt(0).toUpperCase() + prefix.slice(1),
        };
    }
    return { key: 'other', label: '其他模型' };
}

const PRICING_APPS = ['claude', 'codex', 'gemini'] as const;
type PricingApp = (typeof PRICING_APPS)[number];

interface AppConfig {
    multiplier: string;
    source: PricingModelSource;
}

/** 每个 app 的全局计费配置 */
function useAllPricingConfigs() {
    const claude = useGlobalPricingConfig('claude');
    const codex = useGlobalPricingConfig('codex');
    const gemini = useGlobalPricingConfig('gemini');

    const map: Record<PricingApp, AppConfig | undefined> = {
        claude: claude.data
            ? { multiplier: claude.data.multiplier, source: claude.data.modelSource }
            : undefined,
        codex: codex.data
            ? { multiplier: codex.data.multiplier, source: codex.data.modelSource }
            : undefined,
        gemini: gemini.data
            ? { multiplier: gemini.data.multiplier, source: gemini.data.modelSource }
            : undefined,
    };

    return { map, isLoading: claude.isLoading || codex.isLoading || gemini.isLoading };
}

/** 区块标题行：标题 + 说明 + 右侧操作 */
function SectionHeader({
    title,
    desc,
    action,
}: {
    title: string;
    desc?: string;
    action?: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-base-content">{title}</h4>
                {desc && <p className={cn('mt-0.5 text-xs', muted)}>{desc}</p>}
            </div>
            {action}
        </div>
    );
}

/** 日志保留天数 + 采集开关面板 */
function RetentionSection() {
    const { t } = useTranslation();
    const { data: days } = useUsageRetention();
    const setRetention = useSetUsageRetention();
    const cleanup = useCleanupUsageLogs();
    const { data: loggingEnabled } = useUsageLoggingEnabled();
    const setLogging = useSetUsageLoggingEnabled();

    const currentDays = days ?? 90;

    return (
        <div className="space-y-3">
            <SectionHeader title={t('usage.retention.title')} desc={t('usage.retention.desc')} />
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3 dark:border-base-200 dark:bg-base-200/30">
                <select
                    className="select select-bordered select-sm w-[150px]"
                    value={currentDays}
                    onChange={(e) => {
                        const v = Number.parseInt(e.target.value, 10);
                        setRetention.mutate(v);
                    }}
                    disabled={setRetention.isPending}
                >
                    <option value={0}>{t('usage.retention.forever')}</option>
                    <option value={30}>30 {t('usage.retention.days')}</option>
                    <option value={90}>90 {t('usage.retention.days')}</option>
                    <option value={180}>180 {t('usage.retention.days')}</option>
                    <option value={365}>365 {t('usage.retention.days')}</option>
                </select>
                <button
                    type="button"
                    className={ghostBtn}
                    onClick={() => {
                        cleanup.mutate(undefined, {
                            onSuccess: (n) =>
                                showToast(t('usage.retention.cleaned', { count: n }), 'success'),
                            onError: (e) => showToast(String(e), 'error'),
                        });
                    }}
                    disabled={cleanup.isPending || currentDays === 0}
                >
                    {cleanup.isPending ? (
                        <span className="loading loading-spinner loading-xs" />
                    ) : (
                        <Database className="h-4 w-4" />
                    )}
                    {t('usage.retention.cleanNow')}
                </button>

                {/* 采集总开关：关掉后代理照常转发，只是不再落库 */}
                <label className="ml-auto flex cursor-pointer items-center gap-2">
                    <input
                        type="checkbox"
                        className="toggle toggle-primary toggle-sm"
                        checked={loggingEnabled ?? true}
                        onChange={(e) => setLogging.mutate(e.target.checked)}
                        disabled={setLogging.isPending}
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-200">
                        {t('usage.retention.loggingEnabled')}
                    </span>
                </label>
            </div>
        </div>
    );
}

export function PricingConfigPanel() {
    const { t } = useTranslation();
    const { data: pricing, isLoading } = useModelPricing();
    const deleteMutation = useDeleteModelPricing();
    const importMutation = useImportModelsDevPricing();

    const [editingModel, setEditingModel] = useState<ModelPricingInfo | null>(null);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [overwriteExisting, setOverwriteExisting] = useState(false);

    // 模型搜索与分组状态
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedGroup, setSelectedGroup] = useState<string>('all');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    const toggleGroupCollapse = (groupKey: string) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            } else {
                next.add(groupKey);
            }
            return next;
        });
    };

    const { activeGroups, totalCount, displayedGroups } = useMemo(() => {
        if (!pricing || pricing.length === 0) {
            return { activeGroups: [], totalCount: 0, displayedGroups: [] };
        }

        const query = searchQuery.trim().toLowerCase();
        // 1. 搜索过滤
        const searchMatched = query
            ? pricing.filter(
                  (m) =>
                      m.modelId.toLowerCase().includes(query) ||
                      m.displayName.toLowerCase().includes(query)
              )
            : pricing;

        // 2. 按分组归类
        const groupMap = new Map<
            string,
            { key: string; label: string; models: ModelPricingInfo[] }
        >();

        for (const m of searchMatched) {
            const { key, label } = resolveModelGroup(m);
            const entry = groupMap.get(key) ?? {
                key,
                label: key === 'other' ? t('usage.groupOther', '其他模型') : label,
                models: [],
            };
            entry.models.push(m);
            groupMap.set(key, entry);
        }

        // 排序已知分组在前，其他在后
        const sortedGroups: { key: string; label: string; models: ModelPricingInfo[] }[] = [];
        for (const g of MODEL_GROUPS) {
            const entry = groupMap.get(g.key);
            if (entry && entry.models.length > 0) {
                sortedGroups.push(entry);
                groupMap.delete(g.key);
            }
        }
        for (const [key, entry] of groupMap.entries()) {
            if (key !== 'other' && entry.models.length > 0) {
                sortedGroups.push(entry);
            }
        }
        const otherEntry = groupMap.get('other');
        if (otherEntry && otherEntry.models.length > 0) {
            sortedGroups.push(otherEntry);
        }

        const filtered =
            selectedGroup === 'all'
                ? sortedGroups
                : sortedGroups.filter((g) => g.key === selectedGroup);

        return {
            activeGroups: sortedGroups,
            totalCount: searchMatched.length,
            displayedGroups: filtered,
        };
    }, [pricing, searchQuery, selectedGroup, t]);

    // 全局配置：每个 app 独立取数，避免三行都显示同一个 app 的值
    const { map: configs, isLoading: configsLoading } = useAllPricingConfigs();
    const [selectedApp, setSelectedApp] = useState<PricingApp>('claude');
    const setConfigMutation = useSetGlobalPricingConfig(selectedApp);

    const [appConfig, setAppConfig] = useState<AppConfig>({ multiplier: '1', source: 'response' });

    // 后端配置到达或切换应用后，同步回本地编辑态
    useEffect(() => {
        const c = configs[selectedApp];
        if (c) setAppConfig({ multiplier: c.multiplier, source: c.source });
    }, [configs, selectedApp]);

    const handleSaveConfig = async () => {
        const trimmed = appConfig.multiplier.trim();
        // 倍率必须是非负数：负倍率会算出负成本
        if (!trimmed || !/^\d+(?:\.\d+)?$/.test(trimmed)) {
            showToast(t('usage.invalidMultiplier'), 'error');
            return;
        }

        try {
            await setConfigMutation.mutateAsync({
                multiplier: trimmed,
                modelSource: appConfig.source,
            });
            showToast(t('common.saved'), 'success');
        } catch (error) {
            showToast(t('usage.saveConfigFailed') + ': ' + String(error), 'error');
        }
    };

    const handleDelete = (modelId: string) => {
        deleteMutation.mutate(modelId, {
            onSuccess: () => setDeleteConfirm(null),
        });
    };

    const handleAddNew = () => {
        setIsAddingNew(true);
        setEditingModel({
            modelId: '',
            displayName: '',
            inputCostPerMillion: '0',
            outputCostPerMillion: '0',
            cacheReadCostPerMillion: '0',
            cacheCreationCostPerMillion: '0',
        });
    };

    const handleImportModelsDev = () => {
        importMutation.mutate(
            { overwriteExisting },
            {
                onSuccess: (res) => {
                    setImportModalOpen(false);
                    setOverwriteExisting(false);
                    showToast(
                        t('usage.importSuccess', {
                            imported: res.imported,
                            updated: res.updated,
                            skipped: res.skipped,
                            total: res.totalFetched,
                        }),
                        'success'
                    );
                },
                onError: (err) => {
                    showToast(t('usage.importFailed') + ': ' + String(err), 'error');
                },
            }
        );
    };

    const current = configs[selectedApp];
    const isDirty =
        !!current &&
        (appConfig.multiplier !== current.multiplier || appConfig.source !== current.source);

    if (isLoading || configsLoading) {
        return (
            <div className="space-y-3 pt-2" aria-busy="true">
                <div className="skeleton h-5 w-40" />
                <div className="skeleton h-28 w-full" />
                <div className="skeleton h-5 w-32" />
                <div className="skeleton h-40 w-full" />
            </div>
        );
    }

    return (
        <div className="space-y-6 pt-2">
            {/* 全局计费配置 */}
            <div className="space-y-3">
                <SectionHeader
                    title={t('usage.globalPricingConfig')}
                    desc={t('usage.globalPricingConfigDesc')}
                    action={
                        <button
                            type="button"
                            className={primaryBtn}
                            onClick={handleSaveConfig}
                            disabled={setConfigMutation.isPending || !isDirty}
                        >
                            {setConfigMutation.isPending ? (
                                <>
                                    <span className="loading loading-spinner loading-xs" />
                                    {t('common.saving')}
                                </>
                            ) : (
                                t('common.save')
                            )}
                        </button>
                    }
                />

                <div className={tableWrap}>
                    <table className="table">
                        <thead className={thead}>
                            <tr>
                                <th className="w-32">{t('usage.appType')}</th>
                                <th>{t('usage.costMultiplier')}</th>
                                <th>{t('usage.pricingSource')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {PRICING_APPS.map((app) => {
                                // 每行读自己 app 的配置 —— 不能全用 selectedApp 的那份
                                const rowConfig = configs[app];
                                const isSelected = selectedApp === app;
                                return (
                                    <tr
                                        key={app}
                                        className={cn(
                                            row,
                                            'cursor-pointer',
                                            isSelected && 'bg-blue-500/5 dark:bg-blue-500/10'
                                        )}
                                        onClick={() => setSelectedApp(app)}
                                    >
                                        <td className="font-medium text-gray-900 dark:text-base-content">
                                            <span className="flex items-center gap-2">
                                                <span
                                                    className={cn(
                                                        'h-1.5 w-1.5 rounded-full',
                                                        isSelected
                                                            ? 'bg-blue-500'
                                                            : 'bg-gray-300 dark:bg-gray-600'
                                                    )}
                                                />
                                                {app.charAt(0).toUpperCase() + app.slice(1)}
                                            </span>
                                        </td>
                                        <td>
                                            {isSelected ? (
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    className="input input-sm input-bordered w-24 tabular-nums"
                                                    value={appConfig.multiplier}
                                                    onChange={(e) =>
                                                        setAppConfig({
                                                            ...appConfig,
                                                            multiplier: e.target.value,
                                                        })
                                                    }
                                                    disabled={setConfigMutation.isPending}
                                                />
                                            ) : (
                                                <span className="tabular-nums">
                                                    ×{rowConfig?.multiplier ?? '1'}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {isSelected ? (
                                                <select
                                                    className="select select-sm select-bordered w-32"
                                                    value={appConfig.source}
                                                    onChange={(e) =>
                                                        setAppConfig({
                                                            ...appConfig,
                                                            source: e.target
                                                                .value as PricingModelSource,
                                                        })
                                                    }
                                                    disabled={setConfigMutation.isPending}
                                                >
                                                    <option value="response">
                                                        {t('usage.responseModel')}
                                                    </option>
                                                    <option value="request">
                                                        {t('usage.requestModel')}
                                                    </option>
                                                </select>
                                            ) : (
                                                <span className={cn('text-xs', muted)}>
                                                    {(rowConfig?.source ?? 'response') === 'request'
                                                        ? t('usage.requestModel')
                                                        : t('usage.responseModel')}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="border-t border-gray-100 dark:border-base-200" />

            {/* 数据保留 */}
            <RetentionSection />

            <div className="border-t border-gray-100 dark:border-base-200" />

            {/* 模型定价配置 */}
            <div className="space-y-4">
                <SectionHeader
                    title={t('usage.modelPricing')}
                    desc={`${t('usage.modelPricingDesc')} ${t('usage.perMillion')}`}
                    action={
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                className={ghostBtn}
                                onClick={() => setImportModalOpen(true)}
                                disabled={importMutation.isPending}
                            >
                                <Download className="h-4 w-4" />
                                {t('usage.importModelsDev')}
                            </button>
                            <button type="button" className={primaryBtn} onClick={handleAddNew}>
                                <Plus className="h-4 w-4" />
                                {t('common.add')}
                            </button>
                        </div>
                    }
                />

                {pricing && pricing.length > 0 && (
                    /* 搜索与分组切换工具栏 */
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        {/* 搜索框 */}
                        <div className="relative min-w-[200px] max-w-xs flex-1">
                            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t('usage.searchModels')}
                                className="input input-sm input-bordered w-full pl-8 pr-7 text-xs"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>

                        {/* 分组切换胶囊 */}
                        <div className="flex flex-wrap items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => setSelectedGroup('all')}
                                className={cn(
                                    'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                                    selectedGroup === 'all'
                                        ? 'bg-primary text-primary-content'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-base-200 dark:text-gray-300 dark:hover:bg-base-300'
                                )}
                            >
                                {t('usage.allGroups')} ({pricing.length})
                            </button>
                            {activeGroups.map((g) => (
                                <button
                                    key={g.key}
                                    type="button"
                                    onClick={() => setSelectedGroup(g.key)}
                                    className={cn(
                                        'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                                        selectedGroup === g.key
                                            ? 'bg-primary text-primary-content'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-base-200 dark:text-gray-300 dark:hover:bg-base-300'
                                    )}
                                >
                                    {g.label} ({g.models.length})
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {!pricing || pricing.length === 0 ? (
                    <div className={card}>
                        <div className={emptyState}>
                            <Coins className="h-8 w-8 opacity-40" />
                            <span className="max-w-md text-center">{t('usage.noPricingData')}</span>
                        </div>
                    </div>
                ) : totalCount === 0 ? (
                    <div className={card}>
                        <div className={emptyState}>
                            <Search className="h-8 w-8 opacity-40" />
                            <span className="max-w-md text-center">{t('usage.noMatchingModels')}</span>
                        </div>
                    </div>
                ) : (
                    <div className={tableWrap}>
                        <table className="table">
                            <thead className={thead}>
                                <tr>
                                    <th>{t('usage.model')}</th>
                                    <th>{t('usage.displayName')}</th>
                                    <th className="text-right">{t('usage.inputCost')}</th>
                                    <th className="text-right">{t('usage.outputCost')}</th>
                                    <th className="text-right">{t('usage.cacheReadCost')}</th>
                                    <th className="text-right">{t('usage.cacheWriteCost')}</th>
                                    <th className="text-right">{t('common.action')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayedGroups.map((group) => {
                                    const isCollapsed = collapsedGroups.has(group.key);
                                    return (
                                        <Fragment key={group.key}>
                                            {/* 分组标题行 */}
                                            <tr
                                                className="cursor-pointer bg-gray-50/90 hover:bg-gray-100/90 dark:bg-base-200/60 dark:hover:bg-base-200 transition-colors select-none border-y border-gray-200/60 dark:border-base-300"
                                                onClick={() => toggleGroupCollapse(group.key)}
                                            >
                                                <td colSpan={7} className="py-2.5 px-4">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2 font-semibold text-xs text-gray-800 dark:text-gray-200">
                                                            {isCollapsed ? (
                                                                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                                                            ) : (
                                                                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                                                            )}
                                                            <span>{group.label}</span>
                                                            <span className="rounded-full bg-gray-200/80 px-2 py-0.5 text-[11px] font-normal text-gray-600 dark:bg-base-300 dark:text-gray-400">
                                                                {t('usage.modelsCount', { count: group.models.length })}
                                                            </span>
                                                        </div>
                                                        <span className="text-[11px] text-gray-400">
                                                            {isCollapsed
                                                                ? t('common.expand', { defaultValue: '展开' })
                                                                : t('common.collapse', { defaultValue: '折叠' })}
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>

                                            {/* 分组下的各模型条目 */}
                                            {!isCollapsed &&
                                                group.models.map((model) => (
                                                    <tr key={model.modelId} className={row}>
                                                        <td>
                                                            <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-800 dark:bg-base-200 dark:text-gray-100">
                                                                {model.modelId}
                                                            </code>
                                                        </td>
                                                        <td className="text-gray-700 dark:text-gray-200">
                                                            {model.displayName}
                                                        </td>
                                                        <td className="text-right font-mono text-xs tabular-nums">
                                                            ${model.inputCostPerMillion}
                                                        </td>
                                                        <td className="text-right font-mono text-xs tabular-nums">
                                                            ${model.outputCostPerMillion}
                                                        </td>
                                                        <td className="text-right font-mono text-xs tabular-nums">
                                                            ${model.cacheReadCostPerMillion}
                                                        </td>
                                                        <td className="text-right font-mono text-xs tabular-nums">
                                                            ${model.cacheCreationCostPerMillion}
                                                        </td>
                                                        <td className="text-right">
                                                            <div className="flex justify-end gap-1">
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-ghost btn-xs btn-square"
                                                                    onClick={() => {
                                                                        setIsAddingNew(false);
                                                                        setEditingModel(model);
                                                                    }}
                                                                    title={t('common.edit')}
                                                                    aria-label={t('common.edit')}
                                                                >
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-ghost btn-xs btn-square text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                                                    onClick={() => setDeleteConfirm(model.modelId)}
                                                                    title={t('common.delete')}
                                                                    aria-label={t('common.delete')}
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* 编辑弹窗 */}
            {editingModel && (
                <PricingEditModal
                    open={!!editingModel}
                    model={editingModel}
                    isNew={isAddingNew}
                    onClose={() => {
                        setEditingModel(null);
                        setIsAddingNew(false);
                    }}
                />
            )}

            {/* 删除确认弹窗 */}
            {deleteConfirm && (
                <dialog className="modal modal-open">
                    <div className="modal-box rounded-xl">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-base-content">
                            {t('usage.deleteConfirmTitle')}
                        </h3>
                        <p className={cn('py-4 text-sm', muted)}>{t('usage.deleteConfirmDesc')}</p>
                        <div className="modal-action">
                            <button
                                type="button"
                                className={ghostBtn}
                                onClick={() => setDeleteConfirm(null)}
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                className="btn btn-sm border-none bg-red-500 text-white hover:bg-red-600"
                                onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
                                disabled={deleteMutation.isPending}
                            >
                                {deleteMutation.isPending
                                    ? t('common.deleting')
                                    : t('common.delete')}
                            </button>
                        </div>
                    </div>
                    <form
                        method="dialog"
                        className="modal-backdrop"
                        onClick={() => setDeleteConfirm(null)}
                    >
                        <button>close</button>
                    </form>
                </dialog>
            )}

            {/* models.dev 导入确认弹窗 */}
            {importModalOpen && (
                <dialog className="modal modal-open">
                    <div className="modal-box rounded-xl">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-base-content">
                            {t('usage.importModelsDevTitle')}
                        </h3>
                        <p className={cn('py-3 text-sm', muted)}>
                            {t('usage.importModelsDevDesc')}
                        </p>
                        <div className="my-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3 dark:border-base-200 dark:bg-base-200/30">
                            <label className="flex cursor-pointer items-center gap-2">
                                <input
                                    type="checkbox"
                                    className="checkbox checkbox-primary checkbox-sm"
                                    checked={overwriteExisting}
                                    onChange={(e) => setOverwriteExisting(e.target.checked)}
                                    disabled={importMutation.isPending}
                                />
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                                    {t('usage.overwriteExistingPricing')}
                                </span>
                            </label>
                            <p className="mt-1.5 pl-6 text-xs text-gray-400 dark:text-gray-500">
                                {t('usage.overwriteExistingPricingTip')}
                            </p>
                        </div>
                        <div className="modal-action">
                            <button
                                type="button"
                                className={ghostBtn}
                                onClick={() => setImportModalOpen(false)}
                                disabled={importMutation.isPending}
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                className={primaryBtn}
                                onClick={handleImportModelsDev}
                                disabled={importMutation.isPending}
                            >
                                {importMutation.isPending ? (
                                    <>
                                        <span className="loading loading-spinner loading-xs" />
                                        {t('usage.importing')}
                                    </>
                                ) : (
                                    <>
                                        <Download className="h-4 w-4" />
                                        {t('usage.startImport')}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                    <form
                        method="dialog"
                        className="modal-backdrop"
                        onClick={() => !importMutation.isPending && setImportModalOpen(false)}
                    >
                        <button>close</button>
                    </form>
                </dialog>
            )}
        </div>
    );
}
