import { invoke } from '@tauri-apps/api/core';
import type {
    CreateWorkspaceInput,
    CreateWorkspaceAutomationInput,
    LocalEnvironmentConfig,
    LocalEnvironmentUpdateInput,
    UpdateWorkspaceAutomationInput,
    UpdateWorkspaceInput,
    Workspace,
    WorkspaceAutomation,
    WorkspaceBinding,
    WorkspaceBindingInput,
    WorkspaceGitStatus,
    WorkspaceWorktree,
} from '../types/workspace';

export async function listWorkspaces(): Promise<Workspace[]> {
    return await invoke<Workspace[]>('list_workspaces');
}

export async function getWorkspace(id: string): Promise<Workspace> {
    return await invoke<Workspace>('get_workspace', { id });
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    return await invoke<Workspace>('create_workspace', { input });
}

export async function updateWorkspace(
    id: string,
    input: UpdateWorkspaceInput
): Promise<Workspace> {
    return await invoke<Workspace>('update_workspace', { id, input });
}

export async function deleteWorkspace(id: string): Promise<void> {
    await invoke('delete_workspace', { id });
}

export async function importProjectAsWorkspace(rootPath: string): Promise<Workspace> {
    return await invoke<Workspace>('import_project_as_workspace', { rootPath });
}

export async function touchWorkspace(id: string): Promise<Workspace> {
    return await invoke<Workspace>('touch_workspace', { id });
}

export async function listWorkspaceBindings(workspaceId: string): Promise<WorkspaceBinding[]> {
    return await invoke<WorkspaceBinding[]>('list_workspace_bindings', { workspaceId });
}

export async function setWorkspaceBinding(
    input: WorkspaceBindingInput
): Promise<WorkspaceBinding> {
    return await invoke<WorkspaceBinding>('set_workspace_binding', { input });
}

export async function deleteWorkspaceBinding(id: string): Promise<void> {
    await invoke('delete_workspace_binding', { id });
}

export async function getWorkspaceGitStatus(
    workspaceId: string
): Promise<WorkspaceGitStatus> {
    return await invoke<WorkspaceGitStatus>('get_workspace_git_status', { workspaceId });
}

export async function listWorkspaceWorktrees(
    workspaceId: string
): Promise<WorkspaceWorktree[]> {
    return await invoke<WorkspaceWorktree[]>('list_workspace_worktrees', { workspaceId });
}

export async function readLocalEnvironment(
    workspaceId: string
): Promise<LocalEnvironmentConfig> {
    return await invoke<LocalEnvironmentConfig>('read_local_environment', { workspaceId });
}

export async function saveLocalEnvironment(
    input: LocalEnvironmentUpdateInput
): Promise<LocalEnvironmentConfig> {
    return await invoke<LocalEnvironmentConfig>('save_local_environment', { input });
}

export async function listWorkspaceAutomations(
    workspaceId: string
): Promise<WorkspaceAutomation[]> {
    return await invoke<WorkspaceAutomation[]>('list_workspace_automations', { workspaceId });
}

export async function createWorkspaceAutomation(
    input: CreateWorkspaceAutomationInput
): Promise<WorkspaceAutomation> {
    return await invoke<WorkspaceAutomation>('create_workspace_automation', { input });
}

export async function updateWorkspaceAutomation(
    id: string,
    input: UpdateWorkspaceAutomationInput
): Promise<WorkspaceAutomation> {
    return await invoke<WorkspaceAutomation>('update_workspace_automation', { id, input });
}

export async function deleteWorkspaceAutomation(id: string): Promise<void> {
    await invoke('delete_workspace_automation', { id });
}
