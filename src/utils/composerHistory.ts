// ComposerHistory - 输入框增量撤销/重做（时间窗合并连续输入，程序性写入可抑制）

const MERGE_WINDOW_MS = 800;
const MAX_HISTORY = 200;

/**
 * 文本快照双栈：
 * - record：输入时快照；800ms 内的连续输入合并为同一历史点（接近编辑器分组粒度）；
 * - undo/redo：返回目标文本（由调用方程序性写回编辑器，写回期间应抑制 record）。
 */
export class ComposerHistory {
    private undoStack: string[];
    private redoStack: string[] = [];
    private lastRecordAt = 0;

    constructor(initial = '') {
        this.undoStack = [initial];
    }

    /** 重置基线（切换会话/tab 时调用，避免跨会话撤销） */
    reset(initial = ''): void {
        this.undoStack = [initial];
        this.redoStack = [];
        this.lastRecordAt = 0;
    }

    record(text: string, now: number = Date.now()): void {
        const top = this.undoStack[this.undoStack.length - 1];
        if (top === text) return;
        this.redoStack = [];
        // 合并窗口内替换栈顶（基线快照除外），把逐字符输入聚成停顿分组
        if (now - this.lastRecordAt < MERGE_WINDOW_MS && this.undoStack.length > 1) {
            this.undoStack[this.undoStack.length - 1] = text;
        } else {
            this.undoStack.push(text);
            if (this.undoStack.length > MAX_HISTORY) {
                this.undoStack.shift();
            }
        }
        this.lastRecordAt = now;
    }

    /** 返回撤销目标文本；无可撤销返回 null */
    undo(current: string): string | null {
        if (this.undoStack[this.undoStack.length - 1] === current) {
            if (this.undoStack.length === 1) return null;
            this.undoStack.pop();
        }
        const target = this.undoStack[this.undoStack.length - 1];
        if (target === undefined || target === current) return null;
        this.redoStack.push(current);
        // 撤销后的新输入不与旧栈顶合并
        this.lastRecordAt = 0;
        return target;
    }

    /** 返回重做目标文本；无可重做返回 null */
    redo(current: string): string | null {
        const target = this.redoStack.pop();
        if (target === undefined || target === current) return null;
        this.undoStack.push(target);
        this.lastRecordAt = 0;
        return target;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 1;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }
}
