import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { ApiToken } from '../types/token';

interface TokenState {
    tokens: ApiToken[];
    hasLoaded: boolean;
    loading: boolean;
    error: string | null;

    loadTokens: (force?: boolean) => Promise<void>;
    addToken: (token: Omit<ApiToken, 'id' | 'createdAt' | 'isActive' | 'lastUsed'>) => Promise<void>;
    updateToken: (id: string, tokenData: Omit<ApiToken, 'id' | 'createdAt' | 'isActive' | 'lastUsed'>) => Promise<void>;
    switchToken: (tokenId: string) => Promise<void>;
    deleteToken: (tokenId: string) => Promise<void>;
    moveToken: (tokenId: string, targetIndex: number) => Promise<void>;
    fetchModels: (baseUrl: string, apiKey: string) => Promise<string[]>;
}

export const useTokenStore = create<TokenState>((set, get) => ({
    tokens: [],
    hasLoaded: false,
    loading: false,
    error: null,

    loadTokens: async (force = false) => {
        if (!force && get().hasLoaded) {
            return;
        }
        set({ loading: true, error: null });
        try {
            const tokens = await invoke<ApiToken[]>('get_tokens');
            set({ tokens, loading: false, hasLoaded: true });
        } catch (error) {
            set({ error: String(error), loading: false });
        }
    },

    addToken: async (tokenData) => {
        set({ loading: true, error: null });
        try {
            const newToken: ApiToken = {
                ...tokenData,
                id: `token-${Date.now()}`,
                isActive: false,
                createdAt: new Date().toISOString(),
            };
            await invoke('add_api_token', { token: newToken });
            await get().loadTokens(true);
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    updateToken: async (id: string, tokenData) => {
        set({ loading: true, error: null });
        try {
            // 获取原有 token 的完整数据
            const existingToken = get().tokens.find(t => t.id === id);
            if (!existingToken) {
                throw new Error('Token not found');
            }

            const updatedToken: ApiToken = {
                ...tokenData,
                id: existingToken.id,
                isActive: existingToken.isActive,
                createdAt: existingToken.createdAt,
                lastUsed: existingToken.lastUsed,
            };

            await invoke('update_api_token', { tokenId: id, token: updatedToken });
            await get().loadTokens(true);
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    switchToken: async (tokenId: string) => {
        set({ loading: true, error: null });
        try {
            await invoke('switch_api_token', { tokenId });
            await get().loadTokens(true);
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    deleteToken: async (tokenId: string) => {
        set({ loading: true, error: null });
        try {
            await invoke('delete_api_token', { tokenId });
            await get().loadTokens(true);
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    moveToken: async (tokenId: string, targetIndex: number) => {
        set({ loading: true, error: null });
        try {
            await invoke('move_api_token', { tokenId, targetIndex });
            await get().loadTokens(true);
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    fetchModels: async (baseUrl: string, apiKey: string) => {
        try {
            const models = await invoke<string[]>('fetch_available_models', { baseUrl, apiKey });
            return models;
        } catch (error) {
            throw new Error(String(error));
        }
    },
}));
