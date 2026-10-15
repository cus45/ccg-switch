import {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Check, ChevronDown, Settings2} from 'lucide-react';
import {useProviderStore} from '../../stores/useProviderStore';
import {useChatStore} from '../../stores/useChatStore';
import type {AppType} from '../../types/app';
import type {Provider} from '../../types/provider';
import {showToast} from '../common/ToastContainer';

export interface ChatProviderSelectorProps {
    appType: AppType;
    variant?: 'header' | 'compact';
    disabled?: boolean;
    className?: string;
}

function getDomainFromUrl(url?: string): string {
    if (!url) return '';
    try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        return parsed.hostname;
    } catch {
        return url.replace(/^https?:\/\//, '').split('/')[0] || url;
    }
}

/**
 * 对话模块内嵌的服务商快速切换组件。
 *
 * 直接复用全局 `useProviderStore`，在对话界面直观呈现当前活跃的 API 服务商，
 * 支持在当前会话中即时无缝切换服务商与联动模型，不丢弃上下文。
 */
export default function ChatProviderSelector({
    appType,
    variant = 'header',
    disabled = false,
    className = '',
}: ChatProviderSelectorProps) {
    const {t} = useTranslation();
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    const {providers, hasLoaded, loading, loadAllProviders, switchProvider} = useProviderStore();

    useEffect(() => {
        if (!hasLoaded && !loading) {
            void loadAllProviders();
        }
    }, [hasLoaded, loading, loadAllProviders]);

    const appProviders = useMemo(() => {
        if (!providers || !Array.isArray(providers)) return [];
        return providers.filter((p) => p && p.appType === appType);
    }, [providers, appType]);

    const activeProvider = useMemo(() => {
        return appProviders.find((p) => p.isActive) || appProviders[0];
    }, [appProviders]);

    useEffect(() => {
        if (!open) return;
        const handleDocClick = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', handleDocClick);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleDocClick);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);

    const handleSelect = async (target: Provider) => {
        if (target.id === activeProvider?.id && target.isActive) {
            setOpen(false);
            return;
        }

        try {
            await switchProvider(appType, target.id);
            // 切换后如果该服务商配置了推荐默认模型，联动更新当前模型选择
            const recommendedModel =
                target.defaultSonnetModel ||
                target.defaultReasoningModel ||
                target.defaultOpusModel ||
                target.defaultHaikuModel;
            if (recommendedModel) {
                useChatStore.getState().setModel(recommendedModel);
            }
            showToast(t('chat.providerSwitched', { defaultValue: `已切换至服务商: ${target.name}`, name: target.name }), 'success');
        } catch (err) {
            showToast(t('chat.providerSwitchFailed', { defaultValue: `切换服务商失败: ${err}`, err: String(err) }), 'error');
        } finally {
            setOpen(false);
        }
    };

    const isCompact = variant === 'compact';
    const displayName = activeProvider?.name || t('chat.defaultProvider', { defaultValue: '默认服务商' });
    const domainText = getDomainFromUrl(activeProvider?.url);

    return (
        <div className={`relative inline-block text-left ${className}`} ref={rootRef}>
            <button
                type="button"
                data-testid="chat-provider-selector-trigger"
                disabled={disabled}
                onClick={() => setOpen((prev) => !prev)}
                title={
                    disabled
                        ? '生成中，无法切换服务商'
                        : `当前服务商: ${displayName}${domainText ? ` (${domainText})` : ''}`
                }
                className={
                    isCompact
                        ? `flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
                              disabled
                                  ? 'cursor-not-allowed border-base-200 bg-base-100 text-base-content/35'
                                  : 'border-base-300 bg-base-100 text-base-content/85 hover:border-base-content/25 hover:bg-base-200/50'
                          }`
                        : `btn btn-ghost btn-xs h-7 min-h-0 gap-1.5 px-2 font-normal ${
                              disabled ? 'opacity-40 cursor-not-allowed' : 'text-base-content/75 hover:text-base-content'
                          }`
                }
            >
                <span className="flex h-2 w-2 shrink-0 items-center justify-center">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
                </span>
                <span className="truncate max-w-[140px] text-xs font-medium">
                    {displayName}
                </span>
                <ChevronDown size={12} className={`shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div
                    data-testid="chat-provider-dropdown"
                    className="absolute left-0 top-full z-50 mt-1 min-w-[240px] max-w-[320px] rounded-lg border border-base-300 bg-base-100 p-1.5 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
                >
                    <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold tracking-wider text-base-content/50 uppercase">
                        <span>API 服务商</span>
                        <span className="text-[10px] text-base-content/40 font-normal">
                            {appType.toUpperCase()}
                        </span>
                    </div>

                    <div className="max-h-60 overflow-y-auto space-y-0.5 py-1">
                        {appProviders.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-base-content/50">
                                暂无配置的服务商
                            </div>
                        ) : (
                            appProviders.map((item) => {
                                const isSelected = item.id === activeProvider?.id && item.isActive;
                                const itemDomain = getDomainFromUrl(item.url);
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        data-testid={`chat-provider-option-${item.id}`}
                                        onClick={() => void handleSelect(item)}
                                        className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                                            isSelected
                                                ? 'bg-primary/10 text-primary font-medium'
                                                : 'text-base-content/80 hover:bg-base-200/70 hover:text-base-content'
                                        }`}
                                    >
                                        <div className="flex min-w-0 flex-1 flex-col pr-2">
                                            <div className="flex items-center gap-1.5">
                                                <span className="truncate font-medium">{item.name}</span>
                                                {item.inFailoverQueue && (
                                                    <span className="badge badge-ghost badge-xs scale-90 px-1 text-[10px]">
                                                        备用
                                                    </span>
                                                )}
                                            </div>
                                            {itemDomain && (
                                                <span className="truncate text-[10px] text-base-content/40">
                                                    {itemDomain}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex shrink-0 items-center gap-1">
                                            {isSelected && (
                                                <Check size={14} className="text-primary shrink-0" />
                                            )}
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    <div className="border-t border-base-300 mt-1 pt-1 flex items-center justify-between px-1">
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                window.location.hash = '#/providers';
                            }}
                            className="btn btn-ghost btn-xs h-6 w-full justify-start gap-1.5 px-2 text-[11px] text-base-content/60 hover:text-base-content"
                        >
                            <Settings2 size={12} />
                            <span>管理服务商与密钥...</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
