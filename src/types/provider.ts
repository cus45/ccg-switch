import {AppType} from './app';

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
    /** HTTP 代理完整 URL（新格式） */
    httpProxy?: string;
    /** HTTPS 代理完整 URL（新格式） */
    httpsProxy?: string;
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

/** 用量/余额查询脚本配置（序列化后存于 Provider.meta.usageScript） */
export interface UsageScriptConfig {
    enabled: boolean;
    code: string;
    timeout?: number;
    apiKey?: string;
    baseUrl?: string;
    accessToken?: string;
    userId?: string;
    templateType?: 'custom' | 'generic' | 'newapi';
    autoQueryInterval?: number;
}

/** 单个套餐的用量数据 */
export interface UsageData {
    planName?: string;
    extra?: string;
    isValid?: boolean;
    invalidMessage?: string;
    total?: number;
    used?: number;
    remaining?: number;
    unit?: string;
}

/** 用量查询结果 */
export interface UsageResult {
    success: boolean;
    data?: UsageData[];
    error?: string;
}

/** 从 provider.meta 解析用量脚本配置 */
export function getUsageScriptConfig(provider: Provider): UsageScriptConfig | null {
    const raw = provider.meta?.usageScript;
    if (!raw) return null;
    try {
        return JSON.parse(raw) as UsageScriptConfig;
    } catch {
        return null;
    }
}
