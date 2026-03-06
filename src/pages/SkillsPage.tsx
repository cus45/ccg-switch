import { useTranslation } from 'react-i18next';
import { Zap, Plus, RefreshCw, Trash2, Edit, Eye, FolderOpen, User, Search, Download, Package, FolderInput } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSkillStore } from '../stores/useSkillStore';
import { useSkillStoreV2 } from '../stores/useSkillStoreV2';
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
    const [newRepo, setNewRepo] = useState({ owner: '', name: '', branch: 'main' });
    const [scanning, setScanning] = useState(false);

    useEffect(() => {
        if (pageTab === 'legacy') loadSkills();
        else if (pageTab === 'installed') loadInstalled();
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
                            <>
                                <button onClick={() => loadSkills()} disabled={loading} className="px-3 py-1.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-base-100 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                                    {t('common.refresh')}
                                </button>
                                <button onClick={handleAdd} className="px-3 py-1.5 bg-purple-500 text-white text-sm font-medium rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-1.5">
                                    <Plus className="w-4 h-4" />
                                    {t('common.add')}
                                </button>
                            </>
                        )}
                        {pageTab === 'installed' && (
                            <>
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
                                <button onClick={() => loadInstalled()} disabled={v2Loading} className="px-3 py-1.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-base-100 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                                    <RefreshCw className={`w-4 h-4 ${v2Loading ? 'animate-spin' : ''}`} />
                                    {t('common.refresh')}
                                </button>
                            </>
                        )}
                        {pageTab === 'discover' && (
                            <button onClick={() => discoverSkills()} disabled={discovering} className="px-3 py-1.5 bg-purple-500 text-white text-sm font-medium rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                                <Search className={`w-4 h-4 ${discovering ? 'animate-spin' : ''}`} />
                                {discovering ? '发现中...' : '发现技能'}
                            </button>
                        )}
                        {pageTab === 'repos' && (
                            <>
                                <button onClick={() => loadRepos()} className="px-3 py-1.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-base-100 transition-colors flex items-center gap-1.5">
                                    <RefreshCw className="w-4 h-4" />
                                    {t('common.refresh')}
                                </button>
                                <button onClick={() => { setNewRepo({ owner: '', name: '', branch: 'main' }); setAddRepoModal(true); }} className="px-3 py-1.5 bg-purple-500 text-white text-sm font-medium rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-1.5">
                                    <Plus className="w-4 h-4" />
                                    添加仓库
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* 页面标签 */}
                <div className="flex gap-2 border-b border-gray-200 dark:border-base-300">
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
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="font-semibold text-gray-900 dark:text-base-content">{skill.name}</h3>
                                                {skill.repoOwner && <span className="text-xs text-gray-400">{skill.repoOwner}/{skill.repoName}</span>}
                                            </div>
                                            {skill.description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{skill.description}</p>}
                                            <div className="flex items-center gap-4">
                                                {SKILL_APPS.map(({ key, label, app }) => (
                                                    <label key={app} className="flex items-center gap-1.5 cursor-pointer">
                                                        <input type="checkbox" className="toggle toggle-xs toggle-primary" checked={skill[key]} onChange={(e) => toggleV2App(skill.id, app, e.target.checked)} />
                                                        <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                        <button onClick={() => setV2DeleteModal({ isOpen: true, id: skill.id })} className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors ml-4">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
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
                        return filtered.length === 0 ? (
                            <div className="bg-white dark:bg-base-100 rounded-xl p-8 shadow-sm border border-gray-100 dark:border-base-200 text-center">
                                <Search className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                                <p className="text-gray-500 dark:text-gray-400">{query ? '未找到匹配的技能' : '点击"发现技能"从 GitHub 仓库获取可安装的技能'}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {filtered.map((skill) => {
                                const isInstalled = installed.some((s) => s.directory === skill.directory);
                                return (
                                    <div key={skill.key} className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h3 className="font-semibold text-gray-900 dark:text-base-content">{skill.name}</h3>
                                                    <span className="text-xs text-gray-400">{skill.repoOwner}/{skill.repoName}</span>
                                                    {isInstalled && <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">已安装</span>}
                                                </div>
                                                {skill.description && <p className="text-sm text-gray-500 dark:text-gray-400">{skill.description}</p>}
                                            </div>
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
                                                    className="px-3 py-1.5 bg-purple-500 text-white text-xs font-medium rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-1.5 ml-4 disabled:opacity-50"
                                                >
                                                    {installLoading === skill.key ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                                    安装
                                                </button>
                                            )}
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
                                <div key={`${repo.owner}/${repo.name}`} className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200">
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="font-semibold text-gray-900 dark:text-base-content">{repo.owner}/{repo.name}</h3>
                                                <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-base-200 text-gray-500 dark:text-gray-400 rounded">{repo.branch}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <label className="flex items-center gap-1.5 cursor-pointer">
                                                <input type="checkbox" className="toggle toggle-sm toggle-primary" checked={repo.enabled} onChange={(e) => saveRepo({ ...repo, enabled: e.target.checked })} />
                                                <span className="text-xs text-gray-600 dark:text-gray-400">{repo.enabled ? '启用' : '禁用'}</span>
                                            </label>
                                            <button onClick={() => deleteRepo(repo.owner, repo.name)} className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
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
                        if (!newRepo.owner.trim() || !newRepo.name.trim()) return;
                        try {
                            await saveRepo({ owner: newRepo.owner.trim(), name: newRepo.name.trim(), branch: newRepo.branch.trim() || 'main', enabled: true });
                            showToast('仓库添加成功', 'success');
                            setAddRepoModal(false);
                        } catch (e) { showToast(String(e), 'error'); }
                    }}
                    onCancel={() => setAddRepoModal(false)}
                >
                    <div className="space-y-3">
                        <div>
                            <label className="text-sm text-gray-600 dark:text-gray-400">Owner</label>
                            <input type="text" value={newRepo.owner} onChange={(e) => setNewRepo({ ...newRepo, owner: e.target.value })} placeholder="e.g. anthropics" className="w-full mt-1 px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 dark:text-base-content text-sm" />
                        </div>
                        <div>
                            <label className="text-sm text-gray-600 dark:text-gray-400">Name</label>
                            <input type="text" value={newRepo.name} onChange={(e) => setNewRepo({ ...newRepo, name: e.target.value })} placeholder="e.g. skills" className="w-full mt-1 px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 dark:text-base-content text-sm" />
                        </div>
                        <div>
                            <label className="text-sm text-gray-600 dark:text-gray-400">Branch</label>
                            <input type="text" value={newRepo.branch} onChange={(e) => setNewRepo({ ...newRepo, branch: e.target.value })} placeholder="main" className="w-full mt-1 px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 dark:text-base-content text-sm" />
                        </div>
                    </div>
                </ModalDialog>
            </div>
        </div>
    );
}

export default SkillsPage;
