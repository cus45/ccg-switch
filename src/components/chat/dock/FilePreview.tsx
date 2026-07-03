import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {readChatTextFile, type ReadTextFileResult} from '../../../services/chatDockService';

interface FilePreviewProps {
    /** 要预览的文件绝对路径（DockShell 的 `file` 文档）。 */
    filePath: string;
}

/**
 * 单文件只读预览（DockShell 的 `file` 文档）。从旧 FilesPanel 拆出预览部分，
 * 自行按路径加载内容（复用 `chat_read_text_file`）。
 */
export default function FilePreview({filePath}: FilePreviewProps) {
    const {t} = useTranslation();
    const tf = useCallback((key: string, fallback: string): string => {
        const translated = t(key);
        return translated === key ? fallback : translated;
    }, [t]);

    const [result, setResult] = useState<ReadTextFileResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setFailed(false);
        setResult(null);

        void (async () => {
            try {
                const loaded = await readChatTextFile(filePath);
                if (!cancelled) setResult(loaded);
            } catch {
                if (!cancelled) setFailed(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [filePath]);

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-gray-400 dark:text-base-content/50">
                {tf('chat.dock.loading', 'Loading...')}
            </div>
        );
    }

    if (failed || !result) {
        return (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-gray-500 dark:text-base-content/60">
                {tf('chat.dock.previewFailed', 'Failed to load this file.')}
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-2 py-1 text-xs text-gray-500 dark:border-base-200 dark:text-base-content/60">
                <span className="truncate" title={filePath}>
                    {filePath}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                    {result.binary && <span>{tf('chat.dock.previewBinary', 'Binary file')}</span>}
                    {result.truncated && <span>{tf('chat.dock.previewTruncated', 'Truncated')}</span>}
                </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-gray-50 dark:bg-base-200/40">
                {result.binary ? (
                    <div className="p-3 text-xs text-gray-500 dark:text-base-content/60">
                        {tf('chat.dock.previewBinaryHint', 'Preview is unavailable for binary files.')}
                    </div>
                ) : result.content.length === 0 ? (
                    <div className="p-3 text-xs text-gray-500 dark:text-base-content/60">
                        {tf('chat.dock.previewEmpty', 'Empty file')}
                    </div>
                ) : (
                    <pre className="whitespace-pre p-2 font-mono text-xs leading-relaxed text-gray-800 dark:text-base-content">
                        {result.content}
                    </pre>
                )}
            </div>
        </div>
    );
}
