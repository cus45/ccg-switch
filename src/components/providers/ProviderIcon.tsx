import { AppType } from '../../types/app';
import { getAppColor, getAppLabel } from '../../hooks/useVisibleAppOptions';

interface ProviderIconProps {
    appType: AppType;
    size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm',
    lg: 'w-10 h-10 text-base',
};

export default function ProviderIcon({ appType, size = 'md' }: ProviderIconProps) {
    const color = getAppColor(appType);
    const label = getAppLabel(appType);

    return (
        <div
            className={`${sizeMap[size]} rounded-full flex items-center justify-center font-bold text-white shadow-sm shrink-0`}
            style={{ backgroundColor: color }}
            title={label}
        >
            {label.charAt(0).toUpperCase()}
        </div>
    );
}
