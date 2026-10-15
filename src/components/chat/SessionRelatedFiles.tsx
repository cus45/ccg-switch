import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, FileCode, Plus, Minus } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface RelatedFileItem {
    path?: string;
    displayPath?: string;
    openPath?: string;
    additions?: number;
    deletions?: number;
}

export interface SessionRelatedFilesProps {
    files: RelatedFileItem[];
    onOpenFile: (path: string) => void;
    className?: string;
}

export const SessionRelatedFiles: React.FC<SessionRelatedFilesProps> = ({
    files,
    onOpenFile,
    className,
}) => {
    const { t } = useTranslation();
    const [isCollapsed, setIsCollapsed] = useState(false);

    if (!files || files.length === 0) {
        return null;
    }

    // Deduplicate by targetPath
    const uniqueFiles = Array.from(
        new Map(
            files
                .map((file) => {
                    const targetPath = file.openPath || file.path || file.displayPath || '';
                    return {
                        ...file,
                        targetPath,
                    };
                })
                .filter((file) => Boolean(file.targetPath))
                .map((file) => [file.targetPath, file])
        ).values()
    );

    return (
        <div
            className={cn(
                'session-related-files-bar mx-3 my-1.5 rounded-lg border border-base-content/10 bg-base-200/50 backdrop-blur-sm text-xs transition-all',
                className
            )}
        >
            <div className="flex items-center justify-between px-2.5 py-1.5">
                <button
                    type="button"
                    onClick={() => setIsCollapsed((prev) => !prev)}
                    className="flex items-center gap-1.5 font-medium text-base-content/70 hover:text-base-content"
                >
                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    <span>{t('chat.relatedFiles', 'Touched Files')}</span>
                    <span className="badge badge-xs badge-neutral px-1.5 py-0.5 text-[10px]">
                        {uniqueFiles.length}
                    </span>
                </button>
            </div>

            {!isCollapsed && (
                <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2 pt-0.5">
                    {uniqueFiles.map((file) => {
                        const fileName = file.displayPath || file.targetPath.split(/[\\/]/).pop() || file.targetPath;
                        const hasDiff = (file.additions ?? 0) > 0 || (file.deletions ?? 0) > 0;

                        return (
                            <button
                                key={file.targetPath}
                                type="button"
                                onClick={() => onOpenFile(file.targetPath)}
                                title={file.targetPath}
                                className="group flex items-center gap-1.5 rounded-md border border-base-content/10 bg-base-100 px-2 py-1 text-xs text-base-content/80 shadow-xs hover:border-primary/40 hover:bg-base-200/60 hover:text-primary transition-colors"
                            >
                                <FileCode size={13} className="text-primary/70 group-hover:text-primary" />
                                <span className="max-w-[180px] truncate font-mono text-[11px]">{fileName}</span>
                                {hasDiff && (
                                    <span className="flex items-center gap-0.5 text-[10px] font-mono">
                                        {(file.additions ?? 0) > 0 && (
                                            <span className="text-success flex items-center">
                                                <Plus size={9} />
                                                {file.additions}
                                            </span>
                                        )}
                                        {(file.deletions ?? 0) > 0 && (
                                            <span className="text-error flex items-center">
                                                <Minus size={9} />
                                                {file.deletions}
                                            </span>
                                        )}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default SessionRelatedFiles;
