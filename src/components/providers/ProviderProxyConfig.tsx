import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ProviderProxyConfig } from '../../types/provider';

interface ProviderProxyConfigProps {
    value: ProviderProxyConfig;
    onChange: (config: ProviderProxyConfig) => void;
}

/**
 * 从旧格式构建完整 URL（向下兼容）
 */
function buildProxyUrl(config: ProviderProxyConfig): string {
    if (!config.proxyHost) return '';

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

    // 初始化：优先使用新格式，否则从旧格式构建
    const [proxyUrl, setProxyUrl] = useState(() => {
        if (value.httpProxy) return value.httpProxy;
        if (value.proxyHost) return buildProxyUrl(value);
        return '';
    });

    // 外部 value 变化时同步
    useEffect(() => {
        setExpanded(value.enabled);
        if (value.httpProxy) {
            setProxyUrl(value.httpProxy);
        } else if (value.proxyHost) {
            setProxyUrl(buildProxyUrl(value));
        }
    }, [value.enabled, value.httpProxy, value.proxyHost]);

    // 处理启用开关
    const handleToggle = (enabled: boolean) => {
        setExpanded(enabled);
        if (enabled) {
            onChange({
                enabled: true,
                httpProxy: proxyUrl.trim() || undefined,
                httpsProxy: proxyUrl.trim() || undefined,
            });
        } else {
            onChange({ enabled: false });
            setProxyUrl('');
        }
    };

    // 处理代理 URL 输入（同时写入 httpProxy 和 httpsProxy）
    const handleUrlChange = (url: string) => {
        setProxyUrl(url);
        const trimmed = url.trim() || undefined;
        onChange({
            enabled: true,
            httpProxy: trimmed,
            httpsProxy: trimmed,
        });
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
                    {/* 代理 URL 输入（同时设为 HTTP_PROXY 和 HTTPS_PROXY） */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-600 dark:text-slate-300">
                            {t('providers.httpProxy')}
                        </label>
                        <input
                            type="text"
                            className="flex h-8 w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900/50 px-3 py-1 text-sm text-gray-900 dark:text-slate-200 shadow-sm transition-colors placeholder:text-gray-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 font-mono"
                            placeholder="http://127.0.0.1:7890"
                            value={proxyUrl}
                            onChange={(e) => handleUrlChange(e.target.value)}
                        />
                        <p className="text-xs text-gray-400 dark:text-slate-500">
                            {t('providers.proxyEnvHint')}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
