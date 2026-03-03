import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Zap, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { showToast } from '../common/ToastContainer';
import { VISIBLE_APP_TYPES, APP_LABELS, APP_COLORS, AppType } from '../../types/app';

interface UniversalProviderConfig {
    name: string;
    apiKey: string;
    url?: string;
    targetApps: string[];
    description?: string;
}

interface UniversalProviderPanelProps {
    onClose?: () => void;
}

export default function UniversalProviderPanel({ onClose }: UniversalProviderPanelProps) {
    const { t } = useTranslation();

    const [name, setName] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [url, setUrl] = useState('');
    const [description, setDescription] = useState('');
    const [targetApps, setTargetApps] = useState<AppType[]>([...VISIBLE_APP_TYPES]);
    const [showKey, setShowKey] = useState(false);
    const [applying, setApplying] = useState(false);

    const toggleApp = (app: AppType) => {
        setTargetApps(prev =>
            prev.includes(app) ? prev.filter(a => a !== app) : [...prev, app]
        );
    };

    const handleApply = async () => {
        if (!name.trim()) {
            showToast(t('providers.universal.error_name', 'Provider 名称不能为空'), 'error');
            return;
        }
        if (!apiKey.trim()) {
            showToast(t('providers.universal.error_key', 'API Key 不能为空'), 'error');
            return;
        }
        if (targetApps.length === 0) {
            showToast(t('providers.universal.error_apps', '至少选择一个应用'), 'error');
            return;
        }

        setApplying(true);
        try {
            const config: UniversalProviderConfig = {
                name: name.trim(),
                apiKey: apiKey.trim(),
                url: url.trim() || undefined,
                targetApps,
                description: description.trim() || undefined,
            };
            const addedIds = await invoke<string[]>('apply_universal_provider', { config });
            showToast(
                t('providers.universal.success', '已为 {{count}} 个应用添加 Provider', { count: addedIds.length }),
                'success'
            );
            onClose?.();
        } catch (error) {
            showToast(t('providers.universal.error_apply', '应用失败: ') + error, 'error');
        } finally {
            setApplying(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* 标题说明 */}
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Zap className="w-4 h-4 text-yellow-500" />
                <span>{t('providers.universal.hint', '一次性为多个应用配置相同的 Provider 信息')}</span>
            </div>

            {/* Provider 名称 */}
            <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('providers.field_name', '名称')} <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    className="input input-bordered input-sm w-full"
                    placeholder="My Universal Provider"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>

            {/* API Key */}
            <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    API Key <span className="text-red-500">*</span>
                </label>
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

            {/* Base URL */}
            <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Base URL <span className="text-gray-400 font-normal">({t('common.optional', '可选')})</span>
                </label>
                <input
                    type="text"
                    className="input input-bordered input-sm w-full font-mono text-xs"
                    placeholder="https://api.anthropic.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                />
            </div>

            {/* 描述 */}
            <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('providers.field_description', '描述')} <span className="text-gray-400 font-normal">({t('common.optional', '可选')})</span>
                </label>
                <input
                    type="text"
                    className="input input-bordered input-sm w-full"
                    placeholder={t('providers.desc_placeholder', '可选描述...')}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                />
            </div>

            {/* 应用选择 */}
            <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('providers.universal.target_apps', '目标应用')} <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                    {VISIBLE_APP_TYPES.map((app) => {
                        const checked = targetApps.includes(app);
                        const color = APP_COLORS[app];
                        return (
                            <button
                                key={app}
                                type="button"
                                onClick={() => toggleApp(app)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                                    checked
                                        ? 'text-white border-transparent shadow-sm'
                                        : 'bg-gray-100 dark:bg-base-200 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-base-300 hover:border-gray-300'
                                }`}
                                style={checked ? { backgroundColor: color, borderColor: color } : undefined}
                            >
                                <span className={`w-2 h-2 rounded-full ${checked ? 'bg-white/70' : 'bg-gray-400'}`} />
                                {APP_LABELS[app]}
                            </button>
                        );
                    })}
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {t('providers.universal.selected_count', '已选 {{count}} 个应用', { count: targetApps.length })}
                </p>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2 pt-2">
                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 px-4 py-2 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-base-300 transition-colors"
                    >
                        {t('common.cancel', '取消')}
                    </button>
                )}
                <button
                    type="button"
                    onClick={handleApply}
                    disabled={applying}
                    className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-pink-500 text-white text-sm font-medium rounded-xl hover:from-orange-600 hover:to-pink-600 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    <Zap className="w-4 h-4" />
                    {applying
                        ? t('providers.universal.applying', '应用中...')
                        : t('providers.universal.apply_btn', '一键应用到所有选中应用')}
                </button>
            </div>
        </div>
    );
}
