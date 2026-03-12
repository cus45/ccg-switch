import { invoke } from '@tauri-apps/api/core';

export interface ConfigExportResult {
    success: true;
    fileName: string;
}

export interface ConfigImportResult {
    success: true;
    cancelled: boolean;
    importedFiles: string[];
}

function triggerJsonDownload(data: unknown, fileName: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}

function selectJsonFile(): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0] ?? null;
            resolve(file);
        };
        input.oncancel = () => {
            resolve(null);
        };
        input.click();
    });
}

export async function exportConfigToFile(): Promise<ConfigExportResult> {
    const data = await invoke('export_config');
    const fileName = `cc-switch-backup-${new Date().toISOString().slice(0, 10)}.json`;
    triggerJsonDownload(data, fileName);
    return {
        success: true,
        fileName,
    };
}

export async function importConfigFromFile(): Promise<ConfigImportResult> {
    const file = await selectJsonFile();
    if (!file) {
        return {
            success: true,
            cancelled: true,
            importedFiles: [],
        };
    }

    const text = await file.text();
    const data = JSON.parse(text);
    const importedFiles = await invoke<string[]>('import_config', { data });
    return {
        success: true,
        cancelled: false,
        importedFiles,
    };
}

// --- Providers-only ---

export async function exportProvidersConfigToFile(): Promise<ConfigExportResult> {
    const data = await invoke('export_providers_config');
    const fileName = `cc-switch-providers-${new Date().toISOString().slice(0, 10)}.json`;
    triggerJsonDownload(data, fileName);
    return {
        success: true,
        fileName,
    };
}

export async function importProvidersConfigFromFile(): Promise<ConfigImportResult> {
    const file = await selectJsonFile();
    if (!file) {
        return {
            success: true,
            cancelled: true,
            importedFiles: [],
        };
    }

    const text = await file.text();
    const data = JSON.parse(text);
    const importedFiles = await invoke<string[]>('import_providers_config', { data });
    return {
        success: true,
        cancelled: false,
        importedFiles,
    };
}
