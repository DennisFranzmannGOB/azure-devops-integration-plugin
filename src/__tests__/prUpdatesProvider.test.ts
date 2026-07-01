import { PrUpdatesProvider, PrIterationItem, PrIterationFileItem } from '../prUpdatesProvider';
import { EnrichedPullRequest, PrChange } from '../api';

jest.mock('../auth', () => ({
    getToken: jest.fn().mockResolvedValue('token'),
}));

jest.mock('../api', () => ({
    getPrIterations: jest.fn(),
    getPrChanges: jest.fn(),
}));

const api = jest.requireMock('../api') as {
    getPrIterations: jest.Mock;
    getPrChanges: jest.Mock;
};

function makePr(id = 1): EnrichedPullRequest {
    return {
        pullRequestId: id,
        title: `PR ${id}`,
        sourceRefName: 'refs/heads/feature/test',
        createdBy: { displayName: 'User', id: 'u1' },
        reviewers: [],
        repository: { id: 'repo1', name: 'myrepo', project: { id: 'proj1', name: 'proj' } },
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

// ─────────────────────────────────────────────────────────────────────────────
// PrIterationItem
// ─────────────────────────────────────────────────────────────────────────────

describe('PrIterationItem', () => {
    it('uses "Iteration {id}" as the label', () => {
        const item = new PrIterationItem(3, 'src3', 'base3');
        expect(item.label).toBe('Iteration 3');
    });

    it('includes author in description when provided', () => {
        const item = new PrIterationItem(1, 's', 'b', undefined, 'Alice');
        expect(item.description).toContain('Alice');
    });

    it('includes formatted date in description when createdDate is provided', () => {
        const item = new PrIterationItem(1, 's', 'b', '2024-06-15T10:00:00Z');
        expect(typeof item.description).toBe('string');
        expect((item.description as string).length).toBeGreaterThan(0);
    });

    it('sets description with both author and date joined by " · "', () => {
        const item = new PrIterationItem(1, 's', 'b', '2024-06-15T10:00:00Z', 'Bob');
        expect(item.description).toContain('Bob');
        expect(item.description).toContain(' · ');
    });

    it('has no description when neither date nor author are provided', () => {
        const item = new PrIterationItem(1, 's', 'b');
        expect(item.description).toBeUndefined();
    });

    it('is collapsible', () => {
        const item = new PrIterationItem(1, 's', 'b');
        expect(item.collapsibleState).toBe(1); // Collapsed
    });

    it('has contextValue "prIteration"', () => {
        const item = new PrIterationItem(2, 's', 'b');
        expect(item.contextValue).toBe('prIteration');
    });

    it('stores sourceCommitId and baseCommitId', () => {
        const item = new PrIterationItem(5, 'srcABC', 'baseXYZ');
        expect(item.sourceCommitId).toBe('srcABC');
        expect(item.baseCommitId).toBe('baseXYZ');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PrIterationFileItem
// ─────────────────────────────────────────────────────────────────────────────

describe('PrIterationFileItem', () => {
    it('uses the filename (last segment) as the label', () => {
        const item = new PrIterationFileItem(makeChange('/src/feature/Foo.ts'), 'org', 'proj', 'repo1', 'l1', 'r1');
        expect(item.label).toBe('Foo.ts');
    });

    it('uses the directory path as description', () => {
        const item = new PrIterationFileItem(makeChange('/src/feature/Foo.ts'), 'org', 'proj', 'repo1', 'l1', 'r1');
        expect(item.description).toBe('/src/feature');
    });

    it('has no description for root-level files', () => {
        const item = new PrIterationFileItem(makeChange('/Root.ts'), 'org', 'proj', 'repo1', 'l1', 'r1');
        expect(item.description).toBeUndefined();
    });

    it('fires azureDevops.openPrIterationDiff when clicked', () => {
        const item = new PrIterationFileItem(makeChange('/Foo.ts'), 'org', 'proj', 'repo1', 'l1', 'r1');
        expect(item.command?.command).toBe('azureDevops.openPrIterationDiff');
        expect(item.command?.arguments?.[0]).toBe(item);
    });

    it('has contextValue "prIterationFile"', () => {
        const item = new PrIterationFileItem(makeChange('/Foo.ts'), 'org', 'proj', 'repo1', 'l1', 'r1');
        expect(item.contextValue).toBe('prIterationFile');
    });

    it('stores left/right commit IDs', () => {
        const item = new PrIterationFileItem(makeChange('/Foo.ts'), 'org', 'proj', 'repo1', 'leftCom', 'rightCom');
        expect(item.leftCommitId).toBe('leftCom');
        expect(item.rightCommitId).toBe('rightCom');
    });

    it.each([
        ['add', 'diff-added'],
        ['delete', 'diff-removed'],
        ['rename', 'diff-renamed'],
        ['edit', 'diff-modified'],
    ])('uses "%s" changeType icon "%s"', (changeType, iconId) => {
        const item = new PrIterationFileItem(makeChange('/Foo.ts', changeType), 'org', 'proj', 'repo1', 'l', 'r');
        expect((item.iconPath as any)?.id).toBe(iconId);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PrUpdatesProvider
// ─────────────────────────────────────────────────────────────────────────────

describe('PrUpdatesProvider — selectPr and clear', () => {
    it('returns empty list before a PR is selected', async () => {
        const provider = new PrUpdatesProvider({} as any);
        const result = await provider.getChildren();
        expect(result).toEqual([]);
    });

    it('returns empty list after clear()', async () => {
        api.getPrIterations.mockResolvedValue([
            { id: 1, sourceRefCommit: { commitId: 's1' }, targetRefCommit: { commitId: 't1' } },
        ]);
        const provider = new PrUpdatesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        provider.clear();
        const result = await provider.getChildren();
        expect(result).toEqual([]);
    });
});

describe('PrUpdatesProvider — getRootItems() — iteration ordering and base commits', () => {
    beforeEach(() => {
        api.getPrIterations.mockReset();
        api.getPrChanges.mockReset();
    });

    it('returns iterations sorted newest-first (highest id first)', async () => {
        api.getPrIterations.mockResolvedValue([
            { id: 1, sourceRefCommit: { commitId: 'src1' }, targetRefCommit: { commitId: 'tgt1' } },
            { id: 2, sourceRefCommit: { commitId: 'src2' }, targetRefCommit: { commitId: 'tgt2' } },
            { id: 3, sourceRefCommit: { commitId: 'src3' }, targetRefCommit: { commitId: 'tgt3' } },
        ]);
        const provider = new PrUpdatesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const items = await provider.getChildren() as PrIterationItem[];
        expect(items.map(i => i.iterationId)).toEqual([3, 2, 1]);
    });

    it('for iteration 1 uses targetRefCommit as base (merge base)', async () => {
        api.getPrIterations.mockResolvedValue([
            { id: 1, sourceRefCommit: { commitId: 'src1' }, targetRefCommit: { commitId: 'mergeBase' } },
        ]);
        const provider = new PrUpdatesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const items = await provider.getChildren() as PrIterationItem[];
        expect(items[0].baseCommitId).toBe('mergeBase');
        expect(items[0].sourceCommitId).toBe('src1');
    });

    it('for iteration N uses previous iteration sourceCommit as base', async () => {
        api.getPrIterations.mockResolvedValue([
            { id: 1, sourceRefCommit: { commitId: 'src1' }, targetRefCommit: { commitId: 'base' } },
            { id: 2, sourceRefCommit: { commitId: 'src2' }, targetRefCommit: { commitId: 'tgt2' } },
        ]);
        const provider = new PrUpdatesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const items = await provider.getChildren() as PrIterationItem[];
        // Newest first: [iter2, iter1]
        const iter2 = items.find(i => i.iterationId === 2)!;
        expect(iter2.baseCommitId).toBe('src1'); // previous iteration's source commit
    });

    it('returns empty list when API returns no iterations', async () => {
        api.getPrIterations.mockResolvedValue([]);
        const provider = new PrUpdatesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const items = await provider.getChildren();
        expect(items).toEqual([]);
    });
});

describe('PrUpdatesProvider — getIterationFiles()', () => {
    beforeEach(() => {
        api.getPrIterations.mockReset();
        api.getPrChanges.mockReset();
    });

    it('calls getPrChanges with compareToIterationId = iterationId - 1', async () => {
        api.getPrIterations.mockResolvedValue([
            { id: 1, sourceRefCommit: { commitId: 's1' }, targetRefCommit: { commitId: 't1' } },
            { id: 3, sourceRefCommit: { commitId: 's3' }, targetRefCommit: { commitId: 't3' } },
        ]);
        api.getPrChanges.mockResolvedValue([makeChange('/Foo.ts')]);

        const provider = new PrUpdatesProvider({} as any);
        provider.selectPr(makePr(42), 'myOrg');
        const iterItems = await provider.getChildren() as PrIterationItem[];

        // Expand iteration 3
        const iter3 = iterItems.find(i => i.iterationId === 3)!;
        await provider.getChildren(iter3);

        expect(api.getPrChanges).toHaveBeenCalledWith(
            'myOrg', 'proj', 'repo1', 42, 3, 'token', 2  // compareToIterationId = 3 - 1 = 2
        );
    });

    it('calls getPrChanges with compareToIterationId = 0 for iteration 1', async () => {
        api.getPrIterations.mockResolvedValue([
            { id: 1, sourceRefCommit: { commitId: 's1' }, targetRefCommit: { commitId: 't1' } },
        ]);
        api.getPrChanges.mockResolvedValue([]);

        const provider = new PrUpdatesProvider({} as any);
        provider.selectPr(makePr(7), 'org');
        const iterItems = await provider.getChildren() as PrIterationItem[];
        await provider.getChildren(iterItems[0]);

        expect(api.getPrChanges).toHaveBeenCalledWith('org', 'proj', 'repo1', 7, 1, 'token', 0);
    });

    it('returns PrIterationFileItem children with correct commit IDs', async () => {
        api.getPrIterations.mockResolvedValue([
            { id: 1, sourceRefCommit: { commitId: 'srcA' }, targetRefCommit: { commitId: 'baseA' } },
        ]);
        api.getPrChanges.mockResolvedValue([makeChange('/Foo.ts', 'edit'), makeChange('/Bar.ts', 'add')]);

        const provider = new PrUpdatesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const iterItems = await provider.getChildren() as PrIterationItem[];
        const files = await provider.getChildren(iterItems[0]) as PrIterationFileItem[];

        expect(files).toHaveLength(2);
        // All files in this iteration use srcA as right and baseA as left
        for (const f of files) {
            expect(f.rightCommitId).toBe('srcA');
            expect(f.leftCommitId).toBe('baseA');
        }
    });

    it('filters out changes without a path', async () => {
        api.getPrIterations.mockResolvedValue([
            { id: 1, sourceRefCommit: { commitId: 's1' }, targetRefCommit: { commitId: 't1' } },
        ]);
        api.getPrChanges.mockResolvedValue([
            makeChange('/ValidFile.ts'),
            { changeType: 'edit', item: { path: '' } },
        ]);

        const provider = new PrUpdatesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const iterItems = await provider.getChildren() as PrIterationItem[];
        const files = await provider.getChildren(iterItems[0]) as PrIterationFileItem[];

        expect(files).toHaveLength(1);
        expect(files[0].change.item.path).toBe('/ValidFile.ts');
    });
});
