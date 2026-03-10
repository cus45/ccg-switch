import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';
import { ProviderProxyConfig } from '../../types/provider';

interface ProviderProxyConfigProps {
    value: ProviderProxyConfig;
    onChange: (config: ProviderProxyConfig) => void;
}

/**
 * 解析代理 URL 字符串
 * 格式: http://host:port / https://host:port / socks5://host:port
 * 支持: http://user:pass@host:port
 */
function parseProxyUrl(url: string): Partial<ProviderProxyConfig> {
    if (!url.trim()) {
        return { enabled: false };
    }

    try {
        const parsed = new URL(url);
        const protocol = parsed.protocol.replace(':', '') as 'http' | 'https' | 'socks5';

        // 如果 URL 中包含认证信息
        if (parsed.username || parsed.password) {
            return {
                enabled: true,
                proxyType: protocol,
                proxyHost: parsed.hostname,
                proxyPort: parsed.port ? parseInt(parsed.port, 10) : undefined,
                proxyUsername: decodeURIComponent(parsed.username) || undefined,
                proxyPassword: decodeURIComponent(parsed.password) || undefined,
            };
        }

        return {
            enabled: true,
            proxyType: protocol,
            proxyHost: parsed.hostname,
            proxyPort: parsed.port ? parseInt(parsed.port, 10) : undefined,
        };
    } catch {
        // URL 解析失败，返回原始值让用户继续编辑
        return { enabled: true };
    }
}

/**
 * 构建代理 URL 字符串
 */
function buildProxyUrl(config: ProviderProxyConfig): string {
    if (!config.enabled || !config.proxyHost) {
        return '';
    }

    const protocol = config.proxyType || 'http';
    const port = config.proxyPort ? `:${config.proxyPort}` : '';

    if (config.proxyUsername && config.proxyPassword) {
        return `${protocol}://${encodeURIComponent(config.proxyUsername)}:${encodeURIComponent(config.proxyPassword)}@${config.proxyHost}${port}`;
    }

    return `${protocol}://${config.proxyHost}${port}`;
}

export default function ProviderProxyConfigInput({ value, onChange }: ProviderProxyConfigProps) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(value.enabled);
    const [showPassword, setShowPassword] = useState(false);

    // URL 输入框的值（单行输入）
    const [proxyUrl, setProxyUrl] = useState(() => buildProxyUrl(value));

    // 处理启用开关
    const handleToggle = (enabled: boolean) => {
        setExpanded(enabled);
        if (enabled) {
            // 启用时，解析当前 URL 或使用默认值
            const parsed = parseProxyUrl(proxyUrl);
            onChange({
                enabled: true,
                proxyType: parsed.proxyType || 'http',
                proxyHost: parsed.proxyHost || '',
                proxyPort: parsed.proxyPort,
                proxyUsername: parsed.proxyUsername,
                proxyPassword: parsed.proxyPassword,
            });
        } else {
            // 禁用时清除配置
            onChange({ enabled: false });
            setProxyUrl('');
        }
    };

    // 处理 URL 输入变化
    const handleUrlChange = (url: string) => {
        setProxyUrl(url);
        const parsed = parseProxyUrl(url);
        if (parsed.enabled) {
            onChange({
                enabled: true,
                proxyType: parsed.proxyType,
                proxyHost: parsed.proxyHost,
                proxyPort: parsed.proxyPort,
                proxyUsername: parsed.proxyUsername,
                proxyPassword: parsed.proxyPassword,
            });
        }
    };

    // 清除代理配置
    const handleClear = () => {
        setProxyUrl('');
        onChange({ enabled: false });
        setExpanded(false);
    };

    return (
        <div className="space-y-2 pt-2">
            {/* 折叠面板标题 */}
            <div className="flex items-center justify-between">
                <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-slate-200 hover:text-gray-900 dark:hover:text-slate-100 transition-colors"
                >
                    {expanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                    ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                    )}
                    {t('providers.proxyConfig')}
                </button>

                {/* 启用开关 + 清除按钮 */}
                <div className="flex items-center gap-2">
                    {value.enabled && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                        >
                            {t('providers.clear')}
                        </button>
                    )}
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={value.enabled}
                            onChange={(e) => handleToggle(e.target.checked)}
                        />
                        <div className="w-9 h-5 bg-gray-200 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-1 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                </div>
            </div>

            {/* 描述 */}
            <p className="text-xs text-gray-500 dark:text-slate-400">
                {t('providers.proxyConfigDesc')}
            </p>

            {/* 展开的配置面板 */}
            {expanded && value.enabled && (
                <div className="mt-3 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-gray-200 dark:border-slate-700/50 space-y-3">
                    {/* 代理 URL 单行输入 */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-600 dark:text-slate-300">
                            {t('providers.useCustomProxy')}
                        </label>
                        <input
                            type="text"
                            className="flex h-8 w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900/50 px-3 py-1 text-sm text-gray-900 dark:text-slate-200 shadow-sm transition-colors placeholder:text-gray-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 font-mono"
                            placeholder={t('providers.proxyUrlPlaceholder')}
                            value={proxyUrl}
                            onChange={(e) => handleUrlChange(e.target.value)}
                        />
                    </div>

                    {/* 用户名密码（可选）- 仅在 URL 中没有认证信息时显示 */}
                    {!(value.proxyUsername && value.proxyPassword) && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-gray-600 dark:text-slate-300">
                                    {t('providers.proxyUsername')}
                                </label>
                                <input
                                    type="text"
                                    className="flex h-8 w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900/50 px-3 py-1 text-sm text-gray-900 dark:text-slate-200 shadow-sm transition-colors placeholder:text-gray-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                                    value={value.proxyUsername || ''}
                                    onChange={(e) => {
                                        const newUsername = e.target.value.trim();
                                        onChange({
                                            ...value,
                                            proxyUsername: newUsername || undefined,
                                        });
                                        // 更新 URL
                                        setProxyUrl(buildProxyUrl({
                                            ...value,
                                            proxyUsername: newUsername || undefined,
                                        }));
                                    }}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-gray-600 dark:text-slate-300">
                                    {t('providers.proxyPassword')}
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        className="flex h-8 w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900/50 px-3 py-1 pr-8 text-sm text-gray-900 dark:text-slate-200 shadow-sm transition-colors placeholder:text-gray-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                                        value={value.proxyPassword || ''}
                                        onChange={(e) => {
                                            const newPassword = e.target.value;
                                            onChange({
                                                ...value,
                                                proxyPassword: newPassword || undefined,
                                            });
                                            // 更新 URL
                                            setProxyUrl(buildProxyUrl({
                                                ...value,
                                                proxyPassword: newPassword || undefined,
                                            }));
                                        }}
                                    />
                                    <button
                                        type="button"
                                        tabIndex={-1}
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                                    >
                                        {showPassword ? (
                                            <EyeOff className="w-3.5 h-3.5" />
                                        ) : (
                                            <Eye className="w-3.5 h-3.5" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 当前配置预览 */}
                    {value.proxyHost && (
                        <div className="text-xs text-gray-500 dark:text-slate-400 pt-1 border-t border-gray-200 dark:border-slate-700/50">
                            <span className="font-medium">Preview: </span>
                            <code className="font-mono bg-gray-100 dark:bg-slate-700/50 px-1.5 py-0.5 rounded">
                                {buildProxyUrl(value).replace(/:[^:@]+@/, ':****@')}
                            </code>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
