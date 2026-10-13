export interface ProjectProfile {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    isActive: boolean;
    providers: Record<string, string>;
    mcpServers: Record<string, string[]>;
    skills: Record<string, string[]>;
    prompts: Record<string, string>;
    createdAt: number;
    updatedAt: number;
}
