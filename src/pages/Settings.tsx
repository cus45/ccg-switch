import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon, Sun, Moon, Globe, PanelLeft, PanelRight, PanelTop, Terminal, Power } from 'lucide-react';
import { useConfigStore } from '../stores/useConfigStore';
import { SidebarPosition, TerminalType } from '../types/config';
import { AutoLaunchStatus } from '../types/advanced';
import { getAutoLaunchStatus, setAutoLaunch } from '../services/advancedService';
import ImportExportPanel from '../components/settings/ImportExportPanel';
import GlobalProxyPanel from '../components/settings/GlobalProxyPanel';
import EnvCheckerPanel from '../components/settings/EnvCheckerPanel';
import AboutPanel from '../components/settings/AboutPanel';
import WebDavBackupPanel from '../components/settings/WebDavBackupPanel';

type SettingsTab = 'general' | 'proxy' | 'advanced' | 'about';

function Settings() {
    const { t, i18n } = useTranslation();
    const { config, saveConfig } = useConfigStore();
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [autoLaunch, setAutoLaunchState] = useState<AutoLaunchStatus | null>(null);
    const [autoLaunchError, setAutoLaunchError] = useState<string | null>(null);

    useEffect(() => {
        getAutoLaunchStatus()
            .then(setAutoLaunchState)
            .catch((e) => setAutoLaunchError(String(e)));
    }, []);

    // 根据平台自动修正终端配置
    useEffect(() => {
        if (!config) return;

        const platform = navigator.platform.toLowerCase();
        const isMac = platform.includes('mac');
        const isWindows = platform.includes('win');
        const isLinux = !isMac && !isWindows;

        const macTerminals: TerminalType[] = ['terminal', 'iterm', 'warp'];
        const windowsTerminals: TerminalType[] = ['cmd', 'powershell', 'wt'];
        const linuxTerminals: TerminalType[] = ['xterm', 'gnome-terminal', 'konsole'];

        let needsFix = false;
        let correctTerminal: TerminalType = 'terminal';

        if (isMac && !macTerminals.includes(config.preferredTerminal)) {
            correctTerminal = 'terminal';
            needsFix = true;
        } else if (isWindows && !windowsTerminals.includes(config.preferredTerminal)) {
            correctTerminal = 'powershell';
            needsFix = true;
        } else if (isLinux && !linuxTerminals.includes(config.preferredTerminal)) {
            correctTerminal = 'xterm';
            needsFix = true;
        }

        if (needsFix) {
            saveConfig({ ...config, preferredTerminal: correctTerminal });
        }
    }, [config]);

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

    const handleAutoLaunchToggle = async (enabled: boolean) => {
        setAutoLaunchError(null);
        try {
            await setAutoLaunch(enabled);
            setAutoLaunchState(prev => prev ? { ...prev, enabled } : { enabled, supported: true });
        } catch (e) {
            setAutoLaunchError(String(e));
        }
    };

    const sidebarOptions: { value: SidebarPosition; label: string; icon: typeof PanelLeft }[] = [
        { value: 'left', label: t('settings.sidebarLeft', '左侧'), icon: PanelLeft },
        { value: 'right', label: t('settings.sidebarRight', '右侧'), icon: PanelRight },
        { value: 'top', label: t('settings.sidebarTop', '顶部'), icon: PanelTop },
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

                <div className="tabs tabs-boxed bg-base-200/50 dark:bg-base-200 p-1">
                    {(['general', 'proxy', 'advanced', 'about'] as const).map(tab => (
                        <button
                            key={tab}
                            className={`tab ${activeTab === tab ? 'tab-active' : ''}`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {t(`settings.tab_${tab}`)}
                        </button>
                    ))}
                </div>

                {activeTab === 'general' && (
                    <>
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
                            <div className="flex items-center justify-between py-3 border-t border-gray-100 dark:border-base-200">
                                <div className="flex items-center gap-3">
                                    <Terminal className="w-5 h-5 text-orange-500" />
                                    <div>
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings.preferredTerminal', '启动终端')}</span>
                                        <p className="text-xs text-gray-400 mt-0.5">{t('settings.preferredTerminalHint', '恢复会话时使用的终端')}</p>
                                    </div>
                                </div>
                                <select
                                    value={config?.preferredTerminal || 'terminal'}
                                    onChange={(e) => handleTerminalChange(e.target.value as TerminalType)}
                                    className="px-3 py-1.5 bg-gray-100 dark:bg-base-200 border border-gray-200 dark:border-base-300 rounded-lg text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]"
                                >
                                    <optgroup label="Windows">
                                        <option value="cmd">命令提示符</option>
                                        <option value="powershell">PowerShell</option>
                                        <option value="wt">Windows Terminal</option>
                                    </optgroup>
                                    <optgroup label="macOS">
                                        <option value="terminal">Terminal (系统默认)</option>
                                        <option value="iterm">iTerm2</option>
                                        <option value="warp">Warp</option>
                                    </optgroup>
                                    <optgroup label="Linux">
                                        <option value="xterm">XTerm</option>
                                        <option value="gnome-terminal">GNOME Terminal</option>
                                        <option value="konsole">Konsole</option>
                                    </optgroup>
                                </select>
                            </div>
                        </div>

                        {/* 开机自启动 */}
                        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <Power className="w-5 h-5 text-emerald-500" />
                                    <div>
                                        <span className="font-semibold text-gray-900 dark:text-base-content">
                                            {t('settings.auto_launch')}
                                        </span>
                                        <p className="text-xs text-gray-400 mt-0.5">
                                            {autoLaunch?.supported === false
                                                ? t('settings.auto_launch_unsupported')
                                                : t('settings.auto_launch_hint')}
                                        </p>
                                    </div>
                                </div>
                                <input
                                    type="checkbox"
                                    className="toggle toggle-success"
                                    checked={autoLaunch?.enabled ?? false}
                                    disabled={!autoLaunch?.supported}
                                    onChange={(e) => handleAutoLaunchToggle(e.target.checked)}
                                />
                            </div>
                            {autoLaunchError && (
                                <div className="text-sm text-red-500 mt-2">{autoLaunchError}</div>
                            )}
                        </div>
                    </>
                )}

                {activeTab === 'proxy' && (
                    <GlobalProxyPanel />
                )}

                {activeTab === 'advanced' && (
                    <>
                        <ImportExportPanel />
                        <WebDavBackupPanel />
                        <EnvCheckerPanel />
                    </>
                )}

                {activeTab === 'about' && (
                    <AboutPanel />
                )}
            </div>
        </div>
    );
}

export default Settings;
