import { useTranslation } from 'react-i18next';
import { Server, Plus, RefreshCw, Trash2, Edit, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMcpStoreV2 } from '../stores/useMcpStoreV2';
import McpFormModal from '../components/mcp/McpFormModal';
import ModalDialog from '../components/common/ModalDialog';
import { McpServerRow, MCP_V2_APPS } from '../types/mcpV2';
import { showToast } from '../components/common/ToastContainer';

// ========== 服务器卡片 ==========
function McpServerRowCard({ server, onEdit, onDelete, onToggleApp }: {
    server: McpServerRow;
    onEdit: (server: McpServerRow) => void;
    onDelete: (id: string) => void;
    onToggleApp: (id: string, app: string, enabled: boolean) => void;
}) {
    const { t } = useTranslation();
    const cfg = server.serverConfig;
    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-base-200 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-gray-900 dark:text-base-content">{server.name}</h3>
                        {server.description && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">{server.description}</span>
                        )}
                    </div>
                    <div className="space-y-1 text-sm">
                        {cfg.command && (
                            <p className="text-gray-600 dark:text-gray-400">
                                <span className="font-medium">{t('mcp.command')}:</span> {cfg.command}
                                {cfg.args && cfg.args.length > 0 && ` ${cfg.args.join(' ')}`}
                            </p>
                        )}
                        {cfg.url && (
                            <p className="text-gray-600 dark:text-gray-400">
                                <span className="font-medium">{t('mcp.url')}:</span> {cfg.url}
                            </p>
                        )}
                    </div>
                    {/* 多应用开关 */}
                    <div className="mt-3 flex items-center gap-4">
                        {MCP_V2_APPS.map(({ key, label, app }) => (
                            <label key={app} className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="toggle toggle-xs toggle-primary"
                                    checked={server[key]}
                                    onChange={(e) => onToggleApp(server.id, app, e.target.checked)}
                                />
                                <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
                            </label>
                        ))}
                    </div>
                </div>
                <div className="flex gap-1 ml-4">
                    <button
                        onClick={() => onEdit(server)}
                        className="p-2 text-gray-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                    >
                        <Edit className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => onDelete(server.id)}
                        className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

function McpPage() {
    const { t } = useTranslation();
    const { servers, loading, loadServers, deleteServer, toggleApp, importFromApps, upsertServer } = useMcpStoreV2();

    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: string }>({ isOpen: false, id: '' });
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingServer, setEditingServer] = useState<McpServerRow | null>(null);

    useEffect(() => {
        loadServers();
    }, []);

    const handleAdd = () => {
        setEditingServer(null);
        setIsFormOpen(true);
    };

    const handleEdit = (server: McpServerRow) => {
        setEditingServer(server);
        setIsFormOpen(true);
    };

    const handleDelete = (id: string) => setDeleteModal({ isOpen: true, id });

    const confirmDelete = async () => {
        try {
            await deleteServer(deleteModal.id);
            showToast(t('mcp.delete_success'), 'success');
        } catch {
            showToast(t('mcp.delete_failed'), 'error');
        } finally {
            setDeleteModal({ isOpen: false, id: '' });
        }
    };

    const handleImport = async () => {
        try {
            const count = await importFromApps();
            showToast(t('mcp.import_success', { count }), 'success');
        } catch (e) {
            showToast(String(e), 'error');
        }
    };

    const handleSave = async (server: Partial<McpServerRow>) => {
        try {
            await upsertServer(server as McpServerRow);
            showToast(t('common.success'), 'success');
        } catch (e) {
            showToast(String(e), 'error');
            throw e;
        }
    };

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="p-6 space-y-4 max-w-7xl mx-auto">
                {/* 标题栏 */}
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <Server className="w-6 h-6 text-blue-500" />
                        <h1 className="text-xl font-bold text-gray-900 dark:text-base-content">{t('mcp.title')}</h1>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            {servers.length} {t('mcp.servers')}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleAdd}
                            disabled={loading}
                            className="px-3 py-1.5 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                            <Plus className="w-4 h-4" />
                            {t('common.add')}
                        </button>
                        <button
                            onClick={handleImport}
                            disabled={loading}
                            className="px-3 py-1.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                            <Download className="w-4 h-4" />
                            {t('mcp.import_from_apps')}
                        </button>
                        <button
                            onClick={() => loadServers()}
                            disabled={loading}
                            className="px-3 py-1.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-base-100 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            {t('common.refresh')}
                        </button>
                    </div>
                </div>

                {/* 服务器列表 */}
                {loading ? (
                    <div className="bg-white dark:bg-base-100 rounded-xl p-8 shadow-sm border border-gray-100 dark:border-base-200 text-center">
                        <RefreshCw className="w-8 h-8 text-blue-500 mx-auto mb-2 animate-spin" />
                        <p className="text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
                    </div>
                ) : servers.length === 0 ? (
                    <div className="bg-white dark:bg-base-100 rounded-xl p-8 shadow-sm border border-gray-100 dark:border-base-200 text-center">
                        <Server className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-500 dark:text-gray-400">{t('mcp.empty')}</p>
                        <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                            {t('mcp.empty_hint')}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3">
                        {servers.map((server) => (
                            <McpServerRowCard
                                key={server.id}
                                server={server}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                                onToggleApp={(id, app, enabled) => toggleApp(id, app, enabled)}
                            />
                        ))}
                    </div>
                )}

                {/* 删除确认 */}
                <ModalDialog
                    isOpen={deleteModal.isOpen}
                    title={t('mcp.delete_title')}
                    message={t('mcp.confirm_delete')}
                    type="confirm"
                    isDestructive={true}
                    onConfirm={confirmDelete}
                    onCancel={() => setDeleteModal({ isOpen: false, id: '' })}
                />

                {/* 表单模态框 */}
                <McpFormModal
                    isOpen={isFormOpen}
                    editingServer={editingServer}
                    existingIds={servers.map(s => s.id)}
                    onClose={() => { setIsFormOpen(false); setEditingServer(null); }}
                    onSave={handleSave}
                />
            </div>
        </div>
    );
}

export default McpPage;
