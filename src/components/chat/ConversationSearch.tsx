import {Search, X} from 'lucide-react';
import {forwardRef, type KeyboardEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {getChatNavigationControlLabel} from '../../utils/chatUiBehavior';

interface ConversationSearchProps {
    value: string;
    onChange: (value: string) => void;
}

const ConversationSearch = forwardRef<HTMLInputElement, ConversationSearchProps>(function ConversationSearch(
    { value, onChange },
    ref,
) {
    const { t } = useTranslation();
    const searchPlaceholderLabel = getChatNavigationControlLabel({
        control: 'search-placeholder',
        translate: (key, options) => t(key, options),
    });
    const clearSearchLabel = getChatNavigationControlLabel({
        control: 'clear-search',
        translate: (key, options) => t(key, options),
    });

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape' && value) {
            event.preventDefault();
            onChange('');
        }
    };

    return (
        <div className="bg-base-100/90 px-4 py-2 backdrop-blur">
            <div className="mx-auto flex w-full max-w-4xl items-center gap-2 rounded-full border border-base-200/70 bg-base-200/40 px-3 py-1.5 text-xs text-base-content/60 transition-colors focus-within:border-base-content/30 focus-within:bg-base-100 hover:border-base-content/20">
                <Search size={14} className="flex-shrink-0 text-base-content/40" />
                <input
                    ref={ref}
                    type="search"
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-base-content/40"
                    value={value}
                    placeholder={searchPlaceholderLabel}
                    aria-label={searchPlaceholderLabel}
                    onChange={(event) => onChange(event.target.value)}
                    onKeyDown={handleKeyDown}
                />
                {value && (
                    <button
                        type="button"
                        className="btn btn-ghost btn-xs h-6 min-h-0 w-6 rounded-full p-0 text-base-content/45 hover:text-base-content"
                        title={clearSearchLabel}
                        aria-label={clearSearchLabel}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onChange('')}
                    >
                        <X size={13} />
                    </button>
                )}
            </div>
        </div>
    );
});

export default ConversationSearch;
