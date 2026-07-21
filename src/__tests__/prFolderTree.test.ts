import * as vscode from 'vscode';
import { PrChangesProvider, PrFolderItem, PrFileItem, PrCommentThreadItem } from '../prChangesProvider';
import { EnrichedPullRequest, PrChange } from '../api';

jest.mock('../auth', () => ({
    getToken: jest.fn().mockResolvedValue('token'),
}));

jest.mock('../api', () => ({
    getPrThreads: jest.fn(),
    getPrIterations: jest.fn(),
    getPrChanges: jest.fn(),
    addPullRequestComment: jest.fn(),
    replyToThread: jest.fn(),
    updateThreadStatus: jest.fn(),
}));

const api = jest.requireMock('../api') as {
    getPrThreads: jest.Mock;
    getPrIterations: jest.Mock;
    getPrChanges: jest.Mock;
};

function makePr(): EnrichedPullRequest {
    return {
        pullRequestId: 42,
        title: 'Test PR',
        sourceRefName: 'refs/heads/feature/my-pr',
        createdBy: { displayName: 'User', id: 'u1' },
        reviewers: [],
        repository: { id: 'repo1', name: 'repo', project: { id: 'proj1', name: 'proj' } },
        status: 'active',
        isDraft: false,
        url: '',
        unresolvedCommentCount: 0,
        commentThreads: [],
        checksStatus: 'none',
        checks: [],
        workItems: [],
    };
}

function makeChange(path: string, changeType = 'edit'): PrChange {
    return { changeType, item: { path } };
}

function setupIterations() {
    api.getPrIterations.mockResolvedValue([{
        id: 1,
        sourceRefCommit: { commitId: 'src123' },
        targetRefCommit: { commitId: 'tgt456' },
    }]);
}

describe('Folder tree — PrFolderItem building', () => {
    beforeEach(() => {
        api.getPrIterations.mockReset();
        api.getPrThreads.mockReset();
        api.getPrChanges.mockReset();
        setupIterations();
        api.getPrThreads.mockResolvedValue([]);
    });

    it('wraps nested files in folder nodes', async () => {
        api.getPrChanges.mockResolvedValue([
            makeChange('/extensions/unitop/src/Foo.al'),
            makeChange('/extensions/unitop/src/Bar.al'),
        ]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        // Single compacted folder for extensions/unitop/src
        expect(root).toHaveLength(1);
        expect(root[0]).toBeInstanceOf(PrFolderItem);
        expect(root[0].label).toBe('extensions/unitop/src');
    });

    it('places root-level files at root without a folder wrapper', async () => {
        api.getPrChanges.mockResolvedValue([
            makeChange('/README.md'),
        ]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        expect(root).toHaveLength(1);
        expect(root[0]).toBeInstanceOf(PrFileItem);
        expect((root[0] as PrFileItem).label).toBe('README.md');
    });

    it('reuses the loaded PR snapshot until an explicit refresh', async () => {
        api.getPrChanges.mockResolvedValue([makeChange('/README.md')]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');

        await provider.getChildren();
        await provider.getChildren();

        expect(api.getPrIterations).toHaveBeenCalledTimes(1);
        expect(api.getPrChanges).toHaveBeenCalledTimes(1);
        expect(api.getPrThreads).toHaveBeenCalledTimes(1);

        provider.refresh();
        await provider.getChildren();

        expect(api.getPrIterations).toHaveBeenCalledTimes(2);
        expect(api.getPrChanges).toHaveBeenCalledTimes(2);
        expect(api.getPrThreads).toHaveBeenCalledTimes(2);
    });

    it('shares concurrent root loads for the same PR snapshot', async () => {
        let resolveIterations!: (value: Array<{
            id: number;
            sourceRefCommit: { commitId: string };
            targetRefCommit: { commitId: string };
        }>) => void;
        api.getPrIterations.mockReturnValue(new Promise((resolve) => {
            resolveIterations = resolve;
        }));
        api.getPrChanges.mockResolvedValue([makeChange('/README.md')]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const firstLoad = provider.getChildren();
        const secondLoad = provider.getChildren();
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(api.getPrIterations).toHaveBeenCalledTimes(1);

        resolveIterations([{
            id: 1,
            sourceRefCommit: { commitId: 'src123' },
            targetRefCommit: { commitId: 'tgt456' },
        }]);
        await Promise.all([firstLoad, secondLoad]);
    });

    it('uses the loaded PR snapshot to locate a file', async () => {
        api.getPrChanges.mockResolvedValue([makeChange('/README.md')]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        await provider.getChildren();
        const file = await provider.getFileItem('/README.md');

        expect(file).toBeInstanceOf(PrFileItem);
        expect(api.getPrIterations).toHaveBeenCalledTimes(1);
        expect(api.getPrChanges).toHaveBeenCalledTimes(1);
        expect(api.getPrThreads).toHaveBeenCalledTimes(1);
    });

    it('does not compact folders that have multiple children', async () => {
        api.getPrChanges.mockResolvedValue([
            makeChange('/src/a/foo.ts'),
            makeChange('/src/b/bar.ts'),
        ]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        // 'src' has two sub-folders → NOT compacted
        expect(root).toHaveLength(1);
        expect(root[0].label).toBe('src');
        const srcChildren = await provider.getChildren(root[0] as PrFolderItem);
        expect(srcChildren).toHaveLength(2);
        expect(srcChildren.every(c => c instanceof PrFolderItem)).toBe(true);
    });

    it('compacts a chain of single-child folders into one node', async () => {
        api.getPrChanges.mockResolvedValue([
            makeChange('/a/b/c/file.ts'),
        ]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        expect(root).toHaveLength(1);
        expect(root[0].label).toBe('a/b/c');
        const children = await provider.getChildren(root[0] as PrFolderItem);
        expect(children).toHaveLength(1);
        expect(children[0]).toBeInstanceOf(PrFileItem);
    });

    it('returns a file parent so the tree can reveal and select it', async () => {
        api.getPrChanges.mockResolvedValue([
            makeChange('/src/app.ts'),
        ]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();
        const folder = root[0] as PrFolderItem;
        const file = (await provider.getChildren(folder))[0] as PrFileItem;

        expect(provider.getParent(file)).toBe(folder);
    });

    it('sorts folder nodes before file nodes at the same level', async () => {
        api.getPrChanges.mockResolvedValue([
            makeChange('/README.md'),
            makeChange('/src/app.ts'),
        ]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        expect(root[0]).toBeInstanceOf(PrFolderItem);  // 'src' folder first
        expect(root[1]).toBeInstanceOf(PrFileItem);     // 'README.md' file second
    });

    it('sorts items alphabetically within each group', async () => {
        api.getPrChanges.mockResolvedValue([
            makeChange('/z_folder/file.ts'),
            makeChange('/a_folder/file.ts'),
            makeChange('/z_root.ts'),
            makeChange('/a_root.ts'),
        ]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        // Folders first (alphabetical), then files (alphabetical)
        expect(root[0].label).toBe('a_folder');
        expect(root[1].label).toBe('z_folder');
        expect(root[2].label).toBe('a_root.ts');
        expect(root[3].label).toBe('z_root.ts');
    });

    it('attaches threads to files nested inside folder nodes', async () => {
        api.getPrChanges.mockResolvedValue([
            makeChange('/src/app.ts'),
        ]);
        api.getPrThreads.mockResolvedValue([{
            id: 1,
            status: 'active',
            isDeleted: false,
            threadContext: {
                filePath: '/src/app.ts',
                rightFileStart: { line: 5, offset: 1 },
                rightFileEnd: { line: 5, offset: 1 },
            },
            comments: [{
                id: 1, parentCommentId: 0, content: 'A comment',
                author: { displayName: 'Alice', id: 'a1' },
                publishedDate: '2024-01-01T00:00:00Z',
                commentType: 'text', isDeleted: false,
            }],
        }]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        const folder = root[0] as PrFolderItem;
        const folderChildren = await provider.getChildren(folder);
        const fileNode = folderChildren[0] as PrFileItem;

        expect(fileNode).toBeInstanceOf(PrFileItem);
        expect(fileNode.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);

        const fileChildren = await provider.getChildren(fileNode);
        expect(fileChildren).toHaveLength(1);
        expect(fileChildren[0]).toBeInstanceOf(PrCommentThreadItem);
    });

    it('attaches renamed-file threads even when the thread still points at the original path', async () => {
        api.getPrChanges.mockResolvedValue([
            {
                changeType: 'rename',
                item: { path: '/src/new-name.ts' },
                originalPath: '/src/old-name.ts',
            },
        ]);
        api.getPrThreads.mockResolvedValue([{
            id: 2,
            status: 'active',
            isDeleted: false,
            threadContext: {
                filePath: '/src/old-name.ts',
                leftFileStart: { line: 5, offset: 1 },
                leftFileEnd: { line: 5, offset: 1 },
            },
            comments: [{
                id: 1, parentCommentId: 0, content: 'Rename comment',
                author: { displayName: 'Alice', id: 'a1' },
                publishedDate: '2024-01-01T00:00:00Z',
                commentType: 'text', isDeleted: false,
            }],
        }]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        const folder = root[0] as PrFolderItem;
        const folderChildren = await provider.getChildren(folder);
        const fileNode = folderChildren[0] as PrFileItem;

        expect(fileNode.change.item.path).toBe('/src/new-name.ts');

        const fileChildren = await provider.getChildren(fileNode);
        expect(fileChildren).toHaveLength(1);
        expect(fileChildren[0]).toBeInstanceOf(PrCommentThreadItem);
    });

    it('sets correct contextValue on PrFolderItem', async () => {
        api.getPrChanges.mockResolvedValue([makeChange('/src/app.ts')]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        expect((root[0] as PrFolderItem).contextValue).toBe('prFolder');
    });

    it('sourceBranch is propagated to PrFileItem', async () => {
        api.getPrChanges.mockResolvedValue([makeChange('/src/app.ts')]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        const folder = root[0] as PrFolderItem;
        const children = await provider.getChildren(folder);
        const fileItem = children[0] as PrFileItem;

        expect(fileItem.sourceBranch).toBe('feature/my-pr');
    });
});

// --- Reviewed files / checkbox state ---

function makeMockStore(reviewedPaths: string[] = [], iterationId = 1) {
    return {
        getStoredIterationId: jest.fn().mockReturnValue(iterationId),
        advanceIteration: jest.fn(),
        getReviewedFiles: jest.fn().mockReturnValue(new Set(reviewedPaths)),
        setReviewed: jest.fn(),
        resetPr: jest.fn(),
        clearAll: jest.fn(),
        gc: jest.fn(),
        isReviewed: jest.fn((_, path: string) => reviewedPaths.includes(path)),
    };
}

describe('Reviewed files / checkbox state', () => {
    beforeEach(() => {
        api.getPrIterations.mockReset();
        api.getPrThreads.mockReset();
        api.getPrChanges.mockReset();
        setupIterations();
        api.getPrThreads.mockResolvedValue([]);
    });

    it('file is Unchecked when not reviewed', async () => {
        api.getPrChanges.mockResolvedValue([makeChange('/src/app.ts')]);

        const store = makeMockStore([]);
        const provider = new PrChangesProvider({} as any, store as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        const folder = root[0] as PrFolderItem;
        const children = await provider.getChildren(folder);
        const file = children[0] as PrFileItem;

        expect(file.checkboxState).toBe(vscode.TreeItemCheckboxState.Unchecked);
    });

    it('file is Checked when reviewed', async () => {
        api.getPrChanges.mockResolvedValue([makeChange('/src/app.ts')]);

        const store = makeMockStore(['/src/app.ts']);
        const provider = new PrChangesProvider({} as any, store as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        const folder = root[0] as PrFolderItem;
        const children = await provider.getChildren(folder);
        const file = children[0] as PrFileItem;

        expect(file.checkboxState).toBe(vscode.TreeItemCheckboxState.Checked);
    });

    it('folder is Checked only when all descendant files are reviewed', async () => {
        api.getPrChanges.mockResolvedValue([
            makeChange('/src/a.ts'),
            makeChange('/src/b.ts'),
        ]);

        const storeAll = makeMockStore(['/src/a.ts', '/src/b.ts']);
        const providerAll = new PrChangesProvider({} as any, storeAll as any);
        providerAll.selectPr(makePr(), 'org');
        const rootAll = await providerAll.getChildren();
        expect((rootAll[0] as PrFolderItem).checkboxState).toBe(vscode.TreeItemCheckboxState.Checked);

        const storePartial = makeMockStore(['/src/a.ts']);
        const providerPartial = new PrChangesProvider({} as any, storePartial as any);
        providerPartial.selectPr(makePr(), 'org');
        const rootPartial = await providerPartial.getChildren();
        expect((rootPartial[0] as PrFolderItem).checkboxState).toBe(vscode.TreeItemCheckboxState.Unchecked);
    });

    it('advanceIteration is called on first load (no stored iteration)', async () => {
        api.getPrChanges.mockResolvedValue([makeChange('/src/app.ts')]);

        // Simulate no prior entry: getStoredIterationId returns undefined
        const store = makeMockStore([]);
        store.getStoredIterationId.mockReturnValue(undefined);
        const provider = new PrChangesProvider({} as any, store as any);
        provider.selectPr(makePr(), 'org');
        await provider.getChildren();

        expect(store.advanceIteration).toHaveBeenCalledWith(42, 1, []);
    });

    it('hides reviewed files when hideReviewedFiles is true', async () => {
        api.getPrChanges.mockResolvedValue([
            makeChange('/src/a.ts'),
            makeChange('/src/b.ts'),
        ]);
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn().mockImplementation((key: string, def: unknown) =>
                key === 'hideReviewedFiles' ? true : def
            ),
        });

        const store = makeMockStore(['/src/a.ts']);
        const provider = new PrChangesProvider({} as any, store as any);
        provider.selectPr(makePr(), 'org');
        const root = await provider.getChildren();

        // Only b.ts should appear
        const folder = root[0] as PrFolderItem;
        const children = await provider.getChildren(folder);
        expect(children).toHaveLength(1);
        expect((children[0] as PrFileItem).change.item.path).toBe('/src/b.ts');

        // Reset mock
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn().mockImplementation((_key: string, def?: unknown) => def),
        });
    });

    describe('PR change navigation', () => {
        beforeEach(() => {
            api.getPrIterations.mockReset();
            api.getPrThreads.mockReset();
            api.getPrChanges.mockReset();
            setupIterations();
            api.getPrThreads.mockResolvedValue([]);
        });

        it('moves through files in the rendered PR Changes tree order', async () => {
            api.getPrChanges.mockResolvedValue([
                makeChange('/src/z-folder/z.ts'),
                makeChange('/src/a-folder/a.ts'),
                makeChange('/src/root.ts'),
            ]);

            const provider = new PrChangesProvider({} as any);
            provider.selectPr(makePr(), 'org');

            const next = await provider.getAdjacentFile('/src/a-folder/a.ts', 'next');
            const previous = await provider.getAdjacentFile('/src/root.ts', 'previous');

            expect(next?.change.item.path).toBe('/src/z-folder/z.ts');
            expect(previous?.change.item.path).toBe('/src/z-folder/z.ts');
            expect(api.getPrIterations).toHaveBeenCalledTimes(1);
            expect(api.getPrChanges).toHaveBeenCalledTimes(1);
            expect(api.getPrThreads).toHaveBeenCalledTimes(1);
        });

        it('skips reviewed files when they are hidden', async () => {
            api.getPrChanges.mockResolvedValue([
                makeChange('/src/a.ts'),
                makeChange('/src/b.ts'),
                makeChange('/src/c.ts'),
            ]);
            (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
                get: jest.fn().mockImplementation((key: string, def: unknown) =>
                    key === 'hideReviewedFiles' ? true : def
                ),
            });

            const provider = new PrChangesProvider({} as any, makeMockStore(['/src/b.ts']) as any);
            provider.selectPr(makePr(), 'org');

            const next = await provider.getAdjacentFile('/src/a.ts', 'next');
            const previous = await provider.getAdjacentFile('/src/c.ts', 'previous');

            expect(next?.change.item.path).toBe('/src/c.ts');
            expect(previous?.change.item.path).toBe('/src/a.ts');

            (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
                get: jest.fn().mockImplementation((_key: string, def?: unknown) => def),
            });
        });

        it('navigates forward from a newly hidden active file', async () => {
            api.getPrChanges.mockResolvedValue([
                makeChange('/src/a.ts'),
                makeChange('/src/b.ts'),
                makeChange('/src/c.ts'),
            ]);
            (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
                get: jest.fn().mockImplementation((key: string, def: unknown) =>
                    key === 'hideReviewedFiles' ? true : def
                ),
            });

            const provider = new PrChangesProvider({} as any, makeMockStore(['/src/b.ts']) as any);
            provider.selectPr(makePr(), 'org');

            const next = await provider.getAdjacentFile('/src/b.ts', 'next');

            expect(next?.change.item.path).toBe('/src/c.ts');

            (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
                get: jest.fn().mockImplementation((_key: string, def?: unknown) => def),
            });
        });
    });
});
