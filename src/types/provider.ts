import { AppType } from './app';

/**
 * Provider 单独的代理配置
 */
export interface ProviderProxyConfig {
    /** 是否启用单独代理 */
    enabled: boolean;
    /** 代理类型: http | https | socks5 */
    proxyType?: 'http' | 'https' | 'socks5';
    /** 代理主机 */
    proxyHost?: string;
    /** 代理端口 */
    proxyPort?: number;
    /** 代理用户名（可选） */
    proxyUsername?: string;
    /** 代理密码（可选） */
    proxyPassword?: string;
}

export interface Provider {
    id: string;
    name: string;
    appType: AppType;
    apiKey: string;
    url?: string;
    defaultSonnetModel?: string;
    defaultOpusModel?: string;
    defaultHaikuModel?: string;
    defaultReasoningModel?: string;
    customParams?: Record<string, any>;
    settingsConfig?: any;
    meta?: Record<string, string>;
    icon?: string;
    inFailoverQueue: boolean;
    description?: string;
    tags?: string[];
    isActive: boolean;
    createdAt: string;
    lastUsed?: string;
    /** Provider 单独的代理配置 */
    proxyConfig?: ProviderProxyConfig;
}
