import { invoke } from '@tauri-apps/api/core';
import { DeepLinkImportRequest } from '../types/deeplink';

export const deeplinkService = {
    parseDeeplink: (url: string): Promise<DeepLinkImportRequest> => {
        return invoke('parse_deeplink', { url });
    },

    importProviderFromDeeplink: (request: DeepLinkImportRequest): Promise<string> => {
        return invoke('import_provider_from_deeplink', { request });
    },
};
