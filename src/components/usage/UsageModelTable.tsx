import { useTranslation } from 'react-i18next';
import { Hash } from 'lucide-react';

interface ModelUsageRow {
    model: string;
    requests: number;
    input: number;
    output: number;
    cost: number;
}

interface UsageModelTableProps {
    models: ModelUsageRow[];
}

function UsageModelTable({ models }: UsageModelTableProps) {
    const { t } = useTranslation();

    if (models.length === 0) {
        return (
            <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
                <div className="flex items-center gap-2 mb-4">
                    <Hash className="w-5 h-5 text-purple-500" />
                    <h2 className="font-semibold text-gray-900 dark:text-base-content">
                        {t('usage.modelTable', 'Model Usage')}
                    </h2>
                </div>
                <div className="h-24 flex items-center justify-center text-sm text-gray-400">
                    {t('usage.noData', 'No usage data available')}
                </div>
            </div>
        );
    }

    const maxTokens = Math.max(...models.map(m => m.input + m.output), 1);

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <div className="flex items-center gap-2 mb-4">
                <Hash className="w-5 h-5 text-purple-500" />
                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                    {t('usage.modelTable', 'Model Usage')}
                </h2>
                <span className="text-xs text-gray-400 ml-auto">
                    {models.length} {t('usage.models', 'models')}
                </span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-base-200">
                            <th className="text-left py-2 pr-4 font-medium">
                                {t('usage.model', 'Model')}
                            </th>
                            <th className="text-right py-2 px-2 font-medium">
                                {t('usage.requests', 'Requests')}
                            </th>
                            <th className="text-right py-2 px-2 font-medium">
                                {t('usage.inputTokens', 'Input')}
                            </th>
                            <th className="text-right py-2 px-2 font-medium">
                                {t('usage.outputTokens', 'Output')}
                            </th>
                            <th className="text-right py-2 px-2 font-medium">
                                {t('usage.cost', 'Cost')}
                            </th>
                            <th className="text-left py-2 pl-3 font-medium w-32">
                                {t('usage.share', 'Share')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {models.map((row) => {
                            const totalTokens = row.input + row.output;
                            const sharePercent = Math.max((totalTokens / maxTokens) * 100, 2);
                            return (
                                <tr
                                    key={row.model}
                                    className="border-b border-gray-50 dark:border-base-200 last:border-0 hover:bg-gray-50 dark:hover:bg-base-200 transition-colors"
                                >
                                    <td
                                        className="py-2 pr-4 font-medium text-gray-900 dark:text-base-content truncate max-w-[220px]"
                                        title={row.model}
                                    >
                                        {row.model}
                                    </td>
                                    <td className="py-2 px-2 text-right text-gray-600 dark:text-gray-300">
                                        {row.requests.toLocaleString()}
                                    </td>
                                    <td className="py-2 px-2 text-right text-gray-600 dark:text-gray-300">
                                        {formatCompact(row.input)}
                                    </td>
                                    <td className="py-2 px-2 text-right text-gray-600 dark:text-gray-300">
                                        {formatCompact(row.output)}
                                    </td>
                                    <td className="py-2 px-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                                        ${row.cost.toFixed(4)}
                                    </td>
                                    <td className="py-2 pl-3 w-32">
                                        <div className="h-2 rounded-full bg-gray-200 dark:bg-base-300 overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-300"
                                                style={{ width: `${sharePercent}%` }}
                                            />
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function formatCompact(v: number): string {
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toLocaleString();
}

export default UsageModelTable;
