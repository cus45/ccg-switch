export interface ProxyConfig {
    port: number;
    host: string;
    enabled: boolean;
    takeoverMode: boolean;
    authToken?: string;
}

export interface ProxyState {
    running: boolean;
    port: number;
    host: string;
    requestCount: number;
    /** 是否处于 Live 接管状态（CLI 配置已指向本地代理） */
    takeoverActive: boolean;
    /** 已接管的应用列表（claude / codex / gemini） */
    takenOverApps: string[];
}

export type CircuitBreakerState = 'closed' | 'open' | 'halfopen';

export interface ProviderHealth {
    providerId: string;
    state: CircuitBreakerState;
    failureCount: number;
    lastFailure?: string;
    lastSuccess?: string;
}
