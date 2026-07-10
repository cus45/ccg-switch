import {type ReactNode, useEffect, useRef, useState} from 'react';
import {Check, ChevronDown, ChevronUp} from 'lucide-react';

const ICON_BOX_LAYOUT_CLASS = 'flex h-4 w-4 shrink-0 items-center justify-center leading-none';
const TRIGGER_ICON_BOX_CLASS = `selector-dropdown-icon-box selector-dropdown-trigger-icon selector-dropdown-icon-box--trigger ${ICON_BOX_LAYOUT_CLASS}`;
const OPTION_ICON_BOX_CLASS = `selector-dropdown-icon-box selector-dropdown-option-icon selector-dropdown-icon-box--option ${ICON_BOX_LAYOUT_CLASS}`;
const CHECK_ICON_BOX_CLASS = `selector-dropdown-icon-box selector-dropdown-check-icon selector-dropdown-icon-box--check ${ICON_BOX_LAYOUT_CLASS} text-primary`;

export interface SelectorOption<T extends string> {
    id: T;
    label: string;
    description?: string;
    icon?: ReactNode;
    disabled?: boolean;
}

interface SelectorDropdownProps<T extends string> {
    value: T;
    options: SelectorOption<T>[];
    onChange: (id: T) => void;
    /** 触发按钮上的图标（取当前选中项的 icon） */
    buttonIcon?: ReactNode;
    /** 触发按钮上的文字（默认用当前选中项 label） */
    buttonLabel?: string;
    title?: string;
    /** 菜单对齐方向 */
    align?: 'left' | 'right';
    /** 高亮态（例如 bypassPermissions 用警告色） */
    highlight?: boolean;
    /** 菜单底部附加内容（如 1M 上下文开关） */
    footer?: ReactNode;
    /** 紧凑模式：只显示触发图标，匹配 provider toolbar button。 */
    compact?: boolean;
    disabled?: boolean;
}

/**
 * 通用底部工具栏选择器：药丸按钮 + 向上弹出的菜单。
 * 替代 jcc-gui 里 ModeSelect/ModelSelect/ReasoningSelect 的重复实现。
 */
export function SelectorDropdown<T extends string>({
    value,
    options,
    onChange,
    buttonIcon,
    buttonLabel,
    title,
    align = 'left',
    highlight = false,
    footer,
    compact = false,
    disabled = false,
}: SelectorDropdownProps<T>) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    const current = options.find((o) => o.id === value) ?? options[0];

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', onDoc);
            document.addEventListener('keydown', onEsc);
        }, 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', onDoc);
            document.removeEventListener('keydown', onEsc);
        };
    }, [open]);

    useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);

    return (
        <div className="relative inline-block" ref={rootRef}>
            <button
                type="button"
                title={title}
                disabled={disabled}
                onClick={(e) => {
                    e.stopPropagation();
                    if (disabled) return;
                    setOpen((v) => !v);
                }}
                className={`flex h-6 shrink-0 items-center rounded-md border text-xs font-medium transition-colors
                    ${compact ? 'w-6 justify-center px-0' : 'gap-1 px-1.5'}
                    ${
                        disabled
                            ? 'cursor-not-allowed border-base-200 bg-base-100 text-base-content/35'
                            : highlight
                            ? 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/20'
                            : 'border-base-300 bg-base-100 text-base-content/80 hover:border-base-content/25 hover:bg-base-200/50'
                }`}
            >
                {buttonIcon && (
                    <span className={TRIGGER_ICON_BOX_CLASS}>
                        {buttonIcon}
                    </span>
                )}
                {!compact && (
                    <>
                        <span className="max-w-[7rem] truncate">{buttonLabel ?? current?.label}</span>
                        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </>
                )}
            </button>

            {open && (
                <div
                    className={`absolute bottom-full mb-1.5 z-[10000] min-w-[15rem] max-h-80 overflow-y-auto
                        rounded-lg border border-base-300 bg-base-100 shadow-lg p-1
                        ${align === 'right' ? 'right-0' : 'left-0'}`}
                >
                    {options.map((opt) => (
                        <button
                            key={opt.id}
                            type="button"
                            disabled={opt.disabled}
                            onClick={() => {
                                if (opt.disabled) return;
                                onChange(opt.id);
                                setOpen(false);
                            }}
                            className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left
                                ${opt.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-base-200'}
                                ${opt.id === value ? 'bg-base-200/60' : ''}`}
                        >
                            {opt.icon && (
                                <span className={OPTION_ICON_BOX_CLASS}>
                                    {opt.icon}
                                </span>
                            )}
                            <span className="flex-1 min-w-0">
                                <span className="block text-xs font-medium text-base-content">
                                    {opt.label}
                                </span>
                                {opt.description && (
                                    <span className="block text-[11px] text-base-content/50 leading-tight mt-0.5">
                                        {opt.description}
                                    </span>
                                )}
                            </span>
                            {opt.id === value && (
                                <span className={CHECK_ICON_BOX_CLASS}>
                                    <Check size={14} />
                                </span>
                            )}
                        </button>
                    ))}
                    {footer}
                </div>
            )}
        </div>
    );
}
