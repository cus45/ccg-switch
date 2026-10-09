import type { AppType } from '../types/app';
import { GENERATED_PROVIDER_PRESETS } from './providerPresets.generated';

/** 一条供应商预设（只含本项目会用到的字段） */
export interface ProviderPresetData {
    app: AppType;
    name: string;
    /** official / cn_official / third_party / aggregator 等，来自上游分类 */
    category: string;
    websiteUrl?: string;
    /** 获取 API Key 的页面 */
    apiKeyUrl?: string;
    /** Base URL */
    url: string;
    /** main → Sonnet 位（OpenCode / Codex / Gemini 的主模型），opus / haiku 对应各档位 */
    models?: { main?: string; opus?: string; haiku?: string };
    /** OpenCode 的 AI SDK 包 */
    npm?: string;
}

/** 本项目自带、上游没有的预设 */
const LOCAL_PRESETS: ProviderPresetData[] = [
    { app: 'claude', name: 'Claude Official (API Key)', category: 'official', websiteUrl: 'https://console.anthropic.com', apiKeyUrl: 'https://console.anthropic.com/settings/keys', url: 'https://api.anthropic.com' },
    { app: 'claudedesktop', name: 'Anthropic API', category: 'official', websiteUrl: 'https://console.anthropic.com', apiKeyUrl: 'https://console.anthropic.com/settings/keys', url: 'https://api.anthropic.com' },
];

export const PROVIDER_PRESETS: ProviderPresetData[] = [...LOCAL_PRESETS, ...GENERATED_PROVIDER_PRESETS];

/** 某应用可用的预设，按名称排序（与 cc-switch 一致：不置顶） */
export function presetsForApp(app: AppType): ProviderPresetData[] {
    return PROVIDER_PRESETS.filter((p) => p.app === app).sort((a, b) =>
        a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base' })
    );
}

/** 按名称或域名搜索 */
export function matchesPreset(p: ProviderPresetData, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [p.name, p.url, p.websiteUrl ?? ''].some((s) => s.toLowerCase().includes(q));
}
