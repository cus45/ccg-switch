import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Folder, FolderPlus, SlidersHorizontal } from 'lucide-react';
import { useProjectProfileStore } from '../../stores/useProjectProfileStore';
import { showToast } from '../common/ToastContainer';
import ProjectProfileSaveModal from './ProjectProfileSaveModal';
import ProjectProfileManagerModal from './ProjectProfileManagerModal';

export default function ProjectProfileSelector() {
    const { t } = useTranslation();
    const { profiles, loadProfiles, switchProfile } = useProjectProfileStore();
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [saveModalOpen, setSaveModalOpen] = useState(false);
    const [managerModalOpen, setManagerModalOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        loadProfiles();
    }, [loadProfiles]);

    // 点击外部关闭下拉菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const activeProfile = profiles.find((p) => p.isActive);

    const handleSelectProfile = async (id: string, name: string) => {
        setDropdownOpen(false);
        try {
            await switchProfile(id);
            showToast(t('projectProfiles.switchSuccess', '已成功切换到项目：{{name}}', { name }), 'success');
        } catch (e) {
            showToast(String(e), 'error');
        }
    };

    return (
        <div className="relative inline-block text-left" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="h-8 px-2.5 rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-base-200 hover:bg-gray-50 dark:hover:bg-base-100 flex items-center gap-1.5 text-xs text-gray-700 dark:text-slate-200 shadow-sm transition-colors focus:outline-none"
                title={t('projectProfiles.selectorTooltip', '切换或管理整套项目配置（供应商、MCP、技能、Prompt）')}
            >
                <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className="font-medium max-w-[120px] truncate">
                    {activeProfile ? activeProfile.name : t('projectProfiles.defaultProfile', '未选择项目')}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            </button>

            {dropdownOpen && (
                <div className="absolute left-0 mt-1.5 w-60 rounded-lg bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-lg py-1 z-50 animate-in fade-in-50 zoom-in-95 duration-100">
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider flex items-center justify-between">
                        <span>{t('projectProfiles.title', '项目环境组合')}</span>
                        <span className="text-[10px] font-normal lowercase">{profiles.length}</span>
                    </div>

                    <div className="max-h-56 overflow-y-auto py-1">
                        {profiles.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">
                                {t('projectProfiles.noProfiles', '暂无保存的项目配置')}
                            </div>
                        ) : (
                            profiles.map((p) => {
                                const isActive = p.isActive;
                                return (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => handleSelectProfile(p.id, p.name)}
                                        className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between transition-colors ${
                                            isActive
                                                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                                                : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 truncate">
                                            <Folder className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                                            <span className="truncate">{p.name}</span>
                                        </div>
                                        {isActive && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />}
                                    </button>
                                );
                            })
                        )}
                    </div>

                    <div className="border-t border-gray-100 dark:border-slate-800 my-1" />

                    <button
                        type="button"
                        onClick={() => {
                            setDropdownOpen(false);
                            setSaveModalOpen(true);
                        }}
                        className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 flex items-center gap-2"
                    >
                        <FolderPlus className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span>{t('projectProfiles.saveCurrent', '另存当前配置为新项目...')}</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            setDropdownOpen(false);
                            setManagerModalOpen(true);
                        }}
                        className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 flex items-center gap-2"
                    >
                        <SlidersHorizontal className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                        <span>{t('projectProfiles.manageProfiles', '管理项目配置...')}</span>
                    </button>
                </div>
            )}

            <ProjectProfileSaveModal
                isOpen={saveModalOpen}
                onClose={() => setSaveModalOpen(false)}
            />

            <ProjectProfileManagerModal
                isOpen={managerModalOpen}
                onClose={() => setManagerModalOpen(false)}
                onOpenSaveModal={() => setSaveModalOpen(true)}
            />
        </div>
    );
}
