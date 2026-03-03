import { useTranslation } from 'react-i18next';
import { FileText, Plus, RefreshCw, Trash2, Edit, CheckCircle, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePromptStoreV2 } from '../stores/usePromptStoreV2';
import { PromptRow, PROMPT_APPS } from '../types/promptV2';
import ModalDialog from '../components/common/ModalDialog';
import { showToast } from '../components/common/ToastContainer';

function PromptsPage() {
    const { t } = useTranslation();
    const v2Store = usePromptStoreV2();

    const [currentApp, setCurrentApp] = useState('claude');

    // 编辑弹窗状态
    const [isEditing, setIsEditing] = useState(false);
    const [editPrompt, setEditPrompt] = useState<Partial<PromptRow>>({});
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: string; appType: string }>({ isOpen: false, id: '', appType: '' });

    // 数据加载
    useEffect(() => {
        v2Store.loadPrompts(currentApp);
        v2Store.loadLiveContent(currentApp);
    }, [currentApp]);

    // 编辑视图
    if (isEditing) {
        return (
            <div className="h-full w-full overflow-y-auto">
                <div className="p-6 space-y-4 max-w-7xl mx-auto">
                    <div className="flex justify-between items-center">
                        <h1 className="text-xl font-bold text-gray-900 dark:text-base-content">
                            {editPrompt.id ? '编辑 Prompt' : '新建 Prompt'}
                        </h1>
                        <div className="flex gap-2">
                            <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-base-100 transition-colors">
                                {t('common.cancel')}
                            </button>
                            <button onClick={async () => {
                                if (!editPrompt.name?.trim()) return;
                                try {
                                    const now = Date.now() / 1000 | 0;
                                    await v2Store.upsertPrompt({
                                        id: editPrompt.id || crypto.randomUUID(),
                                        appType: editPrompt.appType || currentApp,
                                        name: editPrompt.name!.trim(),
                                        content: editPrompt.content || '',
                                        description: editPrompt.description || null,
                                        enabled: editPrompt.enabled || false,
                                        createdAt: editPrompt.createdAt || now,
                                        updatedAt: now,
                                    });
                                    setIsEditing(false);
                                    showToast('保存成功', 'success');
                                } catch (e) { showToast(String(e), 'error'); }
                            }} className="px-3 py-1.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors">
                                {t('common.save')}
                            </button>
                        </div>
                    </div>
                    <input
                        type="text"
                        value={editPrompt.name || ''}
                        onChange={(e) => setEditPrompt({ ...editPrompt, name: e.target.value })}
                        placeholder="Prompt 名称"
                        className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 dark:text-base-content"
                    />
                    <input
                        type="text"
                        value={editPrompt.description || ''}
                        onChange={(e) => setEditPrompt({ ...editPrompt, description: e.target.value })}
                        placeholder="描述（可选）"
                        className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 dark:text-base-content"
                    />
                    <textarea
                        value={editPrompt.content || ''}
                        onChange={(e) => setEditPrompt({ ...editPrompt, content: e.target.value })}
                        rows={20}
                        placeholder="Prompt 内容"
                        className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 dark:text-base-content font-mono text-sm"
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="p-6 space-y-4 max-w-7xl mx-auto">
                {/* 标题栏 */}
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <FileText className="w-6 h-6 text-green-500" />
                        <h1 className="text-xl font-bold text-gray-900 dark:text-base-content">
                            {t('prompts.title')}
                        </h1>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            {v2Store.prompts.length} {t('prompts.presets')}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => v2Store.loadPrompts(currentApp)} disabled={v2Store.loading} className="px-3 py-1.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-base-100 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                            <RefreshCw className={`w-4 h-4 ${v2Store.loading ? 'animate-spin' : ''}`} />
                            {t('common.refresh')}
                        </button>
                        <button onClick={() => { setEditPrompt({ appType: currentApp, name: '', content: '', description: '' }); setIsEditing(true); }} className="px-3 py-1.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors flex items-center gap-1.5">
                            <Plus className="w-4 h-4" />
                            {t('common.add')}
                        </button>
                    </div>
                </div>

                {/* 应用 tab */}
                <div className="flex gap-2 flex-wrap">
                    {PROMPT_APPS.map(({ key, label }) => (
                        <button key={key} onClick={() => setCurrentApp(key)} className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${currentApp === key ? 'bg-green-500 text-white' : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-base-100'}`}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* Prompt 列表 */}
                {v2Store.loading ? (
                    <div className="bg-white dark:bg-base-100 rounded-xl p-8 text-center">
                        <RefreshCw className="w-8 h-8 text-green-500 mx-auto mb-2 animate-spin" />
                        <p className="text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
                    </div>
                ) : v2Store.prompts.length === 0 ? (
                    <div className="bg-white dark:bg-base-100 rounded-xl p-8 shadow-sm border border-gray-100 dark:border-base-200 text-center">
                        <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-500 dark:text-gray-400">暂无 Prompt 预设</p>
                        <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">点击"添加"创建新预设，或"从文件导入"导入现有配置</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {v2Store.prompts.map((prompt) => (
                            <div key={prompt.id} className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-semibold text-gray-900 dark:text-base-content">{prompt.name}</h3>
                                            {prompt.enabled && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
                                                    <CheckCircle className="w-3 h-3" />
                                                    已启用
                                                </span>
                                            )}
                                        </div>
                                        {prompt.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{prompt.description}</p>}
                                        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 line-clamp-2 font-mono">{prompt.content.substring(0, 150)}{prompt.content.length > 150 ? '...' : ''}</p>
                                    </div>
                                    <div className="flex gap-2 ml-4 flex-shrink-0">
                                        {prompt.enabled ? (
                                            <button onClick={() => v2Store.disablePrompt(prompt.id, currentApp)} className="px-3 py-1.5 text-xs font-medium text-orange-600 bg-orange-50 dark:bg-orange-900/20 dark:text-orange-400 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors">
                                                禁用
                                            </button>
                                        ) : (
                                            <button onClick={() => v2Store.enablePrompt(prompt.id, currentApp)} className="px-3 py-1.5 text-xs font-medium text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors">
                                                启用
                                            </button>
                                        )}
                                        <button onClick={() => { setEditPrompt(prompt); setIsEditing(true); }} className="p-2 text-gray-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors">
                                            <Edit className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => setDeleteModal({ isOpen: true, id: prompt.id, appType: currentApp })} disabled={prompt.enabled} className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 从文件导入按钮 */}
                <div className="flex justify-center">
                    <button
                        onClick={async () => {
                            try {
                                await v2Store.importFromFile(currentApp);
                                showToast('导入成功', 'success');
                            } catch (e) { showToast(String(e), 'error'); }
                        }}
                        className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-base-200 rounded-lg hover:bg-gray-200 dark:hover:bg-base-100 transition-colors flex items-center gap-2"
                    >
                        <Download className="w-4 h-4" />
                        从 {PROMPT_APPS.find(a => a.key === currentApp)?.file} 导入
                    </button>
                </div>

                {/* 删除确认对话框 */}
                <ModalDialog
                    isOpen={deleteModal.isOpen}
                    title="删除 Prompt"
                    message="确认删除此 Prompt？此操作不可恢复。"
                    type="confirm"
                    isDestructive={true}
                    onConfirm={async () => {
                        try {
                            await v2Store.deletePrompt(deleteModal.id, deleteModal.appType);
                            showToast('删除成功', 'success');
                        } catch (e) { showToast(String(e), 'error'); }
                        finally { setDeleteModal({ isOpen: false, id: '', appType: '' }); }
                    }}
                    onCancel={() => setDeleteModal({ isOpen: false, id: '', appType: '' })}
                />
            </div>
        </div>
    );
}

export default PromptsPage;
