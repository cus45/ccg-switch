import { useTranslation } from 'react-i18next';
import { Sparkles, Plus, RefreshCw, Trash2, Check, Eye, EyeOff, Zap, Settings, Download, ChevronDown, Edit2, LayoutGrid, List, Globe, GripVertical } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { useTokenStore } from '../stores/useTokenStore';
import ModalDialog from '../components/common/ModalDialog';
import { showToast } from '../components/common/ToastContainer';
import { open } from '@tauri-apps/plugin-shell';
import { ApiToken } from '../types/token';

type ViewMode = 'card' | 'table';

// 自定义下拉搜索组件
interface ModelSelectProps {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    models: string[];
}

function ModelSelect({ value, onChange, placeholder, models }: ModelSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredModels = models.filter(m =>
        m.toLowerCase().includes(search.toLowerCase())
    );

    const handleSelect = (model: string) => {
        onChange(model);
        setSearch('');
        setIsOpen(false);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        onChange(val);
        setSearch(val);
        if (!isOpen && val) {
            setIsOpen(true);
        }
    };

    return (
        <div ref={dropdownRef} className="relative">
            <div className="relative">
                <input
                    type="text"
                    className="input input-bordered input-sm w-full font-mono text-xs pr-8"
                    placeholder={placeholder}
                    value={value}
                    onChange={handleInputChange}
                    onFocus={() => models.length > 0 && setIsOpen(true)}
                />
                {models.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setIsOpen(!isOpen)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/50 hover:text-base-content"
                    >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                )}
            </div>

            {isOpen && filteredModels.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredModels.map((model) => (
                        <button
                            key={model}
                            type="button"
                            onClick={() => handleSelect(model)}
                            className="w-full px-3 py-2 text-left text-xs font-mono hover:bg-base-200 transition-colors first:rounded-t-lg last:rounded-b-lg"
                        >
                            {model}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function ClaudePage() {
    const { t } = useTranslation();
    const { tokens, loading, loadTokens, addToken, updateToken, switchToken, deleteToken, moveToken, fetchModels } = useTokenStore();
    const [viewMode, setViewMode] = useState<ViewMode>('card');
    const [searchQuery, setSearchQuery] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [newToken, setNewToken] = useState({
        name: '',
        apiKey: '',
        url: '',
        defaultSonnetModel: '',
        defaultOpusModel: '',
        defaultHaikuModel: '',
        description: ''
    });
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [showKeys, setShowKeys] = useState<{ [key: string]: boolean }>({});
    const [draggingTokenId, setDraggingTokenId] = useState<string | null>(null);
    const [dragOverTokenId, setDragOverTokenId] = useState<string | null>(null);
    const dragSourceTokenIdRef = useRef<string | null>(null);
    const dragOverTokenIdRef = useRef<string | null>(null);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: string; name: string }>({
        isOpen: false,
        id: '',
        name: ''
    });

    // 搜索过滤
    const filteredTokens = tokens.filter(token =>
        token.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        token.apiKey.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (token.url && token.url.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (token.description && token.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    useEffect(() => {
        loadTokens();
    }, [loadTokens]);

    const handleAdd = () => {
        setNewToken({
            name: '',
            apiKey: '',
            url: 'https://api.anthropic.com',
            defaultSonnetModel: '',
            defaultOpusModel: '',
            defaultHaikuModel: '',
            description: ''
        });
        setAvailableModels([]);
        setIsAdding(true);
        setIsEditing(false);
        setEditingId(null);
    };

    const handleEdit = (token: ApiToken) => {
        setNewToken({
            name: token.name,
            apiKey: token.apiKey,
            url: token.url || 'https://api.anthropic.com',
            defaultSonnetModel: token.defaultSonnetModel || '',
            defaultOpusModel: token.defaultOpusModel || '',
            defaultHaikuModel: token.defaultHaikuModel || '',
            description: token.description || ''
        });
        setAvailableModels([]);
        setEditingId(token.id);
        setIsEditing(true);
        setIsAdding(true);
    };

    const handleSave = async () => {
        if (!newToken.name.trim() || !newToken.apiKey.trim()) {
            showToast('请填写名称和 API Key', 'error');
            return;
        }
        try {
            const tokenData = {
                name: newToken.name.trim(),
                apiKey: newToken.apiKey.trim(),
                url: newToken.url.trim() || undefined,
                defaultSonnetModel: newToken.defaultSonnetModel.trim() || undefined,
                defaultOpusModel: newToken.defaultOpusModel.trim() || undefined,
                defaultHaikuModel: newToken.defaultHaikuModel.trim() || undefined,
                description: newToken.description.trim() || undefined
            };

            if (isEditing && editingId) {
                await updateToken(editingId, tokenData);
                showToast('API Key 更新成功', 'success');
            } else {
                await addToken(tokenData);
                showToast('API Key 添加成功', 'success');
            }
            setIsAdding(false);
            setIsEditing(false);
            setEditingId(null);
        } catch (error) {
            showToast((isEditing ? '更新失败: ' : '添加失败: ') + error, 'error');
        }
    };

    const handleSwitch = async (tokenId: string) => {
        try {
            await switchToken(tokenId);
            showToast('API Key 切换成功', 'success');
        } catch (error) {
            showToast('切换失败: ' + error, 'error');
        }
    };

    const getTokenIndex = (tokenId: string) => {
        return tokens.findIndex(token => token.id === tokenId);
    };

    const handleMoveToken = async (tokenId: string, targetIndex: number, successMessage: string) => {
        try {
            await moveToken(tokenId, targetIndex);
            showToast(successMessage, 'success');
        } catch (error) {
            showToast('移动失败: ' + error, 'error');
        }
    };

    const updateDragOverTokenId = (tokenId: string | null) => {
        dragOverTokenIdRef.current = tokenId;
        setDragOverTokenId(tokenId);
    };

    const resolveTokenIdFromPoint = (clientX: number, clientY: number) => {
        const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
        return element?.closest<HTMLElement>('[data-token-id]')?.dataset.tokenId || null;
    };

    const clearDragState = () => {
        dragSourceTokenIdRef.current = null;
        updateDragOverTokenId(null);
        setDraggingTokenId(null);
    };

    const handlePointerDragStart = (tokenId: string) => (e: React.PointerEvent<HTMLElement>) => {
        if (loading) {
            return;
        }
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        dragSourceTokenIdRef.current = tokenId;
        setDraggingTokenId(tokenId);
    };

    const getDraggingSourceTokenId = () => {
        return dragSourceTokenIdRef.current;
    };

    const handlePointerOver = (tokenId: string) => () => {
        const sourceTokenId = getDraggingSourceTokenId();
        if (!sourceTokenId || sourceTokenId === tokenId) {
            return;
        }
        if (dragOverTokenIdRef.current !== tokenId) {
            updateDragOverTokenId(tokenId);
        }
    };

    useEffect(() => {
        const handleGlobalPointerMove = (event: PointerEvent) => {
            const sourceTokenId = dragSourceTokenIdRef.current;
            if (!sourceTokenId) {
                return;
            }

            const hoverTokenId = resolveTokenIdFromPoint(event.clientX, event.clientY);
            if (hoverTokenId && hoverTokenId !== sourceTokenId) {
                if (dragOverTokenIdRef.current !== hoverTokenId) {
                    updateDragOverTokenId(hoverTokenId);
                }
            } else if (dragOverTokenIdRef.current !== null) {
                updateDragOverTokenId(null);
            }
        };

        const handleGlobalPointerUp = (event: PointerEvent) => {
            const sourceTokenId = dragSourceTokenIdRef.current;
            if (!sourceTokenId) {
                return;
            }

            const targetTokenId =
                dragOverTokenIdRef.current ||
                resolveTokenIdFromPoint(event.clientX, event.clientY);

            clearDragState();

            if (!targetTokenId || targetTokenId === sourceTokenId) {
                return;
            }

            const sourceIndex = getTokenIndex(sourceTokenId);
            const targetIndex = getTokenIndex(targetTokenId);
            if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
                return;
            }

            void handleMoveToken(sourceTokenId, targetIndex, '已更新配置顺序');
        };

        window.addEventListener('pointermove', handleGlobalPointerMove);
        window.addEventListener('pointerup', handleGlobalPointerUp);
        window.addEventListener('pointercancel', handleGlobalPointerUp);
        return () => {
            window.removeEventListener('pointermove', handleGlobalPointerMove);
            window.removeEventListener('pointerup', handleGlobalPointerUp);
            window.removeEventListener('pointercancel', handleGlobalPointerUp);
        };
    }, [tokens]);

    const handleDelete = (id: string, name: string) => {
        setDeleteModal({ isOpen: true, id, name });
    };

    const confirmDelete = async () => {
        try {
            await deleteToken(deleteModal.id);
            setDeleteModal({ isOpen: false, id: '', name: '' });
            showToast('API Key 删除成功', 'success');
        } catch (error) {
            showToast('删除失败: ' + error, 'error');
        }
    };

    const toggleShowKey = (id: string) => {
        setShowKeys(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const maskApiKey = (key: string) => {
        if (key.length <= 10) return '***';
        return key.substring(0, 7) + '...' + key.substring(key.length - 4);
    };

    const getBaseUrl = (url?: string) => {
        if (!url) return '';
        const raw = url.trim();
        if (!raw) return '';

        const normalized = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `https://${raw}`;
        try {
            const parsed = new URL(normalized);
            return `${parsed.protocol}//${parsed.host}`;
        } catch {
            return '';
        }
    };

    const handleOpenBaseUrl = async (url?: string) => {
        const baseUrl = getBaseUrl(url);
        if (!baseUrl) {
            showToast('URL 格式不正确，无法打开', 'error');
            return;
        }
        try {
            await open(baseUrl);
        } catch (error) {
            showToast('打开链接失败: ' + error, 'error');
        }
    };

    const handleFetchModels = async () => {
        if (!newToken.url || !newToken.apiKey) {
            showToast('请先填写 URL 和 API Key', 'error');
            return;
        }
        setFetchingModels(true);
        try {
            const models = await fetchModels(newToken.url, newToken.apiKey);
            setAvailableModels(models);
            showToast(`成功获取 ${models.length} 个模型`, 'success');
        } catch (error) {
            showToast('获取模型列表失败: ' + error, 'error');
        } finally {
            setFetchingModels(false);
        }
    };

    const handleOpenSettings = async () => {
        try {
            const { homeDir, join } = await import('@tauri-apps/api/path');
            const home = await homeDir();
            const settingsPath = await join(home, '.claude', 'settings.json');
            await open(settingsPath);
        } catch (error) {
            showToast('打开设置失败: ' + error, 'error');
        }
    };

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="p-6 space-y-4 max-w-7xl mx-auto">
                {/* 标题栏 */}
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center shadow-md">
                            <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <h1 className="text-xl font-bold text-gray-900 dark:text-base-content">
                            {t('claude.title', 'Claude API')}
                        </h1>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            ({filteredTokens.length} / {tokens.length} 个配置)
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <div className="btn-group">
                            <button
                                onClick={() => setViewMode('table')}
                                className={`btn btn-sm ${viewMode === 'table' ? 'btn-active' : 'btn-ghost'}`}
                                title="表格视图"
                            >
                                <List className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setViewMode('card')}
                                className={`btn btn-sm ${viewMode === 'card' ? 'btn-active' : 'btn-ghost'}`}
                                title="卡片视图"
                            >
                                <LayoutGrid className="w-4 h-4" />
                            </button>
                        </div>
                        <button
                            onClick={handleOpenSettings}
                            className="btn btn-ghost btn-sm gap-2"
                            title="打开 Claude 设置文件"
                        >
                            <Settings className="w-4 h-4" />
                            打开设置
                        </button>
                        <button
                            onClick={() => loadTokens()}
                            disabled={loading}
                            className="btn btn-ghost btn-sm gap-2"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            刷新
                        </button>
                        <button
                            onClick={handleAdd}
                            className="btn bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white border-none btn-sm gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            添加 API Key
                        </button>
                    </div>
                </div>

                {/* 搜索框 */}
                <div className="flex gap-3">
                    <div className="flex-1">
                        <input
                            type="text"
                            placeholder="搜索配置名称、API Key、URL 或描述..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input input-bordered input-sm w-full"
                        />
                        <p className="mt-1 text-xs text-base-content/50">可拖拽配置卡片或表格行调整顺序</p>
                    </div>
                </div>

                {/* 列表内容 */}
                {tokens.length === 0 && !loading && (
                    <div className="text-center py-16">
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-orange-100 to-pink-100 dark:from-orange-900/20 dark:to-pink-900/20 flex items-center justify-center mx-auto mb-4">
                            <Sparkles className="w-10 h-10 text-orange-500" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">还没有 API Key</h3>
                        <p className="text-base-content/60 mb-4 text-sm">
                            添加您的 Claude API Key 开始使用
                        </p>
                        <button
                            onClick={handleAdd}
                            className="btn bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white border-none gap-2 btn-sm"
                        >
                            <Plus className="w-4 h-4" />
                            添加第一个 API Key
                        </button>
                    </div>
                )}

                {filteredTokens.length === 0 && tokens.length > 0 && (
                    <div className="text-center py-16">
                        <p className="text-base-content/60">没有找到匹配的配置</p>
                    </div>
                )}

                {viewMode === 'table' && filteredTokens.length > 0 && (
                    <div className="overflow-x-auto bg-base-100 rounded-lg border border-base-300">
                        <table className="table">
                            <thead>
                                <tr className="border-b border-base-300">
                                    <th className="bg-base-200"></th>
                                    <th className="bg-base-200">名称</th>
                                    <th className="bg-base-200">API Key</th>
                                    <th className="bg-base-200">URL</th>
                                    <th className="bg-base-200">模型配置</th>
                                    <th className="bg-base-200 text-right">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTokens.map((token) => (
                                    <tr key={token.id} className={`border-b border-base-200 hover:bg-base-200/50 transition-colors ${
                                        token.isActive
                                            ? 'bg-gradient-to-r from-orange-50 to-pink-50 dark:from-orange-900/20 dark:to-pink-900/20 border-l-4 border-l-orange-500'
                                            : ''
                                    } ${draggingTokenId === token.id ? 'opacity-60' : ''} ${
                                        dragOverTokenId === token.id && draggingTokenId !== token.id
                                            ? 'bg-info/5'
                                            : ''
                                    }`}
                                        data-token-id={token.id}
                                        onPointerOver={handlePointerOver(token.id)}
                                    >
                                        <td className="w-12">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onPointerDown={handlePointerDragStart(token.id)}
                                                    onClick={(e) => e.preventDefault()}
                                                    className="inline-flex h-6 w-6 items-center justify-center rounded text-base-content/50 hover:bg-base-200 cursor-grab active:cursor-grabbing"
                                                    title="拖拽排序"
                                                >
                                                    <GripVertical className="w-4 h-4" />
                                                </button>
                                                {token.isActive && (
                                                    <div className="tooltip tooltip-right" data-tip="使用中">
                                                        <Zap className="w-5 h-5 text-orange-500" fill="currentColor" />
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="font-medium">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-base truncate">{token.name}</span>
                                                    {token.isActive && (
                                                        <span className="badge badge-sm bg-gradient-to-r from-orange-500 to-pink-500 text-white border-none gap-1 shadow-sm whitespace-nowrap shrink-0">
                                                            <Zap className="w-3 h-3" fill="currentColor" />
                                                            使用中
                                                        </span>
                                                    )}
                                                </div>
                                                {token.description && (
                                                    <span className="text-xs text-base-content/60">{token.description}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="flex items-center gap-2">
                                                <code className="font-mono text-xs bg-base-200 px-2 py-1 rounded">
                                                    {showKeys[token.id] ? token.apiKey : maskApiKey(token.apiKey)}
                                                </code>
                                                <button
                                                    onClick={() => toggleShowKey(token.id)}
                                                    className="btn btn-ghost btn-xs"
                                                >
                                                    {showKeys[token.id] ? (
                                                        <EyeOff className="w-3.5 h-3.5" />
                                                    ) : (
                                                        <Eye className="w-3.5 h-3.5" />
                                                    )}
                                                </button>
                                            </div>
                                        </td>
                                        <td>
                                            <div className="flex items-center gap-1 min-w-0">
                                                <code
                                                    className="font-mono text-xs text-base-content/70 truncate"
                                                    title={token.url || 'api.anthropic.com'}
                                                >
                                                    {token.url || 'api.anthropic.com'}
                                                </code>
                                                {token.url && (
                                                    <button
                                                        onClick={() => handleOpenBaseUrl(token.url)}
                                                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-info/80 hover:text-info hover:bg-info/10 transition-colors"
                                                        title="打开主域名"
                                                    >
                                                        <Globe className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="text-xs space-y-1 font-mono">
                                                {token.defaultSonnetModel && (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-base-content/50 w-14 flex-shrink-0">Sonnet</span>
                                                        <span className="text-base-content/70 truncate">{token.defaultSonnetModel}</span>
                                                    </div>
                                                )}
                                                {token.defaultOpusModel && (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-base-content/50 w-14 flex-shrink-0">Opus</span>
                                                        <span className="text-base-content/70 truncate">{token.defaultOpusModel}</span>
                                                    </div>
                                                )}
                                                {token.defaultHaikuModel && (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-base-content/50 w-14 flex-shrink-0">Haiku</span>
                                                        <span className="text-base-content/70 truncate">{token.defaultHaikuModel}</span>
                                                    </div>
                                                )}
                                                {!token.defaultSonnetModel && !token.defaultOpusModel && !token.defaultHaikuModel && (
                                                    <span className="text-base-content/40">未配置</span>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="flex justify-end gap-2">
                                                {token.isActive ? (
                                                    <button
                                                        disabled
                                                        className="btn btn-xs bg-gradient-to-r from-orange-500 to-pink-500 text-white border-none cursor-default gap-1"
                                                    >
                                                        <Check className="w-3.5 h-3.5" />
                                                        使用中
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleSwitch(token.id)}
                                                        disabled={loading}
                                                        className="btn btn-xs bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white border-none"
                                                    >
                                                        切换
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleEdit(token)}
                                                    disabled={loading}
                                                    className="btn btn-ghost btn-xs"
                                                    title="编辑"
                                                >
                                                    <Edit2 className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(token.id, token.name)}
                                                    disabled={loading || token.isActive}
                                                    className="btn btn-ghost btn-xs text-error hover:bg-error/10"
                                                    title={token.isActive ? '无法删除使用中的 API Key' : '删除'}
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

                {viewMode === 'card' && filteredTokens.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                        {filteredTokens.map((token) => (
                            <div
                                key={token.id}
                                className={`card bg-base-100 border-2 transition-all hover:shadow-lg flex flex-col ${
                                token.isActive
                                    ? 'border-orange-500 ring-2 ring-orange-500/20 bg-gradient-to-br from-orange-50/50 to-pink-50/50 dark:from-orange-900/10 dark:to-pink-900/10'
                                    : 'border-base-300 hover:border-orange-500/50'
                            } ${draggingTokenId === token.id ? 'opacity-60' : ''} ${
                                dragOverTokenId === token.id && draggingTokenId !== token.id
                                    ? 'ring-info/50'
                                    : ''
                            }`}
                                data-token-id={token.id}
                                onPointerOver={handlePointerOver(token.id)}
                            >
                                <div className="card-body p-4 flex flex-col">
                                    {/* 顶部固定内容 - 标题和操作按钮 */}
                                    <div className="flex items-start justify-between gap-2 mb-2 min-h-12">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <button
                                                    type="button"
                                                    onPointerDown={handlePointerDragStart(token.id)}
                                                    onClick={(e) => e.preventDefault()}
                                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-base-content/50 hover:bg-base-200 cursor-grab active:cursor-grabbing"
                                                    title="拖拽排序"
                                                >
                                                    <GripVertical className="w-4 h-4" />
                                                </button>
                                                <h3 className="font-bold text-base truncate">{token.name}</h3>
                                                {token.isActive && (
                                                    <span className="badge badge-sm bg-gradient-to-r from-orange-500 to-pink-500 text-white border-none gap-1 shadow-md whitespace-nowrap shrink-0">
                                                        <Zap className="w-3 h-3" fill="currentColor" />
                                                        使用中
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => handleEdit(token)}
                                                disabled={loading}
                                                className="btn btn-ghost btn-xs"
                                                title="编辑"
                                            >
                                                <Edit2 className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(token.id, token.name)}
                                                disabled={loading || token.isActive}
                                                className="btn btn-ghost btn-xs text-error hover:bg-error/10"
                                                title={token.isActive ? '无法删除使用中的 API Key' : '删除'}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* API Key - 固定高度 */}
                                    <div className="h-10 mb-2">
                                        <div className="flex items-center gap-2 bg-base-200 rounded-lg p-2">
                                            <code className="font-mono text-xs flex-1 truncate">
                                                {showKeys[token.id] ? token.apiKey : maskApiKey(token.apiKey)}
                                            </code>
                                            <button
                                                onClick={() => toggleShowKey(token.id)}
                                                className="btn btn-ghost btn-xs"
                                            >
                                                {showKeys[token.id] ? (
                                                    <EyeOff className="w-3 h-3" />
                                                ) : (
                                                    <Eye className="w-3 h-3" />
                                                )}
                                            </button>
                                        </div>
                                    </div>

                                    {/* URL - 固定高度 */}
                                    <div className="h-7 mb-2">
                                        {token.url && (
                                            <div className="flex items-center gap-1 min-w-0">
                                                <div
                                                    className="text-xs text-base-content/50 truncate"
                                                    title={token.url}
                                                >
                                                    <span className="font-medium">URL:</span> {token.url}
                                                </div>
                                                <button
                                                    onClick={() => handleOpenBaseUrl(token.url)}
                                                    className="inline-flex h-5 w-5 items-center justify-center rounded-md text-info/80 hover:text-info hover:bg-info/10 transition-colors"
                                                    title="打开主域名"
                                                >
                                                    <Globe className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* 模型配置 - 固定高度 */}
                                    <div className="h-16 mb-2">
                                        {(token.defaultSonnetModel || token.defaultOpusModel || token.defaultHaikuModel) && (
                                            <div className="text-xs text-base-content/50 space-y-1 font-mono">
                                                {token.defaultSonnetModel && (
                                                    <div className="flex items-center gap-2" title={token.defaultSonnetModel}>
                                                        <span className="text-base-content/50 w-14 flex-shrink-0">Sonnet</span>
                                                        <span className="text-base-content/70 truncate">{token.defaultSonnetModel}</span>
                                                    </div>
                                                )}
                                                {token.defaultOpusModel && (
                                                    <div className="flex items-center gap-2" title={token.defaultOpusModel}>
                                                        <span className="text-base-content/50 w-14 flex-shrink-0">Opus</span>
                                                        <span className="text-base-content/70 truncate">{token.defaultOpusModel}</span>
                                                    </div>
                                                )}
                                                {token.defaultHaikuModel && (
                                                    <div className="flex items-center gap-2" title={token.defaultHaikuModel}>
                                                        <span className="text-base-content/50 w-14 flex-shrink-0">Haiku</span>
                                                        <span className="text-base-content/70 truncate">{token.defaultHaikuModel}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* 底部固定内容 - 按钮和日期 */}
                                    <div className="mt-auto">
                                        {/* 切换按钮 */}
                                        {token.isActive ? (
                                            <button
                                                disabled
                                                className="btn btn-sm bg-gradient-to-r from-orange-500 to-pink-500 text-white border-none w-full cursor-default"
                                            >
                                                <Zap className="w-4 h-4" fill="currentColor" />
                                                当前使用中
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleSwitch(token.id)}
                                                disabled={loading}
                                                className="btn btn-sm bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white border-none w-full"
                                            >
                                                切换到此配置
                                            </button>
                                        )}

                                        <div className="text-xs text-base-content/50 mt-2 truncate">
                                            {new Date(token.createdAt).toLocaleDateString('zh-CN')}
                                            {token.lastUsed && new Date(token.createdAt).toLocaleDateString('zh-CN') !== new Date(token.lastUsed).toLocaleDateString('zh-CN') && (
                                                <> · {new Date(token.lastUsed).toLocaleDateString('zh-CN')}</>
                                            )}
                                        </div>

                                        {/* 备注 - 限制20字符 */}
                                        {token.description && (
                                            <div className="text-xs text-base-content/70 mt-1 truncate" title={token.description}>
                                                {token.description.length > 20 ? token.description.substring(0, 20) + '...' : token.description}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 添加/编辑 API Key 对话框 */}
            <ModalDialog
                isOpen={isAdding}
                onClose={() => {
                    setIsAdding(false);
                    setIsEditing(false);
                    setEditingId(null);
                }}
                title={isEditing ? '编辑 Claude API Key' : '添加 Claude API Key'}
                onConfirm={handleSave}
                confirmText={isEditing ? '保存' : '添加'}
            >
                <div className="space-y-3">
                    <div>
                        <label className="label py-1">
                            <span className="label-text font-medium text-sm">名称 *</span>
                        </label>
                        <input
                            type="text"
                            className="input input-bordered input-sm w-full"
                            placeholder="例如: 主账号"
                            value={newToken.name}
                            onChange={(e) => setNewToken({ ...newToken, name: e.target.value })}
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="label py-1">
                            <span className="label-text font-medium text-sm">API Key *</span>
                        </label>
                        <input
                            type="text"
                            className="input input-bordered input-sm w-full font-mono text-xs"
                            placeholder="sk-ant-..."
                            value={newToken.apiKey}
                            onChange={(e) => setNewToken({ ...newToken, apiKey: e.target.value })}
                        />
                    </div>

                    <div>
                        <label className="label py-1">
                            <span className="label-text font-medium text-sm">API URL</span>
                        </label>
                        <input
                            type="text"
                            className="input input-bordered input-sm w-full font-mono text-xs"
                            placeholder="https://api.anthropic.com"
                            value={newToken.url}
                            onChange={(e) => setNewToken({ ...newToken, url: e.target.value })}
                        />
                    </div>

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handleFetchModels}
                            disabled={fetchingModels || !newToken.url || !newToken.apiKey}
                            className="btn btn-sm bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white border-none gap-2"
                        >
                            <Download className={`w-3.5 h-3.5 ${fetchingModels ? 'animate-bounce' : ''}`} />
                            {fetchingModels ? '获取中...' : '获取模型列表'}
                        </button>
                        {availableModels.length > 0 && (
                            <span className="text-xs text-success self-center">
                                已获取 {availableModels.length} 个模型
                            </span>
                        )}
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        <div>
                            <label className="label py-1">
                                <span className="label-text font-medium text-sm">默认 Sonnet 模型</span>
                            </label>
                            <ModelSelect
                                value={newToken.defaultSonnetModel}
                                onChange={(val) => setNewToken({ ...newToken, defaultSonnetModel: val })}
                                placeholder="claude-sonnet-4-5"
                                models={availableModels}
                            />
                        </div>

                        <div>
                            <label className="label py-1">
                                <span className="label-text font-medium text-sm">默认 Opus 模型</span>
                            </label>
                            <ModelSelect
                                value={newToken.defaultOpusModel}
                                onChange={(val) => setNewToken({ ...newToken, defaultOpusModel: val })}
                                placeholder="claude-opus-4"
                                models={availableModels}
                            />
                        </div>

                        <div>
                            <label className="label py-1">
                                <span className="label-text font-medium text-sm">默认 Haiku 模型</span>
                            </label>
                            <ModelSelect
                                value={newToken.defaultHaikuModel}
                                onChange={(val) => setNewToken({ ...newToken, defaultHaikuModel: val })}
                                placeholder="claude-haiku-3-5"
                                models={availableModels}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="label py-1">
                            <span className="label-text font-medium text-sm">描述（可选）</span>
                        </label>
                        <textarea
                            className="textarea textarea-bordered textarea-sm w-full text-xs"
                            placeholder="例如: 用于日常开发"
                            rows={2}
                            value={newToken.description}
                            onChange={(e) => setNewToken({ ...newToken, description: e.target.value })}
                        />
                    </div>
                </div>
            </ModalDialog>

            {/* 删除确认对话框 */}
            <ModalDialog
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, id: '', name: '' })}
                title="确认删除"
                message={`确定要删除 API Key "${deleteModal.name}" 吗？此操作无法撤销。`}
                onConfirm={confirmDelete}
                confirmText="删除"
                isDestructive
            />
        </div>
    );
}

export default ClaudePage;
