import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Server, Activity } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface ProxyState {
    running: boolean;
    port: number;
    host: string;
    requestCount: number;
}

function ProxyUsageCard() {
    const { t } = useTranslation();
    const [status, setStatus] = useState<ProxyState | null>(null);

    useEffect(() => {
        invoke<ProxyState>('get_proxy_status').then(setStatus).catch(() => {});
    }, []);

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <div className="flex items-center gap-2 mb-3">
                <Server className="w-5 h-5 text-indigo-500" />
                <h3 className="font-semibold text-gray-900 dark:text-base-content">
                    {t('dashboard.proxyStatus')}
                </h3>
            </div>
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${status?.running ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                        {status?.running ? t('proxy.running') : t('proxy.stopped')}
                    </span>
                </div>
                {status?.running && (
                    <>
                        <div className="text-sm text-gray-500">
                            {status.host}:{status.port}
                        </div>
                        <div className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                            <Activity className="w-3.5 h-3.5" />
                            {status.requestCount} {t('dashboard.requests')}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default ProxyUsageCard;
