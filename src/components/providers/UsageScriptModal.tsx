import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {invoke} from '@tauri-apps/api/core';
import {FlaskConical, Loader2, X} from 'lucide-react';
import {getUsageScriptConfig, Provider, UsageResult, UsageScriptConfig} from '../../types/provider';

// 预设脚本模板（{{apiKey}} / {{baseUrl}} / {{accessToken}} / {{userId}} 运行时由后端替换）
const GENERIC_TEMPLATE = `({
  request: {
    url: "{{baseUrl}}/user/balance",
    method: "GET",
    headers: {
      "Authorization": "Bearer {{apiKey}}",
      "User-Agent": "ccg-switch/1.0"
    }
  },
  extractor: function(response) {
    return {
      isValid: response.is_active || true,
      remaining: response.balance,
      unit: "USD"
    };
  }
})`;

const NEWAPI_TEMPLATE = `({
  request: {
    url: "{{baseUrl}}/api/user/self",
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer {{accessToken}}",
      "New-Api-User": "{{userId}}"
    },
  },
  extractor: function (response) {
    if (response.success && response.data) {
      return {
        planName: response.data.group || "默认套餐",
        remaining: response.data.quota / 500000,
        used: response.data.used_quota / 500000,
        total: (response.data.quota + response.data.used_quota) / 500000,
        unit: "USD",
      };
    }
    return {
      isValid: false,
      invalidMessage: response.message || "查询失败"
    };
  },
})`;

const TEMPLATES: Record<string, string> = {
    generic: GENERIC_TEMPLATE,
    newapi: NEWAPI_TEMPLATE,
    custom: GENERIC_TEMPLATE,
};

const DEFAULT_CONFIG: UsageScriptConfig = {
    enabled: false,
    code: GENERIC_TEMPLATE,
    timeout: 10,
    templateType: 'generic',
    autoQueryInterval: 0,
};

interface UsageScriptModalProps {
    isOpen: boolean;
    provider: Provider | null;
    onClose: () => void;
    onSave: (provider: Provider, config: UsageScriptConfig) => Promise<void>;
}

export default function UsageScriptModal({ isOpen, provider, onClose, onSave }: UsageScriptModalProps) {
    const { t } = useTranslation();
    const [config, setConfig] = useState<UsageScriptConfig>(DEFAULT_CONFIG);
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testResult, setTestResult] = useState<UsageResult | null>(null);

    useEffect(() => {
        if (isOpen && provider) {
            setConfig(getUsageScriptConfig(provider) ?? DEFAULT_CONFIG);
            setTestResult(null);
        }
    }, [isOpen, provider]);

    if (!isOpen || !provider) return null;

    const update = (patch: Partial<UsageScriptConfig>) => setConfig(prev => ({ ...prev, ...patch }));

    const handleTemplateChange = (type: 'custom' | 'generic' | 'newapi') => {
        update({ templateType: type, code: TEMPLATES[type] });
    };

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const result = await invoke<UsageResult>('test_usage_script', {
                providerId: provider.id,
                config,
            });
            setTestResult(result);
        } catch (error) {
            setTestResult({ success: false, error: String(error) });
        } finally {
            setTesting(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave(provider, config);
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal modal-open">
            <div className="modal-box max-w-2xl bg-white dark:bg-base-100">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg">
                        {t('usage_script.title')} · {provider.name}
                    </h3>
                    <button onClick={onClose} className="btn btn-ghost btn-sm btn-circle">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="space-y-4">
                    {/* 启用开关 */}
                    <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-sm font-medium">{t('usage_script.enable')}</span>
                        <input
                            type="checkbox"
                            className="toggle toggle-sm toggle-success"
                            checked={config.enabled}
                            onChange={(e) => update({ enabled: e.target.checked })}
                        />
                    </label>

                    {/* 模板选择 */}
                    <div>
                        <label className="text-sm font-medium block mb-1">{t('usage_script.template')}</label>
                        <div className="flex gap-2">
                            {(['generic', 'newapi', 'custom'] as const).map(type => (
                                <button
                                    key={type}
                                    onClick={() => handleTemplateChange(type)}
                                    className={`btn btn-xs rounded-full ${config.templateType === type ? 'bg-gray-900 text-white hover:bg-gray-800' : 'btn-ghost border border-base-300'}`}
                                >
                                    {t(`usage_script.template_${type}`)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 参数：通用 = apiKey/baseUrl；NewAPI = baseUrl/accessToken/userId */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-base-content/60 block mb-1">
                                Base URL <span className="opacity-60">({t('usage_script.fallback_provider')})</span>
                            </label>
                            <input
                                type="text"
                                className="input input-bordered input-sm w-full font-mono"
                                placeholder={provider.url || 'https://...'}
                                value={config.baseUrl || ''}
                                onChange={(e) => update({ baseUrl: e.target.value })}
                            />
                        </div>
                        {config.templateType !== 'newapi' && (
                            <div>
                                <label className="text-xs text-base-content/60 block mb-1">
                                    API Key <span className="opacity-60">({t('usage_script.fallback_provider')})</span>
                                </label>
                                <input
                                    type="password"
                                    className="input input-bordered input-sm w-full font-mono"
                                    value={config.apiKey || ''}
                                    onChange={(e) => update({ apiKey: e.target.value })}
                                />
                            </div>
                        )}
                        {config.templateType === 'newapi' && (
                            <>
                                <div>
                                    <label className="text-xs text-base-content/60 block mb-1">Access Token</label>
                                    <input
                                        type="password"
                                        className="input input-bordered input-sm w-full font-mono"
                                        value={config.accessToken || ''}
                                        onChange={(e) => update({ accessToken: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-base-content/60 block mb-1">User ID</label>
                                    <input
                                        type="text"
                                        className="input input-bordered input-sm w-full font-mono"
                                        value={config.userId || ''}
                                        onChange={(e) => update({ userId: e.target.value })}
                                    />
                                </div>
                            </>
                        )}
                        <div>
                            <label className="text-xs text-base-content/60 block mb-1">{t('usage_script.timeout')}</label>
                            <input
                                type="number"
                                min={2}
                                max={30}
                                className="input input-bordered input-sm w-full"
                                value={config.timeout ?? 10}
                                onChange={(e) => update({ timeout: Number(e.target.value) || 10 })}
                            />
                        </div>
                        <div>
                            <label className="text-xs text-base-content/60 block mb-1">{t('usage_script.auto_interval')}</label>
                            <input
                                type="number"
                                min={0}
                                max={1440}
                                className="input input-bordered input-sm w-full"
                                value={config.autoQueryInterval ?? 0}
                                onChange={(e) => update({ autoQueryInterval: Math.min(1440, Math.max(0, Number(e.target.value) || 0)) })}
                            />
                        </div>
                    </div>

                    {/* 脚本编辑 */}
                    <div>
                        <label className="text-xs text-base-content/60 block mb-1">{t('usage_script.script')}</label>
                        <textarea
                            className="textarea textarea-bordered w-full font-mono text-xs leading-relaxed"
                            rows={12}
                            spellCheck={false}
                            value={config.code}
                            onChange={(e) => update({ code: e.target.value })}
                        />
                    </div>

                    {/* 测试结果 */}
                    {testResult && (
                        <div className={`rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-all border ${
                            testResult.success
                                ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                                : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400'
                        }`}>
                            {testResult.success
                                ? JSON.stringify(testResult.data, null, 2)
                                : testResult.error || t('usage_script.test_failed')}
                        </div>
                    )}
                </div>

                <div className="modal-action">
                    <button onClick={handleTest} disabled={testing} className="btn btn-ghost btn-sm gap-2">
                        {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                        {t('usage_script.test')}
                    </button>
                    <button onClick={onClose} className="btn btn-ghost btn-sm">{t('common.cancel')}</button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="btn btn-sm bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-none gap-2"
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                        {t('common.save')}
                    </button>
                </div>
            </div>
            <div className="modal-backdrop" onClick={onClose} />
        </div>
    );
}
