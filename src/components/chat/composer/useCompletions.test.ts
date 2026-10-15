import {describe, expect, it} from 'vitest';
import {getSlashCommandCompletions, normalizeWorkspaceFile, shouldConsumeCompletionKey,} from './useCompletions';

describe('getSlashCommandCompletions', () => {
    it('includes cc-gui parity built-in commands for an empty slash query', () => {
        const labels = getSlashCommandCompletions('').map((item) => item.label);

        expect(labels).toEqual(expect.arrayContaining([
            '/clear',
            '/provider',
            '/model',
            '/fork',
            '/compact',
            '/context',
            '/init',
            '/plan',
            '/resume',
            '/review',
            '/batch',
            '/claude-api',
            '/debug',
            '/loop',
            '/simplify',
            '/update-config',
            '/diff',
        ]));
    });

    it('filters slash commands by command label and description', () => {
        expect(getSlashCommandCompletions('pla').map((item) => item.label)).toContain('/plan');
        expect(getSlashCommandCompletions('tokens').map((item) => item.label)).toContain('/compact');
        expect(getSlashCommandCompletions('provider').map((item) => item.label)).toContain('/provider');
        expect(getSlashCommandCompletions('model').map((item) => item.label)).toContain('/model');
        expect(getSlashCommandCompletions('fork').map((item) => item.label)).toContain('/fork');
    });

    it('normalizes backend-provided project commands', () => {
        expect(getSlashCommandCompletions('deep', [{
            name: '/review:deep',
            description: 'Deep project review',
            source: 'project',
        }])).toEqual([{
            id: '/review:deep',
            label: '/review:deep',
            description: 'Deep project review [project]',
            insertText: '/review:deep',
            kind: 'command',
        }]);
    });
});

describe('normalizeWorkspaceFile', () => {
    it('accepts snake_case payloads from Rust commands', () => {
        expect(normalizeWorkspaceFile({
            rel_path: 'src/pages/ChatPage.tsx',
            name: 'ChatPage.tsx',
            is_dir: false,
        })).toEqual({
            relPath: 'src/pages/ChatPage.tsx',
            name: 'ChatPage.tsx',
            isDir: false,
        });
    });

    it('accepts camelCase payloads from future frontend adapters', () => {
        expect(normalizeWorkspaceFile({
            relPath: 'src/components/chat',
            name: 'chat',
            isDir: true,
        })).toEqual({
            relPath: 'src/components/chat',
            name: 'chat',
            isDir: true,
        });
    });

    it('drops invalid items instead of rendering undefined candidates', () => {
        expect(normalizeWorkspaceFile({
            name: 'missing-path.ts',
            is_dir: false,
        })).toBeNull();
    });
});

describe('shouldConsumeCompletionKey', () => {
    it('consumes Enter and Tab while the completion menu is open even before items finish loading', () => {
        expect(shouldConsumeCompletionKey('Enter', true, 0)).toBe(true);
        expect(shouldConsumeCompletionKey('Tab', true, 0)).toBe(true);
    });

    it('does not consume submit keys when the completion menu is closed', () => {
        expect(shouldConsumeCompletionKey('Enter', false, 0)).toBe(false);
        expect(shouldConsumeCompletionKey('Tab', false, 3)).toBe(false);
    });
});
