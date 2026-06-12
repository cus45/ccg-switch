import { useTranslation } from 'react-i18next';
import { X, ChevronDown, ChevronUp, Save, Plus } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { McpServerConfig, McpServerRow, type McpV2LegacyApp } from '../../types/mcpV2';
import { mcpPresets, getMcpPresetWithDescription } from '../../config/mcpPresets';
import McpWizardModal from './McpWizardModal';
import { useVisibleAppOptions } from '../../hooks/useVisibleAppOptions';

interface McpFormModalProps {
    isOpen: boolean;
    editingServer?: McpServerRow | null;
    existingIds?: string[];
    onClose: () => void;
    onSave: (server: Partial<McpServerRow>) => Promise<void>;
}

function isMcpLegacyApp(appType: string): appType is McpV2LegacyApp {
    return appType === 'claude' || appType === 'codex' || appType === 'gemini';
}

function McpFormModal({ isOpen, editingServer, existingIds = [], onClose, onSave }: McpFormModalProps) {
    const { t } = useTranslation();
    const isEditing = !!editingServer;
    const appOptions = useVisibleAppOptions();
    const mcpAppOptions = appOptions.flatMap(option => {
        if (!isMcpLegacyApp(option.appType)) {
            return [];
        }
        return [{ ...option, appType: option.appType }];
    });

    // 表单状态
    const [formId, setFormId] = useState('');
    const [formName, setFormName] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [formHomepage, setFormHomepage] = useState('');
    const [formDocs, setFormDocs] = useState('');
    const [formTags, setFormTags] = useState('');
    const [formConfig, setFormConfig] = useState('');
    const [enabledApps, setEnabledApps] = useState({
        claude: true,
        codex: true,
        gemini: true,
    });

    // UI 状态
    const [selectedPreset, setSelectedPreset] = useState<number | null>(isEditing ? null : -1);
    const [showMetadata, setShowMetadata] = useState(false);
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [configError, setConfigError] = useState('');
    const [idError, setIdError] = useState('');
    const [saving, setSaving] = useState(false);

    // 初始化表单
    useEffect(() => {
        if (!isOpen) return;

        if (editingServer) {
            setFormId(editingServer.id);
            setFormName(editingServer.name);
            setFormDescription(editingServer.description || '');
            setFormHomepage(editingServer.homepage || '');
            setFormDocs(editingServer.docs || '');
            setFormTags(editingServer.tags?.join(', ') || '');
            setFormConfig(JSON.stringify(editingServer.serverConfig, null, 2));
            setEnabledApps({
                claude: editingServer.enabledClaude,
                codex: editingServer.enabledCodex,
                gemini: editingServer.enabledGemini,
            });
            setSelectedPreset(null);
            setShowMetadata(!!(editingServer.description || editingServer.homepage || editingServer.docs || editingServer.tags?.length));
        } else {
            resetForm();
        }
    }, [isOpen, editingServer]);

    const resetForm = () => {
        setFormId('');
        setFormName('');
        setFormDescription('');
        setFormHomepage('');
        setFormDocs('');
        setFormTags('');
        setFormConfig('');
        setEnabledApps({ claude: true, codex: true, gemini: true });
        setSelectedPreset(-1);
        setShowMetadata(false);
        setConfigError('');
        setIdError('');
    };

    // 确保唯一 ID
    const ensureUniqueId = (base: string): string => {
        let candidate = base.trim();
        if (!candidate) candidate = 'mcp-server';
        if (!existingIds.includes(candidate)) return candidate;
        let i = 1;
        while (existingIds.includes(`${candidate}-${i}`)) i++;
        return `${candidate}-${i}`;
    };

    // ID 验证
    const handleIdChange = (value: string) => {
        setFormId(value);
        if (!isEditing) {
            const exists = existingIds.includes(value.trim());
            setIdError(exists ? t('mcp.error.idExists') : '');
        }
    };

    // 应用预设
    const applyPreset = (index: number) => {
        if (index < 0 || index >= mcpPresets.length) return;
        const preset = mcpPresets[index];
        const presetWithDesc = getMcpPresetWithDescription(preset, t);

        const id = ensureUniqueId(presetWithDesc.id);
        setFormId(id);
        setFormName(presetWithDesc.name || presetWithDesc.id);
        setFormDescription(presetWithDesc.description || '');
        setFormHomepage(presetWithDesc.homepage || '');
        setFormDocs(presetWithDesc.docs || '');
        setFormTags(presetWithDesc.tags?.join(', ') || '');
        setFormConfig(JSON.stringify(presetWithDesc.server, null, 2));
        setSelectedPreset(index);
        setConfigError('');
    };

    // 自定义模式
    const applyCustom = () => {
        setSelectedPreset(-1);
        resetForm();
    };

    // JSON 配置变更
    const handleConfigChange = (value: string) => {
        setFormConfig(value);
        if (!value.trim()) {
            setConfigError('');
            return;
        }
        try {
            JSON.parse(value);
            setConfigError('');
        } catch {
            setConfigError(t('mcp.error.jsonInvalid'));
        }
    };

    // 向导应用
    const handleWizardApply = (title: string, json: string) => {
        if (!formId.trim()) {
            setFormId(title);
        }
        if (!formName.trim()) {
            setFormName(title);
        }
        setFormConfig(json);
        setConfigError('');
    };

    // 提交表单
    const handleSubmit = async () => {
        const trimmedId = formId.trim();
        if (!trimmedId) {
            setIdError(t('mcp.error.idRequired'));
            return;
        }

        if (!isEditing && existingIds.includes(trimmedId)) {
            setIdError(t('mcp.error.idExists'));
            return;
        }

        let serverConfig: McpServerConfig = {};
        if (formConfig.trim()) {
            try {
                serverConfig = JSON.parse(formConfig);
            } catch {
                setConfigError(t('mcp.error.jsonInvalid'));
                return;
            }
        }

        if (serverConfig.type === 'stdio' && !serverConfig.command?.trim()) {
            setConfigError(t('mcp.error.commandRequired'));
            return;
        }
        if ((serverConfig.type === 'http' || serverConfig.type === 'sse') && !serverConfig.url?.trim()) {
            setConfigError(t('mcp.wizard.urlRequired'));
            return;
        }

        setSaving(true);
        try {
            const parsedTags = formTags
                .split(',')
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);

            const entry: Partial<McpServerRow> = {
                id: trimmedId,
                name: formName.trim() || trimmedId,
                serverConfig,
                description: formDescription.trim() || null,
                tags: parsedTags,
                homepage: formHomepage.trim() || undefined,
                docs: formDocs.trim() || undefined,
                enabledClaude: enabledApps.claude,
                enabledCodex: enabledApps.codex,
                enabledGemini: enabledApps.gemini,
            };

            await onSave(entry);
            onClose();
        } catch (error) {
            console.error('保存失败:', error);
        } finally {
            setSaving(false);
        }
    };

    // 向导初始配置
    const wizardInitialSpec = useMemo(() => {
        if (!formConfig.trim()) return undefined;
        try {
            return JSON.parse(formConfig) as McpServerConfig;
        } catch {
            return undefined;
        }
    }, [formConfig]);

    const updateEnabledApp = (app: McpV2LegacyApp, checked: boolean) => {
        setEnabledApps(prev => ({ ...prev, [app]: checked }));
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white dark:bg-base-100 rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                    {/* 标题栏 */}
                    <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-base-200">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-base-content">
                            {isEditing ? t('mcp.edit_server') : t('mcp.add_server')}
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-base-200 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* 表单内容 */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {/* 预设选择（仅新增时展示） */}
                        {!isEditing && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('mcp.presets.title')}
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={applyCustom}
                                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                                            selectedPreset === -1
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-base-100'
                                        }`}
                                    >
                                        {t('mcp.presets.custom')}
                                    </button>
                                    {mcpPresets.map((preset, idx) => {
                                        const descKey = `mcp.presets.${preset.id}.description`;
                                        return (
                                            <button
                                                key={preset.id}
                                                type="button"
                                                onClick={() => applyPreset(idx)}
                                                title={t(descKey)}
                                                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                                                    selectedPreset === idx
                                                        ? 'bg-blue-500 text-white'
                                                        : 'bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-base-100'
                                                }`}
                                            >
                                                {preset.id}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 服务器 ID */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    {t('mcp.form.title')} <span className="text-red-500">*</span>
                                </label>
                                {!isEditing && idError && (
                                    <span className="text-xs text-red-500">{idError}</span>
                                )}
                            </div>
                            <input
                                type="text"
                                value={formId}
                                onChange={(e) => handleIdChange(e.target.value)}
                                disabled={isEditing}
                                placeholder={t('mcp.form.titlePlaceholder')}
                                className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-base-content disabled:opacity-50"
                            />
                        </div>

                        {/* 显示名称 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {t('mcp.form.name')}
                            </label>
                            <input
                                type="text"
                                value={formName}
                                onChange={(e) => setFormName(e.target.value)}
                                placeholder={t('mcp.form.namePlaceholder')}
                                className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-base-content"
                            />
                        </div>

                        {/* 启用到应用 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                {t('mcp.form.enabledApps')}
                            </label>
                            <div className="flex flex-wrap gap-4">
                                {mcpAppOptions.map(({ appType, label }) => (
                                    <label key={appType} className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={enabledApps[appType]}
                                            onChange={(e) => updateEnabledApp(appType, e.target.checked)}
                                            className="checkbox checkbox-sm checkbox-primary"
                                        />
                                        <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* 附加信息折叠区 */}
                        <div>
                            <button
                                type="button"
                                onClick={() => setShowMetadata(!showMetadata)}
                                className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                            >
                                {showMetadata ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                {t('mcp.form.additionalInfo')}
                            </button>
                        </div>

                        {showMetadata && (
                            <div className="space-y-4 pl-4 border-l-2 border-gray-200 dark:border-base-200">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        {t('mcp.form.description')}
                                    </label>
                                    <input
                                        type="text"
                                        value={formDescription}
                                        onChange={(e) => setFormDescription(e.target.value)}
                                        placeholder={t('mcp.form.descriptionPlaceholder')}
                                        className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-base-content"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        {t('mcp.form.tags')}
                                    </label>
                                    <input
                                        type="text"
                                        value={formTags}
                                        onChange={(e) => setFormTags(e.target.value)}
                                        placeholder={t('mcp.form.tagsPlaceholder')}
                                        className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-base-content"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        {t('mcp.form.homepage')}
                                    </label>
                                    <input
                                        type="text"
                                        value={formHomepage}
                                        onChange={(e) => setFormHomepage(e.target.value)}
                                        placeholder={t('mcp.form.homepagePlaceholder')}
                                        className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-base-content"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        {t('mcp.form.docs')}
                                    </label>
                                    <input
                                        type="text"
                                        value={formDocs}
                                        onChange={(e) => setFormDocs(e.target.value)}
                                        placeholder={t('mcp.form.docsPlaceholder')}
                                        className="w-full px-3 py-2 bg-white dark:bg-base-200 border border-gray-300 dark:border-base-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-base-content"
                                    />
                                </div>
                            </div>
                        )}

                        {/* JSON 配置 */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    {t('mcp.form.jsonConfig')}
                                </label>
                                <button
                                    type="button"
                                    onClick={() => setIsWizardOpen(true)}
                                    className="text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                                >
                                    {t('mcp.form.useWizard')}
                                </button>
                            </div>
                            <textarea
                                value={formConfig}
                                onChange={(e) => handleConfigChange(e.target.value)}
                                placeholder={t('mcp.form.jsonPlaceholder')}
                                rows={10}
                                className={`w-full px-3 py-2 bg-white dark:bg-base-200 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-base-content font-mono text-sm resize-y ${
                                    configError ? 'border-red-500' : 'border-gray-300 dark:border-base-200'
                                }`}
                            />
                            {configError && (
                                <p className="text-sm text-red-500 mt-1">{configError}</p>
                            )}
                        </div>
                    </div>

                    {/* 底部按钮 */}
                    <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 dark:border-base-200">
                        <button
                            onClick={onClose}
                            disabled={saving}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-base-200 rounded-lg hover:bg-gray-200 dark:hover:bg-base-100 transition-colors disabled:opacity-50"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={saving || (!isEditing && !!idError)}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {isEditing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                            {saving ? t('common.saving') : isEditing ? t('common.save') : t('common.add')}
                        </button>
                    </div>
                </div>
            </div>

            {/* 向导模态框 */}
            <McpWizardModal
                isOpen={isWizardOpen}
                onClose={() => setIsWizardOpen(false)}
                onApply={handleWizardApply}
                initialTitle={formId}
                initialServer={wizardInitialSpec}
            />
        </>
    );
}

export default McpFormModal;
