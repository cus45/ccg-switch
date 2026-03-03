import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Upload, Loader2 } from 'lucide-react';
import { exportConfigToFile, importConfigFromFile } from '../../services/configTransferService';

function ImportExportPanel() {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleExport = async () => {
        setLoading(true);
        setMessage(null);
        try {
            await exportConfigToFile();
            setMessage({ type: 'success', text: t('settings.exportSuccess') });
        } catch (e) {
            setMessage({ type: 'error', text: String(e) });
        } finally {
            setLoading(false);
        }
    };

    const handleImport = async () => {
        setLoading(true);
        setMessage(null);
        try {
            const result = await importConfigFromFile();
            if (result.cancelled) {
                return;
            }
            setMessage({ type: 'success', text: `${t('settings.importSuccess')}: ${result.importedFiles.join(', ')}` });
        } catch (e) {
            setMessage({ type: 'error', text: String(e) });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
            <h2 className="font-semibold text-gray-900 dark:text-base-content mb-4">
                {t('settings.importExport')}
            </h2>
            <div className="flex gap-3">
                <button
                    onClick={handleExport}
                    disabled={loading}
                    className="btn btn-sm bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-base-300"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {t('settings.export')}
                </button>
                <button
                    onClick={handleImport}
                    disabled={loading}
                    className="btn btn-sm bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-base-300"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {t('settings.import')}
                </button>
            </div>
            {message && (
                <div className={`mt-3 text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                    {message.text}
                </div>
            )}
        </div>
    );
}

export default ImportExportPanel;
