export type AppType = 'claude' | 'codex' | 'gemini' | 'opencode' | 'openclaw' | 'claudedesktop';

export const APP_TYPES: AppType[] = ['claude', 'codex', 'gemini', 'opencode', 'openclaw'];

/** 前端可见的应用类型（OpenClaw 已废弃） */
export const VISIBLE_APP_TYPES: AppType[] = ['claude', 'codex', 'gemini', 'opencode', 'claudedesktop'];

/** 支持本地代理接管 / 故障转移的应用（OpenCode 暂不支持） */
export const PROXY_APP_TYPES: AppType[] = ['claude', 'codex', 'gemini'];

export const APP_LABELS: Record<AppType, string> = {
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini',
    opencode: 'OpenCode',
    openclaw: 'OpenClaw',
    claudedesktop: 'Claude Desktop',
};

export const APP_COLORS: Record<AppType, string> = {
    claude: '#D97706',
    codex: '#059669',
    gemini: '#2563EB',
    opencode: '#7C3AED',
    openclaw: '#DC2626',
    claudedesktop: '#C2410C',
};
