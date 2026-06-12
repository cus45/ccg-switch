import type { ReactNode } from 'react';
import { AlertCircle, Brain, FileCode, MessageSquare, ShieldQuestion, Terminal, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConversationItem } from '../../types/conversation';

interface MessageItemProps {
    item: ConversationItem;
}

const statusClasses: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600 dark:bg-base-200 dark:text-gray-300',
    running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export function MessageItem({ item }: MessageItemProps) {
    const { t } = useTranslation();
    const chrome = getItemChrome(item.itemType, t);
    const command = safeMetadataString(item.metadata, 'command');
    const path = safeMetadataString(item.metadata, 'path');
    const toolName = safeMetadataString(item.metadata, 'toolName') ?? safeMetadataString(item.metadata, 'tool_name');

    return (
        <article className="rounded-lg border border-gray-200/70 dark:border-base-200 bg-white dark:bg-base-100 px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2">
                    <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${chrome.iconClass}`}>
                        {chrome.icon}
                    </span>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-base-content">
                                {chrome.label}
                            </span>
                            {item.role && (
                                <span className="text-[11px] uppercase text-gray-400 dark:text-gray-500">
                                    {item.role}
                                </span>
                            )}
                        </div>
                        {(path || toolName) && (
                            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                                {toolName ?? path}
                            </p>
                        )}
                    </div>
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${statusClasses[item.status] ?? statusClasses.pending}`}>
                    {t(`conversation.status.${item.status}`, { defaultValue: item.status })}
                </span>
            </div>

            {item.summary && (
                <p className="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                    {item.summary}
                </p>
            )}

            {command && item.itemType === 'command' && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-gray-950 px-3 py-2 text-xs text-gray-100">
                    <code>{command}</code>
                </pre>
            )}

            {item.content && (
                <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-700 dark:text-gray-200">
                    {item.content}
                </div>
            )}
        </article>
    );
}

function getItemChrome(
    itemType: string,
    t: ReturnType<typeof useTranslation>['t']
): { label: string; icon: ReactNode; iconClass: string } {
    switch (itemType) {
        case 'message':
            return {
                label: t('conversation.item.message', { defaultValue: 'Message' }),
                icon: <MessageSquare className="h-4 w-4" />,
                iconClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
            };
        case 'reasoning':
            return {
                label: t('conversation.item.reasoning', { defaultValue: 'Reasoning' }),
                icon: <Brain className="h-4 w-4" />,
                iconClass: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
            };
        case 'command':
            return {
                label: t('conversation.item.command', { defaultValue: 'Command' }),
                icon: <Terminal className="h-4 w-4" />,
                iconClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
            };
        case 'file_change':
            return {
                label: t('conversation.item.file_change', { defaultValue: 'File change' }),
                icon: <FileCode className="h-4 w-4" />,
                iconClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
            };
        case 'mcp_tool':
            return {
                label: t('conversation.item.mcp_tool', { defaultValue: 'MCP tool' }),
                icon: <Wrench className="h-4 w-4" />,
                iconClass: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
            };
        case 'approval':
            return {
                label: t('conversation.item.approval', { defaultValue: 'Approval' }),
                icon: <ShieldQuestion className="h-4 w-4" />,
                iconClass: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
            };
        case 'error':
            return {
                label: t('conversation.item.error', { defaultValue: 'Error' }),
                icon: <AlertCircle className="h-4 w-4" />,
                iconClass: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
            };
        default:
            return {
                label: t('conversation.item.raw', { defaultValue: 'Raw event' }),
                icon: <MessageSquare className="h-4 w-4" />,
                iconClass: 'bg-gray-100 text-gray-600 dark:bg-base-200 dark:text-gray-300',
            };
    }
}

function safeMetadataString(metadata: Record<string, unknown>, key: string): string | undefined {
    const value = metadata[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
}
