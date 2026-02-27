import { useState, useEffect } from 'react';
import { Settings, Save } from 'lucide-react';
import { useProxyStore } from '../../stores/useProxyStore';
import { showToast } from '../common/ToastContainer';

export default function ProxyConfig() {
    const { proxyState, config, loadConfig, updateConfig } = useProxyStore();
    const running = proxyState?.running ?? false;

    const [localHost, setLocalHost] = useState(config.host);
    const [localPort, setLocalPort] = useState(String(config.port));
    const [localTakeover, setLocalTakeover] = useState(config.takeoverMode);

    // 同步 store config 到本地状态
    useEffect(() => {
        setLocalHost(config.host);
        setLocalPort(String(config.port));
        setLocalTakeover(config.takeoverMode);
    }, [config]);

    useEffect(() => {
        void loadConfig();
    }, [loadConfig]);

    const portNum = parseInt(localPort, 10);
    const portValid = !isNaN(portNum) && portNum >= 1024 && portNum <= 65535;
    const hostValid = localHost.trim().length > 0;
    const canSave = portValid && hostValid && !running;

    const handleSave = () => {
        if (!canSave) return;
        updateConfig({
            host: localHost.trim(),
            port: portNum,
            takeoverMode: localTakeover,
        });
        showToast('配置已保存', 'success');
    };

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl shadow-sm border border-gray-100 dark:border-base-200 p-5">
            <div className="flex items-center gap-2 mb-4">
                <Settings className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold text-gray-900 dark:text-base-content">代理配置</h2>
                {running && (
                    <span className="ml-auto text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
                        运行中时不可修改
                    </span>
                )}
            </div>

            <div className="space-y-4">
                {/* Host */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        监听地址
                    </label>
                    <input
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        端口 <span className="text-gray-400 font-normal">(1024–65535)</span>
                    </label>
                    <input
                        type="number"
                        value={localPort}
                        onChange={(e) => setLocalPort(e.target.value)}
                        disabled={running}
                        min={1024}
                        max={65535}
                        className={`input input-bordered input-sm w-full ${!portValid && localPort.length > 0 ? 'input-error' : ''} disabled:opacity-60`}
                    />
                    {!portValid && localPort.length > 0 && (
                        <p className="text-xs text-error mt-1">端口需在 1024–65535 范围内</p>
                    )}
                </div>

                {/* Takeover Mode */}
                <div className="flex items-center justify-between py-2 border-t border-gray-100 dark:border-base-200">
                    <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">接管模式</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            启用后代理将接管所有流量
                        </p>
                    </div>
                    <input
                        type="checkbox"
                        checked={localTakeover}
                        onChange={(e) => setLocalTakeover(e.target.checked)}
                        disabled={running}
                        className="toggle toggle-sm toggle-success disabled:opacity-60"
                    />
                </div>

                {/* 保存按钮 */}
                <button
                    onClick={handleSave}
                    disabled={!canSave}
                    className="w-full btn btn-sm gap-2 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-none disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Save className="w-4 h-4" />
                    保存配置
                </button>
            </div>
        </div>
    );
}
