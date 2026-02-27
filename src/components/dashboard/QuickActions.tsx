import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, Server, Settings, BarChart3 } from 'lucide-react';

function QuickActions() {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const actions = [
        { icon: Plus, label: t('dashboard.addProvider'), path: '/providers', color: 'text-orange-500' },
        { icon: Server, label: t('dashboard.manageProxy'), path: '/proxy', color: 'text-indigo-500' },
        { icon: BarChart3, label: t('dashboard.viewUsage'), path: '/usage', color: 'text-emerald-500' },
        { icon: Settings, label: t('dashboard.openSettings'), path: '/settings', color: 'text-gray-500' },
    ];

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <h3 className="font-semibold text-gray-900 dark:text-base-content mb-3">
                {t('dashboard.quickActions')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
                {actions.map((action) => (
                    <button
                        key={action.path}
                        onClick={() => navigate(action.path)}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-base-200 hover:bg-gray-100 dark:hover:bg-base-300 transition-colors text-left"
                    >
                        <action.icon className={`w-4 h-4 ${action.color}`} />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{action.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

export default QuickActions;
