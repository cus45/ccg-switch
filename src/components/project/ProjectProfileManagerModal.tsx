import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CheckCircle2, ChevronRight, Folder, RefreshCw, Trash2, Zap, Globe, Key, FileText } from 'lucide-react';
import ModalDialog from '../common/ModalDialog';
import { showToast } from '../common/ToastContainer';
import { useProjectProfileStore } from '../../stores/useProjectProfileStore';
import { ProjectProfile } from '../../types/projectProfile';

interface ProjectProfileManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenSaveModal: () => void;
}

export default function ProjectProfileManagerModal({
    isOpen,
    onClose,
    onOpenSaveModal,
}: ProjectProfileManagerModalProps) {
    const { t } = useTranslation();
    const { profiles, switchProfile, deleteProfile, captureCurrent } = useProjectProfileStore();
    const [selectedProfile, setSelectedProfile] = useState<ProjectProfile | null>(null);
    const [switchingId, setSwitchingId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [overwriteConfirmProfile, setOverwriteConfirmProfile] = useState<ProjectProfile | null>(null);

    if (!isOpen) return null;

    const activeProfile = profiles.find((p) => p.isActive);
    const displayed = selectedProfile || activeProfile || profiles[0] || null;

    const handleSwitch = async (id: string, name: string) => {
        setSwitchingId(id);
        try {
            await switchProfile(id);
            showToast(t('projectProfiles.switchSuccess', '已成功切换到项目：{{name}}', { name }), 'success');
        } catch (e) {
            showToast(String(e), 'error');
        } finally {
            setSwitchingId(null);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteProfile(id);
            showToast(t('projectProfiles.deleteSuccess', '项目已删除'), 'success');
            if (selectedProfile?.id === id) {
                setSelectedProfile(null);
            }
        } catch (e) {
            showToast(String(e), 'error');
        } finally {
            setDeleteConfirmId(null);
        }
    };

    const handleOverwrite = async (profile: ProjectProfile) => {
        try {
            await captureCurrent(profile.name, profile.description, profile.icon);
            // 删除旧 profile，避免重复
            if (profile.id) {
                await deleteProfile(profile.id);
            }
            showToast(t('projectProfiles.overwriteSuccess', '已将当前系统配置覆盖至项目：{{name}}', { name: profile.name }), 'success');
            setOverwriteConfirmProfile(null);
        } catch (e) {
            showToast(String(e), 'error');
        }
    };

    return (
        <ModalDialog
            isOpen={isOpen}
            type="info"
            title={t('projectProfiles.managerTitle', '管理项目配置 (Project Profiles)')}
            message=""
            onConfirm={onClose}
            onCancel={onClose}
        >
            <div className="flex flex-col md:flex-row gap-4 h-[440px] -mt-2">
                {/* 左侧：项目列表 */}
                <div className="w-full md:w-56 flex flex-col border border-gray-200 dark:border-slate-800 rounded-lg overflow-hidden bg-gray-50/50 dark:bg-slate-900/30">
                    <div className="p-2 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">
                            {t('projectProfiles.listHeader', '全部项目 ({{count}})', { count: profiles.length })}
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                onClose();
                                onOpenSaveModal();
                            }}
                            className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium"
                        >
                            + {t('projectProfiles.new', '新增')}
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-800/60 p-1">
                        {profiles.length === 0 ? (
                            <div className="p-4 text-center text-xs text-gray-400 dark:text-slate-500">
                                {t('projectProfiles.noProfiles', '暂无保存的项目配置')}
                            </div>
                        ) : (
                            profiles.map((p) => {
                                const isSelected = displayed?.id === p.id;
                                return (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => setSelectedProfile(p)}
                                        className={`w-full text-left p-2 rounded-md transition-colors flex items-center justify-between gap-1.5 ${
                                            isSelected
                                                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-200'
                                                : 'hover:bg-gray-100 dark:hover:bg-slate-800/60 text-gray-700 dark:text-slate-300'
                                        }`}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5">
                                                <Folder className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                                                <span className="text-xs font-medium truncate">{p.name}</span>
                                            </div>
                                            {p.isActive && (
                                                <span className="inline-block mt-0.5 px-1 py-0.2 rounded text-[10px] bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                                                    {t('projectProfiles.active', '当前生效')}
                                                </span>
                                            )}
                                        </div>
                                        <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* 右侧：项目详情与操作 */}
                <div className="flex-1 border border-gray-200 dark:border-slate-800 rounded-lg p-4 flex flex-col justify-between overflow-y-auto bg-white dark:bg-slate-900/50">
                    {displayed ? (
                        <div className="space-y-4">
                            {/* 标题 & 激活状态 */}
                            <div className="flex items-start justify-between gap-2 border-b border-gray-100 dark:border-slate-800 pb-3">
                                <div>
                                    <h4 className="text-base font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                                        {displayed.name}
                                        {displayed.isActive && (
                                            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 flex items-center gap-1">
                                                <CheckCircle2 className="w-3 h-3" />
                                                {t('projectProfiles.currentActive', '当前生效中')}
                                            </span>
                                        )}
                                    </h4>
                                    {displayed.description && (
                                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                            {displayed.description}
                                        </p>
                                    )}
                                </div>

                                <div className="flex items-center gap-1.5">
                                    {!displayed.isActive && (
                                        <button
                                            type="button"
                                            onClick={() => handleSwitch(displayed.id, displayed.name)}
                                            disabled={switchingId === displayed.id}
                                            className="px-2.5 py-1 rounded text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors flex items-center gap-1"
                                        >
                                            {switchingId === displayed.id ? (
                                                <RefreshCw className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <Check className="w-3 h-3" />
                                            )}
                                            {t('projectProfiles.applyNow', '一键切换此项目')}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* 配置内容概览 */}
                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div className="p-2.5 rounded-md border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/20 space-y-1">
                                    <div className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-slate-300">
                                        <Key className="w-3.5 h-3.5 text-amber-500" />
                                        <span>{t('projectProfiles.providersCount', '活跃供应商')}</span>
                                    </div>
                                    <p className="text-gray-500 dark:text-slate-400 text-[11px]">
                                        {Object.keys(displayed.providers).length > 0
                                            ? Object.entries(displayed.providers)
                                                  .map(([app]) => app)
                                                  .join(', ')
                                            : t('common.none', '无')}
                                    </p>
                                </div>

                                <div className="p-2.5 rounded-md border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/20 space-y-1">
                                    <div className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-slate-300">
                                        <Globe className="w-3.5 h-3.5 text-blue-500" />
                                        <span>{t('projectProfiles.mcpCount', '启用 MCP')}</span>
                                    </div>
                                    <p className="text-gray-500 dark:text-slate-400 text-[11px]">
                                        {Object.values(displayed.mcpServers).flat().length} {t('projectProfiles.items', '项服务')}
                                    </p>
                                </div>

                                <div className="p-2.5 rounded-md border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/20 space-y-1">
                                    <div className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-slate-300">
                                        <Zap className="w-3.5 h-3.5 text-purple-500" />
                                        <span>{t('projectProfiles.skillsCount', '启用技能')}</span>
                                    </div>
                                    <p className="text-gray-500 dark:text-slate-400 text-[11px]">
                                        {Object.values(displayed.skills).flat().length} {t('projectProfiles.items', '个技能')}
                                    </p>
                                </div>

                                <div className="p-2.5 rounded-md border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/20 space-y-1">
                                    <div className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-slate-300">
                                        <FileText className="w-3.5 h-3.5 text-emerald-500" />
                                        <span>{t('projectProfiles.promptsCount', '启用 Prompt')}</span>
                                    </div>
                                    <p className="text-gray-500 dark:text-slate-400 text-[11px]">
                                        {Object.keys(displayed.prompts).length > 0
                                            ? Object.keys(displayed.prompts).join(', ')
                                            : t('common.none', '无')}
                                    </p>
                                </div>
                            </div>

                            {/* 危险操作区 */}
                            <div className="pt-4 flex items-center justify-between border-t border-gray-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setOverwriteConfirmProfile(displayed)}
                                    className="text-xs text-gray-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1"
                                >
                                    <RefreshCw className="w-3 h-3" />
                                    {t('projectProfiles.overwriteWithCurrent', '用当前系统配置更新覆盖')}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setDeleteConfirmId(displayed.id)}
                                    className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 transition-colors flex items-center gap-1"
                                >
                                    <Trash2 className="w-3 h-3" />
                                    {t('common.delete', '删除')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-xs text-gray-400 dark:text-slate-500">
                            {t('projectProfiles.selectProfileHint', '请选择或创建一个项目配置')}
                        </div>
                    )}
                </div>
            </div>

            {/* 删除确认弹窗框 */}
            <ModalDialog
                isOpen={!!deleteConfirmId}
                type="confirm"
                title={t('projectProfiles.deleteConfirmTitle', '确认删除项目配置？')}
                message={t('projectProfiles.deleteConfirmMsg', '删除项目配置不会影响当前系统运行的配置，但日后将无法直接一键切回此配置。')}
                onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
                onCancel={() => setDeleteConfirmId(null)}
            />

            {/* 覆盖更新确认弹窗框 */}
            <ModalDialog
                isOpen={!!overwriteConfirmProfile}
                type="confirm"
                title={t('projectProfiles.overwriteConfirmTitle', '确认用当前配置覆盖更新？')}
                message={t('projectProfiles.overwriteConfirmMsg', '将抓取当前系统所有活跃的供应商、MCP、技能和 Prompt 状态，覆盖当前项目已存的设置。')}
                onConfirm={() => overwriteConfirmProfile && handleOverwrite(overwriteConfirmProfile)}
                onCancel={() => setOverwriteConfirmProfile(null)}
            />
        </ModalDialog>
    );
}
