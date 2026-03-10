import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2, RefreshCw, ChevronDown, ExternalLink, X, Plus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import ModalDialog from '../common/ModalDialog';
import { showToast } from '../common/ToastContainer';
import { useProviderStore } from '../../stores/useProviderStore';
import { Provider, ProviderProxyConfig } from '../../types/provider';
import { AppType, VISIBLE_APP_TYPES, APP_LABELS } from '../../types/app';
import ProviderProxyConfigInput from './ProviderProxyConfig';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

function LabelText({ children, className }: { children: React.ReactNode, className?: string }) {
    return (
        <label className={cn("text-sm font-medium leading-none text-gray-700 dark:text-slate-200", className)}>
            {children}
        </label>
    );
}

function TextInput({ className, ...props }: any) {
    return (
        <input
            className={cn("flex h-9 w-full rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900/50 px-3 py-1 text-sm text-gray-900 dark:text-slate-200 shadow-sm transition-colors placeholder:text-gray-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50", className)}
            {...props}
        />
    );
}

interface ProviderFormProps {
    isOpen: boolean;
    editingProvider?: Provider | null;
    onClose: () => void;
    defaultAppType?: AppType;
}

const PRESETS = [
    { label: 'Claude Official', url: 'https://api.anthropic.com', appType: 'claude' as AppType },
    { label: 'OpenRouter', url: 'https://openrouter.ai/api', appType: 'claude' as AppType },
];

export default function ProviderForm({ isOpen, editingProvider, onClose, defaultAppType = 'claude' }: ProviderFormProps) {
    const { t } = useTranslation();
    const { addProvider, updateProvider } = useProviderStore();
    const isEditing = !!editingProvider;

    const [name, setName] = useState(editingProvider?.name || '');
    const [appType, setAppType] = useState<AppType>(editingProvider?.appType || defaultAppType);
    const [apiKey, setApiKey] = useState(editingProvider?.apiKey || '');
    const [url, setUrl] = useState(editingProvider?.url || 'https://api.anthropic.com');
    const [defaultSonnetModel, setDefaultSonnetModel] = useState(editingProvider?.defaultSonnetModel || '');
    const [defaultOpusModel, setDefaultOpusModel] = useState(editingProvider?.defaultOpusModel || '');
    const [defaultHaikuModel, setDefaultHaikuModel] = useState(editingProvider?.defaultHaikuModel || '');
    const [defaultReasoningModel, setDefaultReasoningModel] = useState(editingProvider?.defaultReasoningModel || '');
    const [description, setDescription] = useState(editingProvider?.description || '');
    const [tags, setTags] = useState<string[]>(editingProvider?.tags || []);
    const [proxyConfig, setProxyConfig] = useState<ProviderProxyConfig>(() => {
        if (editingProvider?.proxyConfig) {
            return editingProvider.proxyConfig;
        }
        return { enabled: false };
    });
    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [fetchedModels, setFetchedModels] = useState<string[]>([]);
    const [fetchModelsLoading, setFetchModelsLoading] = useState(false);

    // This state actually holds the true internal settingsConfig object for the database.
    const [internalSettings, setInternalSettings] = useState<any>(() => {
        if (editingProvider?.settingsConfig) {
            return JSON.parse(JSON.stringify(editingProvider.settingsConfig));
        }
        return {
            alwaysThinkingEnabled: false,
            teammatesMode: false,
            disableNonessentialTraffic: false,
            disableAttributionHeader: false,
            maxOutputTokens: '',
        };
    });

    useEffect(() => {
        if (isOpen) {
            setName(editingProvider?.name || '');
            setAppType(editingProvider?.appType || defaultAppType);
            setApiKey(editingProvider?.apiKey || '');
            setUrl(editingProvider?.url || 'https://api.anthropic.com');
            setDefaultSonnetModel(editingProvider?.defaultSonnetModel || '');
            setDefaultOpusModel(editingProvider?.defaultOpusModel || '');
            setDefaultHaikuModel(editingProvider?.defaultHaikuModel || '');
            setDefaultReasoningModel(editingProvider?.defaultReasoningModel || '');
            setDescription(editingProvider?.description || '');
            setTags(editingProvider?.tags || []);
            if (editingProvider?.proxyConfig) {
                setProxyConfig(editingProvider.proxyConfig);
            } else {
                setProxyConfig({ enabled: false });
            }
            setShowKey(false);
            setFetchedModels([]);
            
            if (editingProvider?.settingsConfig) {
                setInternalSettings(JSON.parse(JSON.stringify(editingProvider.settingsConfig)));
            } else {
                setInternalSettings({
                    alwaysThinkingEnabled: false,
                    teammatesMode: false,
                    disableNonessentialTraffic: false,
                    disableAttributionHeader: false,
                    maxOutputTokens: '',
                });
            }

            // 对 Claude 类型，从当前 settings.json 读取 checkbox 状态
            // 用文件实际值填充 Provider 未显式保存的新字段
            const currentAppType = editingProvider?.appType || defaultAppType;
            if (currentAppType === 'claude') {
                invoke<any>('get_claude_settings_state').then(fileState => {
                    setInternalSettings((prev: any) => {
                        const saved = editingProvider?.settingsConfig || {};
                        const merged = { ...prev };
                        // 对每个已知字段：如果 Provider 没有显式保存过，用文件当前值
                        const knownKeys = ['alwaysThinkingEnabled', 'teammatesMode', 'disableNonessentialTraffic', 'disableAttributionHeader', 'maxOutputTokens'];
                        for (const key of knownKeys) {
                            if (!(key in saved)) {
                                merged[key] = fileState[key];
                            }
                        }
                        return merged;
                    });
                }).catch(() => {});
            }
        }
    }, [isOpen, editingProvider, defaultAppType]);

    const applyPreset = (preset: typeof PRESETS[number]) => {
        if (preset.url) {
            setUrl(preset.url);
        }
        setAppType(preset.appType);
    };

    const handleSave = async () => {
        const finalApiKey = apiKey.trim();
        const finalUrl = url.trim();
        const finalName = name.trim();

        if (!finalName || !finalApiKey) {
            showToast(t('providers.error_required', '请填写名称和 API Key'), 'error');
            return;
        }

        setSaving(true);
        try {
            const data = {
                name: finalName,
                appType,
                apiKey: finalApiKey,
                url: finalUrl || undefined,
                defaultSonnetModel: defaultSonnetModel.trim() || undefined,
                defaultOpusModel: defaultOpusModel.trim() || undefined,
                defaultHaikuModel: defaultHaikuModel.trim() || undefined,
                defaultReasoningModel: defaultReasoningModel.trim() || undefined,
                description: description.trim() || undefined,
                tags: tags.length > 0 ? tags : undefined,
                settingsConfig: (() => {
                    // 只保存白名单内的已知字段，排除历史残留
                    const known = ['alwaysThinkingEnabled', 'teammatesMode', 'disableNonessentialTraffic', 'disableAttributionHeader', 'maxOutputTokens'];
                    const clean: Record<string, any> = {};
                    if (internalSettings) {
                        for (const k of known) {
                            if (k in internalSettings) clean[k] = internalSettings[k];
                        }
                    }
                    return Object.keys(clean).length > 0 ? clean : undefined;
                })(),
                proxyConfig: proxyConfig.enabled ? proxyConfig : undefined,
            };

            if (isEditing && editingProvider) {
                await updateProvider(editingProvider.id, data);
                showToast(t('providers.update_success', 'Provider 更新成功'), 'success');
            } else {
                await addProvider(data);
                showToast(t('providers.add_success', 'Provider 添加成功'), 'success');
            }
            onClose();
        } catch (error) {
            showToast((isEditing ? '更新失败: ' : '添加失败: ') + error, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleCheckboxChange = (field: string, checked: boolean) => {
        setInternalSettings((prev: any) => ({
            ...prev,
            [field]: checked
        }));
    };

    // ============================================
    // 实时配置预览 - 调用后端获取原始 + 预览内容，逐行 diff 高亮
    // ============================================
    const [previewData, setPreviewData] = useState<{ title: string; content: string; originalContent: string }[]>([]);
    // 首次打开表单时的初始预览，作为 diff baseline（对比用户在表单中做的变更）
    const initialPreviewRef = useRef<Record<string, string>>({});

    // 构建用于预览的 Provider 对象（仅包含已知配置字段，排除历史残留字段）
    const buildPreviewProvider = useCallback(() => {
        // 白名单：只有这些字段可以写入 settingsConfig 传给后端
        const knownFields: Record<string, any> = {
            alwaysThinkingEnabled: false,
            teammatesMode: false,
            disableNonessentialTraffic: false,
            disableAttributionHeader: false,
            maxOutputTokens: '',
        };
        const filteredSettings: Record<string, any> = {};
        if (internalSettings) {
            for (const [k, v] of Object.entries(internalSettings)) {
                if (!(k in knownFields)) continue; // 跳过不在白名单中的字段（如历史残留的 enabledPlugins）
                const def = knownFields[k];
                if (typeof def === 'boolean') {
                    filteredSettings[k] = v; // 布尔字段始终发送，确保 true/false 都能明确生效
                } else if (typeof def === 'string' && v && (v as string).trim() !== '') {
                    filteredSettings[k] = v;
                }
            }
        }

        return {
            id: editingProvider?.id || '__preview__',
            name: name || 'Preview',
            appType,
            apiKey: apiKey || 'your-api-key-here',
            url: url.trim() || undefined,
            defaultSonnetModel: defaultSonnetModel.trim() || undefined,
            defaultOpusModel: defaultOpusModel.trim() || undefined,
            defaultHaikuModel: defaultHaikuModel.trim() || undefined,
            defaultReasoningModel: defaultReasoningModel.trim() || undefined,
            settingsConfig: Object.keys(filteredSettings).length > 0 ? filteredSettings : undefined,
            isActive: false,
            createdAt: editingProvider?.createdAt || new Date().toISOString(),
        };
    }, [editingProvider, name, appType, apiKey, url, defaultSonnetModel, defaultOpusModel, defaultHaikuModel, defaultReasoningModel, internalSettings]);

    // 防抖调用后端：获取预览结果，首次结果作为 baseline
    useEffect(() => {
        if (!isOpen) {
            // 表单关闭时重置初始预览
            initialPreviewRef.current = {};
            return;
        }

        const timer = setTimeout(async () => {
            try {
                const provider = buildPreviewProvider();
                const files = await invoke<[string, string, string][]>('preview_provider_sync', { provider });
                const isFirstLoad = Object.keys(initialPreviewRef.current).length === 0;

                if (isFirstLoad) {
                    // 首次加载：保存当前预览内容作为 baseline
                    const baselineMap: Record<string, string> = {};
                    files.forEach(([title, content]) => {
                        baselineMap[title] = content;
                    });
                    initialPreviewRef.current = baselineMap;
                }

                setPreviewData(files.map(([title, content]) => ({
                    title,
                    content,
                    // baseline 使用首次加载时的预览（而非当前文件内容）
                    originalContent: initialPreviewRef.current[title] || content,
                })));
            } catch (err) {
                console.warn('Preview failed:', err);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [isOpen, buildPreviewProvider]);

    return (
        <ModalDialog
            isOpen={isOpen}
            title={isEditing ? t('providers.edit_title', '编辑 Provider') : t('providers.add_title', '添加 Provider')}
            onConfirm={handleSave}
            onCancel={onClose}
            onClose={onClose}
            confirmText={saving ? t('common.saving', '保存中...') : t('common.save', '保存')}
            maxWidthClass="max-w-[1400px]"
        >
            {/* 预设选择 */}
            {!isEditing && (
                <div className="flex gap-2 mb-4">
                    {PRESETS.map((preset) => (
                        <button
                            key={preset.label}
                            type="button"
                            onClick={() => applyPreset(preset)}
                            className="inline-flex h-7 items-center justify-center rounded-md border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 px-3 text-xs font-medium shadow-sm transition-colors hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-slate-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex flex-col lg:flex-row gap-8 min-h-[500px]">
                {/* 左侧：基本配置和模型 */}
                <div className="flex-[0.9] min-w-0 space-y-5">
                    {/* 名称和应用类型 */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <LabelText>{t('providers.field_name', '名称')}</LabelText>
                            <TextInput
                                placeholder="My Provider"
                                value={name}
                                onChange={(e: any) => setName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <LabelText>{t('providers.field_app_type', '应用类型')}</LabelText>
                            <select
                                className="flex h-9 w-full items-center justify-between rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900/50 px-3 py-2 text-sm text-gray-900 dark:text-slate-200 shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                                value={appType}
                                onChange={(e) => setAppType(e.target.value as AppType)}
                            >
                                {VISIBLE_APP_TYPES.map((type) => (
                                    <option key={type} value={type} className="bg-white dark:bg-slate-900">{APP_LABELS[type]}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* API Key */}
                    <div className="space-y-2">
                        <LabelText>API Key</LabelText>
                        <div className="relative">
                            <TextInput
                                type={showKey ? 'text' : 'password'}
                                className="font-mono pr-10"
                                placeholder="sk-..."
                                value={apiKey}
                                onChange={(e: any) => setApiKey(e.target.value)}
                            />
                            <button
                                type="button"
                                onClick={() => setShowKey(!showKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200"
                            >
                                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    {/* URL */}
                    <div className="space-y-2">
                        <LabelText>URL</LabelText>
                        <div className="relative">
                            <TextInput
                                type="text"
                                className="font-mono pr-10"
                                placeholder="https://api.anthropic.com"
                                value={url}
                                onChange={(e: any) => setUrl(e.target.value)}
                            />
                            {url.trim() && (
                                <button
                                    type="button"
                                    tabIndex={-1}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400/60 hover:text-blue-400 transition-colors"
                                    title={t('providers.openUrl', '在浏览器中打开')}
                                    onClick={() => {
                                        try {
                                            const u = url.trim();
                                            if (u.startsWith('http://') || u.startsWith('https://')) {
                                                window.open(u, '_blank');
                                            }
                                        } catch { /* ignore */ }
                                    }}
                                >
                                    <ExternalLink className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* 模型配置区 */}
                    <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                            <LabelText>{t('providers.modelConfig', '模型配置')}</LabelText>
                            <button
                                type="button"
                                onClick={async () => {
                                    if (!url.trim() || !apiKey.trim()) {
                                        showToast(t('providers.fetchModelsNeedUrlKey', '请先填写 URL 和 API Key'), 'error');
                                        return;
                                    }
                                    setFetchModelsLoading(true);
                                    try {
                                        const models = await invoke<string[]>('fetch_models', { url: url.trim(), apiKey: apiKey.trim() });
                                        setFetchedModels(models);
                                        showToast(t('providers.fetchModelsSuccess', { count: models.length }), 'success');
                                    } catch (error) {
                                        showToast(`${t('providers.fetchModelsFailed', '获取模型失败')}: ${String(error)}`, 'error');
                                    } finally {
                                        setFetchModelsLoading(false);
                                    }
                                }}
                                disabled={fetchModelsLoading || !url.trim() || !apiKey.trim()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 border border-blue-500/60 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {fetchModelsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                {t('providers.fetchModels', '获取模型')}
                            </button>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                            {/* We maintain only the original 4 models to match what the user expected */}
                            <ModelComboBox
                                label="Sonnet Model"
                                placeholder="claude-sonnet-4-..."
                                value={defaultSonnetModel}
                                onChange={(v) => setDefaultSonnetModel(v)}
                                options={fetchedModels}
                            />
                            <ModelComboBox
                                label="Opus Model"
                                placeholder="claude-opus-4-..."
                                value={defaultOpusModel}
                                onChange={(v) => setDefaultOpusModel(v)}
                                options={fetchedModels}
                            />
                            <ModelComboBox
                                label="Haiku Model"
                                placeholder="claude-haiku-..."
                                value={defaultHaikuModel}
                                onChange={(v) => setDefaultHaikuModel(v)}
                                options={fetchedModels}
                            />
                            <ModelComboBox
                                label={t('providers.reasoningModel', '推理模型 (Thinking)')}
                                placeholder="claude-sonnet-4-..."
                                value={defaultReasoningModel}
                                onChange={(v) => setDefaultReasoningModel(v)}
                                options={fetchedModels}
                            />
                        </div>
                    </div>

                    {/* 标签 */}
                    <div className="space-y-2 pt-2">
                        <LabelText>{t('providers.tags', '标签')}</LabelText>
                        <TagInput
                            tags={tags}
                            onChange={setTags}
                            placeholder={t('providers.tagPlaceholder', '输入标签后回车添加')}
                        />
                    </div>

                    {/* 描述 */}
                    <div className="space-y-2 pt-2">
                        <LabelText>{t('providers.field_description', '描述')}</LabelText>
                        <textarea
                            className="flex min-h-[60px] w-full rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900/50 px-3 py-2 text-sm text-gray-900 dark:text-slate-200 shadow-sm placeholder:text-gray-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                            placeholder={t('providers.desc_placeholder', '可选描述...')}
                            rows={2}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>

                    {/* 代理配置 */}
                    <ProviderProxyConfigInput
                        value={proxyConfig}
                        onChange={setProxyConfig}
                    />
                </div>

                {/* 右侧：生成预览 */}
                <div className="flex-[1.1] min-w-0 flex flex-col pt-2 lg:pt-0 pb-1">
                    <div className="flex items-center justify-between mb-4 mt-4 lg:mt-0">
                        <LabelText className="font-bold">配置预览 (切换后完整文件内容)</LabelText>
                    </div>

                    {/* 快捷配置按钮组 */}
                    {appType === 'claude' && (
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4 px-4 py-3 bg-gray-50 dark:bg-slate-800/50 rounded-md border border-gray-200 dark:border-slate-700/50">
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900/50 text-blue-500 focus:ring-blue-500 focus:ring-offset-white dark:focus:ring-offset-slate-900 cursor-pointer"
                                    checked={!!internalSettings.alwaysThinkingEnabled}
                                    onChange={(e) => handleCheckboxChange('alwaysThinkingEnabled', e.target.checked)}
                                />
                                <span className="text-xs text-gray-600 dark:text-slate-300 group-hover:text-gray-900 dark:group-hover:text-slate-200 transition-colors">扩展思考</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900/50 text-blue-500 focus:ring-blue-500 focus:ring-offset-white dark:focus:ring-offset-slate-900 cursor-pointer"
                                    checked={!!internalSettings.teammatesMode}
                                    onChange={(e) => handleCheckboxChange('teammatesMode', e.target.checked)}
                                />
                                <span className="text-xs text-gray-600 dark:text-slate-300 group-hover:text-gray-900 dark:group-hover:text-slate-200 transition-colors">Teammates 模式</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900/50 text-blue-500 focus:ring-blue-500 focus:ring-offset-white dark:focus:ring-offset-slate-900 cursor-pointer"
                                    checked={!!internalSettings.disableNonessentialTraffic}
                                    onChange={(e) => handleCheckboxChange('disableNonessentialTraffic', e.target.checked)}
                                />
                                <span className="text-xs text-gray-600 dark:text-slate-300 group-hover:text-gray-900 dark:group-hover:text-slate-200 transition-colors">禁用非必要流量</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900/50 text-blue-500 focus:ring-blue-500 focus:ring-offset-white dark:focus:ring-offset-slate-900 cursor-pointer"
                                    checked={!!internalSettings.disableAttributionHeader}
                                    onChange={(e) => handleCheckboxChange('disableAttributionHeader', e.target.checked)}
                                />
                                <span className="text-xs text-gray-600 dark:text-slate-300 group-hover:text-gray-900 dark:group-hover:text-slate-200 transition-colors">禁用归因头</span>
                            </label>
                            <label className="flex items-center gap-2 group">
                                <span className="text-xs text-gray-600 dark:text-slate-300 whitespace-nowrap">最大输出 Tokens</span>
                                <input
                                    type="text"
                                    className="h-7 w-24 rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900/50 px-2 text-xs text-gray-900 dark:text-slate-200 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                                    placeholder="如 100000"
                                    value={internalSettings.maxOutputTokens || ''}
                                    onChange={(e) => {
                                        const val = e.target.value.replace(/[^0-9]/g, '');
                                        setInternalSettings((prev: any) => ({ ...prev, maxOutputTokens: val }));
                                    }}
                                />
                            </label>
                        </div>
                    )}

                    <div className="flex flex-col gap-4">
                        {previewData.map((file, idx) => {
                            const stripComma = (s: string) => s.replace(/,\s*$/, '');
                            const previewLines = file.content.split('\n');
                            const originalSet = new Set(file.originalContent.split('\n').map(stripComma));
                            const changedCount = previewLines.filter(line => !originalSet.has(stripComma(line))).length;

                            return (
                                <div key={idx} className="relative rounded-md border border-gray-200 dark:border-slate-700 overflow-hidden bg-gray-50 dark:bg-[#1e1e2e]">
                                    <div className="flex items-center justify-between bg-gray-100 dark:bg-slate-800/80 px-3 py-1.5 border-b border-gray-200 dark:border-slate-700">
                                        <span className="text-xs font-mono text-gray-600 dark:text-slate-300">{file.title}</span>
                                        {changedCount > 0 && (
                                            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400/80 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                                {changedCount} 行变更
                                            </span>
                                        )}
                                    </div>
                                    <div className="p-0 overflow-x-auto">
                                        {previewLines.map((line, lineIdx) => {
                                            const isNew = !originalSet.has(stripComma(line));

                                            return (
                                                <div
                                                    key={lineIdx}
                                                    className={cn(
                                                        "flex font-mono text-[13px] leading-[1.7] border-l-2",
                                                        isNew
                                                            ? "bg-emerald-500/10 border-l-emerald-400 text-emerald-700 dark:text-emerald-300"
                                                            : "border-l-transparent text-gray-800 dark:text-[#cdd6f4]"
                                                    )}
                                                >
                                                    <span className="select-none w-8 shrink-0 text-right pr-2 text-[11px] text-gray-400 dark:text-slate-600 leading-[1.7]">
                                                        {lineIdx + 1}
                                                    </span>
                                                    <span className="px-3 whitespace-pre">{line || ' '}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </ModalDialog>
    );
}

/** Custom styled model combo box with dropdown selection + custom text input */
function ModelComboBox({ label, placeholder, value, onChange, options }: {
    label: string;
    placeholder: string;
    value: string;
    onChange: (v: string) => void;
    options: string[];
}) {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState<string | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
                setFilter(null);
            }
        };
        if (open) document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    // When filter is null → show all; when filter is a string → filter by it
    const filtered = filter === null
        ? options
        : options.filter(m => m.toLowerCase().includes(filter.toLowerCase()));

    const hasOptions = options.length > 0;

    return (
        <div ref={wrapperRef} className="space-y-2 relative">
            <label className="text-[11px] font-medium leading-none text-gray-600 dark:text-slate-300">{label}</label>
            <div className="relative">
                <input
                    type="text"
                    className="flex h-9 w-full rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900/50 px-3 py-1 font-mono text-xs pr-8 text-gray-900 dark:text-slate-200 shadow-sm transition-colors placeholder:text-gray-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                    placeholder={placeholder}
                    value={filter !== null ? filter : value}
                    onChange={(e) => {
                        setFilter(e.target.value);
                        onChange(e.target.value);
                        if (!open && hasOptions) setOpen(true);
                    }}
                    onFocus={() => {
                        if (hasOptions) {
                            setOpen(true);
                            setFilter(null);
                        }
                    }}
                />
                {hasOptions && (
                    <button
                        type="button"
                        tabIndex={-1}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 transition-transform"
                        style={{ transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)` }}
                        onClick={() => { setOpen(!open); setFilter(null); }}
                    >
                        <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
            {open && hasOptions && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg overflow-hidden">
                    <ul className="max-h-48 overflow-y-auto py-1 text-xs font-mono">
                        {filtered.length === 0 ? (
                            <li className="px-3 py-2 text-gray-400 dark:text-slate-400 text-center">No matching models</li>
                        ) : (
                            filtered.map((m) => (
                                <li
                                    key={m}
                                    className={`px-3 py-1.5 cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors ${m === value ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-semibold' : 'text-gray-700 dark:text-slate-300'}`}
                                    onClick={() => {
                                        onChange(m);
                                        setOpen(false);
                                        setFilter(null);
                                    }}
                                >
                                    {m}
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}

/** 标签输入组件：支持历史标签建议、输入过滤、回车/点击添加 */
function TagInput({ tags, onChange, placeholder }: {
    tags: string[];
    onChange: (tags: string[]) => void;
    placeholder: string;
}) {
    const { providers } = useProviderStore();
    const [input, setInput] = useState('');
    const [focused, setFocused] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // 收集所有 Provider 中使用过的标签（去重 + 排序）
    const allHistoryTags = useMemo(() => {
        const set = new Set<string>();
        providers.forEach(p => p.tags?.forEach(t => set.add(t)));
        return Array.from(set).sort();
    }, [providers]);

    // 根据输入过滤建议（排除已选中的）
    const suggestions = useMemo(() => {
        const available = allHistoryTags.filter(t => !tags.includes(t));
        const q = input.trim().toLowerCase();
        if (!q) return available;
        return available.filter(t => t.toLowerCase().includes(q));
    }, [allHistoryTags, tags, input]);

    const addTag = (tag: string) => {
        const v = tag.trim();
        if (v && !tags.includes(v)) {
            onChange([...tags, v]);
        }
        setInput('');
    };

    const removeTag = (tag: string) => {
        onChange(tags.filter(t => t !== tag));
    };

    // 点击外部关闭建议
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setFocused(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const showSuggestions = focused && suggestions.length > 0;

    return (
        <div ref={wrapperRef} className="space-y-2">
            {/* 输入框 */}
            <div className="relative">
                <input
                    type="text"
                    className="flex h-9 w-full rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900/50 px-3 py-1 text-sm text-gray-900 dark:text-slate-200 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                    placeholder={placeholder}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            addTag(input);
                        }
                    }}
                />
                {/* 建议下拉 */}
                {showSuggestions && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg overflow-hidden">
                        <ul className="max-h-36 overflow-y-auto py-1">
                            {suggestions.map((tag) => (
                                <li
                                    key={tag}
                                    className="px-3 py-1.5 text-xs text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-slate-100 cursor-pointer transition-colors"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        addTag(tag);
                                    }}
                                >
                                    {tag}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* 已选标签 + 快捷历史标签 */}
            <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                    <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/15 text-blue-400 border border-blue-500/25"
                    >
                        {tag}
                        <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="hover:text-blue-300 focus:outline-none"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </span>
                ))}
                {/* 未选中的历史标签，作为快捷添加 */}
                {allHistoryTags
                    .filter(t => !tags.includes(t))
                    .map((tag) => (
                        <button
                            key={tag}
                            type="button"
                            onClick={() => addTag(tag)}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-500 border border-gray-200 dark:border-slate-600/30 hover:bg-gray-200 dark:hover:bg-slate-700/70 hover:text-gray-700 dark:hover:text-slate-300 hover:border-gray-300 dark:hover:border-slate-500/50 transition-colors"
                        >
                            <Plus className="w-2.5 h-2.5" />
                            {tag}
                        </button>
                    ))
                }
            </div>
        </div>
    );
}
