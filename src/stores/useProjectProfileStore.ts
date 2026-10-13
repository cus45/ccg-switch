import { create } from 'zustand';
import { ProjectProfile } from '../types/projectProfile';
import { projectProfileService } from '../services/projectProfileService';

interface ProjectProfileState {
    profiles: ProjectProfile[];
    loading: boolean;
    error: string | null;

    loadProfiles: () => Promise<void>;
    switchProfile: (id: string) => Promise<ProjectProfile>;
    captureCurrent: (name: string, description?: string, icon?: string) => Promise<ProjectProfile>;
    saveProfile: (profile: ProjectProfile) => Promise<ProjectProfile>;
    deleteProfile: (id: string) => Promise<void>;
}

export const useProjectProfileStore = create<ProjectProfileState>((set) => ({
    profiles: [],
    loading: false,
    error: null,

    loadProfiles: async () => {
        set({ loading: true, error: null });
        try {
            const profiles = await projectProfileService.getProfiles();
            set({ profiles, loading: false });
        } catch (e) {
            set({ error: String(e), loading: false });
        }
    },

    switchProfile: async (id: string) => {
        set({ loading: true, error: null });
        try {
            const applied = await projectProfileService.applyProfile(id);
            set((state) => ({
                profiles: state.profiles.map((p) => ({
                    ...p,
                    isActive: p.id === id,
                })),
                loading: false,
            }));
            return applied;
        } catch (e) {
            set({ error: String(e), loading: false });
            throw e;
        }
    },

    captureCurrent: async (name: string, description?: string, icon?: string) => {
        set({ loading: true, error: null });
        try {
            const created = await projectProfileService.captureCurrentProfile(name, description, icon);
            set((state) => ({
                profiles: [
                    created,
                    ...state.profiles.map((p) => ({ ...p, isActive: false })),
                ],
                loading: false,
            }));
            return created;
        } catch (e) {
            set({ error: String(e), loading: false });
            throw e;
        }
    },

    saveProfile: async (profile: ProjectProfile) => {
        set({ loading: true, error: null });
        try {
            const saved = await projectProfileService.saveProfile(profile);
            set((state) => ({
                profiles: state.profiles.map((p) => (p.id === saved.id ? saved : p)),
                loading: false,
            }));
            return saved;
        } catch (e) {
            set({ error: String(e), loading: false });
            throw e;
        }
    },

    deleteProfile: async (id: string) => {
        set({ loading: true, error: null });
        try {
            await projectProfileService.deleteProfile(id);
            set((state) => ({
                profiles: state.profiles.filter((p) => p.id !== id),
                loading: false,
            }));
        } catch (e) {
            set({ error: String(e), loading: false });
            throw e;
        }
    },
}));
