import type { TFunction } from 'i18next';

/**
 * 后端给会话文件导入的用量返回的占位供应商名（`dao/usage_logs.rs` 的
 * `provider_name_coalesce`）。只在显示时翻译，不改动原值 —— 供应商筛选是按原名匹配的。
 */
const SESSION_PROVIDER_APPS: Record<string, string> = {
    'Claude (Session)': 'Claude',
    'Codex (Session)': 'Codex',
    'OpenCode (Session)': 'OpenCode',
};

export interface UsageProviderLabel {
    label: string;
    /** 会话日志占位名才有：说明为什么分不出具体供应商 */
    hint?: string;
    /** 是否会话文件导入的占位行 */
    isSession: boolean;
}

/** 用量面板里供应商名的显示文案；空名显示「未知供应商」（与参考项目 cc-switch 一致） */
export function getUsageProviderLabel(name: string | undefined | null, t: TFunction): UsageProviderLabel {
    if (!name) return { label: t('usage.unknownProvider'), isSession: false };
    const app = SESSION_PROVIDER_APPS[name];
    if (!app) return { label: name, isSession: false };
    return {
        label: t('usage.sessionProvider.label', { app }),
        hint: t('usage.sessionProvider.hint'),
        isSession: true,
    };
}

/** 悬停提示：名字本身（截断时看全名），会话日志占位名再附上说明 */
export function usageProviderTitle({ label, hint }: Pick<UsageProviderLabel, 'label' | 'hint'>): string {
    return hint ? `${label}\n${hint}` : label;
}
