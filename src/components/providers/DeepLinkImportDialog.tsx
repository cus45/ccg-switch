import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { DeepLinkImportRequest } from '../../types/deeplink';
import { deeplinkService } from '../../services/deeplinkService';
import { useProviderStore } from '../../stores/useProviderStore';
import { showToast } from '../common/ToastContainer';

export function DeepLinkImportDialog() {
    const { t } = useTranslation();
    const [request, setRequest] = useState<DeepLinkImportRequest | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    // 监听后端 deep link 事件
    useEffect(() => {
        const unlistenImport = listen<DeepLinkImportRequest>('deeplink-import', (event) => {
            console.log('Deep link import event:', event.payload);
            setRequest(event.payload);
            setIsOpen(true);
        });

        const unlistenError = listen<string>('deeplink-error', (event) => {
            console.error('Deep link error:', event.payload);
            showToast(t('deeplink.parseError') + ': ' + event.payload, 'error');
        });

        return () => {
            unlistenImport.then(fn => fn());
            unlistenError.then(fn => fn());
        };
    }, [t]);

    // API Key 遮掩
    const maskedApiKey = request?.apiKey && request.apiKey.length > 4
        ? `${request.apiKey.substring(0, 4)}${'*'.repeat(20)}`
        : '****';

    // 导入处理
    const handleImport = async () => {
        if (!request) return;
        setIsImporting(true);
        try {
            await deeplinkService.importProviderFromDeeplink(request);
            // 刷新 Provider 列表
            await useProviderStore.getState().loadAllProviders(true);
            showToast(t('deeplink.importSuccessDescription', { name: request.name }), 'success');
            setIsOpen(false);
            setRequest(null);
        } catch (error) {
            showToast(t('deeplink.importError') + ': ' + String(error), 'error');
        } finally {
            setIsImporting(false);
        }
    };

    const handleCancel = () => {
        setIsOpen(false);
        setRequest(null);
    };

    if (!isOpen || !request) return null;

    return (
        <dialog className="modal modal-open" style={{ zIndex: 9999 }}>
            <div className="modal-box max-w-lg">
                {/* 标题 */}
                <h3 className="font-bold text-lg">{t('deeplink.confirmImport')}</h3>
                <p className="text-sm text-base-content/60 mt-1">{t('deeplink.confirmImportDescription')}</p>

                {/* 字段展示 - grid 布局 */}
                <div className="mt-4 space-y-3">
                    {/* App Type */}
                    <div className="grid grid-cols-3 gap-2 items-center">
                        <span className="text-sm text-base-content/60">{t('deeplink.app')}</span>
                        <span className="col-span-2 text-sm font-medium capitalize">{request.app}</span>
                    </div>

                    {/* Provider Name */}
                    <div className="grid grid-cols-3 gap-2 items-center">
                        <span className="text-sm text-base-content/60">{t('deeplink.providerName')}</span>
                        <span className="col-span-2 text-sm font-medium">{request.name}</span>
                    </div>

                    {/* Homepage (optional) */}
                    {request.homepage && (
                        <div className="grid grid-cols-3 gap-2 items-center">
                            <span className="text-sm text-base-content/60">{t('deeplink.homepage')}</span>
                            <span className="col-span-2 text-sm break-all text-blue-500">{request.homepage}</span>
                        </div>
                    )}

                    {/* Endpoint - 支持逗号分隔多行 */}
                    {request.endpoint && (
                        <div className="grid grid-cols-3 gap-2 items-start">
                            <span className="text-sm text-base-content/60 pt-0.5">{t('deeplink.endpoint')}</span>
                            <div className="col-span-2 text-sm break-all space-y-1">
                                {request.endpoint.split(',').map((ep, idx) => (
                                    <div key={idx} className={idx === 0 ? 'font-medium' : 'text-base-content/60'}>
                                        {idx === 0 && request.endpoint?.includes(',') ? '🔹 ' : ''}
                                        {ep.trim()}
                                        {idx === 0 && request.endpoint?.includes(',') && (
                                            <span className="text-xs text-base-content/40 ml-2">({t('deeplink.primaryEndpoint')})</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* API Key (masked) */}
                    {request.apiKey && (
                        <div className="grid grid-cols-3 gap-2 items-center">
                            <span className="text-sm text-base-content/60">{t('deeplink.apiKey')}</span>
                            <span className="col-span-2 text-sm font-mono text-base-content/50">{maskedApiKey}</span>
                        </div>
                    )}

                    {/* Model 字段 - 根据应用类型不同展示 */}
                    {request.app === 'claude' ? (
                        <>
                            {request.haikuModel && (
                                <div className="grid grid-cols-3 gap-2 items-center">
                                    <span className="text-sm text-base-content/60">{t('deeplink.haikuModel')}</span>
                                    <span className="col-span-2 text-sm font-mono">{request.haikuModel}</span>
                                </div>
                            )}
                            {request.sonnetModel && (
                                <div className="grid grid-cols-3 gap-2 items-center">
                                    <span className="text-sm text-base-content/60">{t('deeplink.sonnetModel')}</span>
                                    <span className="col-span-2 text-sm font-mono">{request.sonnetModel}</span>
                                </div>
                            )}
                            {request.opusModel && (
                                <div className="grid grid-cols-3 gap-2 items-center">
                                    <span className="text-sm text-base-content/60">{t('deeplink.opusModel')}</span>
                                    <span className="col-span-2 text-sm font-mono">{request.opusModel}</span>
                                </div>
                            )}
                            {request.model && (
                                <div className="grid grid-cols-3 gap-2 items-center">
                                    <span className="text-sm text-base-content/60">{t('deeplink.multiModel')}</span>
                                    <span className="col-span-2 text-sm font-mono">{request.model}</span>
                                </div>
                            )}
                        </>
                    ) : (
                        request.model && (
                            <div className="grid grid-cols-3 gap-2 items-center">
                                <span className="text-sm text-base-content/60">{t('deeplink.model')}</span>
                                <span className="col-span-2 text-sm font-mono">{request.model}</span>
                            </div>
                        )
                    )}

                    {/* Notes */}
                    {request.notes && (
                        <div className="grid grid-cols-3 gap-2 items-start">
                            <span className="text-sm text-base-content/60">{t('deeplink.notes')}</span>
                            <span className="col-span-2 text-sm text-base-content/60">{request.notes}</span>
                        </div>
                    )}

                    {/* Config source badge (if present) */}
                    {(request.config || request.configUrl) && (
                        <div className="grid grid-cols-3 gap-2 items-center">
                            <span className="text-sm text-base-content/60">{t('deeplink.configSource')}</span>
                            <div className="col-span-2">
                                <span className="badge badge-sm badge-info">
                                    {request.config ? t('deeplink.configEmbedded') : t('deeplink.configRemote')}
                                </span>
                                {request.configFormat && (
                                    <span className="text-xs text-base-content/40 ml-2 uppercase">{request.configFormat}</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Warning */}
                <div className="mt-4 rounded-lg bg-warning/10 p-3 text-sm text-warning-content dark:text-yellow-200">
                    {t('deeplink.warning')}
                </div>

                {/* Actions */}
                <div className="modal-action">
                    <button className="btn btn-ghost" onClick={handleCancel} disabled={isImporting}>
                        取消
                    </button>
                    <button className="btn btn-primary" onClick={handleImport} disabled={isImporting}>
                        {isImporting ? (
                            <><span className="loading loading-spinner loading-xs"></span> {t('deeplink.importing')}</>
                        ) : (
                            t('deeplink.import')
                        )}
                    </button>
                </div>
            </div>
            {/* 点击遮罩关闭 */}
            <form method="dialog" className="modal-backdrop">
                <button onClick={handleCancel}>close</button>
            </form>
        </dialog>
    );
}
