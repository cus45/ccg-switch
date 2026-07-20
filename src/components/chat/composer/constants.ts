// 发送控制台的静态配置：模型、权限模式、推理强度。
// 移植自 jcc-gui 的 ChatInputBox/types.ts，裁剪为 ccg-switch 实际用到的字段。

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ChatProviderId = 'claude' | 'codex';

export interface ModeInfo {
    id: PermissionMode;
    /** i18n key 后缀，对应 chat.modes.<id>.label / .description */
    i18nKey: string;
    /** lucide 图标名（在组件里映射为实际图标） */
    icon: 'message-square' | 'clipboard-list' | 'bot' | 'zap';
}

export interface ModelInfo {
    id: string;
    label: string;
    /** i18n key 后缀，对应 chat.models.<key>.description */
    descKey?: string;
    /** 动态模型的直接描述，通常来自 provider 配置或本地自定义模型。 */
    description?: string;
}

export interface ReasoningInfo {
    id: ReasoningEffort;
    i18nKey: string;
    icon: 'circle-dot' | 'circle' | 'circle-dashed' | 'flame' | 'rocket';
}

export interface ProviderInfo {
    id: ChatProviderId;
    label: string;
}

export const AVAILABLE_PROVIDERS: ProviderInfo[] = [
    { id: 'claude', label: 'Claude Code' },
    { id: 'codex', label: 'Codex' },
];

export const AVAILABLE_MODES: ModeInfo[] = [
    { id: 'default', i18nKey: 'default', icon: 'message-square' },
    { id: 'plan', i18nKey: 'plan', icon: 'clipboard-list' },
    { id: 'acceptEdits', i18nKey: 'acceptEdits', icon: 'bot' },
    { id: 'bypassPermissions', i18nKey: 'bypassPermissions', icon: 'zap' },
];

export const CLAUDE_MODELS: ModelInfo[] = [
    { id: 'claude-opus-4-8', label: 'Opus 4.8', descKey: 'opus48' },
    { id: 'claude-opus-4-7', label: 'Opus 4.7', descKey: 'opus47' },
    { id: 'claude-fable-5', label: 'Fable 5', descKey: 'fable5' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', descKey: 'sonnet46' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', descKey: 'haiku45' },
];

export const CODEX_MODELS: ModelInfo[] = [
    { id: 'gpt-5.5', label: 'GPT-5.5', descKey: 'gpt55' },
    { id: 'gpt-5.4', label: 'GPT-5.4', descKey: 'gpt54' },
    { id: 'gpt-5.2-codex', label: 'GPT-5.2-Codex', descKey: 'gpt52codex' },
    { id: 'gpt-5.1-codex-max', label: 'GPT-5.1-Codex-Max', descKey: 'gpt51codexMax' },
    { id: 'gpt-5.2', label: 'GPT-5.2', descKey: 'gpt52' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' },
];

export const REASONING_LEVELS: ReasoningInfo[] = [
    { id: 'low', i18nKey: 'low', icon: 'circle-dashed' },
    { id: 'medium', i18nKey: 'medium', icon: 'circle' },
    { id: 'high', i18nKey: 'high', icon: 'circle-dot' },
    { id: 'xhigh', i18nKey: 'xhigh', icon: 'flame' },
    { id: 'max', i18nKey: 'max', icon: 'rocket' },
];

/** 支持 effort 调节的 Claude 模型；其余（如 Haiku）隐藏推理强度选择器。 */
export const EFFORT_SUPPORTED_CLAUDE_MODELS = new Set([
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-sonnet-4-6',
]);

/** 额外支持 xhigh 档的模型。 */
export const XHIGH_EFFORT_CLAUDE_MODELS = new Set([
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
]);

/** 支持 max 档的模型。 */
export const MAX_EFFORT_CLAUDE_MODELS = new Set([
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-sonnet-4-6',
]);

export const ONE_M_CONTEXT_SUFFIX = '[1m]';
const ONE_M_CONTEXT_SUFFIX_RE = /\[1m]$/i;

export function strip1MContextSuffix(modelId: string | undefined | null): string {
    return modelId ? modelId.replace(ONE_M_CONTEXT_SUFFIX_RE, '') : '';
}

export function modelSupports1MContext(modelId: string | undefined | null): boolean {
    const baseModel = strip1MContextSuffix(modelId).toLowerCase();
    return Boolean(baseModel) && !baseModel.includes('haiku');
}

export function apply1MContextSuffix(modelId: string, enabled: boolean): string {
    const baseModel = strip1MContextSuffix(modelId);
    if (!enabled || !modelSupports1MContext(baseModel)) return baseModel;
    return `${baseModel}${ONE_M_CONTEXT_SUFFIX}`;
}

export function modelsForProvider(provider: ChatProviderId): ModelInfo[] {
    return provider === 'codex' ? CODEX_MODELS : CLAUDE_MODELS;
}

/** 各模型的上下文窗口上限（用于 token 用量环估算）。Claude 默认 200k。 */
export function contextWindowFor(modelId: string): number {
    if (ONE_M_CONTEXT_SUFFIX_RE.test(modelId)) return 1_000_000;
    if (modelId.startsWith('gpt-')) return 400_000;
    return 200_000;
}

/** 当前模型可用的推理档位列表。 */
export function reasoningLevelsFor(
    provider: ChatProviderId,
    modelId: string,
): ReasoningInfo[] {
    const baseModel = strip1MContextSuffix(modelId);
    return REASONING_LEVELS.filter((level) => {
        if (provider !== 'claude') {
            // Codex：low/medium/high/xhigh，无 max
            return level.id !== 'max';
        }
        if (level.id === 'xhigh') return XHIGH_EFFORT_CLAUDE_MODELS.has(baseModel);
        if (level.id === 'max') return MAX_EFFORT_CLAUDE_MODELS.has(baseModel);
        return true;
    });
}

/** 当前模型是否暴露推理强度选择器。 */
export function reasoningVisibleFor(provider: ChatProviderId, modelId: string): boolean {
    if (provider !== 'claude') return true;
    return EFFORT_SUPPORTED_CLAUDE_MODELS.has(strip1MContextSuffix(modelId));
}
