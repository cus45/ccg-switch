// Skills v2 数据库版类型

export interface InstalledSkillRow {
    id: string;
    name: string;
    description: string | null;
    directory: string;
    repoOwner: string | null;
    repoName: string | null;
    repoBranch: string | null;
    readmeUrl: string | null;
    enabledClaude: boolean;
    enabledCodex: boolean;
    enabledGemini: boolean;
    enabledOpencode?: boolean;
    installedAt: number;
}

export interface SkillRepo {
    owner: string;
    name: string;
    branch: string;
    enabled: boolean;
}

export interface DiscoverableSkill {
    key: string;
    name: string;
    description: string;
    directory: string;
    repoPath: string;
    readmeUrl: string | null;
    repoOwner: string;
    repoName: string;
    repoBranch: string;
    stars?: number;
}

export const SKILL_APPS: { key: keyof Pick<InstalledSkillRow, 'enabledClaude' | 'enabledCodex' | 'enabledGemini' | 'enabledOpencode'>; label: string; app: string }[] = [
    { key: 'enabledClaude', label: 'Claude', app: 'claude' },
    { key: 'enabledCodex', label: 'Codex', app: 'codex' },
    { key: 'enabledGemini', label: 'Gemini', app: 'gemini' },
    { key: 'enabledOpencode', label: 'OpenCode', app: 'opencode' },
];
