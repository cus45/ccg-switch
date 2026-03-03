import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon, Sun, Moon, Globe } from 'lucide-react';
import { useConfigStore } from '../stores/useConfigStore';
import ImportExportPanel from '../components/settings/ImportExportPanel';
import SpeedTestPanel from '../components/settings/SpeedTestPanel';
import StreamCheckPanel from '../components/settings/StreamCheckPanel';
import GlobalProxyPanel from '../components/settings/GlobalProxyPanel';
import EnvCheckerPanel from '../components/settings/EnvCheckerPanel';

function Settings() {
    const { t, i18n } = useTranslation();
    const { config, saveConfig } = useConfigStore();

    const handleThemeChange = async (theme: 'light' | 'dark') => {
        if (!config) return;
        await saveConfig({
            ...config,
            theme,
            language: config.language
        });
    };

    const handleLanguageChange = async (language: 'zh' | 'en') => {
        if (!config) return;
        await saveConfig({
            ...config,
            theme: config.theme,
            language
        });
        i18n.changeLanguage(language);
    };

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="p-6 space-y-6 max-w-3xl mx-auto">
                <div className="flex items-center gap-3">
                    <SettingsIcon className="w-6 h-6 text-gray-500" />
                    <h1 className="text-xl font-bold text-gray-900 dark:text-base-content">
                        {t('settings.title')}
                    </h1>
                </div>

                <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
                    <h2 className="font-semibold text-gray-900 dark:text-base-content mb-4">
                        {t('settings.appearance')}
                    </h2>

                    <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-base-200">
                        <div className="flex items-center gap-3">
                            {config?.theme === 'light' ? (
                                <Sun className="w-5 h-5 text-yellow-500" />
                            ) : (
                                <Moon className="w-5 h-5 text-blue-500" />
                            )}
                            <span className="text-gray-700 dark:text-gray-300">{t('settings.theme')}</span>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleThemeChange('light')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${config?.theme === 'light' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300'}`}
                            >
                                {t('settings.light')}
                            </button>
                            <button
                                onClick={() => handleThemeChange('dark')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${config?.theme === 'dark' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300'}`}
                            >
                                {t('settings.dark')}
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                            <Globe className="w-5 h-5 text-green-500" />
                            <span className="text-gray-700 dark:text-gray-300">{t('settings.language')}</span>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleLanguageChange('zh')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${config?.language === 'zh' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300'}`}
                            >
                                中文
                            </button>
                            <button
                                onClick={() => handleLanguageChange('en')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${config?.language === 'en' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300'}`}
                            >
                                English
                            </button>
                        </div>
                    </div>
                </div>

                <ImportExportPanel />
                <SpeedTestPanel />
                <StreamCheckPanel />
                <GlobalProxyPanel />
                <EnvCheckerPanel />

                <div className="text-center text-sm text-gray-400 dark:text-gray-500">
                    CCG Switch v1.0.0
                </div>
            </div>
        </div>
    );
}

export default Settings;
