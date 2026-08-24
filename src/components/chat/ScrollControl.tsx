import {ArrowDown} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {getChatNavigationControlLabel} from '../../utils/chatUiBehavior';

interface ScrollControlProps {
    visible: boolean;
    /** 脱离底部跟随后累积的新增消息数；0 时不显示角标。 */
    unreadCount?: number;
    onScrollToBottom: () => void;
}

function translateWithFallback(
    t: (key: string, options?: Record<string, unknown>) => string,
    key: string,
    fallback: string,
    options?: Record<string, unknown>,
): string {
    const translated = t(key, options);
    return translated === key ? fallback : translated;
}

export default function ScrollControl({visible, unreadCount = 0, onScrollToBottom}: ScrollControlProps) {
    const {t} = useTranslation();
    const scrollToBottomLabel = getChatNavigationControlLabel({
        control: 'scroll-to-bottom',
        translate: (key, options) => t(key, options),
    });
    const hasUnread = unreadCount > 0;
    const unreadLabel = translateWithFallback(
        t,
        'chat.layout.unreadMessages',
        `${unreadCount} new message${unreadCount === 1 ? '' : 's'}`,
        {count: unreadCount},
    );
    const buttonLabel = hasUnread ? unreadLabel : scrollToBottomLabel;

    if (!visible) return null;

    return (
        <button
            type="button"
            className={
                hasUnread
                    // 有未读时展开成胶囊，把条数直接写在按钮上，不用悬停才知道
                    ? 'btn btn-sm absolute bottom-32 right-4 h-8 min-h-0 gap-1.5 rounded-full border border-primary/30 bg-primary/90 px-3 text-primary-content shadow-lg backdrop-blur transition hover:scale-105 hover:bg-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary xl:right-60'
                    : 'btn btn-circle btn-sm absolute bottom-32 right-4 border border-base-300 bg-base-100/95 shadow-lg backdrop-blur transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary xl:right-60'
            }
            title={buttonLabel}
            aria-label={buttonLabel}
            onClick={onScrollToBottom}
        >
            <ArrowDown size={16} />
            {hasUnread && (
                <span className="text-xs font-medium tabular-nums">
                    {unreadCount > 99 ? '99+' : unreadCount}
                </span>
            )}
        </button>
    );
}
