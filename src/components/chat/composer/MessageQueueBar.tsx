// MessageQueueBar - 忙时排队消息条（对标 desktop-cc-gui MessageQueue）

import {useTranslation} from 'react-i18next';
import {Clock, X} from 'lucide-react';
import type {QueuedChatMessage} from '../../../types/chat';

export interface MessageQueueBarProps {
    items: QueuedChatMessage[];
    onRemove: (id: string) => void;
}

/**
 * 回合进行中用户继续发送的消息进入待发队列，在输入框上方展示。
 * 本轮成功结束后队首自动发送；用户可随时移除队列项。
 */
export function MessageQueueBar({items, onRemove}: MessageQueueBarProps) {
    const {t} = useTranslation();
    if (!items || items.length === 0) return null;

    const removeLabel = t('chat.queue.remove');

    return (
        <div className="mb-1.5 flex flex-col gap-1 px-1" data-testid="chat-message-queue">
            <div className="text-[11px] font-medium text-base-content/45">
                {t('chat.queue.title', {count: items.length})}
            </div>
            {items.map((item) => (
                <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-lg border border-base-300/70 bg-base-200/50 px-2 py-1 text-xs text-base-content/70"
                >
                    <Clock size={12} className="shrink-0 text-base-content/40" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate" title={item.text}>
                        {item.text || t('chat.queue.attachmentOnly')}
                    </span>
                    {item.attachments && item.attachments.length > 0 && (
                        <span className="shrink-0 text-[10px] text-base-content/40">
                            {t('chat.queue.attachmentCount', {count: item.attachments.length})}
                        </span>
                    )}
                    <button
                        type="button"
                        className="btn btn-ghost btn-xs h-5 min-h-0 w-5 shrink-0 p-0 text-base-content/50 hover:text-error"
                        onClick={() => onRemove(item.id)}
                        title={removeLabel}
                        aria-label={removeLabel}
                    >
                        <X size={12} />
                    </button>
                </div>
            ))}
        </div>
    );
}

export default MessageQueueBar;
