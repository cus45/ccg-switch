import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, RefreshCw } from 'lucide-react';
import { useUsageStore } from '../stores/useUsageStore';
import UsageSummaryCard from '../components/usage/UsageSummaryCard';
import UsageDailyChart from '../components/usage/UsageDailyChart';
import UsageModelTable from '../components/usage/UsageModelTable';

function UsagePage() {
    const { t } = useTranslation();
    const { summaries, loading, days, hasLoaded, loadSummaries, setDays } = useUsageStore();

    useEffect(() => {
        if (!hasLoaded) {
            void loadSummaries();
        }
    }, [hasLoaded, loadSummaries]);

    // 聚合统计
    const totalRequests = summaries.reduce((s, d) => s + d.totalRequests, 0);
    const totalTokens = summaries.reduce((s, d) => s + d.totalInputTokens + d.totalOutputTokens, 0);
    const totalCost = summaries.reduce((s, d) => s + d.totalCostUsd, 0);

    // 聚合模型数据（byModel 是 Record<string, ModelDailySummary>）
    const modelMap = new Map<string, { requests: number; input: number; output: number; cost: number }>();
    summaries.forEach(d => {
        Object.entries(d.byModel).forEach(([model, m]) => {
            const existing = modelMap.get(model) || { requests: 0, input: 0, output: 0, cost: 0 };
            modelMap.set(model, {
                requests: existing.requests + m.requests,
                input: existing.input + m.inputTokens,
                output: existing.output + m.outputTokens,
                cost: existing.cost + m.costUsd,
            });
        });
    });

    const modelRows = [...modelMap.entries()]
        .map(([model, data]) => ({ model, ...data }))
        .sort((a, b) => (b.input + b.output) - (a.input + a.output));

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="p-6 space-y-6 max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <BarChart3 className="w-6 h-6 text-emerald-500" />
                        <h1 className="text-xl font-bold text-gray-900 dark:text-base-content">
                            {t('usage.title', 'Proxy Usage')}
                        </h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {[7, 14, 30].map(d => (
                            <button
                                key={d}
                                onClick={() => setDays(d)}
                                className={`btn btn-sm ${days === d ? 'btn-primary' : 'btn-ghost'}`}
                            >
                                {d}d
                            </button>
                        ))}
                        <button
                            onClick={() => loadSummaries()}
                            disabled={loading}
                            className="btn btn-ghost btn-sm"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <UsageSummaryCard
                        label={t('usage.totalRequests', 'Total Requests')}
                        value={totalRequests.toLocaleString()}
                    />
                    <UsageSummaryCard
                        label={t('usage.totalTokens', 'Total Tokens')}
                        value={formatCompact(totalTokens)}
                    />
                    <UsageSummaryCard
                        label={t('usage.totalCost', 'Total Cost')}
                        value={`$${totalCost.toFixed(4)}`}
                    />
                </div>

                {/* Daily chart */}
                <UsageDailyChart summaries={summaries} />

                {/* Model table */}
                <UsageModelTable models={modelRows} />
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

export default UsagePage;
