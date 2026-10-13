import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectProfileStore } from './useProjectProfileStore';
import type { ProjectProfile } from '../types/projectProfile';

const tauriMocks = vi.hoisted(() => ({
    invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: tauriMocks.invoke,
}));

function createProfile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
    return {
        id: 'proj-1',
        name: 'Work Profile',
        description: 'Test description',
        isActive: false,
        providers: { claude: 'p1' },
        mcpServers: { claude: ['mcp1'] },
        skills: { claude: ['skill1'] },
        prompts: { claude: 'prompt1' },
        createdAt: 1000,
        updatedAt: 1000,
        ...overrides,
    };
}

describe('useProjectProfileStore', () => {
    beforeEach(() => {
        tauriMocks.invoke.mockReset();
        useProjectProfileStore.setState({
            profiles: [],
            loading: false,
            error: null,
        });
    });

    it('loads project profiles from backend', async () => {
        const mockProfiles = [createProfile({ id: 'p1', isActive: true }), createProfile({ id: 'p2' })];
        tauriMocks.invoke.mockResolvedValueOnce(mockProfiles);

        await useProjectProfileStore.getState().loadProfiles();

        expect(tauriMocks.invoke).toHaveBeenCalledWith('get_project_profiles');
        expect(useProjectProfileStore.getState().profiles).toHaveLength(2);
        expect(useProjectProfileStore.getState().profiles[0].id).toBe('p1');
    });

    it('switches project profile and marks it active', async () => {
        const p1 = createProfile({ id: 'p1', isActive: true });
        const p2 = createProfile({ id: 'p2', isActive: false });
        useProjectProfileStore.setState({ profiles: [p1, p2] });

        tauriMocks.invoke.mockResolvedValueOnce({ ...p2, isActive: true });

        await useProjectProfileStore.getState().switchProfile('p2');

        expect(tauriMocks.invoke).toHaveBeenCalledWith('apply_project_profile', { id: 'p2' });
        const profiles = useProjectProfileStore.getState().profiles;
        expect(profiles.find((p) => p.id === 'p1')?.isActive).toBe(false);
        expect(profiles.find((p) => p.id === 'p2')?.isActive).toBe(true);
    });

    it('captures current system state as a new project profile', async () => {
        const captured = createProfile({ id: 'captured-1', name: 'New Project', isActive: true });
        tauriMocks.invoke.mockResolvedValueOnce(captured);

        const result = await useProjectProfileStore.getState().captureCurrent('New Project', 'desc');

        expect(tauriMocks.invoke).toHaveBeenCalledWith('capture_current_project_profile', {
            name: 'New Project',
            description: 'desc',
            icon: null,
        });
        expect(result.id).toBe('captured-1');
        expect(useProjectProfileStore.getState().profiles[0].id).toBe('captured-1');
        expect(useProjectProfileStore.getState().profiles[0].isActive).toBe(true);
    });

    it('deletes project profile', async () => {
        const p1 = createProfile({ id: 'p1' });
        useProjectProfileStore.setState({ profiles: [p1] });

        tauriMocks.invoke.mockResolvedValueOnce(true);

        await useProjectProfileStore.getState().deleteProfile('p1');

        expect(tauriMocks.invoke).toHaveBeenCalledWith('delete_project_profile', { id: 'p1' });
        expect(useProjectProfileStore.getState().profiles).toHaveLength(0);
    });
});
