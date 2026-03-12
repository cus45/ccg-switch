import { invoke } from '@tauri-apps/api/core';
import { WebDavConfig, AutoLaunchStatus } from '../types/advanced';

export async function getWebDavConfig(): Promise<WebDavConfig> {
  return invoke<WebDavConfig>('get_webdav_config');
}

export async function saveWebDavConfig(config: WebDavConfig): Promise<void> {
  return invoke('save_webdav_config', { config });
}

export async function getAutoLaunchStatus(): Promise<AutoLaunchStatus> {
  return invoke<AutoLaunchStatus>('get_auto_launch_status');
}

export async function setAutoLaunch(enabled: boolean): Promise<void> {
  return invoke('set_auto_launch', { enabled });
}
