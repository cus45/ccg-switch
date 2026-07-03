// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {
    activateDockDocument,
    closeDockDocument,
    createFileDocument,
    createFilesDocument,
    createReviewDocument,
    createSideChatDocument,
    DOCK_DOCUMENTS_STORAGE_KEY,
    DOCK_SHELL_FLAG_STORAGE_KEY,
    type DockDocumentsState,
    EMPTY_DOCK_DOCUMENTS_STATE,
    isDockShellEnabled,
    loadDockDocumentsState,
    openDockDocument,
    saveDockDocumentsState,
} from './dockDocuments';

afterEach(() => {
    window.localStorage.clear();
});

describe('dock document factories', () => {
    it('derives file document title from the path base name across separators', () => {
        expect(createFileDocument('C:/repo/src/App.tsx').title).toBe('App.tsx');
        expect(createFileDocument('C:\\repo\\src\\main.rs').title).toBe('main.rs');
    });

    it('keys files/review as singletons and file/sideChat by identity', () => {
        expect(createFilesDocument().id).toBe('files');
        expect(createReviewDocument().id).toBe('review');
        expect(createFileDocument('/a/b.txt').id).toBe('file:/a/b.txt');
        expect(createSideChatDocument('tab-1', 'Chat').id).toBe('sideChat:tab-1');
    });
});

describe('openDockDocument', () => {
    it('appends a new document and activates it', () => {
        const state = openDockDocument(EMPTY_DOCK_DOCUMENTS_STATE, createFilesDocument());
        expect(state.documents.map((doc) => doc.id)).toEqual(['files']);
        expect(state.activeDocId).toBe('files');
    });

    it('re-opening an existing document focuses it without duplicating', () => {
        let state = openDockDocument(EMPTY_DOCK_DOCUMENTS_STATE, createFilesDocument());
        state = openDockDocument(state, createReviewDocument());
        state = openDockDocument(state, createFilesDocument());

        expect(state.documents.map((doc) => doc.id)).toEqual(['files', 'review']);
        expect(state.activeDocId).toBe('files');
    });

    it('re-opening refreshes document metadata (e.g. renamed title)', () => {
        let state = openDockDocument(EMPTY_DOCK_DOCUMENTS_STATE, createSideChatDocument('tab-1', 'Old'));
        state = openDockDocument(state, createSideChatDocument('tab-1', 'New'));

        expect(state.documents).toHaveLength(1);
        expect(state.documents[0].title).toBe('New');
    });
});

describe('closeDockDocument', () => {
    const threeDocs = (): DockDocumentsState => {
        let state = openDockDocument(EMPTY_DOCK_DOCUMENTS_STATE, createFilesDocument());
        state = openDockDocument(state, createFileDocument('/a.txt'));
        state = openDockDocument(state, createReviewDocument());
        return state;
    };

    it('closing a background document keeps the active one', () => {
        const state = closeDockDocument(threeDocs(), 'files');
        expect(state.documents.map((doc) => doc.id)).toEqual(['file:/a.txt', 'review']);
        expect(state.activeDocId).toBe('review');
    });

    it('closing the active middle document activates the next neighbour', () => {
        let state = threeDocs();
        state = activateDockDocument(state, 'file:/a.txt');
        state = closeDockDocument(state, 'file:/a.txt');
        expect(state.activeDocId).toBe('review');
    });

    it('closing the active last document falls back to the previous one', () => {
        const state = closeDockDocument(threeDocs(), 'review');
        expect(state.activeDocId).toBe('file:/a.txt');
    });

    it('closing the only document clears the active id', () => {
        const state = closeDockDocument(
            openDockDocument(EMPTY_DOCK_DOCUMENTS_STATE, createFilesDocument()),
            'files',
        );
        expect(state.documents).toEqual([]);
        expect(state.activeDocId).toBeNull();
    });

    it('closing an unknown id is a no-op', () => {
        const state = threeDocs();
        expect(closeDockDocument(state, 'missing')).toBe(state);
    });
});

describe('activateDockDocument', () => {
    it('ignores unknown ids', () => {
        const state = openDockDocument(EMPTY_DOCK_DOCUMENTS_STATE, createFilesDocument());
        expect(activateDockDocument(state, 'missing')).toBe(state);
    });
});

describe('persistence', () => {
    it('round-trips documents and active id', () => {
        let state = openDockDocument(EMPTY_DOCK_DOCUMENTS_STATE, createFilesDocument());
        state = openDockDocument(state, createFileDocument('/a.txt'));
        state = activateDockDocument(state, 'files');
        saveDockDocumentsState(state);

        expect(loadDockDocumentsState()).toEqual(state);
    });

    it('drops sideChat documents on load (chat tab pool does not survive restarts)', () => {
        let state = openDockDocument(EMPTY_DOCK_DOCUMENTS_STATE, createFilesDocument());
        state = openDockDocument(state, createSideChatDocument('tab-1', 'Chat'));
        saveDockDocumentsState(state);

        const restored = loadDockDocumentsState();
        expect(restored.documents.map((doc) => doc.id)).toEqual(['files']);
        expect(restored.activeDocId).toBe('files');
    });

    it('returns the empty state for malformed payloads', () => {
        window.localStorage.setItem(DOCK_DOCUMENTS_STORAGE_KEY, '{not json');
        expect(loadDockDocumentsState()).toEqual(EMPTY_DOCK_DOCUMENTS_STATE);

        window.localStorage.setItem(DOCK_DOCUMENTS_STORAGE_KEY, JSON.stringify({documents: 'nope'}));
        expect(loadDockDocumentsState()).toEqual(EMPTY_DOCK_DOCUMENTS_STATE);
    });

    it('repairs a dangling activeDocId to the last document', () => {
        window.localStorage.setItem(DOCK_DOCUMENTS_STORAGE_KEY, JSON.stringify({
            documents: [createFilesDocument(), createReviewDocument()],
            activeDocId: 'missing',
        }));

        expect(loadDockDocumentsState().activeDocId).toBe('review');
    });
});

describe('isDockShellEnabled', () => {
    it('defaults to enabled', () => {
        expect(isDockShellEnabled()).toBe(true);
    });

    it('treats 0/false/off as the rollback switch', () => {
        for (const value of ['0', 'false', 'off', ' OFF ']) {
            window.localStorage.setItem(DOCK_SHELL_FLAG_STORAGE_KEY, value);
            expect(isDockShellEnabled()).toBe(false);
        }
        window.localStorage.setItem(DOCK_SHELL_FLAG_STORAGE_KEY, 'on');
        expect(isDockShellEnabled()).toBe(true);
    });
});
