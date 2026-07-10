import {useTranslation} from 'react-i18next';
import {
    Bot,
    Circle,
    CircleDashed,
    CircleDot,
    ClipboardList,
    Flame,
    Lightbulb,
    Loader2,
    type LucideIcon,
    MessageSquare,
    RefreshCw,
    Rocket,
    Send,
    Sparkles,
    Square,
    Zap,
} from 'lucide-react';
import {SelectorDropdown, type SelectorOption} from './SelectorDropdown';
import {
    AVAILABLE_MODES,
    AVAILABLE_PROVIDERS,
    type ChatProviderId,
    type ModelInfo,
    modelSupports1MContext,
    modelsForProvider,
    type PermissionMode,
    type ReasoningEffort,
    reasoningLevelsFor,
    reasoningVisibleFor,
} from './constants';
import {ModelIcon, ProviderBrandIcon} from './ModelIcon';
import {
    getChatComposerModeText,
    getChatComposerReasoningText,
    getChatComposerToolbarLabel,
} from '../../../utils/chatUiBehavior';

const MODE_ICONS: Record<string, LucideIcon> = {
    'message-square': MessageSquare,
    'clipboard-list': ClipboardList,
    bot: Bot,
    zap: Zap,
};

const REASONING_ICONS: Record<string, LucideIcon> = {
    'circle-dot': CircleDot,
    circle: Circle,
    'circle-dashed': CircleDashed,
    flame: Flame,
    rocket: Rocket,
};

interface ButtonAreaProps {
    provider: ChatProviderId;
    permissionMode: PermissionMode;
    model: string;
    models?: ModelInfo[];
    modelsLoading?: boolean;
    modelsError?: string | null;
    modelsCanRefresh?: boolean;
    modelsRefreshing?: boolean;
    modelsRefreshError?: string | null;
    longContextEnabled?: boolean;
    reasoningEffort: ReasoningEffort;
    isLoading: boolean;
    isSubmitting: boolean;
    isEnhancing: boolean;
    canSubmit: boolean;
    hasPromptText: boolean;
    onProviderChange: (p: ChatProviderId) => void;
    onModeChange: (m: PermissionMode) => void;
    onModelChange: (id: string) => void;
    onLongContextChange?: (enabled: boolean) => void;
    onRefreshModels?: () => void;
    onReasoningChange: (e: ReasoningEffort) => void;
    onEnhance: () => void;
    onSubmit: () => void;
    onStop: () => void;
}

/**
 * 输入区底部工具栏：provider / 权限模式 / 模型 / 推理强度选择器 +
 * Prompt 增强 + 发送/停止。移植自 jcc-gui ButtonArea。
 */
export function ButtonArea({
    provider,
    permissionMode,
    model,
    models: injectedModels,
    modelsLoading = false,
    modelsError = null,
    modelsCanRefresh = false,
    modelsRefreshing = false,
    modelsRefreshError = null,
    longContextEnabled = true,
    reasoningEffort,
    isLoading,
    isSubmitting,
    isEnhancing,
    canSubmit,
    hasPromptText,
    onProviderChange,
    onModeChange,
    onModelChange,
    onLongContextChange,
    onRefreshModels,
    onReasoningChange,
    onEnhance,
    onSubmit,
    onStop,
}: ButtonAreaProps) {
    const { t } = useTranslation();
    const providerLabel = getChatComposerToolbarLabel({control: 'provider', translate: t});
    const modeLabel = getChatComposerToolbarLabel({control: 'mode', translate: t});
    const modelLabel = getChatComposerToolbarLabel({control: 'model', translate: t});
    const reasoningLabel = getChatComposerToolbarLabel({control: 'reasoning', translate: t});
    const longContextLabel = getChatComposerToolbarLabel({control: 'long-context', translate: t});
    const modelsRefreshLabel = getChatComposerToolbarLabel({control: 'models-refresh', translate: t});
    const modelsRefreshingLabel = getChatComposerToolbarLabel({control: 'models-refreshing', translate: t});
    const modelsLoadingLabel = getChatComposerToolbarLabel({control: 'models-loading', translate: t});
    const enhancePromptLabel = getChatComposerToolbarLabel({control: 'enhance', translate: t});
    const sendLabel = getChatComposerToolbarLabel({control: 'send', translate: t});
    const stopLabel = getChatComposerToolbarLabel({control: 'stop', translate: t});

    const providerOptions: SelectorOption<ChatProviderId>[] = AVAILABLE_PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        icon: <ProviderBrandIcon provider={p.id} size={16} colored />,
    }));

    const modeOptions: SelectorOption<PermissionMode>[] = AVAILABLE_MODES.filter(
        // Codex 暂不暴露 plan 模式
        (m) => provider !== 'codex' || m.id !== 'plan',
    ).map((m) => {
        const Icon = MODE_ICONS[m.icon];
        return {
            id: m.id,
            label: getChatComposerModeText({
                mode: m.id,
                field: 'label',
                translate: t,
            }),
            description: getChatComposerModeText({
                mode: m.id,
                field: 'description',
                translate: t,
            }),
            icon: <Icon size={14} />,
        };
    });

    const models = injectedModels && injectedModels.length > 0
        ? injectedModels
        : modelsForProvider(provider);
    const modelOptions: SelectorOption<string>[] = models.map((m) => ({
        id: m.id,
        label: m.label,
        description: m.descKey
            ? t(`chat.models.${m.descKey}`, { defaultValue: '' }) || undefined
            : m.description,
        icon: <ModelIcon provider={provider} modelId={m.id} size={14} />,
    }));

    const reasoningVisible = reasoningVisibleFor(provider, model);
    const reasoningLevels = reasoningLevelsFor(provider, model);
    const reasoningOptions: SelectorOption<ReasoningEffort>[] = reasoningLevels.map((r) => {
        const Icon = REASONING_ICONS[r.icon];
        return {
            id: r.id,
            label: getChatComposerReasoningText({
                effort: r.id,
                field: 'label',
                translate: t,
            }),
            description: getChatComposerReasoningText({
                effort: r.id,
                field: 'description',
                translate: t,
            }),
            icon: <Icon size={14} />,
        };
    });

    const currentMode = AVAILABLE_MODES.find((m) => m.id === permissionMode);
    const CurrentModeIcon = currentMode ? MODE_ICONS[currentMode.icon] : MessageSquare;
    const currentModel = models.find((m) => m.id === model);
    const controlsDisabled = isLoading || isSubmitting;
    const supportsLongContext = modelSupports1MContext(model);
    const showLongContextToggle = provider === 'claude';
    const displayLongContextEnabled = supportsLongContext && longContextEnabled;
    const longContextTitle = supportsLongContext
        ? getChatComposerToolbarLabel({
            control: displayLongContextEnabled ? 'long-context-enabled' : 'long-context-disabled',
            translate: t,
        })
        : getChatComposerToolbarLabel({control: 'long-context-unavailable', translate: t});
    const modelStatusError = modelsRefreshError ?? modelsError;
    const modelStatusFooter = (modelsLoading || modelsRefreshing || modelStatusError) ? (
        <div
            className={`border-t border-base-300 px-2 py-1.5 text-[11px] ${
                modelStatusError ? 'text-error' : 'text-base-content/50'
            }`}
            title={modelStatusError ?? undefined}
        >
            {modelStatusError ?? (modelsRefreshing ? modelsRefreshingLabel : modelsLoadingLabel)}
        </div>
    ) : undefined;
    const showModelRefresh = modelsCanRefresh && Boolean(onRefreshModels);
    const modelRefreshTitle = modelsRefreshError
        ?? (modelsRefreshing ? modelsRefreshingLabel : modelsRefreshLabel);
    const modelRefreshAriaLabel = modelsRefreshing ? modelsRefreshingLabel : modelsRefreshLabel;

    return (
        <div className="chat-composer-toolbar flex flex-wrap items-center gap-1 px-1 pt-1">
            {/* 左侧选择器组 */}
            <div className="chat-composer-toolbar-selectors flex min-w-0 flex-1 flex-wrap items-center gap-1">
                <SelectorDropdown
                    value={provider}
                    options={providerOptions}
                    onChange={onProviderChange}
                    buttonIcon={<ProviderBrandIcon provider={provider} size={16} colored />}
                    compact
                    title={providerLabel}
                    disabled={controlsDisabled}
                />

                <SelectorDropdown
                    value={permissionMode}
                    options={modeOptions}
                    onChange={onModeChange}
                    buttonIcon={<CurrentModeIcon size={14} />}
                    buttonLabel={currentMode ? getChatComposerModeText({
                        mode: currentMode.id,
                        field: 'label',
                        translate: t,
                    }) : undefined}
                    highlight={permissionMode === 'bypassPermissions'}
                    title={modeLabel}
                    disabled={controlsDisabled}
                />

                <SelectorDropdown
                    value={model}
                    options={modelOptions}
                    onChange={onModelChange}
                    buttonIcon={<ModelIcon provider={provider} modelId={currentModel?.id ?? model} size={14} />}
                    buttonLabel={currentModel?.label ?? model}
                    title={modelLabel}
                    footer={modelStatusFooter}
                    disabled={controlsDisabled}
                />
                {showLongContextToggle && (
                    <button
                        type="button"
                        role="switch"
                        aria-checked={displayLongContextEnabled}
                        className={`chat-long-context-toggle flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium transition-colors ${
                            displayLongContextEnabled
                                ? 'border-primary/35 bg-primary/10 text-primary'
                                : 'border-base-300 bg-base-100 text-base-content/55 hover:border-base-content/25 hover:bg-base-200/50'
                        } disabled:cursor-not-allowed disabled:opacity-45`}
                        title={longContextTitle}
                        aria-label={longContextLabel}
                        disabled={controlsDisabled || !supportsLongContext}
                        onClick={() => onLongContextChange?.(!longContextEnabled)}
                    >
                        <span className={`h-2.5 w-2.5 rounded-full ${
                            displayLongContextEnabled ? 'bg-primary' : 'bg-base-content/35'
                        }`} />
                        <span>{longContextLabel}</span>
                    </button>
                )}
                {showModelRefresh && (
                    <button
                        type="button"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-base-300 bg-base-100 text-base-content/60 transition-colors hover:border-base-content/25 hover:bg-base-200/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
                        title={modelRefreshTitle}
                        aria-label={modelRefreshAriaLabel}
                        disabled={controlsDisabled || modelsRefreshing}
                        onClick={onRefreshModels}
                    >
                        <RefreshCw size={13} className={modelsRefreshing ? 'animate-spin' : ''} />
                    </button>
                )}

                {reasoningVisible && (
                    <SelectorDropdown
                        value={reasoningEffort}
                        options={reasoningOptions}
                        onChange={onReasoningChange}
                        buttonIcon={<Lightbulb size={14} />}
                        buttonLabel={getChatComposerReasoningText({
                            effort: reasoningEffort,
                            field: 'label',
                            translate: t,
                        })}
                        align="right"
                        title={reasoningLabel}
                        disabled={controlsDisabled}
                    />
                )}
            </div>

            {/* 右侧工具按钮 */}
            <div className="chat-composer-toolbar-actions ml-auto flex shrink-0 items-center gap-1">
                <button
                    type="button"
                    className="chat-composer-action-button flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base-content/60 transition-colors hover:bg-base-200 hover:text-primary disabled:opacity-40 disabled:hover:bg-transparent"
                    onClick={onEnhance}
                    disabled={!hasPromptText || controlsDisabled || isEnhancing}
                    title={enhancePromptLabel}
                    aria-label={enhancePromptLabel}
                >
                    {isEnhancing ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : (
                        <Sparkles size={16} />
                    )}
                </button>

                {isLoading ? (
                    <button
                        type="button"
                        className="chat-composer-primary-action flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-error text-error-content transition-colors hover:bg-error/90"
                        onClick={onStop}
                        title={stopLabel}
                        aria-label={stopLabel}
                    >
                        <Square size={15} />
                    </button>
                ) : (
                    <button
                        type="button"
                        className="chat-composer-primary-action flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-content transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-base-200 disabled:text-base-content/40 disabled:hover:bg-base-200"
                        onClick={onSubmit}
                        disabled={!canSubmit || isSubmitting}
                        title={sendLabel}
                        aria-label={sendLabel}
                    >
                        {isSubmitting ? (
                            <Loader2 size={15} className="animate-spin" />
                        ) : (
                            <Send size={15} />
                        )}
                    </button>
                )}
            </div>
        </div>
    );
}
