import {describe, expect, it} from 'vitest';
import {ComposerHistory} from './composerHistory';

describe('ComposerHistory', () => {
    it('merges keystrokes within the grouping window into one history step', () => {
        const history = new ComposerHistory('');
        history.record('h', 1000);
        history.record('he', 1200);
        history.record('hel', 1400);
        // 停顿后再输入 → 新历史点
        history.record('hello world', 3000);

        expect(history.undo('hello world')).toBe('hel');
        expect(history.undo('hel')).toBe('');
        expect(history.undo('')).toBeNull();
    });

    it('redo restores undone text and new input clears the redo stack', () => {
        const history = new ComposerHistory('');
        history.record('draft one', 1000);
        history.record('draft one two', 3000);

        expect(history.undo('draft one two')).toBe('draft one');
        expect(history.canRedo).toBe(true);
        expect(history.redo('draft one')).toBe('draft one two');
        expect(history.canRedo).toBe(false);

        expect(history.undo('draft one two')).toBe('draft one');
        history.record('draft one edited', 9000);
        expect(history.canRedo).toBe(false);
        expect(history.redo('draft one edited')).toBeNull();
    });

    it('reset drops both stacks and starts a new baseline', () => {
        const history = new ComposerHistory('');
        history.record('something', 1000);
        history.reset('new tab draft');

        expect(history.canUndo).toBe(false);
        expect(history.canRedo).toBe(false);
        expect(history.undo('new tab draft')).toBeNull();
    });

    it('caps history length', () => {
        const history = new ComposerHistory('');
        for (let index = 0; index < 260; index += 1) {
            history.record(`text-${index}`, index * 10_000);
        }
        let undoCount = 0;
        let current = 'text-259';
        for (;;) {
            const previous = history.undo(current);
            if (previous === null) break;
            current = previous;
            undoCount += 1;
        }
        expect(undoCount).toBeLessThanOrEqual(200);
        expect(undoCount).toBeGreaterThan(150);
    });
});
