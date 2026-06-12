import { invoke } from '@tauri-apps/api/core';
import type { AdapterRegistry } from '../types/adapter';

export async function getAdapterRegistry(): Promise<AdapterRegistry> {
    return await invoke<AdapterRegistry>('get_adapter_registry');
}
