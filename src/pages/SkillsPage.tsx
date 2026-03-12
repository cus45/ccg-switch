import { useTranslation } from 'react-i18next';
import { Zap, Plus, RefreshCw, Trash2, Edit, Eye, FolderOpen, User, Search, Download, Package, FolderInput, ExternalLink, Share2, Import, Star, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSkillStore } from '../stores/useSkillStore';
import { useSkillStoreV2 } from '../stores/useSkillStoreV2';
import { useProviderStore } from '../stores/useProviderStore';
import ModalDialog from '../components/common/ModalDialog';
import { showToast } from '../components/common/ToastContainer';
import { APP_TYPES, APP_LABELS } from '../types/app';
import { SKILL_APPS } from '../types/skillV2';

const ALL_TAB = 'all';


function SkillsPage() {
    const { t } = useTranslation();
    const [pageTab, setPageTab] = useState<'legacy' | 'discover' | 'installed' | 'repos'>('installed');
    const [searchQuery, setSearchQuery] = useState('');

    // ---- Legacy ----
    const { skills, loading, loadSkills, saveSkill, deleteSkill, currentApp, setCurrentApp, toggleSkillForApp } = useSkillStore();
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editContent, setEditContent] = useState('');
    const [previewName, setPreviewName] = useState<string | null>(null);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; name: string }>({
        isOpen: false,
        name: ''
    });

    // ---- V2 (DB) ----
    const { installed, discoverable, discovering, loading: v2Loading, loadInstalled, discoverSkills, installSkill, uninstallSkill, toggleApp: toggleV2App, repos, loadRepos, saveRepo, deleteRepo, scanAndImport } = useSkillStoreV2();
    const [v2DeleteModal, setV2DeleteModal] = useState<{ isOpen: boolean; id: string }>({ isOpen: false, id: '' });
    const [installLoading, setInstallLoading] = useState<string | null>(null);
    const [addRepoModal, setAddRepoModal] = useState(false);
    const [repoUrl, setRepoUrl] = useState('');
    const [repoBranch, setRepoBranch] = useState('');
    const [repoError, setRepoError] = useState('');
    const [scanning, setScanning] = useState(false);
    
    // Import/Export States
    const [importModal, setImportModal] = useState(false);
    const [importPayload, setImportPayload] = useState('');
    const [importLoading, setImportLoading] = useState(false);
    const { exportSkill, importSkill, runSkillSandbox, checkSkillUpdate, applySkillUpdate } = useSkillStoreV2();

    // Sandbox States
    const { providers, loadAllProviders } = useProviderStore();
    const [sandboxModal, setSandboxModal] = useState<{ isOpen: boolean; skillId: string; name: string; content: string }>({ isOpen: false, skillId: '', name: '', content: '' });
    const [sandboxProvider, setSandboxProvider] = useState('');
    const [sandboxModel, setSandboxModel] = useState('');
    const [sandboxInput, setSandboxInput] = useState('');
    const [sandboxOutput, setSandboxOutput] = useState('');
    const [sandboxCompareOutput, setSandboxCompareOutput] = useState('');
    const [sandboxLoading, setSandboxLoading] = useState(false);
    const [sandboxCompareMode, setSandboxCompareMode] = useState(false);

    // Update States
    const [updateModal, setUpdateModal] = useState<{ isOpen: boolean; skillId: string; name: string; remoteContent: string; localContent: string }>({ isOpen: false, skillId: '', name: '', remoteContent: '', localContent: '' });
    const [checkingUpdate, setCheckingUpdate] = useState<string | null>(null);
    const [applyingUpdate, setApplyingUpdate] = useState(false);

    // Sorting 
    const [discoverSort, setDiscoverSort] = useState<'stars' | 'name'>('stars');

    useEffect(() => {
        if (pageTab === 'legacy') loadSkills();
        else if (pageTab === 'installed') {
            loadInstalled();
            loadAllProviders();
        }
        else if (pageTab === 'repos') loadRepos();
    }, [pageTab]);

    const handleAdd = () => {
        setEditName('');
        setEditContent('');
        setIsEditing(true);
    };

    const handleEdit = (name: string, content: string) => {
        setEditName(name);
        setEditContent(content);
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (!editName.trim()) return;
        try {
            await saveSkill(editName.trim(), editContent);
            setIsEditing(false);
        } catch (error) {
            console.error('保存失败:', error);
        }
    };

    const handleDelete = async (name: string) => {
        setDeleteModal({ isOpen: true, name });
    };

    const confirmDelete = async () => {
        try {
            await deleteSkill(deleteModal.name);
            showToast(t('skills.delete_success'), 'success');
        } catch (error) {
            showToast(t('skills.delete_failed'), 'error');
        } finally {
            setDeleteModal({ isOpen: false, name: '' });
        }
    };

    // 获取技能在当前应用下的启用状态
    const getAppEnabled = (skillApps: Record<string, boolean> | undefined, app: string): boolean => {
        if (!skillApps || Object.keys(skillApps).length === 0) return true;
        return skillApps[app] !== false;
    };

    const handleAppToggle = async (name: string, app: string, enabled: boolean) => {
        try {
            await toggleSkillForApp(name, app, enabled);
        } catch {
            showToast(t('skills.toggle_failed'), 'error');
        }
    };

    if (isEditing) {
        return (
            <div className="h-full w-full overflow-y-auto">
                <div className="p-6 space-y-4 max-w-7xl mx-auto">
                    <div className="flex justify-between items-center">
                        <h1 className="text-xl font-bold text-gray-900 dark:text-base-content">
                            {editName ? t('skills.edit') : t('skills.add')}
                        </h1>
                        <div className="flex gap-2">
                            <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-base-100 transition-colors">
                                {t('common.cancel')}
                            </button>
                            <button onClick={handleSave} className="px-3 py-1.5 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors">
                                {t('common.save')}
                            </button>
                        </div>
                    </div>
                    <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder={t('skills.name_placeholder')}
                        className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 dark:text-base-content"
                    />
                    <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={20}
                        placeholder={t('skills.content_placeholder')}
                        className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 dark:text-base-content font-mono text-sm"
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="p-6 space-y-4 max-w-7xl mx-auto">
                {/* 标题栏 */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex items-center gap-3">
                        <Zap className="w-6 h-6 text-purple-500" />
                        <h1 className="text-xl font-bold text-gray-900 dark:text-base-content">
                            {t('skills.title')}
                        </h1>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center w-full sm:w-auto">
                        {/* 搜索框 */}
                        <div className="relative flex-1 sm:flex-none sm:min-w-[200px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder={t('skills.search_placeholder')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-3 py-1.5 bg-white dark:bg-base-200 border border-gray-200 dark:border-base-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 dark:text-base-content"
                            />
                        </div>
                        {/* 操作按钮 */}
                        {pageTab === 'legacy' && (
                            <div className="contents">
                                <button onClick={() => loadSkills()} disabled={loading} className="px-3 py-1.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-base-100 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                                    {t('common.refresh')}
                                </button>
                                <button onClick={handleAdd} className="px-3 py-1.5 bg-purple-500 text-white text-sm font-medium rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-1.5">
                                    <Plus className="w-4 h-4" />
                                    {t('common.add')}
                                </button>
                            </div>
                        )}
                        {pageTab === 'installed' && (
                            <div className="contents">
                                <button onClick={() => { setImportPayload(''); setImportModal(true); }} className="px-3 py-1.5 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-1.5">
                                    <Import className="w-4 h-4" />
                                    从分享码导入
                                </button>
                                <button onClick={async () => {
                                    setScanning(true);
                                    try {
                                        const result = await scanAndImport();
                                        if (result.imported > 0) {
                                            showToast(`成功导入 ${result.imported} 个技能`, 'success');
                                        } else if (result.skipped > 0) {
                                            showToast('所有技能已在数据库中', 'info');
                                        } else {
                                            showToast('未发现可导入的技能', 'info');
                                        }
                                    } catch (e) {
                                        showToast(String(e), 'error');
                                    } finally {
                                        setScanning(false);
                                    }
                                }} disabled={scanning || v2Loading} className="px-3 py-1.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                                    <FolderInput className={`w-4 h-4 ${scanning ? 'animate-pulse' : ''}`} />
                                    {scanning ? '扫描中...' : '扫描导入'}
                                </button>
                                <button onClick={async () => {
                                    const names = installed.map(s => s.name).join('\n');
                                    try {
                                        await invoke('write_clipboard', { text: names });
                                        showToast(`已复制 ${installed.length} 个技能名称`, 'success');
                                    } catch {
                                        showToast('复制失败', 'error');
                                    }
                                }} className="px-3 py-1.5 bg-orange-400 text-white text-sm font-medium rounded-lg hover:bg-orange-500 transition-colors flex items-center gap-1.5">
                                    <Copy className="w-4 h-4" />
                                    复制清单
                                </button>
                                <button onClick={() => loadInstalled()} disabled={v2Loading} className="px-3 py-1.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-base-100 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                                    <RefreshCw className={`w-4 h-4 ${v2Loading ? 'animate-spin' : ''}`} />
                                    {t('common.refresh')}
                                </button>
                            </div>
                        )}
                        {pageTab === 'discover' && (
                            <button onClick={() => discoverSkills()} disabled={discovering} className="px-3 py-1.5 bg-purple-500 text-white text-sm font-medium rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                                <Search className={`w-4 h-4 ${discovering ? 'animate-spin' : ''}`} />
                                {discovering ? '发现中...' : '发现技能'}
                            </button>
                        )}
                        {pageTab === 'repos' && (
                            <div className="contents">
                                <button onClick={() => loadRepos()} className="px-3 py-1.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-base-100 transition-colors flex items-center gap-1.5">
                                    <RefreshCw className="w-4 h-4" />
                                    {t('common.refresh')}
                                </button>
                                <button onClick={() => { setRepoUrl(''); setRepoBranch(''); setRepoError(''); setAddRepoModal(true); }} className="px-3 py-1.5 bg-purple-500 text-white text-sm font-medium rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-1.5">
                                    <Plus className="w-4 h-4" />
                                    添加仓库
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* 页面标签 */}
                <div className="flex items-end justify-between border-b border-gray-200 dark:border-base-300">
                    <div className="flex gap-2">
                        <button onClick={() => setPageTab('installed')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${pageTab === 'installed' ? 'border-purple-500 text-purple-600 dark:text-purple-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                            <Package className="w-4 h-4 inline mr-1.5" />
                            已安装 ({installed.length})
                        </button>
                        <button onClick={() => setPageTab('discover')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${pageTab === 'discover' ? 'border-purple-500 text-purple-600 dark:text-purple-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                            <Search className="w-4 h-4 inline mr-1.5" />
                            发现
                        </button>
                        <button onClick={() => setPageTab('repos')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${pageTab === 'repos' ? 'border-purple-500 text-purple-600 dark:text-purple-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                            仓库管理 ({repos.length})
                        </button>
                        <button onClick={() => setPageTab('legacy')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${pageTab === 'legacy' ? 'border-purple-500 text-purple-600 dark:text-purple-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                            本地文件
                        </button>
                    </div>
                    {pageTab === 'discover' && (
                        <div className="pb-2">
                            <select 
                                value={discoverSort}
                                onChange={(e) => setDiscoverSort(e.target.value as 'stars' | 'name')}
                                className="px-3 py-1 bg-white dark:bg-base-200 border border-gray-200 dark:border-base-300 rounded-lg text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500"
                            >
                                <option value="stars">按 Star 数推荐</option>
                                <option value="name">按名称排序</option>
                            </select>
                        </div>
                    )}
                </div>

                {/* ===== 已安装 (v2) ===== */}
                {pageTab === 'installed' && (
                    v2Loading ? (
                        <div className="bg-white dark:bg-base-100 rounded-xl p-8 text-center">
                            <RefreshCw className="w-8 h-8 text-purple-500 mx-auto mb-2 animate-spin" />
                            <p className="text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
                        </div>
                    ) : (() => {
                        const query = searchQuery.trim().toLowerCase();
                        const filtered = query
                            ? installed.filter(s =>
                                s.name.toLowerCase().includes(query) ||
                                (s.description?.toLowerCase().includes(query)) ||
                                (s.repoOwner?.toLowerCase().includes(query)) ||
                                (s.repoName?.toLowerCase().includes(query))
                            )
                            : installed;
                        return filtered.length === 0 ? (
                            <div className="bg-white dark:bg-base-100 rounded-xl p-8 shadow-sm border border-gray-100 dark:border-base-200 text-center">
                                <Package className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                                <p className="text-gray-500 dark:text-gray-400">{query ? '未找到匹配的技能' : '暂无已安装的技能'}</p>
                                <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">{query ? '尝试其他关键词' : '切换到"发现"标签安装新技能'}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {filtered.map((skill) => (
                                <div key={skill.id} className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h3 className="font-semibold text-gray-900 dark:text-base-content">{skill.name}</h3>
                                        {skill.repoOwner && <span className="text-xs text-gray-400">{skill.repoOwner}/{skill.repoName}</span>}
                                    </div>
                                    {skill.description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">{skill.description}</p>}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            {SKILL_APPS.map(({ key, label, app }) => (
                                                <label key={app} className="flex items-center gap-1.5 cursor-pointer">
                                                    <input type="checkbox" className="toggle toggle-xs toggle-primary" checked={skill[key]} onChange={(e) => toggleV2App(skill.id, app, e.target.checked)} />
                                                    <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
                                                </label>
                                            ))}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {skill.repoOwner && skill.repoName && (
                                                <button 
                                                    onClick={async () => {
                                                        setCheckingUpdate(skill.id);
                                                        try {
                                                            const res = await checkSkillUpdate(skill.id);
                                                            if (res.has_update) {
                                                                setUpdateModal({
                                                                    isOpen: true,
                                                                    skillId: skill.id,
                                                                    name: skill.name,
                                                                    remoteContent: res.remote_content,
                                                                    localContent: res.local_content
                                                                });
                                                            } else {
                                                                showToast('当前已是最新版本', 'success');
                                                            }
                                                        } catch (e) {
                                                            showToast(String(e), 'error');
                                                        } finally {
                                                            setCheckingUpdate(null);
                                                        }
                                                    }}
                                                    disabled={checkingUpdate === skill.id}
                                                    className="p-2 text-gray-500 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors disabled:opacity-50"
                                                    title="检查更新"
                                                >
                                                    <RefreshCw className={`w-4 h-4 ${checkingUpdate === skill.id ? "animate-spin" : ""}`} />
                                                </button>
                                            )}
                                            <button 
                                                onClick={async () => {
                                                    try {
                                                        const content = await invoke<string>('read_skill_content_by_id', { id: skill.id });
                                                        await invoke('write_clipboard', { text: content });
                                                        showToast('技能系统提示词已复制', 'success');
                                                    } catch (e) {
                                                        showToast(String(e), 'error');
                                                    }
                                                }}
                                                className="p-2 text-gray-500 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg transition-colors"
                                                title="复制 Prompt"
                                            >
                                                <Copy className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const content = await invoke<string>('read_skill_content_by_id', { id: skill.id }).catch(() => "未能加载技能内容");
                                                        setSandboxModal({ isOpen: true, skillId: skill.id, name: skill.name, content });
                                                        setSandboxInput('');
                                                        setSandboxOutput('');
                                                        setSandboxCompareOutput('');
                                                        setSandboxCompareMode(false);
                                                        if (providers.length > 0 && !sandboxProvider) {
                                                            setSandboxProvider(providers[0].id);
                                                            setSandboxModel(providers[0].defaultSonnetModel || providers[0].defaultOpusModel || providers[0].defaultHaikuModel || '');
                                                        }
                                                    } catch (e) {
                                                        showToast(String(e), "error");
                                                    }
                                                }}
                                                className="p-2 text-gray-500 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                                                title="沙盒测试"
                                            >
                                                <Zap className="w-4 h-4" />
                                            </button>
                                            <button 
                                                onClick={async () => {
                                                    try {
                                                        const code = await exportSkill(skill.id);
                                                        await invoke('write_clipboard', { text: code });
                                                        showToast('分享码已复制到剪贴板', 'success');
                                                    } catch (e) {
                                                        showToast(String(e), 'error');
                                                    }
                                                }} 
                                                className="p-2 text-gray-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                                title="分享技能"
                                            >
                                                <Share2 className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => setV2DeleteModal({ isOpen: true, id: skill.id })} className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="卸载技能">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        );
                    })()
                )}

                {/* ===== 发现 (v2) ===== */}
                {pageTab === 'discover' && (
                    discovering ? (
                        <div className="bg-white dark:bg-base-100 rounded-xl p-8 text-center">
                            <Search className="w-8 h-8 text-purple-500 mx-auto mb-2 animate-spin" />
                            <p className="text-gray-500 dark:text-gray-400">正在从 GitHub 仓库发现技能...</p>
                        </div>
                    ) : (() => {
                        const query = searchQuery.trim().toLowerCase();
                        const filtered = query
                            ? discoverable.filter(s =>
                                s.name.toLowerCase().includes(query) ||
                                (s.description?.toLowerCase().includes(query)) ||
                                (s.repoOwner?.toLowerCase().includes(query)) ||
                                (s.repoName?.toLowerCase().includes(query))
                            )
                            : discoverable;
                            
                        const sortedDiscoverable = [...filtered].sort((a, b) => {
                            if (discoverSort === 'stars') {
                                const aStars = a.stars ?? -1;
                                const bStars = b.stars ?? -1;
                                if (bStars !== aStars) return bStars - aStars;
                            }
                            return a.name.localeCompare(b.name);
                        });

                        return sortedDiscoverable.length === 0 ? (
                            <div className="bg-white dark:bg-base-100 rounded-xl p-8 shadow-sm border border-gray-100 dark:border-base-200 text-center">
                                <Search className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                                <p className="text-gray-500 dark:text-gray-400">{query ? '未找到匹配的技能' : '点击"发现技能"从 GitHub 仓库获取可安装的技能'}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {sortedDiscoverable.map((skill) => {
                                const isInstalled = installed.some((s) => s.directory === skill.directory);
                                return (
                                    <div key={skill.key} className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                                    <h3 className="font-semibold text-gray-900 dark:text-base-content">{skill.name}</h3>
                                                    <span className="text-xs text-gray-400">{skill.repoOwner}/{skill.repoName}</span>
                                                    {skill.stars !== undefined && skill.stars !== null && (
                                                        <span className="flex items-center gap-0.5 text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 px-1.5 py-0.5 rounded whitespace-nowrap">
                                                            <Star className="w-3 h-3 fill-current" />
                                                            {skill.stars >= 1000 ? `${(skill.stars / 1000).toFixed(1)}k` : skill.stars}
                                                        </span>
                                                    )}
                                                    {isInstalled && <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full whitespace-nowrap">已安装</span>}
                                                </div>
                                                {skill.description && <p className="text-sm text-gray-500 dark:text-gray-400">{skill.description}</p>}
                                            </div>
                                            <div className="flex items-center gap-2 ml-4">
                                                {skill.readmeUrl && (
                                                    <button onClick={() => invoke('open_external', { url: skill.readmeUrl! })} className="p-2 text-gray-500 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors" title="在 GitHub 中查看">
                                                        <ExternalLink className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {!isInstalled && (
                                                    <button
                                                        disabled={installLoading === skill.key}
                                                        onClick={async () => {
                                                            setInstallLoading(skill.key);
                                                            try {
                                                                await installSkill(skill, 'claude');
                                                                showToast(`已安装 ${skill.name}`, 'success');
                                                            } catch (e) {
                                                                showToast(String(e), 'error');
                                                            } finally {
                                                                setInstallLoading(null);
                                                            }
                                                        }}
                                                        className="px-3 py-1.5 bg-purple-500 text-white text-xs font-medium rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                                                    >
                                                        {installLoading === skill.key ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                                        安装
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        );
                    })()
                )}

                {/* ===== 仓库管理 ===== */}
                {pageTab === 'repos' && (
                    (() => {
                        const query = searchQuery.trim().toLowerCase();
                        const filtered = query
                            ? repos.filter(r =>
                                r.owner.toLowerCase().includes(query) ||
                                r.name.toLowerCase().includes(query)
                            )
                            : repos;
                        return filtered.length === 0 ? (
                            <div className="bg-white dark:bg-base-100 rounded-xl p-8 shadow-sm border border-gray-100 dark:border-base-200 text-center">
                                <Package className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                                <p className="text-gray-500 dark:text-gray-400">{query ? '未找到匹配的仓库' : '暂无技能仓库'}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {filtered.map((repo) => (
                                <div key={`${repo.owner}/${repo.name}`} className="bg-white dark:bg-base-100 rounded-xl p-3 shadow-sm border border-gray-100 dark:border-base-200">
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold text-gray-900 dark:text-base-content truncate">{repo.owner}/{repo.name}</h3>
                                                <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-base-200 text-gray-500 dark:text-gray-400 rounded whitespace-nowrap">{repo.branch}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <label className="flex items-center cursor-pointer" title={repo.enabled ? '已启用' : '已禁用'}>
                                                <input type="checkbox" className="toggle toggle-xs toggle-primary" checked={repo.enabled} onChange={(e) => saveRepo({ ...repo, enabled: e.target.checked })} />
                                            </label>
                                            <button onClick={() => invoke('open_external', { url: `https://github.com/${repo.owner}/${repo.name}` })} className="p-1.5 text-gray-500 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors" title="在 GitHub 中查看">
                                                <ExternalLink className="w-3.5 h-3.5" />
                                            </button>
                                            <button onClick={() => deleteRepo(repo.owner, repo.name)} className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="删除仓库">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        );
                    })()
                )}

                {/* ===== 本地文件 (Legacy) ===== */}
                {pageTab === 'legacy' && (
                    (() => {
                        // 组合应用过滤和搜索过滤
                        const query = searchQuery.trim().toLowerCase();
                        let result = currentApp && currentApp !== ALL_TAB
                            ? skills.filter((s) => {
                                if (!s.apps || Object.keys(s.apps).length === 0) return true;
                                return s.apps[currentApp] !== false;
                            })
                            : skills;
                        if (query) {
                            result = result.filter(s =>
                                s.name.toLowerCase().includes(query) ||
                                s.content.toLowerCase().includes(query)
                            );
                        }
                        return (
                    <>
                        {/* 应用过滤标签 */}
                        <div className="flex gap-2 flex-wrap">
                            <button onClick={() => setCurrentApp(null)} className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${!currentApp || currentApp === ALL_TAB ? 'bg-gray-900 dark:bg-base-content text-white dark:text-base-100' : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-base-100'}`}>
                                {t('skills.all_apps')}
                            </button>
                            {APP_TYPES.map((appType) => (
                                <button key={appType} onClick={() => setCurrentApp(appType)} className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${currentApp === appType ? 'bg-purple-500 text-white' : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-base-100'}`}>
                                    {APP_LABELS[appType]}
                                </button>
                            ))}
                        </div>

                        {result.length === 0 ? (
                            <div className="bg-white dark:bg-base-100 rounded-xl p-8 shadow-sm border border-gray-100 dark:border-base-200 text-center">
                                <Zap className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                                <p className="text-gray-500 dark:text-gray-400">{query ? '未找到匹配的技能' : t('skills.empty')}</p>
                                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{query ? '尝试其他关键词' : t('skills.empty_hint')}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {result.map((skill) => (
                                    <div key={skill.name} className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-semibold text-gray-900 dark:text-base-content">{skill.name}</h3>
                                                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${skill.source === 'user' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                                                        {skill.source === 'user' ? <><User className="w-3 h-3 inline mr-1" />{t('skills.user')}</> : <><FolderOpen className="w-3 h-3 inline mr-1" />{t('skills.project')}</>}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 font-mono">{skill.content.substring(0, 150)}...</p>
                                                {currentApp && currentApp !== ALL_TAB && (
                                                    <div className="mt-3 flex items-center gap-2">
                                                        <span className="text-xs text-gray-500 dark:text-gray-400">{APP_LABELS[currentApp as keyof typeof APP_LABELS] ?? currentApp}:</span>
                                                        <input type="checkbox" className="toggle toggle-sm toggle-primary" checked={getAppEnabled(skill.apps, currentApp)} onChange={(e) => handleAppToggle(skill.name, currentApp, e.target.checked)} />
                                                        <span className="text-xs text-gray-500 dark:text-gray-400">{getAppEnabled(skill.apps, currentApp) ? t('skills.app_enabled') : t('skills.app_disabled')}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex gap-2 ml-4">
                                                <button onClick={() => setPreviewName(previewName === skill.name ? null : skill.name)} className="p-2 text-gray-500 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors"><Eye className="w-4 h-4" /></button>
                                                <button onClick={() => handleEdit(skill.name, skill.content)} className="p-2 text-gray-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"><Edit className="w-4 h-4" /></button>
                                                <button onClick={() => handleDelete(skill.name)} className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                                            </div>
                                        </div>
                                        {previewName === skill.name && (
                                            <pre className="mt-3 p-3 bg-gray-50 dark:bg-base-200 rounded-lg text-sm text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">{skill.content}</pre>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                        );
                    })()
                )}

                {/* 删除确认（v1）*/}
                <ModalDialog isOpen={deleteModal.isOpen} title={t('skills.delete_title')} message={t('skills.confirm_delete')} type="confirm" isDestructive={true} onConfirm={confirmDelete} onCancel={() => setDeleteModal({ isOpen: false, name: '' })} />

                {/* 导入技能分享码 */}
                <ModalDialog
                    isOpen={importModal}
                    title="从分享码导入技能"
                    type="confirm"
                    onConfirm={async () => {
                        const code = importPayload.trim();
                        if (!code) {
                            showToast('请粘贴有效的分享码', 'error');
                            return;
                        }
                        setImportLoading(true);
                        try {
                            await importSkill(code);
                            showToast('导入成功', 'success');
                            setImportModal(false);
                            setImportPayload('');
                        } catch (e) {
                            showToast(String(e), 'error');
                        } finally {
                            setImportLoading(false);
                        }
                    }}
                    onCancel={() => {
                        if (!importLoading) {
                            setImportModal(false);
                            setImportPayload('');
                        }
                    }}
                >
                    <div className="space-y-2">
                        <textarea
                            disabled={importLoading}
                            value={importPayload}
                            onChange={(e) => setImportPayload(e.target.value)}
                            placeholder="粘贴以 ccg-skill:// 开头的分享码..."
                            rows={8}
                            className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 dark:text-base-content font-mono text-xs resize-none disabled:opacity-50"
                        />
                        {importLoading && <p className="text-sm text-blue-500 flex items-center gap-1.5"><RefreshCw className="w-3 h-3 animate-spin"/>正在解析写入中...</p>}
                    </div>
                </ModalDialog>

                {/* 沙盒测试弹窗 */}
                <ModalDialog
                    isOpen={sandboxModal.isOpen}
                    title={`沙盒测试 - ${sandboxModal.name}`}
                    type="info"
                    maxWidthClass="max-w-4xl"
                    onConfirm={async () => {
                        if (sandboxLoading || !sandboxProvider || !sandboxModel || !sandboxInput.trim()) return;
                        setSandboxLoading(true);
                        setSandboxOutput('');
                        setSandboxCompareOutput('');
                        try {
                            const res = await runSkillSandbox({
                                provider_id: sandboxProvider,
                                model: sandboxModel,
                                system_prompt: sandboxModal.content,
                                user_input: sandboxInput,
                                compare_mode: sandboxCompareMode
                            });
                            setSandboxOutput(res.content);
                            if (res.compare_content) {
                                setSandboxCompareOutput(res.compare_content);
                            }
                        } catch (e) {
                            setSandboxOutput(`请求失败: \n${e}`);
                            setSandboxCompareOutput('');
                        } finally {
                            setSandboxLoading(false);
                        }
                    }}
                    onCancel={() => {
                        if (!sandboxLoading) {
                            setSandboxModal({ ...sandboxModal, isOpen: false });
                            setSandboxCompareMode(false);
                            setSandboxCompareOutput('');
                        }
                    }}
                >
                    <div className="space-y-3 max-h-[80vh] overflow-y-auto">
                        {/* 对比模式开关 */}
                        <div className="flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                            <div>
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">对比模式</label>
                                <p className="text-xs text-gray-500 dark:text-gray-400">同时显示使用技能和不使用技能的输出对比</p>
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="toggle toggle-sm toggle-primary"
                                    checked={sandboxCompareMode}
                                    onChange={(e) => setSandboxCompareMode(e.target.checked)}
                                    disabled={sandboxLoading}
                                />
                                <span className="text-xs text-gray-600 dark:text-gray-400">
                                    {sandboxCompareMode ? '已启用' : '未启用'}
                                </span>
                            </label>
                        </div>
                        <div className="flex gap-2">
                            <select 
                                className="flex-1 px-3 py-2 bg-gray-50 dark:bg-base-200 border border-gray-200 dark:border-base-300 rounded-lg text-sm"
                                value={sandboxProvider}
                                onChange={(e) => {
                                    setSandboxProvider(e.target.value);
                                    const p = providers.find(x => x.id === e.target.value);
                                    if (p) {
                                        setSandboxModel(p.defaultSonnetModel || p.defaultOpusModel || p.defaultHaikuModel || '');
                                    }
                                }}
                            >
                                <option value="" disabled>选择 API 渠道</option>
                                {providers.map(p => (
                                    <option key={p.id} value={p.id}>{p.name} ({p.appType})</option>
                                ))}
                            </select>
                            <input 
                                type="text"
                                className="flex-1 px-3 py-2 bg-gray-50 dark:bg-base-200 border border-gray-200 dark:border-base-300 rounded-lg text-sm"
                                placeholder="输入模型名称 e.g. gpt-4o"
                                value={sandboxModel}
                                onChange={(e) => setSandboxModel(e.target.value)}
                            />
                        </div>

                        {/* 结果显示区域 */}
                        {sandboxCompareMode ? (
                            // 对比模式：三个区域（提示词、有技能、无技能）
                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-gray-500">技能系统提示词</label>
                                    <div className="p-2.5 bg-gray-50 dark:bg-base-300 rounded-lg text-xs font-mono text-gray-600 dark:text-gray-400 h-32 overflow-y-auto whitespace-pre-wrap">
                                        {sandboxModal.content}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                                            🔧 使用技能的输出
                                        </label>
                                        <div className="p-2.5 bg-blue-50 dark:bg-blue-900/10 rounded-lg text-sm text-gray-800 dark:text-gray-200 h-48 overflow-y-auto whitespace-pre-wrap border border-blue-100 dark:border-blue-800/30">
                                            {sandboxLoading ? (
                                                <div className="flex items-center justify-center h-full text-blue-500">
                                                    <RefreshCw className="w-5 h-5 animate-spin mr-2"/> 请求中...
                                                </div>
                                            ) : (sandboxOutput || <span className="text-gray-400 italic">暂无输出...</span>)}
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                            ⚪ 不使用技能的输出
                                        </label>
                                        <div className="p-2.5 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm text-gray-700 dark:text-gray-300 h-48 overflow-y-auto whitespace-pre-wrap border border-gray-300 dark:border-gray-600">
                                            {sandboxLoading ? (
                                                <div className="flex items-center justify-center h-full text-gray-400">
                                                    <RefreshCw className="w-5 h-5 animate-spin mr-2"/> 请求中...
                                                </div>
                                            ) : (sandboxCompareOutput || <span className="text-gray-400 italic">暂无输出...</span>)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            // 普通模式：两个区域（提示词、输出）
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-gray-500">技能系统提示词</label>
                                    <div className="p-2.5 bg-gray-50 dark:bg-base-300 rounded-lg text-xs font-mono text-gray-600 dark:text-gray-400 h-48 overflow-y-auto whitespace-pre-wrap">
                                        {sandboxModal.content}
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-gray-500">模型输出结果</label>
                                    <div className="p-2.5 bg-blue-50 dark:bg-blue-900/10 rounded-lg text-sm text-gray-800 dark:text-gray-200 h-48 overflow-y-auto whitespace-pre-wrap border border-blue-100 dark:border-blue-800/30">
                                        {sandboxLoading ? (
                                            <div className="flex items-center justify-center h-full text-blue-500">
                                                <RefreshCw className="w-5 h-5 animate-spin mr-2"/> 请求中...
                                            </div>
                                        ) : (sandboxOutput || <span className="text-gray-400 italic">暂无输出...</span>)}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-gray-500">模拟用户输入 (User Input)</label>
                            <textarea
                                disabled={sandboxLoading}
                                value={sandboxInput}
                                onChange={(e) => setSandboxInput(e.target.value)}
                                className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg text-sm"
                                rows={3}
                                placeholder="在这里输入要测试的消息..."
                            />
                        </div>

                    </div>
                </ModalDialog>

                {/* 更新和 Diff 确认弹窗 */}
                <ModalDialog
                    isOpen={updateModal.isOpen}
                    title={`更新提示 - ${updateModal.name}`}
                    type="info"
                    maxWidthClass="max-w-4xl"
                    onConfirm={() => {
                        if (!applyingUpdate) setUpdateModal({ ...updateModal, isOpen: false });
                    }}
                    onCancel={() => {
                        if (!applyingUpdate) setUpdateModal({ ...updateModal, isOpen: false });
                    }}
                >
                    <div className="space-y-4">
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg border border-yellow-100 dark:border-yellow-800/30">
                            <p className="text-sm text-yellow-800 dark:text-yellow-200">发现该技能（SKILL.md）在远程仓库有新版本。是否覆盖本地版本？</p>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-500">本地版本 (Local)</label>
                                <div className="p-3 bg-gray-50 dark:bg-base-300 border border-gray-200 dark:border-base-200 rounded-lg text-xs font-mono text-gray-500 h-96 overflow-y-auto whitespace-pre-wrap opacity-80">
                                    {updateModal.localContent}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-500 text-green-600 dark:text-green-400">远程最新版本 (Remote)</label>
                                <div className="p-3 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/30 rounded-lg text-xs font-mono text-gray-800 dark:text-gray-200 h-96 overflow-y-auto whitespace-pre-wrap">
                                    {updateModal.remoteContent}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setUpdateModal({ ...updateModal, isOpen: false })} disabled={applyingUpdate} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-base-200">
                                取消
                            </button>
                            <button 
                                disabled={applyingUpdate}
                                onClick={async () => {
                                    setApplyingUpdate(true);
                                    try {
                                        await applySkillUpdate(updateModal.skillId, updateModal.remoteContent);
                                        showToast('技能更新成功！', 'success');
                                        setUpdateModal({ ...updateModal, isOpen: false });
                                    } catch (e) {
                                        showToast(`更新失败: \n${e}`, 'error');
                                    } finally {
                                        setApplyingUpdate(false);
                                    }
                                }}
                                className="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm hover:bg-purple-600 disabled:opacity-50 flex items-center gap-1.5"
                            >
                                {applyingUpdate ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} 确认覆盖更新
                            </button>
                        </div>
                    </div>
                </ModalDialog>

                {/* 删除确认（v2）*/}
                <ModalDialog isOpen={v2DeleteModal.isOpen} title="卸载技能" message="确认卸载此技能？将从所有应用目录移除。" type="confirm" isDestructive={true}
                    onConfirm={async () => {
                        try { await uninstallSkill(v2DeleteModal.id); showToast('卸载成功', 'success'); }
                        catch (e) { showToast(String(e), 'error'); }
                        finally { setV2DeleteModal({ isOpen: false, id: '' }); }
                    }}
                    onCancel={() => setV2DeleteModal({ isOpen: false, id: '' })} />

                {/* 添加仓库 */}
                <ModalDialog
                    isOpen={addRepoModal}
                    title="添加技能仓库"
                    type="confirm"
                    onConfirm={async () => {
                        setRepoError('');
                        // 解析 URL: 支持 https://github.com/owner/repo、github.com/owner/repo、owner/repo
                        let cleaned = repoUrl.trim();
                        cleaned = cleaned.replace(/^https?:\/\/github\.com\//, '');
                        cleaned = cleaned.replace(/^github\.com\//, '');
                        cleaned = cleaned.replace(/\.git$/, '');
                        cleaned = cleaned.replace(/\/$/, '');
                        const parts = cleaned.split('/');
                        if (parts.length !== 2 || !parts[0] || !parts[1]) {
                            setRepoError('无效的仓库地址，请输入 GitHub 仓库链接或 owner/repo 格式');
                            return;
                        }
                        try {
                            await saveRepo({ owner: parts[0], name: parts[1], branch: repoBranch.trim() || 'main', enabled: true });
                            showToast('仓库添加成功', 'success');
                            setAddRepoModal(false);
                        } catch (e) { showToast(String(e), 'error'); }
                    }}
                    onCancel={() => setAddRepoModal(false)}
                >
                    <div className="space-y-3">
                        <div>
                            <label className="text-sm text-gray-600 dark:text-gray-400">仓库地址</label>
                            <input type="text" value={repoUrl} onChange={(e) => { setRepoUrl(e.target.value); setRepoError(''); }} placeholder="https://github.com/owner/repo 或 owner/repo" className="w-full mt-1 px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 dark:text-base-content text-sm" />
                        </div>
                        <div>
                            <label className="text-sm text-gray-600 dark:text-gray-400">分支（可选）</label>
                            <input type="text" value={repoBranch} onChange={(e) => setRepoBranch(e.target.value)} placeholder="默认 main" className="w-full mt-1 px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 dark:text-base-content text-sm" />
                        </div>
                        {repoError && <p className="text-sm text-red-500">{repoError}</p>}
                    </div>
                </ModalDialog>
            </div>
        </div>
    );
}

export default SkillsPage;
