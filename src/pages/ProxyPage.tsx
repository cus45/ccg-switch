import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ProxyStatus from '../components/proxy/ProxyStatus';
import FailoverQueue from '../components/proxy/FailoverQueue';

function ProxyPage() {
    const { t } = useTranslation();
    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="p-6 max-w-5xl mx-auto space-y-4">
                {/* 标题栏 */}
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow-md">
                        <Network className="w-5 h-5 text-white" />
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-base-content">
                        {t('proxy.dashboardTitle', 'Proxy 控制面板')}
                    </h1>
                </div>

                {/* 状态 + 配置 */}
                <ProxyStatus />

                {/* 故障转移队列 */}
                <FailoverQueue />
            </div>
        </div>
    );
}

export default ProxyPage;
