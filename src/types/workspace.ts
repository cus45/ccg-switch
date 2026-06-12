import type { AppType } from './app';

export type WorkspaceTargetType =
    | 'app'
    | 'model_adapter'
    | 'provider'
    | 'mcp_server'
    | 'skill'
    | 'prompt'
    | 'automation';

export type WorkspaceBindingType = 'default' | 'enabled' | 'override' | 'sync' | 'favorite';
export type NullableUpdate<T> = T | null;

export interface Workspace {
    id: string;
    name: string;
    rootPath: string;
    normalizedPath: string;
    gitRoot?: string;
    originUrl?: string;
    description?: string;
    tags: string[];
    color?: string;
    icon?: string;
    defaultAppType?: AppType;
    defaultProviderId?: string;
    permissionPolicy?: string;
    terminalPolicy?: string;
    metadata: Record<string, unknown>;
    isFavorite: boolean;
    createdAt: number;
    updatedAt: number;
    lastOpenedAt?: number;
}

export interface WorkspaceGitStatus {
    workspaceId: string;
    rootPath: string;
    isGitRepository: boolean;
    gitRoot?: string;
    branch?: string;
    dirty: boolean;
    changedFileCount: number;
    originUrl?: string;
}

export interface WorkspaceWorktree {
    id: string;
    workspaceId: string;
    path: string;
    branch?: string;
    ownerThreadId?: string;
    createdAt: number;
    lastUsedAt?: number;
}

export interface LocalEnvironmentConfig {
    workspaceId: string;
    path: string;
    exists: boolean;
    setupScript?: string;
    rawToml: string;
    parseError?: string;
}

export interface LocalEnvironmentUpdateInput {
    workspaceId: string;
    setupScript?: string;
}

export interface WorkspaceAutomation {
    id: string;
    workspaceId: string;
    title: string;
    prompt: string;
    schedule: string;
    enabled: boolean;
    memoryPath?: string;
    createdAt: number;
    updatedAt: number;
}

export interface CreateWorkspaceAutomationInput {
    workspaceId: string;
    title: string;
    prompt: string;
    schedule: string;
    enabled?: boolean;
    memoryPath?: string;
}

export interface UpdateWorkspaceAutomationInput {
    title?: string;
    prompt?: string;
    schedule?: string;
    enabled?: boolean;
    memoryPath?: NullableUpdate<string>;
}

export interface CreateWorkspaceInput {
    name?: string;
    rootPath: string;
    description?: string;
    tags?: string[];
    color?: string;
    icon?: string;
    defaultAppType?: AppType;
    defaultProviderId?: string;
    permissionPolicy?: string;
    terminalPolicy?: string;
    metadata?: Record<string, unknown>;
    isFavorite?: boolean;
}

export type WorkspaceInput = CreateWorkspaceInput;

export interface UpdateWorkspaceInput {
    name?: string;
    description?: NullableUpdate<string>;
    tags?: string[];
    color?: NullableUpdate<string>;
    icon?: NullableUpdate<string>;
    defaultAppType?: NullableUpdate<AppType>;
    defaultProviderId?: NullableUpdate<string>;
    permissionPolicy?: NullableUpdate<string>;
    terminalPolicy?: NullableUpdate<string>;
    metadata?: Record<string, unknown>;
    isFavorite?: boolean;
}

export interface WorkspaceBinding {
    id: string;
    workspaceId: string;
    targetType: WorkspaceTargetType;
    targetId: string;
    bindingType: WorkspaceBindingType;
    enabled: boolean;
    priority: number;
    config: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}

export interface WorkspaceBindingInput {
    workspaceId: string;
    targetType: WorkspaceTargetType;
    targetId: string;
    bindingType: WorkspaceBindingType;
    enabled?: boolean;
    priority?: number;
    config?: Record<string, unknown>;
}
