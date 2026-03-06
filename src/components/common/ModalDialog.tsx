import { AlertTriangle, CheckCircle, XCircle, Info } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type ModalType = 'confirm' | 'success' | 'error' | 'info';

interface ModalDialogProps {
    isOpen: boolean;
    title: string;
    message?: string;
    children?: React.ReactNode;
    type?: ModalType;
    onConfirm: () => void;
    onCancel?: () => void;
    onClose?: () => void;
    confirmText?: string;
    cancelText?: string;
    confirmClass?: string;
    isDestructive?: boolean;
    maxWidthClass?: string;
}

export default function ModalDialog({
    isOpen,
    title,
    message,
    children,
    type = 'confirm',
    onConfirm,
    onCancel,
    onClose,
    confirmText,
    cancelText,
    confirmClass,
    isDestructive = false,
    maxWidthClass
}: ModalDialogProps) {
    const { t } = useTranslation();
    const finalConfirmText = confirmText || t('common.confirm');
    const finalCancelText = cancelText || t('common.cancel');

    if (!isOpen) return null;

    const getIcon = () => {
        switch (type) {
            case 'success':
                return <CheckCircle className="w-7 h-7 text-green-500" />;
            case 'error':
                return <XCircle className="w-7 h-7 text-red-500" />;
            case 'info':
                return <Info className="w-7 h-7 text-blue-500" />;
            case 'confirm':
            default:
                return isDestructive ? <AlertTriangle className="w-7 h-7 text-red-500" /> : <AlertTriangle className="w-7 h-7 text-blue-500" />;
        }
    };

    const getIconBg = () => {
        switch (type) {
            case 'success': return 'bg-green-50 dark:bg-green-900/20';
            case 'error': return 'bg-red-50 dark:bg-red-900/20';
            case 'info': return 'bg-blue-50 dark:bg-blue-900/20';
            case 'confirm': default: return isDestructive ? 'bg-red-50 dark:bg-red-900/20' : 'bg-blue-50 dark:bg-blue-900/20';
        }
    };

    const showCancel = type === 'confirm' && (onCancel || onClose);
    const handleCancel = onCancel || onClose;

    return createPortal(
        <div className="modal modal-open z-[100]">
            {/* Draggable Top Region */}
            <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-8 z-[110]" />

            <div className={`modal-box relative ${maxWidthClass || (children ? 'max-w-md' : 'max-w-sm')} bg-white dark:bg-base-100 shadow-2xl rounded-2xl p-0 overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col`}>
                <div className={`flex flex-col ${children ? 'items-start' : 'items-center text-center'} p-6 pt-8 ${children ? 'overflow-y-auto flex-1' : ''}`}>
                    {!children && (
                        <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 shadow-sm ${getIconBg()}`}>
                            {getIcon()}
                        </div>
                    )}

                    <h3 className="text-xl font-bold text-gray-900 dark:text-base-content mb-2">{title}</h3>
                    {message && <p className="text-gray-500 dark:text-gray-400 text-sm mb-8 leading-relaxed px-4">{message}</p>}
                    {children && <div className="w-full mt-4">{children}</div>}
                </div>

                <div className={`flex gap-3 w-full p-6 pt-0 flex-shrink-0 ${children ? '' : 'mt-auto'}`}>
                    {showCancel && (
                        <button
                            className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-base-300 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-base-300"
                            onClick={handleCancel}
                        >
                            {finalCancelText}
                        </button>
                    )}
                    <button
                        className={`flex-1 px-4 py-2.5 text-white font-medium rounded-xl shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                            confirmClass || (isDestructive && type === 'confirm'
                                ? 'bg-red-500 hover:bg-red-600 focus:ring-red-500 shadow-red-100'
                                : 'bg-blue-500 hover:bg-blue-600 focus:ring-blue-500 shadow-blue-100')
                        }`}
                        onClick={onConfirm}
                    >
                        {finalConfirmText}
                    </button>
                </div>
            </div>
            <div className="modal-backdrop bg-black/40 backdrop-blur-sm fixed inset-0 z-[-1]" onClick={showCancel ? handleCancel : undefined}></div>
        </div>,
        document.body
    );
}
