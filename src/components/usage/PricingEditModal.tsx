import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Coins, Plus, Save, X } from 'lucide-react';
import { useUpdateModelPricing } from '../../hooks/useUsageQueries';
import type { ModelPricingInfo } from '../../types/usage';
import { showToast } from '../common/ToastContainer';
import { cn } from '../../utils/cn';
import { fieldLabel, ghostBtn, iconBtn, input, muted, primaryBtn } from './styles';

interface PricingEditModalProps {
    open: boolean;
    model: ModelPricingInfo;
    isNew?: boolean;
    onClose: () => void;
}

/** 单价输入：带 $ 前缀，数字等宽 */
function PriceInput({
    label,
    hint,
    value,
    onChange,
}: {
    label: string;
    hint: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="block">
            <span className={fieldLabel}>
                {label} <span className="font-normal opacity-70">{hint}</span>
            </span>
            <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                    $
                </span>
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={cn(input, 'pl-6 tabular-nums')}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    required
                />
            </div>
        </label>
    );
}

export function PricingEditModal({ open, model, isNew = false, onClose }: PricingEditModalProps) {
    const { t } = useTranslation();
    const updatePricing = useUpdateModelPricing();

    const [formData, setFormData] = useState({
        modelId: model.modelId,
        displayName: model.displayName,
        inputCost: model.inputCostPerMillion,
        outputCost: model.outputCostPerMillion,
        cacheReadCost: model.cacheReadCostPerMillion,
        cacheCreationCost: model.cacheCreationCostPerMillion,
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // 验证模型 ID
        if (isNew && !formData.modelId.trim()) {
            showToast(t('usage.modelIdRequired'), 'error');
            return;
        }

        // 验证非负数
        const values = [
            formData.inputCost,
            formData.outputCost,
            formData.cacheReadCost,
            formData.cacheCreationCost,
        ];

        for (const value of values) {
            const num = parseFloat(value);
            if (isNaN(num) || num < 0) {
                showToast(t('usage.invalidPrice'), 'error');
                return;
            }
        }

        try {
            await updatePricing.mutateAsync({
                modelId: isNew ? formData.modelId : model.modelId,
                displayName: formData.displayName,
                inputCost: formData.inputCost,
                outputCost: formData.outputCost,
                cacheReadCost: formData.cacheReadCost,
                cacheCreationCost: formData.cacheCreationCost,
            });

            showToast(t('common.saved'), 'success');
            onClose();
        } catch (error) {
            showToast(t('usage.savePricingFailed') + ': ' + String(error), 'error');
        }
    };

    if (!open) return null;

    const hint = t('usage.perMillion');

    return (
        <dialog className="modal modal-open">
            <div className="modal-box max-w-xl rounded-xl p-0">
                {/* 头部 */}
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-base-200">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                            <Coins className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-base font-semibold text-gray-900 dark:text-base-content">
                                {isNew ? t('usage.addPricing') : t('usage.editPricing')}
                            </h3>
                            {!isNew && (
                                <p className={cn('font-mono text-xs', muted)}>{model.modelId}</p>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        className={iconBtn}
                        onClick={onClose}
                        aria-label={t('common.close')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
                    {isNew && (
                        <label className="block">
                            <span className={fieldLabel}>{t('usage.modelId')}</span>
                            <input
                                type="text"
                                className={cn(input, 'font-mono')}
                                value={formData.modelId}
                                onChange={(e) =>
                                    setFormData({ ...formData, modelId: e.target.value })
                                }
                                placeholder={t('usage.modelIdPlaceholder')}
                                required
                            />
                        </label>
                    )}

                    <label className="block">
                        <span className={fieldLabel}>{t('usage.displayName')}</span>
                        <input
                            type="text"
                            className={input}
                            value={formData.displayName}
                            onChange={(e) =>
                                setFormData({ ...formData, displayName: e.target.value })
                            }
                            placeholder={t('usage.displayNamePlaceholder')}
                            required
                        />
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                        <PriceInput
                            label={t('usage.inputCost')}
                            hint={hint}
                            value={formData.inputCost}
                            onChange={(v) => setFormData({ ...formData, inputCost: v })}
                        />
                        <PriceInput
                            label={t('usage.outputCost')}
                            hint={hint}
                            value={formData.outputCost}
                            onChange={(v) => setFormData({ ...formData, outputCost: v })}
                        />
                        <PriceInput
                            label={t('usage.cacheReadCost')}
                            hint={hint}
                            value={formData.cacheReadCost}
                            onChange={(v) => setFormData({ ...formData, cacheReadCost: v })}
                        />
                        <PriceInput
                            label={t('usage.cacheWriteCost')}
                            hint={hint}
                            value={formData.cacheCreationCost}
                            onChange={(v) => setFormData({ ...formData, cacheCreationCost: v })}
                        />
                    </div>

                    <div className="flex justify-end gap-2 border-t border-gray-100 pt-4 dark:border-base-200">
                        <button type="button" className={ghostBtn} onClick={onClose}>
                            {t('common.cancel')}
                        </button>
                        <button
                            type="submit"
                            className={primaryBtn}
                            disabled={updatePricing.isPending}
                        >
                            {isNew ? <Plus className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                            {updatePricing.isPending
                                ? t('common.saving')
                                : isNew
                                  ? t('common.add')
                                  : t('common.save')}
                        </button>
                    </div>
                </form>
            </div>
            <form method="dialog" className="modal-backdrop" onClick={onClose}>
                <button>close</button>
            </form>
        </dialog>
    );
}
