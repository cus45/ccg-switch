import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Activity, Check, Copy, Power, RefreshCw, Save, Settings} from 'lucide-react';
import {useProxyStore} from '../../stores/useProxyStore';
import {showToast} from '../common/ToastContainer';

export default function ProxyStatus() {
    const { t } = useTranslation();
    const { proxyState, config, loading, loadStatus, loadConfig, startProxy, stopProxy, updateConfig } = useProxyStore();

    const running = proxyState?.running ?? false;
    const [copied, setCopied] = useState(false);

    // 配置表单状态
    const [localHost, setLocalHost] = useState(config.host);
    const [localPort, setLocalPort] = useState(String(config.port));
    const [localTakeover, setLocalTakeover] = useState(config.takeoverMode);

    useEffect(() => {
        void loadStatus();
        void loadConfig();
    }, [loadStatus, loadConfig]);

    useEffect(() => {
        setLocalHost(config.host);
        setLocalPort(String(config.port));
        setLocalTakeover(config.takeoverMode);
    }, [config]);

    const portNum = parseInt(localPort, 10);
    const portValid = !isNaN(portNum) && portNum >= 1024 && portNum <= 65535;
    const hostValid = localHost.trim().length > 0;
    const canSave = portValid && hostValid && !running;

    const handleStart = async () => {
        try {
            // 启动前把表单当前值落盘，避免"改了没保存就启动"用到旧配置
            let host = config.host;
            let port = config.port;
            if (portValid && hostValid) {
                host = localHost.trim();
                port = portNum;
                await updateConfig({ host, port, takeoverMode: localTakeover });
            }
            await startProxy(host, port);
            showToast(t('proxy.status.started'), 'success');
        } catch (error) {
            showToast(t('proxy.status.startFailed', { error: String(error) }), 'error');
        }
    };

    const handleStop = async () => {
        try {
            await stopProxy();
            showToast(t('proxy.status.stoppedToast'), 'info');
        } catch (error) {
            showToast(t('proxy.status.stopFailed', { error: String(error) }), 'error');
        }
    };

    const handleSave = async () => {
        if (!canSave) return;
        try {
            await updateConfig({
                host: localHost.trim(),
                port: portNum,
                takeoverMode: localTakeover,
            });
            showToast(t('proxy.status.configSaved'), 'success');
        } catch (error) {
            showToast(t('proxy.status.configSaveFailed', { error: String(error) }), 'error');
        }
    };

    const handleCopyAddress = () => {
        if (!proxyState) return;
        const addr = `http://${proxyState.host}:${proxyState.port}`;
        navigator.clipboard.writeText(addr);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl shadow-sm border border-gray-100 dark:border-base-200">
            {/* 顶部状态栏 */}
            <div className="flex items-center justify-between p-4 pb-0">
                <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${running ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                    <span className={`text-sm font-semibold ${running ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                        {running ? t('proxy.status.running') : t('proxy.status.stopped')}
                    </span>
                    {running && proxyState && (
                        <div className="flex items-center gap-1.5 ml-1">
                            <code className="text-xs bg-gray-100 dark:bg-base-200 px-2 py-0.5 rounded font-mono text-gray-600 dark:text-gray-300">
                                {proxyState.host}:{proxyState.port}
                            </code>
                            <button
                                onClick={handleCopyAddress}
                                className="btn btn-ghost btn-xs px-1"
                                title={t('proxy.status.copyAddress')}
                            >
                                {copied
                                    ? <Check className="w-3 h-3 text-green-500" />
                                    : <Copy className="w-3 h-3" />
                                }
                            </button>
                            {proxyState.takeoverActive && (
                                <span
                                    className="text-[10px] font-medium text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 px-1.5 py-0.5 rounded-full"
                                    title={t('proxy.status.takenOverHint', { apps: proxyState.takenOverApps.join('、') })}
                                >
                                    {t('proxy.status.takenOver', { apps: proxyState.takenOverApps.join(' / ') })}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1.5">
                    {running && proxyState && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 mr-2 flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            {t('proxy.status.requests', { count: proxyState.requestCount })}
                        </span>
                    )}
                    <button
                        onClick={() => void loadStatus()}
                        disabled={loading}
                        className="btn btn-ghost btn-xs btn-square"
                        title={t('proxy.status.refresh')}
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    {!running ? (
                        <button
                            onClick={() => void handleStart()}
                            disabled={loading}
                            className="btn btn-success btn-xs gap-1"
                        >
                            {loading
                                ? <span className="loading loading-spinner loading-xs" />
                                : <Power className="w-3.5 h-3.5" />
                            }
                            {t('proxy.status.start')}
                        </button>
                    ) : (
                        <button
                            onClick={() => void handleStop()}
                            disabled={loading}
                            className="btn btn-error btn-xs gap-1"
                        >
                            {loading
                                ? <span className="loading loading-spinner loading-xs" />
                                : <Power className="w-3.5 h-3.5" />
                            }
                            {t('proxy.status.stop')}
                        </button>
                    )}
                </div>
            </div>

            {/* 配置区域 */}
            <div className="p-4 pt-3">
                <div className="flex items-center gap-1.5 mb-3">
                    <Settings className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        {t('proxy.config.basicTitle')}
                    </span>
                    {running && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full ml-auto">
                            {t('proxy.config.cannotModifyRunning')}
                        </span>
                    )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-[1fr_120px_auto_auto] gap-3 items-end">
                    {/* Host */}
                    <div>
                        <label htmlFor="proxy-host" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            {t('proxy.config.host')}
                        </label>
                        <input
                            id="proxy-host"
                            type="text"
                            value={localHost}
                            onChange={(e) => setLocalHost(e.target.value)}
                            disabled={running}
                            placeholder="0.0.0.0"
                            className={`input input-bordered input-sm w-full ${!hostValid && localHost.length > 0 ? 'input-error' : ''} disabled:opacity-60`}
                        />
                    </div>

                    {/* Port */}
                    <div>
                        <label htmlFor="proxy-port" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            {t('proxy.config.port')}
                        </label>
                        <input
                            id="proxy-port"
                            type="number"
                            value={localPort}
                            onChange={(e) => setLocalPort(e.target.value)}
                            disabled={running}
                            min={1024}
                            max={65535}
                            placeholder="8080"
                            className={`input input-bordered input-sm w-full ${!portValid && localPort.length > 0 ? 'input-error' : ''} disabled:opacity-60`}
                        />
                    </div>

                    {/* Takeover */}
                    <div className="flex items-center gap-2 pb-0.5">
                        <input
                            type="checkbox"
                            checked={localTakeover}
                            onChange={(e) => setLocalTakeover(e.target.checked)}
                            disabled={running}
                            className="toggle toggle-xs toggle-success disabled:opacity-60"
                        />
                        <span
                            className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap"
                            title={t('proxy.config.takeoverHint')}
                        >
                            {t('proxy.config.takeoverMode')}
                        </span>
                    </div>

                    {/* Save */}
                    <button
                        onClick={handleSave}
                        disabled={!canSave}
                        className="btn btn-sm gap-1 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-none disabled:opacity-50"
                    >
                        <Save className="w-3.5 h-3.5" />
                        {t('proxy.config.save')}
                    </button>
                </div>

                {!portValid && localPort.length > 0 && (
                    <p className="text-xs text-error mt-1.5">{t('proxy.config.portRange')}</p>
                )}
            </div>
        </div>
    );
}
