import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon, Sun, Moon, Globe, PanelLeft, PanelRight, PanelTop, Terminal } from 'lucide-react';
import { useConfigStore } from '../stores/useConfigStore';
import { SidebarPosition, TerminalType } from '../types/config';
import ImportExportPanel from '../components/settings/ImportExportPanel';
import SpeedTestPanel from '../components/settings/SpeedTestPanel';
import StreamCheckPanel from '../components/settings/StreamCheckPanel';
import GlobalProxyPanel from '../components/settings/GlobalProxyPanel';
import EnvCheckerPanel from '../components/settings/EnvCheckerPanel';
import AboutPanel from '../components/settings/AboutPanel';

function Settings() {
    const { t, i18n } = useTranslation();
    const { config, saveConfig } = useConfigStore();

    const handleThemeChange = async (theme: 'light' | 'dark') => {
        if (!config) return;
        await saveConfig({ ...config, theme });
    };

    const handleLanguageChange = async (language: 'zh' | 'en') => {
        if (!config) return;
        await saveConfig({ ...config, language });
        i18n.changeLanguage(language);
    };

    const handleSidebarChange = async (sidebarPosition: SidebarPosition) => {
        if (!config) return;
        await saveConfig({ ...config, sidebarPosition });
    };

    const handleTerminalChange = async (preferredTerminal: TerminalType) => {
        if (!config) return;
        await saveConfig({ ...config, preferredTerminal });
    };

    const sidebarOptions: { value: SidebarPosition; label: string; icon: typeof PanelLeft }[] = [
        { value: 'left', label: t('settings.sidebarLeft', '左侧'), icon: PanelLeft },
        { value: 'right', label: t('settings.sidebarRight', '右侧'), icon: PanelRight },
        { value: 'top', label: t('settings.sidebarTop', '顶部'), icon: PanelTop },
    ];

    const terminalOptions: { value: TerminalType; label: string }[] = [
        { value: 'cmd', label: t('settings.terminal_cmd', '命令提示符') },
        { value: 'powershell', label: 'PowerShell' },
        { value: 'wt', label: 'Windows Terminal' },
    ];

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

                    <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-base-200">
                        <div className="flex items-center gap-3">
                            <Globe className="w-5 h-5 text-green-500" />
                            <span className="text-gray-700 dark:text-gray-300">{t('settings.language')}</span>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleLanguageChange('zh')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${config?.language === 'zh' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300'}`}
                            >
                                {t('settings.zh_label')}
                            </button>
                            <button
                                onClick={() => handleLanguageChange('en')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${config?.language === 'en' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300'}`}
                            >
                                English
                            </button>
                        </div>
                    </div>

                    {/* 导航栏位置 */}
                    <div className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                            <PanelLeft className="w-5 h-5 text-purple-500" />
                            <span className="text-gray-700 dark:text-gray-300">{t('settings.sidebarPosition', '导航栏位置')}</span>
                        </div>
                        <div className="flex gap-2">
                            {sidebarOptions.map(opt => {
                                const Icon = opt.icon;
                                const active = (config?.sidebarPosition || 'left') === opt.value;
                                return (
                                    <button
                                        key={opt.value}
                                        onClick={() => handleSidebarChange(opt.value)}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                            active
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300'
                                        }`}
                                    >
                                        <Icon className="w-4 h-4" />
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 启动终端 */}
                    <div className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                            <Terminal className="w-5 h-5 text-orange-500" />
                            <div>
                                <span className="text-gray-700 dark:text-gray-300">{t('settings.preferredTerminal', '启动终端')}</span>
                                <p className="text-xs text-gray-400 mt-0.5">{t('settings.preferredTerminalHint', '恢复会话时使用的终端')}</p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            {terminalOptions.map(opt => {
                                const active = (config?.preferredTerminal || 'powershell') === opt.value;
                                return (
                                    <button
                                        key={opt.value}
                                        onClick={() => handleTerminalChange(opt.value)}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                            active
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300'
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <ImportExportPanel />
                <SpeedTestPanel />
                <StreamCheckPanel />
                <GlobalProxyPanel />
                <EnvCheckerPanel />

                <AboutPanel />
            </div>
        </div>
    );
}

export default Settings;
