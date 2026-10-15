import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, ListOrdered, X } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface UserTurnAnchor {
    id: string;
    label: string;
    sequence: number;
    total: number;
}

export interface UserMessageOutlineProps {
    anchors: UserTurnAnchor[];
    activeAnchorId?: string | null;
    onSelectAnchor: (id: string) => void;
    className?: string;
}

export const UserMessageOutline: React.FC<UserMessageOutlineProps> = ({
    anchors,
    activeAnchorId,
    onSelectAnchor,
    className,
}) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    if (!anchors || anchors.length === 0) {
        return null;
    }

    return (
        <div ref={popoverRef} className={cn('relative inline-flex items-center', className)}>
            {/* Popover list of user turns */}
            {isOpen && (
                <div
                    role="dialog"
                    aria-label={t('chat.userTurnsOutline', 'User Turns')}
                    className="absolute bottom-full right-0 mb-2 w-72 max-h-72 overflow-y-auto rounded-xl border border-base-content/15 bg-base-100 p-2 shadow-xl backdrop-blur-md z-50 text-xs"
                >
                    <div className="flex items-center justify-between border-b border-base-content/10 px-2 pb-1.5 mb-1.5 font-medium text-base-content/70">
                        <span className="flex items-center gap-1.5">
                            <ListOrdered size={14} className="text-primary" />
                            {t('chat.turnOutline', 'Conversation Outline')}
                        </span>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="btn btn-ghost btn-xs btn-circle text-base-content/50 hover:text-base-content"
                        >
                            <X size={12} />
                        </button>
                    </div>

                    <div className="flex flex-col gap-1">
                        {anchors.map((anchor) => {
                            const isCurrent = anchor.id === activeAnchorId;
                            return (
                                <button
                                    key={anchor.id}
                                    type="button"
                                    onClick={() => {
                                        onSelectAnchor(anchor.id);
                                        setIsOpen(false);
                                    }}
                                    className={cn(
                                        'flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                                        isCurrent
                                            ? 'bg-primary/15 text-primary font-medium'
                                            : 'text-base-content/80 hover:bg-base-200'
                                    )}
                                >
                                    <span className="badge badge-xs badge-neutral mt-0.5 px-1.5 text-[10px] font-mono">
                                        #{anchor.sequence}
                                    </span>
                                    <span className="truncate line-clamp-2 text-xs leading-relaxed">
                                        {anchor.label || t('chat.userTurn', 'User prompt')}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Trigger Button */}
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                title={isOpen ? t('chat.hideOutline', 'Hide outline') : t('chat.showOutline', 'Jump to conversation turn')}
                aria-label={t('chat.userTurns', 'Conversation turns')}
                className={cn(
                    'btn btn-circle btn-sm shadow-md transition-all',
                    isOpen
                        ? 'btn-primary text-primary-content'
                        : 'bg-base-100/90 hover:bg-base-200 text-base-content border border-base-content/15'
                )}
            >
                <div className="relative flex items-center justify-center">
                    <MessageSquare size={15} />
                    <span className="absolute -top-2 -right-2.5 min-w-[16px] h-4 rounded-full bg-primary px-1 text-[9px] font-bold text-primary-content flex items-center justify-center border border-base-100">
                        {anchors.length}
                    </span>
                </div>
            </button>
        </div>
    );
};

export default UserMessageOutline;
