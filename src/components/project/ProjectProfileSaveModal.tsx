import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderPlus, Loader2 } from 'lucide-react';
import ModalDialog from '../common/ModalDialog';
import { showToast } from '../common/ToastContainer';
import { useProjectProfileStore } from '../../stores/useProjectProfileStore';

interface ProjectProfileSaveModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function ProjectProfileSaveModal({ isOpen, onClose }: ProjectProfileSaveModalProps) {
    const { t } = useTranslation();
    const { captureCurrent } = useProjectProfileStore();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);

    if (!isOpen) return null;

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) {
            showToast(t('projectProfiles.nameRequired', '请输入项目名称'), 'warning');
            return;
        }

        setSaving(true);
        try {
            await captureCurrent(trimmed, description.trim() || undefined);
            showToast(t('projectProfiles.saveSuccess', '已将当前整套配置保存为新项目并激活'), 'success');
            setName('');
            setDescription('');
            onClose();
        } catch (err) {
            showToast(String(err), 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalDialog
            isOpen={isOpen}
            type="info"
            title={t('projectProfiles.saveCurrentTitle', '另存当前配置为新项目')}
            message={t('projectProfiles.saveCurrentDesc', '将当前各应用活跃的供应商、启用的 MCP 服务器、技能以及 Prompt 预设打包为一个独立的项目环境，方便日后一键切换。')}
            onConfirm={onClose}
            onCancel={onClose}
        >
            <form onSubmit={handleSave} className="space-y-4 pt-2">
                <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('projectProfiles.nameLabel', '项目名称')} <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('projectProfiles.namePlaceholder', '如：公司企业级开发、DeepSeek 编程等')}
                        className="w-full rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900/50 px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        autoFocus
                    />
                </div>

                <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('projectProfiles.descLabel', '项目描述（可选）')}
                    </label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t('projectProfiles.descPlaceholder', '简要说明此项目环境的用途或配置特点...')}
                        rows={2}
                        className="w-full rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900/50 px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="px-3 py-1.5 rounded-md text-sm border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                        {t('common.cancel', '取消')}
                    </button>
                    <button
                        type="submit"
                        disabled={saving || !name.trim()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50 transition-colors"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
                        {t('common.save', '保存并激活')}
                    </button>
                </div>
            </form>
        </ModalDialog>
    );
}
