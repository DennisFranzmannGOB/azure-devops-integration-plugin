import { ReviewedFilesStore } from '../reviewedFiles';

function makeMockMemento() {
    const store: Record<string, unknown> = {};
    return {
        get: jest.fn((key: string, defaultValue?: unknown) => store[key] ?? defaultValue),
        update: jest.fn((key: string, value: unknown) => { store[key] = value; return Promise.resolve(); }),
        keys: jest.fn(() => Object.keys(store)),
        setKeysForSync: jest.fn(),
    };
}

describe('ReviewedFilesStore', () => {
    describe('basic CRUD', () => {
        it('initially returns false and empty set', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            expect(store.isReviewed(1, '/src/foo.ts')).toBe(false);
            expect([...store.getReviewedFiles(1)]).toHaveLength(0);
        });

        it('setReviewed marks a file and isReviewed returns true', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            store.setReviewed(1, 5, '/src/foo.ts', true);
            expect(store.isReviewed(1, '/src/foo.ts')).toBe(true);
        });

        it('setReviewed false removes the mark', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            store.setReviewed(1, 5, '/src/foo.ts', true);
            store.setReviewed(1, 5, '/src/foo.ts', false);
            expect(store.isReviewed(1, '/src/foo.ts')).toBe(false);
        });

        it('getReviewedFiles returns all marked paths', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            store.setReviewed(1, 5, '/src/a.ts', true);
            store.setReviewed(1, 5, '/src/b.ts', true);
            const set = store.getReviewedFiles(1);
            expect(set.has('/src/a.ts')).toBe(true);
            expect(set.has('/src/b.ts')).toBe(true);
            expect(set.size).toBe(2);
        });

        it('marking same file twice is idempotent', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            store.setReviewed(1, 5, '/src/a.ts', true);
            store.setReviewed(1, 5, '/src/a.ts', true);
            expect(store.getReviewedFiles(1).size).toBe(1);
        });

        it('resetPr clears all marks for a PR', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            store.setReviewed(1, 5, '/src/a.ts', true);
            store.setReviewed(1, 5, '/src/b.ts', true);
            store.resetPr(1);
            expect(store.getReviewedFiles(1).size).toBe(0);
        });

        it('clearAll removes all PRs', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            store.setReviewed(1, 5, '/src/a.ts', true);
            store.setReviewed(2, 3, '/src/b.ts', true);
            store.clearAll();
            expect(store.getReviewedFiles(1).size).toBe(0);
            expect(store.getReviewedFiles(2).size).toBe(0);
        });
    });

    describe('getStoredIterationId / advanceIteration', () => {
        it('returns undefined when no marks exist', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            expect(store.getStoredIterationId(1)).toBeUndefined();
        });

        it('returns stored iterationId after first advanceIteration call', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            store.advanceIteration(1, 5, []);
            expect(store.getStoredIterationId(1)).toBe(5);
        });

        it('keeps marks for files NOT in changedPaths when advancing', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            store.setReviewed(1, 5, '/src/a.ts', true);
            store.setReviewed(1, 5, '/src/b.ts', true);
            // New iteration: only b.ts changed
            store.advanceIteration(1, 6, ['/src/b.ts']);
            expect(store.isReviewed(1, '/src/a.ts')).toBe(true);  // untouched → kept
            expect(store.isReviewed(1, '/src/b.ts')).toBe(false); // changed → cleared
            expect(store.getStoredIterationId(1)).toBe(6);
        });

        it('clears all marks when all files changed', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            store.setReviewed(1, 5, '/src/a.ts', true);
            store.setReviewed(1, 5, '/src/b.ts', true);
            store.advanceIteration(1, 6, ['/src/a.ts', '/src/b.ts']);
            expect(store.getReviewedFiles(1).size).toBe(0);
        });

        it('keeps all marks when changedPaths is empty (e.g. delta fetch failed)', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            store.setReviewed(1, 5, '/src/a.ts', true);
            store.advanceIteration(1, 6, []);
            expect(store.isReviewed(1, '/src/a.ts')).toBe(true);
        });

        it('does nothing for a PR with no existing marks', () => {
            const store = new ReviewedFilesStore(makeMockMemento() as any);
            expect(() => store.advanceIteration(99, 1, [])).not.toThrow();
        });
    });

    describe('gc', () => {
        it('removes entries older than 90 days', () => {
            const memento = makeMockMemento();
            const store = new ReviewedFilesStore(memento as any);

            const oldDate = Date.now() - (91 * 24 * 60 * 60 * 1000);
            const data = {
                '1': { iterationId: 1, files: ['/old.ts'], updatedAt: oldDate },
                '2': { iterationId: 1, files: ['/new.ts'], updatedAt: Date.now() },
            };
            memento.get.mockImplementation((_key: string, def?: unknown) => data ?? def);
            (store as any).read = () => ({ ...data });

            store.gc();

            const written = (memento.update as jest.Mock).mock.calls.at(-1)?.[1] as any;
            expect(written['1']).toBeUndefined();
            expect(written['2']).toBeDefined();
        });

        it('caps at 50 entries by keeping the most recently updated', () => {
            const memento = makeMockMemento();
            const store = new ReviewedFilesStore(memento as any);
            const now = Date.now();

            const data: Record<string, any> = {};
            for (let i = 1; i <= 60; i++) {
                data[String(i)] = { iterationId: 1, files: [], updatedAt: now - i * 1000 };
            }
            (store as any).read = () => ({ ...data });

            store.gc();

            const written = (memento.update as jest.Mock).mock.calls.at(-1)?.[1] as any;
            expect(Object.keys(written)).toHaveLength(50);
            // Entry '1' is most recent (smallest offset) → should be kept
            expect(written['1']).toBeDefined();
            // Entry '60' is oldest among all 60 → should be evicted
            expect(written['60']).toBeUndefined();
        });
    });
});
