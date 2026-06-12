export type AdapterRegistryId = 'claude' | 'codex' | 'gemini' | (string & {});

export interface AppIntegration {
    appId: AdapterRegistryId;
    displayName: string;
    visible: boolean;
    configFiles: string[];
    sessionLocations: string[];
    resumeCommandTemplate: string | null;
    mcpSyncSupported: boolean;
    enabled: boolean;
}

export interface ModelAdapter {
    adapterId: AdapterRegistryId;
    displayName: string;
    protocol: string;
    supportedTransports: string[];
    authSchemes: string[];
    capabilities: string[];
}

export interface AdapterRegistry {
    appIntegrations: AppIntegration[];
    modelAdapters: ModelAdapter[];
}
