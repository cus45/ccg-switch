import { create } from 'zustand';
import type { AppType } from '../types/app';
import type {
    CreateWorkspaceInput,
    UpdateWorkspaceInput,
    Workspace,
    WorkspaceBinding,
    WorkspaceBindingInput,
} from '../types/workspace';
import * as workspaceService from '../services/workspaceService';

interface WorkspaceState {
    workspaces: Workspace[];
    selectedWorkspaceId: string | null;
    bindingsByWorkspace: Record<string, WorkspaceBinding[]>;
    hasLoaded: boolean;
    loading: boolean;
    loadingBindings: boolean;
    error: string | null;
    bindingError: string | null;

    loadWorkspaces: (force?: boolean) => Promise<void>;
    selectWorkspace: (id: string | null) => void;
    createWorkspace: (input: CreateWorkspaceInput) => Promise<Workspace>;
    updateWorkspace: (id: string, input: UpdateWorkspaceInput) => Promise<Workspace>;
    updateWorkspaceDefaults: (
        id: string,
        defaultAppType: AppType | null,
        defaultProviderId: string | null
    ) => Promise<Workspace>;
    deleteWorkspace: (id: string) => Promise<void>;
    importProjectAsWorkspace: (rootPath: string) => Promise<Workspace>;
    touchWorkspace: (id: string) => Promise<Workspace>;
    loadWorkspaceBindings: (workspaceId: string, force?: boolean) => Promise<WorkspaceBinding[]>;
    setWorkspaceBinding: (input: WorkspaceBindingInput) => Promise<WorkspaceBinding>;
    deleteWorkspaceBinding: (id: string) => Promise<void>;
    clearError: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
    workspaces: [],
    selectedWorkspaceId: null,
    bindingsByWorkspace: {},
    hasLoaded: false,
    loading: false,
    loadingBindings: false,
    error: null,
    bindingError: null,

    loadWorkspaces: async (force = false) => {
        if (!force && get().hasLoaded) return;
        set({ loading: true, error: null });
        try {
            const snapshot = await loadWorkspaceSnapshot(get().selectedWorkspaceId);
            set({ ...snapshot, loading: false, hasLoaded: true });
        } catch (error) {
            set({ error: String(error), loading: false });
        }
    },

    selectWorkspace: (id) => {
        set({ selectedWorkspaceId: id });
    },

    createWorkspace: async (input) => {
        set({ loading: true, error: null });
        try {
            const workspace = await workspaceService.createWorkspace(input);
            const snapshot = await loadWorkspaceSnapshot(workspace.id);
            set({ ...snapshot, loading: false, hasLoaded: true });
            return workspace;
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    updateWorkspace: async (id, input) => {
        set({ loading: true, error: null });
        try {
            const workspace = await workspaceService.updateWorkspace(id, input);
            const snapshot = await loadWorkspaceSnapshot(get().selectedWorkspaceId);
            set({ ...snapshot, loading: false, hasLoaded: true });
            return workspace;
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    updateWorkspaceDefaults: async (id, defaultAppType, defaultProviderId) => {
        return await get().updateWorkspace(id, {
            defaultAppType,
            defaultProviderId,
        });
    },

    deleteWorkspace: async (id) => {
        set({ loading: true, error: null });
        try {
            await workspaceService.deleteWorkspace(id);
            const selectedWorkspaceId = get().selectedWorkspaceId === id
                ? null
                : get().selectedWorkspaceId;
            const snapshot = await loadWorkspaceSnapshot(selectedWorkspaceId);
            set({ ...snapshot, loading: false, hasLoaded: true });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    importProjectAsWorkspace: async (rootPath) => {
        set({ loading: true, error: null });
        try {
            const workspace = await workspaceService.importProjectAsWorkspace(rootPath);
            const snapshot = await loadWorkspaceSnapshot(workspace.id);
            set({ ...snapshot, loading: false, hasLoaded: true });
            return workspace;
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    touchWorkspace: async (id) => {
        set({ loading: true, error: null });
        try {
            const workspace = await workspaceService.touchWorkspace(id);
            const snapshot = await loadWorkspaceSnapshot(get().selectedWorkspaceId);
            set({ ...snapshot, loading: false, hasLoaded: true });
            return workspace;
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    loadWorkspaceBindings: async (workspaceId, force = false) => {
        const cached = get().bindingsByWorkspace[workspaceId];
        if (!force && cached) {
            return cached;
        }

        set({ loadingBindings: true, bindingError: null });
        try {
            const bindings = await workspaceService.listWorkspaceBindings(workspaceId);
            set(state => ({
                bindingsByWorkspace: {
                    ...state.bindingsByWorkspace,
                    [workspaceId]: bindings,
                },
                loadingBindings: false,
            }));
            return bindings;
        } catch (error) {
            set({ bindingError: String(error), loadingBindings: false });
            throw error;
        }
    },

    setWorkspaceBinding: async (input) => {
        set({ loadingBindings: true, bindingError: null });
        try {
            const binding = await workspaceService.setWorkspaceBinding(input);
            const bindings = await workspaceService.listWorkspaceBindings(input.workspaceId);
            set(state => ({
                bindingsByWorkspace: {
                    ...state.bindingsByWorkspace,
                    [input.workspaceId]: bindings,
                },
                loadingBindings: false,
            }));
            return binding;
        } catch (error) {
            set({ bindingError: String(error), loadingBindings: false });
            throw error;
        }
    },

    deleteWorkspaceBinding: async (id) => {
        set({ loadingBindings: true, bindingError: null });
        try {
            await workspaceService.deleteWorkspaceBinding(id);
            set(state => {
                const bindingsByWorkspace = Object.fromEntries(
                    Object.entries(state.bindingsByWorkspace).map(([workspaceId, bindings]) => [
                        workspaceId,
                        bindings.filter(binding => binding.id !== id),
                    ])
                );
                return { bindingsByWorkspace, loadingBindings: false };
            });
        } catch (error) {
            set({ bindingError: String(error), loadingBindings: false });
            throw error;
        }
    },

    clearError: () => {
        set({ error: null, bindingError: null });
    },
}));

async function loadWorkspaceSnapshot(
    selectedWorkspaceId: string | null
): Promise<Pick<WorkspaceState, 'workspaces' | 'selectedWorkspaceId'>> {
    const workspaces = await workspaceService.listWorkspaces();
    return {
        workspaces,
        selectedWorkspaceId: resolveSelectedWorkspaceId(selectedWorkspaceId, workspaces),
    };
}

function resolveSelectedWorkspaceId(
    selectedWorkspaceId: string | null,
    workspaces: Workspace[]
): string | null {
    if (!selectedWorkspaceId) {
        return null;
    }
    return workspaces.some(workspace => workspace.id === selectedWorkspaceId)
        ? selectedWorkspaceId
        : null;
}
