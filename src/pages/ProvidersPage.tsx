import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, LayoutGrid, List, GripVertical, Zap, Edit2, Trash2, Eye, EyeOff, Search, Layers, Download, Upload, Loader2, Tag, Copy, ExternalLink, Terminal } from 'lucide-react';
import { useEffect, useMemo, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useProviderStore } from '../stores/useProviderStore';
import { Provider } from '../types/provider';
import { VISIBLE_APP_TYPES, APP_LABELS, APP_COLORS, AppType } from '../types/app';
import ModalDialog from '../components/common/ModalDialog';
import { showToast } from '../components/common/ToastContainer';
import { exportProvidersConfigToFile, importProvidersConfigFromFile } from '../services/configTransferService';
import ProviderCard from '../components/providers/ProviderCard';
import ProviderForm from '../components/providers/ProviderForm';
import ProviderIcon from '../components/providers/ProviderIcon';

type ViewMode = 'card' | 'table';

function maskApiKey(key: string) {
    if (key.length <= 10) return '***';
    return key.substring(0, 7) + '...' + key.substring(key.length - 4);
}

function ProvidersPage() {
    const { t } = useTranslation();
    const { providers, hasLoaded, loading, loadAllProviders, switchProvider, deleteProvider, moveProvider, addProvider } = useProviderStore();
    const [viewMode, setViewMode] = useState<ViewMode>('card');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterApp, setFilterApp] = useState<AppType | 'all'>('all');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
    const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: string; name: string }>({ isOpen: false, id: '', name: '' });
    const [exportLoading, setExportLoading] = useState(false);
    const [importLoading, setImportLoading] = useState(false);
    const [filterTag, setFilterTag] = useState<string | null>(null);

    // 拖拽状态
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const dragSourceRef = useRef<string | null>(null);
    const dragOverRef = useRef<string | null>(null);

    // 收集所有标签
    const allTags = useMemo(() => {
        const tagSet = new Set<string>();
        providers.forEach(p => p.tags?.forEach(t => tagSet.add(t)));
        return Array.from(tagSet).sort();
    }, [providers]);

    // 过滤
    const filteredProviders = useMemo(() => {
        let result = providers;
        if (filterApp !== 'all') {
            result = result.filter(p => p.appType === filterApp);
        }
        if (filterTag) {
            result = result.filter(p => p.tags?.includes(filterTag));
        }
        const query = searchQuery.trim().toLowerCase();
        if (query) {
            result = result.filter(p =>
                p.name.toLowerCase().includes(query) ||
                p.apiKey.toLowerCase().includes(query) ||
                (p.url && p.url.toLowerCase().includes(query)) ||
                (p.description && p.description.toLowerCase().includes(query)) ||
                (p.tags && p.tags.some(t => t.toLowerCase().includes(query)))
            );
        }
        return result;
    }, [providers, filterApp, filterTag, searchQuery]);

    useEffect(() => {
        if (!hasLoaded) {
            void loadAllProviders();
        }
    }, [hasLoaded, loadAllProviders]);

    // 操作
    const handleAdd = () => {
        setEditingProvider(null);
        setIsFormOpen(true);
    };

    const handleEdit = (provider: Provider) => {
        setEditingProvider(provider);
        setIsFormOpen(true);
    };

    const handleSwitch = async (providerId: string) => {
        const provider = providers.find(p => p.id === providerId);
        if (!provider) return;
        try {
            await switchProvider(provider.appType, providerId);
            showToast(t('providers.switch_success'), 'success');
        } catch (error) {
            showToast(t('providers.switch_failed', { error: String(error) }), 'error');
        }
    };

    const handleDelete = (id: string, name: string) => {
        setDeleteModal({ isOpen: true, id, name });
    };

    const handleClone = async (provider: Provider) => {
        const { id, createdAt, isActive, lastUsed, inFailoverQueue, ...data } = provider;
        try {
            await addProvider({ ...data, name: `${data.name} (Copy)` });
            showToast(t('providers.clone_success'), 'success');
        } catch (error) {
            showToast(t('providers.clone_failed', { error: String(error) }), 'error');
        }
    };

    const handleExportConfig = async () => {
        setExportLoading(true);
        try {
            const result = await exportProvidersConfigToFile();
            showToast(
                `${t('providers.exportSuccess')} · ${t('providers.exportLocationHint', { fileName: result.fileName })}`,
                'success'
            );
        } catch (error) {
            showToast(`${t('providers.exportFailed')}: ${String(error)}`, 'error');
        } finally {
            setExportLoading(false);
        }
    };

    const handleImportConfig = async () => {
        setImportLoading(true);
        try {
            const result = await importProvidersConfigFromFile();
            if (result.cancelled) {
                return;
            }
            await loadAllProviders(true);
            const importedFilesText = result.importedFiles.length > 0 ? ` (${result.importedFiles.join(', ')})` : '';
            showToast(`${t('providers.importSuccess')}${importedFilesText}`, 'success');
        } catch (error) {
            showToast(`${t('providers.importFailed')}: ${String(error)}`, 'error');
        } finally {
            setImportLoading(false);
        }
    };

    const confirmDelete = async () => {
        try {
            await deleteProvider(deleteModal.id);
            setDeleteModal({ isOpen: false, id: '', name: '' });
            showToast(t('providers.delete_success'), 'success');
        } catch (error) {
            showToast(t('providers.delete_failed', { error: String(error) }), 'error');
        }
    };

    const handleLaunchTerminal = async (command: string) => {
        try {
            const { homeDir } = await import('@tauri-apps/api/path');
            const home = await homeDir();
            await invoke('launch_resume_session', { command, cwd: home });
            showToast(`已启动 ${command} 终端`, 'success');
        } catch (error) {
            showToast('启动终端失败: ' + error, 'error');
        }
    };

    const toggleShowKey = (id: string) => {
        setShowKeys(prev => ({ ...prev, [id]: !prev[id] }));
    };

    // 拖拽逻辑
    const getProviderIndex = (id: string) => providers.findIndex(p => p.id === id);

    const updateDragOverId = (id: string | null) => {
        dragOverRef.current = id;
        setDragOverId(id);
    };

    const resolveProviderIdFromPoint = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        return el?.closest<HTMLElement>('[data-provider-id]')?.dataset.providerId || null;
    };

    const clearDragState = () => {
        dragSourceRef.current = null;
        updateDragOverId(null);
        setDraggingId(null);
    };

    const handlePointerDragStart = (id: string) => (e: React.PointerEvent<HTMLElement>) => {
        if (loading || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        dragSourceRef.current = id;
        setDraggingId(id);
    };

    const handlePointerOver = (id: string) => () => {
        const src = dragSourceRef.current;
        if (!src || src === id) return;
        if (dragOverRef.current !== id) updateDragOverId(id);
    };

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            if (!dragSourceRef.current) return;
            const hoverId = resolveProviderIdFromPoint(e.clientX, e.clientY);
            if (hoverId && hoverId !== dragSourceRef.current) {
                if (dragOverRef.current !== hoverId) updateDragOverId(hoverId);
            } else if (dragOverRef.current !== null) {
                updateDragOverId(null);
            }
        };
        const onUp = (e: PointerEvent) => {
            const sourceId = dragSourceRef.current;
            if (!sourceId) return;
            const targetId = dragOverRef.current || resolveProviderIdFromPoint(e.clientX, e.clientY);
            clearDragState();
            if (!targetId || targetId === sourceId) return;
            const srcIdx = getProviderIndex(sourceId);
            const tgtIdx = getProviderIndex(targetId);
            if (srcIdx < 0 || tgtIdx < 0 || srcIdx === tgtIdx) return;
            void moveProvider(sourceId, tgtIdx).then(() => {
                showToast(t('providers.sort_updated'), 'success');
            }).catch((err) => {
                showToast(t('providers.sort_failed', { error: String(err) }), 'error');
            });
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
    }, [providers]);

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="p-6 space-y-4 max-w-7xl mx-auto">
                {/* 标题栏 */}
                <div className="flex flex-wrap justify-between items-center gap-2">
                    <div className="flex items-center gap-3 shrink-0">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center shadow-md">
                            <Layers className="w-5 h-5 text-white" />
                        </div>
                        <h1 className="text-xl font-bold text-gray-900 dark:text-base-content">
                            {t('providers.title')}
                        </h1>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            ({filteredProviders.length} / {providers.length})
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                        <div className="btn-group">
                            <button
                                onClick={() => setViewMode('table')}
                                className={`btn btn-sm ${viewMode === 'table' ? 'btn-active' : 'btn-ghost'}`}
                                title={t('providers.table_view')}
                            >
                                <List className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setViewMode('card')}
                                className={`btn btn-sm ${viewMode === 'card' ? 'btn-active' : 'btn-ghost'}`}
                                title={t('providers.card_view')}
                            >
                                <LayoutGrid className="w-4 h-4" />
                            </button>
                        </div>
                        <span className="hidden lg:flex items-center text-xs text-base-content/60 px-1 whitespace-nowrap">
                            {t('providers.importExportScope')}
                        </span>
                        <button
                            onClick={handleExportConfig}
                            disabled={loading || exportLoading || importLoading}
                            className="btn btn-ghost btn-sm gap-2 whitespace-nowrap"
                            title={t('providers.importExportScope')}
                        >
                            {exportLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            {t('providers.export_config')}
                        </button>
                        <button
                            onClick={handleImportConfig}
                            disabled={loading || exportLoading || importLoading}
                            className="btn btn-ghost btn-sm gap-2 whitespace-nowrap"
                            title={t('providers.importExportScope')}
                        >
                            {importLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            {t('providers.import_config')}
                        </button>
                        <button
                            onClick={() => loadAllProviders(true)}
                            disabled={loading || exportLoading || importLoading}
                            className="btn btn-ghost btn-sm gap-2 whitespace-nowrap"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            {t('common.refresh')}
                        </button>
                        <button
                            onClick={handleAdd}
                            className="btn bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-none btn-sm gap-2 whitespace-nowrap"
                        >
                            <Plus className="w-4 h-4" />
                            {t('providers.add_btn')}
                        </button>
                    </div>
                </div>

                {/* 搜索 + 过滤 */}
                <div className="flex gap-3">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
                        <input
                            type="text"
                            placeholder={t('providers.search_placeholder')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input input-bordered input-sm w-full pl-9"
                        />
                    </div>
                    <select
                        className="select select-bordered select-sm"
                        value={filterApp}
                        onChange={(e) => setFilterApp(e.target.value as AppType | 'all')}
                    >
                        <option value="all">{t('providers.filter_all')}</option>
                        {VISIBLE_APP_TYPES.map(type => (
                            <option key={type} value={type}>{APP_LABELS[type]}</option>
                        ))}
                    </select>
                </div>

                {/* 快捷打开配置文件 + 启动终端 */}
                <div className="flex items-center gap-4 flex-wrap text-xs">
                    {[
                        { app: 'Claude', cli: 'claude', dot: 'bg-orange-400', termClass: 'text-orange-500 hover:bg-orange-500/10', files: [
                            { label: 'settings.json', path: '~/.claude/settings.json' },
                            { label: '.claude.json', path: '~/.claude.json' },
                        ]},
                        { app: 'Codex', cli: 'codex', dot: 'bg-emerald-400', termClass: 'text-emerald-500 hover:bg-emerald-500/10', files: [
                            { label: 'auth.json', path: '~/.codex/auth.json' },
                            { label: 'config.toml', path: '~/.codex/config.toml' },
                        ]},
                        { app: 'Gemini', cli: 'gemini', dot: 'bg-blue-400', termClass: 'text-blue-500 hover:bg-blue-500/10', files: [
                            { label: '.env', path: '~/.gemini/.env' },
                            { label: 'settings.json', path: '~/.gemini/settings.json' },
                        ]},
                    ].map(group => (
                        <div key={group.app} className="inline-flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-base-content/50">
                                <span className={`w-1.5 h-1.5 rounded-full ${group.dot}`} />
                                {group.app}
                            </span>
                            {group.files.map(file => (
                                <button
                                    key={file.path}
                                    onClick={() => invoke('open_config_file', { path: file.path }).catch(e => showToast(String(e), 'error'))}
                                    className="px-2 py-0.5 rounded bg-base-200/60 hover:bg-base-200 text-base-content/70 hover:text-base-content transition-colors font-mono"
                                    title={file.path}
                                >
                                    {file.label}
                                </button>
                            ))}
                            <button
                                onClick={() => handleLaunchTerminal(group.cli)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${group.termClass}`}
                                title={`启动 ${group.cli} 终端`}
                            >
                                <Terminal className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>

                {/* 标签筛选 */}
                {allTags.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <Tag className="w-3.5 h-3.5 text-base-content/40 shrink-0" />
                        {allTags.map(tag => (
                            <button
                                key={tag}
                                onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                                className={`px-2 py-0.5 rounded-full text-xs transition-all border ${
                                    filterTag === tag
                                        ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                                        : 'bg-base-200/50 text-base-content/60 border-transparent hover:bg-base-200 hover:text-base-content'
                                }`}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                )}

                {/* 空状态 */}
                {providers.length === 0 && !loading && (
                    <div className="text-center py-16">
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/20 dark:to-purple-900/20 flex items-center justify-center mx-auto mb-4">
                            <Layers className="w-10 h-10 text-blue-500" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">{t('providers.empty_title')}</h3>
                        <p className="text-base-content/60 mb-4 text-sm">
                            {t('providers.empty_desc')}
                        </p>
                        <button
                            onClick={handleAdd}
                            className="btn bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-none gap-2 btn-sm"
                        >
                            <Plus className="w-4 h-4" />
                            {t('providers.add_first')}
                        </button>
                    </div>
                )}

                {filteredProviders.length === 0 && providers.length > 0 && (
                    <div className="text-center py-16">
                        <p className="text-base-content/60">{t('providers.no_match')}</p>
                    </div>
                )}

                {/* 卡片视图 */}
                {viewMode === 'card' && filteredProviders.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredProviders.map((provider) => (
                            <ProviderCard
                                key={provider.id}
                                provider={provider}
                                isDragging={draggingId === provider.id}
                                isDragOver={dragOverId === provider.id && draggingId !== provider.id}
                                onSwitch={handleSwitch}
                                onEdit={handleEdit}
                                onClone={handleClone}
                                onDelete={handleDelete}
                                onPointerDragStart={handlePointerDragStart(provider.id)}
                                onPointerOver={handlePointerOver(provider.id)}
                            />
                        ))}
                    </div>
                )}

                {/* 表格视图 */}
                {viewMode === 'table' && filteredProviders.length > 0 && (
                    <div className="overflow-x-auto bg-base-100 rounded-lg border border-base-300">
                        <table className="table table-fixed min-w-[1100px]">
                            <thead>
                                <tr className="border-b border-base-300">
                                    <th className="bg-base-200 w-14"></th>
                                    <th className="bg-base-200 w-48">{t('providers.col_name')}</th>
                                    <th className="bg-base-200 w-28">{t('providers.col_type')}</th>
                                    <th className="bg-base-200 w-48">API Key</th>
                                    <th className="bg-base-200 w-64">URL</th>
                                    <th className="bg-base-200 text-right w-40 sticky right-0 z-20">{t('common.action')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredProviders.map((provider) => (
                                    <tr
                                        key={provider.id}
                                        data-provider-id={provider.id}
                                        onPointerOver={handlePointerOver(provider.id)}
                                        className={`border-b border-base-200 hover:bg-base-200/50 transition-colors ${
                                            provider.isActive ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10 border-l-4 border-l-green-500' : ''
                                        } ${draggingId === provider.id ? 'opacity-60' : ''} ${
                                            dragOverId === provider.id && draggingId !== provider.id ? 'bg-info/5' : ''
                                        }`}
                                    >
                                        <td className="w-14">
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onPointerDown={handlePointerDragStart(provider.id)}
                                                    onClick={(e) => e.preventDefault()}
                                                    className="inline-flex h-6 w-6 items-center justify-center rounded text-base-content/50 hover:bg-base-200 cursor-grab active:cursor-grabbing"
                                                >
                                                    <GripVertical className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                        <td className="w-48">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <ProviderIcon appType={provider.appType} size="sm" />
                                                <div className="flex flex-col min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium truncate">{provider.name}</span>
                                                        {provider.isActive && (
                                                            <span className="badge badge-sm bg-green-500 text-white border-none gap-1 shrink-0">
                                                                <Zap className="w-3 h-3" fill="currentColor" />
                                                                {t('providers.active_badge')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {provider.description && (
                                                        <span className="text-xs text-base-content/50 truncate">{provider.description}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="w-28">
                                            <span className="inline-flex items-center gap-1.5 text-xs text-base-content/70">
                                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: APP_COLORS[provider.appType] }} />
                                                {APP_LABELS[provider.appType]}
                                            </span>
                                        </td>
                                        <td className="w-48">
                                            <div className="flex items-center gap-2">
                                                <code className="font-mono text-xs bg-base-200 px-2 py-1 rounded truncate max-w-[140px]">
                                                    {showKeys[provider.id] ? provider.apiKey : maskApiKey(provider.apiKey)}
                                                </code>
                                                <button onClick={() => toggleShowKey(provider.id)} className="btn btn-ghost btn-xs">
                                                    {showKeys[provider.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                </button>
                                            </div>
                                        </td>
                                        <td className="w-64">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <code className="font-mono text-xs text-base-content/70 truncate min-w-0" title={provider.url || ''}>
                                                    {provider.url || '-'}
                                                </code>
                                                {provider.url && (provider.url.startsWith('http://') || provider.url.startsWith('https://')) && (
                                                    <button
                                                        onClick={() => invoke('open_external', { url: provider.url!.trim() }).catch(() => {})}
                                                        className="shrink-0 p-0.5 text-blue-400/60 hover:text-blue-400 transition-colors"
                                                        title="在浏览器中打开"
                                                    >
                                                        <ExternalLink className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td className="w-40 sticky right-0 z-20">
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    onClick={() => handleSwitch(provider.id)}
                                                    className={`btn btn-xs gap-1 ${provider.isActive ? 'btn-disabled' : 'btn-ghost text-green-600'}`}
                                                    disabled={provider.isActive}
                                                >
                                                    <Zap className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => handleEdit(provider)} className="btn btn-ghost btn-xs">
                                                    <Edit2 className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => handleClone(provider)} className="btn btn-ghost btn-xs">
                                                    <Copy className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(provider.id, provider.name)}
                                                    className="btn btn-ghost btn-xs text-red-500"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* 表单弹窗 */}
            <ProviderForm
                isOpen={isFormOpen}
                editingProvider={editingProvider}
                onClose={() => { setIsFormOpen(false); setEditingProvider(null); }}
                defaultAppType={filterApp === 'all' ? 'claude' : filterApp}
            />

            {/* 删除确认 */}
            <ModalDialog
                isOpen={deleteModal.isOpen}
                title={t('providers.delete_title')}
                message={t('providers.delete_confirm', { name: deleteModal.name })}
                type="confirm"
                isDestructive
                onConfirm={confirmDelete}
                onCancel={() => setDeleteModal({ isOpen: false, id: '', name: '' })}
            />
        </div>
    );
}

export default ProvidersPage;
