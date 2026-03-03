import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2, RefreshCw, ChevronDown } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import ModalDialog from '../common/ModalDialog';
import { showToast } from '../common/ToastContainer';
import { useProviderStore } from '../../stores/useProviderStore';
import { Provider } from '../../types/provider';
import { AppType, VISIBLE_APP_TYPES, APP_LABELS } from '../../types/app';

interface ProviderFormProps {
    isOpen: boolean;
    editingProvider?: Provider | null;
    onClose: () => void;
    defaultAppType?: AppType;
}

const PRESETS = [
    { label: 'Claude Official', url: 'https://api.anthropic.com', appType: 'claude' as AppType },
    { label: 'OpenRouter', url: 'https://openrouter.ai/api', appType: 'claude' as AppType },
    { label: 'Custom', url: '', appType: 'claude' as AppType },
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
    const [description, setDescription] = useState(editingProvider?.description || '');
    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [fetchedModels, setFetchedModels] = useState<string[]>([]);
    const [fetchModelsLoading, setFetchModelsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setName(editingProvider?.name || '');
            setAppType(editingProvider?.appType || defaultAppType);
            setApiKey(editingProvider?.apiKey || '');
            setUrl(editingProvider?.url || 'https://api.anthropic.com');
            setDefaultSonnetModel(editingProvider?.defaultSonnetModel || '');
            setDefaultOpusModel(editingProvider?.defaultOpusModel || '');
            setDefaultHaikuModel(editingProvider?.defaultHaikuModel || '');
            setDescription(editingProvider?.description || '');
            setShowKey(false);
            setFetchedModels([]);
        }
    }, [isOpen, editingProvider]);

    const applyPreset = (preset: typeof PRESETS[number]) => {
        if (preset.url) setUrl(preset.url);
        setAppType(preset.appType);
    };

    const handleSave = async () => {
        if (!name.trim() || !apiKey.trim()) {
            showToast(t('providers.error_required', '请填写名称和 API Key'), 'error');
            return;
        }
        setSaving(true);
        try {
            const data = {
                name: name.trim(),
                appType,
                apiKey: apiKey.trim(),
                url: url.trim() || undefined,
                defaultSonnetModel: defaultSonnetModel.trim() || undefined,
                defaultOpusModel: defaultOpusModel.trim() || undefined,
                defaultHaikuModel: defaultHaikuModel.trim() || undefined,
                description: description.trim() || undefined,
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

    return (
        <ModalDialog
            isOpen={isOpen}
            title={isEditing ? t('providers.edit_title', '编辑 Provider') : t('providers.add_title', '添加 Provider')}
            onConfirm={handleSave}
            onCancel={onClose}
            onClose={onClose}
            confirmText={saving ? t('common.saving', '保存中...') : t('common.save', '保存')}
        >
            {/* 预设选择 */}
            {!isEditing && (
                <div className="flex gap-2 mb-4">
                    {PRESETS.map((preset) => (
                        <button
                            key={preset.label}
                            type="button"
                            onClick={() => applyPreset(preset)}
                            className="btn btn-xs btn-outline"
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
            )}

            <div className="space-y-3">
                {/* 名称 */}
                <div>
                    <label className="label label-text text-xs font-medium">{t('providers.field_name', '名称')}</label>
                    <input
                        type="text"
                        className="input input-bordered input-sm w-full"
                        placeholder="My Provider"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>

                {/* 应用类型 */}
                <div>
                    <label className="label label-text text-xs font-medium">{t('providers.field_app_type', '应用类型')}</label>
                    <select
                        className="select select-bordered select-sm w-full"
                        value={appType}
                        onChange={(e) => setAppType(e.target.value as AppType)}
                    >
                        {VISIBLE_APP_TYPES.map((type) => (
                            <option key={type} value={type}>{APP_LABELS[type]}</option>
                        ))}
                    </select>
                </div>

                {/* API Key */}
                <div>
                    <label className="label label-text text-xs font-medium">API Key</label>
                    <div className="relative">
                        <input
                            type={showKey ? 'text' : 'password'}
                            className="input input-bordered input-sm w-full font-mono text-xs pr-10"
                            placeholder="sk-..."
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                        />
                        <button
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/50 hover:text-base-content"
                        >
                            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                </div>

                {/* URL */}
                <div>
                    <label className="label label-text text-xs font-medium">URL</label>
                    <input
                        type="text"
                        className="input input-bordered input-sm w-full font-mono text-xs"
                        placeholder="https://api.anthropic.com"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                    />
                </div>

                {/* 模型配置 */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="label label-text text-xs font-medium">{t('providers.modelConfig', '模型配置')}</label>
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
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 border border-blue-500/60 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                        >
                            {fetchModelsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            {t('providers.fetchModels', '获取模型')}
                        </button>
                    </div>
                    <ModelComboBox
                        label="Sonnet Model"
                        placeholder="claude-sonnet-4-..."
                        value={defaultSonnetModel}
                        onChange={setDefaultSonnetModel}
                        options={fetchedModels}
                    />
                    <ModelComboBox
                        label="Opus Model"
                        placeholder="claude-opus-4-..."
                        value={defaultOpusModel}
                        onChange={setDefaultOpusModel}
                        options={fetchedModels}
                    />
                    <ModelComboBox
                        label="Haiku Model"
                        placeholder="claude-haiku-..."
                        value={defaultHaikuModel}
                        onChange={setDefaultHaikuModel}
                        options={fetchedModels}
                    />
                </div>

                {/* 描述 */}
                <div>
                    <label className="label label-text text-xs font-medium">{t('providers.field_description', '描述')}</label>
                    <textarea
                        className="textarea textarea-bordered textarea-sm w-full text-xs"
                        placeholder={t('providers.desc_placeholder', '可选描述...')}
                        rows={2}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
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
        <div ref={wrapperRef} className="relative">
            <label className="label label-text text-xs font-medium">{label}</label>
            <div className="relative">
                <input
                    type="text"
                    className="input input-bordered input-sm w-full font-mono text-xs pr-8"
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
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-base-content/40 hover:text-base-content transition-transform"
                        style={{ transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)` }}
                        onClick={() => { setOpen(!open); setFilter(null); }}
                    >
                        <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
            {open && hasOptions && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-base-300 bg-base-100 shadow-lg overflow-hidden">
                    <ul className="max-h-48 overflow-y-auto py-1 text-xs font-mono">
                        {filtered.length === 0 ? (
                            <li className="px-3 py-2 text-base-content/50 text-center">No matching models</li>
                        ) : (
                            filtered.map((m) => (
                                <li
                                    key={m}
                                    className={`px-3 py-1.5 cursor-pointer hover:bg-primary/20 transition-colors ${m === value ? 'bg-primary/10 text-primary font-semibold' : 'text-base-content'}`}
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
