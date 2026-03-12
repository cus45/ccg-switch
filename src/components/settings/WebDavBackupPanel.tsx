import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Save, Loader2 } from 'lucide-react';
import { getWebDavConfig, saveWebDavConfig } from '../../services/advancedService';
import { WebDavConfig } from '../../types/advanced';

function WebDavBackupPanel() {
    const { t } = useTranslation();
    const [config, setConfig] = useState<WebDavConfig>({
        enabled: false,
        serverUrl: '',
        username: '',
        password: '',
        remotePath: '',
        lastSyncAt: undefined,
    });
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        setLoading(true);
        try {
            const data = await getWebDavConfig();
            setConfig(data);
        } catch (e) {
            setMessage({ type: 'error', text: String(e) });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            await saveWebDavConfig(config);
            setMessage({ type: 'success', text: t('settings.webdav_save_success') });
        } catch (e) {
            setMessage({ type: 'error', text: t('settings.webdav_save_failed') + ': ' + String(e) });
        } finally {
            setSaving(false);
        }
    };

    const disabled = !config.enabled;

    if (loading) {
        return (
            <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
                <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900 dark:text-base-content flex items-center gap-2">
                    <Cloud className="w-4 h-4" />
                    {t('settings.webdav_title')}
                </h2>
                <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-sm text-gray-500">{t('settings.webdav_enabled')}</span>
                    <input
                        type="checkbox"
                        className="toggle toggle-sm toggle-primary"
                        checked={config.enabled}
                        onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                    />
                </label>
            </div>
            <div className="space-y-3">
                <div>
                    <label className="text-xs text-gray-500 mb-1 block">{t('settings.webdav_url')}</label>
                    <input
                        type="text"
                        placeholder={t('settings.webdav_url_placeholder')}
                        value={config.serverUrl || ''}
                        onChange={(e) => setConfig({ ...config, serverUrl: e.target.value || undefined })}
                        disabled={disabled}
                        className="input input-bordered input-sm w-full bg-gray-50 dark:bg-base-200 disabled:opacity-50"
                    />
                </div>
                <div>
                    <label className="text-xs text-gray-500 mb-1 block">{t('settings.webdav_username')}</label>
                    <input
                        type="text"
                        value={config.username || ''}
                        onChange={(e) => setConfig({ ...config, username: e.target.value || undefined })}
                        disabled={disabled}
                        className="input input-bordered input-sm w-full bg-gray-50 dark:bg-base-200 disabled:opacity-50"
                    />
                </div>
                <div>
                    <label className="text-xs text-gray-500 mb-1 block">{t('settings.webdav_password')}</label>
                    <input
                        type="password"
                        value={config.password || ''}
                        onChange={(e) => setConfig({ ...config, password: e.target.value || undefined })}
                        disabled={disabled}
                        className="input input-bordered input-sm w-full bg-gray-50 dark:bg-base-200 disabled:opacity-50"
                    />
                </div>
                <div>
                    <label className="text-xs text-gray-500 mb-1 block">{t('settings.webdav_path')}</label>
                    <input
                        type="text"
                        placeholder={t('settings.webdav_path_placeholder')}
                        value={config.remotePath || ''}
                        onChange={(e) => setConfig({ ...config, remotePath: e.target.value || undefined })}
                        disabled={disabled}
                        className="input input-bordered input-sm w-full bg-gray-50 dark:bg-base-200 disabled:opacity-50"
                    />
                </div>
                {config.lastSyncAt && (
                    <div className="text-xs text-gray-400">
                        {t('settings.webdav_last_sync')}: {config.lastSyncAt}
                    </div>
                )}
                {!config.lastSyncAt && config.enabled && (
                    <div className="text-xs text-gray-400">
                        {t('settings.webdav_never_synced')}
                    </div>
                )}
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="btn btn-sm bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-base-300"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {t('settings.save')}
                </button>
                {message && (
                    <div className={`text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                        {message.text}
                    </div>
                )}
            </div>
        </div>
    );
}

export default WebDavBackupPanel;
