export interface WebDavConfig {
  enabled: boolean;
  serverUrl?: string;
  username?: string;
  password?: string;
  remotePath?: string;
  lastSyncAt?: string;
}

export interface AutoLaunchStatus {
  enabled: boolean;
  supported: boolean;
}
