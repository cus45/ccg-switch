import { invoke } from '@tauri-apps/api/core';
import { ProjectProfile } from '../types/projectProfile';

export const projectProfileService = {
    async getProfiles(): Promise<ProjectProfile[]> {
        return invoke<ProjectProfile[]>('get_project_profiles');
    },

    async saveProfile(profile: ProjectProfile): Promise<ProjectProfile> {
        return invoke<ProjectProfile>('save_project_profile', { profile });
    },

    async deleteProfile(id: string): Promise<boolean> {
        return invoke<boolean>('delete_project_profile', { id });
    },

    async captureCurrentProfile(
        name: string,
        description?: string,
        icon?: string
    ): Promise<ProjectProfile> {
        return invoke<ProjectProfile>('capture_current_project_profile', {
            name,
            description: description || null,
            icon: icon || null,
        });
    },

    async applyProfile(id: string): Promise<ProjectProfile> {
        return invoke<ProjectProfile>('apply_project_profile', { id });
    },
};
