import { Sun, Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../../stores/useConfigStore';
import Logo from './Logo';

function Navbar() {
    const { i18n } = useTranslation();
    const { config, saveConfig } = useConfigStore();

    const toggleTheme = async (event: React.MouseEvent<HTMLButtonElement>) => {
        if (!config) return;

        const newTheme = config.theme === 'light' ? 'dark' : 'light';

        // 如果浏览器支持 View Transition API
        if ('startViewTransition' in document) {
            const x = event.clientX;
            const y = event.clientY;
            const endRadius = Math.hypot(
                Math.max(x, window.innerWidth - x),
                Math.max(y, window.innerHeight - y)
            );

            // @ts-ignore
            const transition = document.startViewTransition(async () => {
                await saveConfig({
                    ...config,
                    theme: newTheme,
                    language: config.language
                });
            });

            transition.ready.then(() => {
                const clipPath = [
                    `circle(0px at ${x}px ${y}px)`,
                    `circle(${endRadius}px at ${x}px ${y}px)`
                ];

                document.documentElement.animate(
                    {
                        clipPath: clipPath
                    },
                    {
                        duration: 500,
                        easing: 'ease-in-out',
                        pseudoElement: '::view-transition-new(root)'
                    }
                );
            });
        } else {
            // 降级方案：直接切换
            await saveConfig({
                ...config,
                theme: newTheme,
                language: config.language
            });
        }
    };

    const toggleLanguage = async () => {
        if (!config) return;
        const newLang = config.language === 'zh' ? 'en' : 'zh';
        await saveConfig({
            ...config,
            language: newLang,
            theme: config.theme
        });
        i18n.changeLanguage(newLang);
    };

    return (
        <nav
            style={{ position: 'sticky', top: 0, zIndex: 50 }}
            className="pt-8 transition-all duration-200 bg-[#FAFBFC] dark:bg-base-300"
        >
            {/* 窗口拖拽区域 - 覆盖导航栏内容区域（在交互元素下方） */}
            <div
                className="absolute top-8 left-0 right-0 h-12"
                style={{ zIndex: 5, backgroundColor: 'rgba(0,0,0,0.001)' }}
                data-tauri-drag-region
            />

            <div className="px-6 relative" style={{ zIndex: 10 }}>
                <div className="flex items-center justify-between h-12">
                    {/* 左侧 Logo */}
                    <Logo size="sm" />

                    {/* 右侧：主题切换 + 语言切换 */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleTheme}
                            className="w-9 h-9 rounded-full bg-gray-100 dark:bg-base-200 hover:bg-gray-200 dark:hover:bg-base-100 flex items-center justify-center transition-colors"
                            title={config?.theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
                        >
                            {config?.theme === 'light' ? (
                                <Moon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                            ) : (
                                <Sun className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                            )}
                        </button>

                        <button
                            onClick={toggleLanguage}
                            className="w-9 h-9 rounded-full bg-gray-100 dark:bg-base-200 hover:bg-gray-200 dark:hover:bg-base-100 flex items-center justify-center transition-colors"
                            title={config?.language === 'zh' ? 'Switch to English' : '切换到中文'}
                        >
                            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                                {config?.language === 'zh' ? 'EN' : '中'}
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </nav>
    );
}

export default Navbar;