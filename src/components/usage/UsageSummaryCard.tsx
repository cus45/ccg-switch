import { useTranslation } from 'react-i18next';

interface UsageSummaryCardProps {
    label: string;
    value: string;
}

function UsageSummaryCard({ label, value }: UsageSummaryCardProps) {
    const { t: _t } = useTranslation();

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <div className="text-2xl font-bold text-gray-900 dark:text-base-content">
                {value}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {label}
            </div>
        </div>
    );
}

export default UsageSummaryCard;
