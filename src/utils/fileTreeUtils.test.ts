import {describe, expect, it} from 'vitest';
import {
    buildChangedPathSet,
    createFileTreeState,
    flattenVisibleTree,
    isDirLoaded,
    isPathChanged,
    joinTreePath,
    normalizeComparePath,
    normalizeDirEntries,
    normalizeDirEntry,
    normalizeTreePath,
    setDirChildren,
    setDirLoading,
    toggleDirExpanded,
} from './fileTreeUtils';

describe('fileTreeUtils path helpers', () => {
    it('normalizes backslashes and trailing separators', () => {
        expect(normalizeTreePath('C:\\repo\\app\\')).toBe('C:/repo/app');
        expect(normalizeTreePath('/home/user/')).toBe('/home/user');
        expect(normalizeTreePath('/')).toBe('/');
    });

    it('joins child names with forward slashes', () => {
        expect(joinTreePath('C:\\repo\\', 'src')).toBe('C:/repo/src');
        expect(joinTreePath('/home/user', 'file.ts')).toBe('/home/user/file.ts');
    });

    it('produces a case-insensitive comparable path', () => {
        expect(normalizeComparePath('C:\\Repo\\App\\Main.TS')).toBe('c:/repo/app/main.ts');
    });
});

describe('fileTreeUtils entry normalization', () => {
    it('accepts both camelCase and snake_case directory flags', () => {
        expect(normalizeDirEntry({name: 'a', isDir: true})).toEqual({name: 'a', isDir: true});
        expect(normalizeDirEntry({name: 'b', is_dir: true})).toEqual({name: 'b', isDir: true});
        expect(normalizeDirEntry({name: 'c'})).toEqual({name: 'c', isDir: false});
    });

    it('drops entries without a usable name', () => {
        expect(normalizeDirEntry({isDir: true})).toBeNull();
        expect(normalizeDirEntry({name: 42 as unknown as string})).toBeNull();
    });

    it('sorts directories first, then case-insensitive by name', () => {
        const entries = normalizeDirEntries([
            {name: 'readme.md', isDir: false},
            {name: 'Zed', isDir: true},
            {name: 'alpha', isDir: true},
            {name: 'App.tsx', isDir: false},
            {name: 42 as unknown as string},
        ]);

        expect(entries.map((entry) => entry.name)).toEqual(['alpha', 'Zed', 'App.tsx', 'readme.md']);
    });
});

describe('fileTreeUtils tree state', () => {
    it('lazily loads children and tracks loaded/loading state', () => {
        let state = createFileTreeState('C:\\repo');
        expect(state.rootPath).toBe('C:/repo');
        expect(isDirLoaded(state, 'C:/repo')).toBe(false);

        state = setDirLoading(state, 'C:/repo', true);
        expect(state.loading['C:/repo']).toBe(true);

        state = setDirChildren(state, 'C:/repo', [
            {name: 'src', isDir: true},
            {name: 'package.json', isDir: false},
        ]);
        expect(isDirLoaded(state, 'C:/repo')).toBe(true);
        expect(state.loading['C:/repo']).toBe(false);
    });

    it('flattens only expanded and loaded directories with correct depth', () => {
        let state = createFileTreeState('C:/repo');
        state = setDirChildren(state, 'C:/repo', [
            {name: 'src', isDir: true},
            {name: 'package.json', isDir: false},
        ]);

        // Collapsed: only the root level is visible.
        expect(flattenVisibleTree(state).map((node) => node.path)).toEqual([
            'C:/repo/src',
            'C:/repo/package.json',
        ]);

        // Expanded but not loaded: no children appear yet.
        state = toggleDirExpanded(state, 'C:/repo/src');
        expect(flattenVisibleTree(state)).toHaveLength(2);

        // Loaded children of an expanded directory render at depth + 1.
        state = setDirChildren(state, 'C:/repo/src', [{name: 'main.ts', isDir: false}]);
        const rows = flattenVisibleTree(state);
        expect(rows.map((node) => node.path)).toEqual([
            'C:/repo/src',
            'C:/repo/src/main.ts',
            'C:/repo/package.json',
        ]);
        const child = rows.find((node) => node.path === 'C:/repo/src/main.ts');
        expect(child?.depth).toBe(1);
    });

    it('hides children again when a directory is collapsed', () => {
        let state = createFileTreeState('C:/repo');
        state = setDirChildren(state, 'C:/repo', [{name: 'src', isDir: true}]);
        state = setDirChildren(state, 'C:/repo/src', [{name: 'main.ts', isDir: false}]);
        state = toggleDirExpanded(state, 'C:/repo/src');
        expect(flattenVisibleTree(state)).toHaveLength(2);

        state = toggleDirExpanded(state, 'C:/repo/src');
        expect(flattenVisibleTree(state).map((node) => node.path)).toEqual(['C:/repo/src']);
    });
});

describe('fileTreeUtils changed-path matching', () => {
    it('resolves git-relative paths against the repo root', () => {
        const changed = buildChangedPathSet('C:\\repo', ['src/main.ts', 'README.md']);
        expect(isPathChanged(changed, 'C:/repo/src/main.ts')).toBe(true);
        // Case-insensitive and backslash-tolerant comparison.
        expect(isPathChanged(changed, 'C:\\repo\\README.md')).toBe(true);
        expect(isPathChanged(changed, 'C:/repo/src/other.ts')).toBe(false);
    });

    it('falls back to raw paths when no git root is known', () => {
        const changed = buildChangedPathSet(null, ['src/main.ts']);
        expect(isPathChanged(changed, 'src/main.ts')).toBe(true);
    });
});
