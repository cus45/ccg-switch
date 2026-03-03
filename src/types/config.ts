export type SidebarPosition = 'left' | 'right' | 'top';

export interface Config {
    theme: 'light' | 'dark';
    language: 'en' | 'zh';
    sidebarPosition: SidebarPosition;
}

export interface ApiConfig {
    name: string;
    token: string;
    url: string;
    model: string;
    customParams?: Record<string, any>;
}
