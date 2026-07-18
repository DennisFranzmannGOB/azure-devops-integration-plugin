import { PrChangesProvider } from '../prChangesProvider';
import { EnrichedPullRequest } from '../api';

jest.mock('../prCommentDocProvider', () => ({
    setCommentContent: jest.fn(),
    buildCommentDocUri: jest.fn(),
    clearCommentContent: jest.fn(),
}));

jest.mock('../auth', () => ({
    getToken: jest.fn().mockResolvedValue('token'),
}));

jest.mock('../api', () => ({
    getPrThreads: jest.fn().mockResolvedValue([]),
    getPrIterations: jest.fn(),
    getPrChanges: jest.fn().mockResolvedValue([]),
    addPullRequestComment: jest.fn(),
    replyToThread: jest.fn(),
    updateThreadStatus: jest.fn(),
}));

const api = jest.requireMock('../api') as {
    getPrIterations: jest.Mock;
    getPrChanges: jest.Mock;
    getPrThreads: jest.Mock;
};

function makePr(id = 42): EnrichedPullRequest {
    return {
        pullRequestId: id,
        title: `PR ${id}`,
        sourceRefName: 'refs/heads/feature/test',
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

describe('PrChangesProvider.onIterationResolved', () => {
    beforeEach(() => {
        api.getPrIterations.mockReset();
        api.getPrChanges.mockReset();
        api.getPrThreads.mockResolvedValue([]);
    });

    it('fires with the latest iteration id after getChildren() resolves', async () => {
        api.getPrIterations.mockResolvedValue([
            { id: 1, sourceRefCommit: { commitId: 'src1' }, targetRefCommit: { commitId: 'tgt1' } },
            { id: 3, sourceRefCommit: { commitId: 'src3' }, targetRefCommit: { commitId: 'tgt3' } },
        ]);
        api.getPrChanges.mockResolvedValue([]);

        const provider = new PrChangesProvider({} as any);
        const emitted: Array<number | undefined> = [];
        provider.onIterationResolved(id => emitted.push(id));

        provider.selectPr(makePr(), 'org');
        await provider.getChildren(); // triggers getRootItems()

        expect(emitted).toEqual([3]);
    });

    it('fires with undefined when clear() is called', async () => {
        const provider = new PrChangesProvider({} as any);
        const emitted: Array<number | undefined> = [];
        provider.onIterationResolved(id => emitted.push(id));

        provider.clear();

        expect(emitted).toEqual([undefined]);
    });

    it('fires with undefined when clear() is called after a PR was selected', async () => {
        api.getPrIterations.mockResolvedValue([
            { id: 2, sourceRefCommit: { commitId: 'src2' }, targetRefCommit: { commitId: 'tgt2' } },
        ]);
        api.getPrChanges.mockResolvedValue([]);

        const provider = new PrChangesProvider({} as any);
        const emitted: Array<number | undefined> = [];
        provider.onIterationResolved(id => emitted.push(id));

        provider.selectPr(makePr(), 'org');
        await provider.getChildren();
        provider.clear();

        expect(emitted).toEqual([2, undefined]);
    });

    it('fires with the highest iteration id when multiple iterations exist', async () => {
        api.getPrIterations.mockResolvedValue([
            { id: 1, sourceRefCommit: { commitId: 'a' }, targetRefCommit: { commitId: 'b' } },
            { id: 2, sourceRefCommit: { commitId: 'c' }, targetRefCommit: { commitId: 'd' } },
            { id: 5, sourceRefCommit: { commitId: 'e' }, targetRefCommit: { commitId: 'f' } },
        ]);
        api.getPrChanges.mockResolvedValue([]);

        const provider = new PrChangesProvider({} as any);
        const emitted: Array<number | undefined> = [];
        provider.onIterationResolved(id => emitted.push(id));

        provider.selectPr(makePr(), 'org');
        await provider.getChildren();

        expect(emitted).toEqual([5]);
    });

    it('discards an iteration result that finishes after another PR is selected', async () => {
        let resolveIterations: (value: Array<{ id: number; sourceRefCommit: { commitId: string }; targetRefCommit: { commitId: string } }>) => void;
        const iterations = new Promise<Array<{ id: number; sourceRefCommit: { commitId: string }; targetRefCommit: { commitId: string } }>>((resolve) => {
            resolveIterations = resolve;
        });
        api.getPrIterations.mockReturnValue(iterations);
        api.getPrChanges.mockResolvedValue([]);

        const provider = new PrChangesProvider({} as any);
        const emitted: Array<number | undefined> = [];
        provider.onIterationResolved(id => emitted.push(id));

        provider.selectPr(makePr(1), 'org');
        const pendingItems = provider.getChildren();
        await Promise.resolve();

        provider.selectPr(makePr(2), 'org');
        resolveIterations!([
            { id: 1, sourceRefCommit: { commitId: 'source-1' }, targetRefCommit: { commitId: 'target-1' } },
        ]);

        await expect(pendingItems).resolves.toEqual([]);
        expect(emitted).toEqual([]);
    });

    it('discards an iteration result that finishes after a refresh', async () => {
        let resolveIterations: (value: Array<{ id: number; sourceRefCommit: { commitId: string }; targetRefCommit: { commitId: string } }>) => void;
        const iterations = new Promise<Array<{ id: number; sourceRefCommit: { commitId: string }; targetRefCommit: { commitId: string } }>>((resolve) => {
            resolveIterations = resolve;
        });
        api.getPrIterations.mockReturnValue(iterations);
        api.getPrChanges.mockResolvedValue([]);

        const provider = new PrChangesProvider({} as any);
        const emitted: Array<number | undefined> = [];
        provider.onIterationResolved(id => emitted.push(id));

        provider.selectPr(makePr(1), 'org');
        const pendingItems = provider.getChildren();
        await Promise.resolve();

        provider.refresh();
        resolveIterations!([
            { id: 1, sourceRefCommit: { commitId: 'source-1' }, targetRefCommit: { commitId: 'target-1' } },
        ]);

        await expect(pendingItems).resolves.toEqual([]);
        expect(emitted).toEqual([]);
    });

    it('fetches threads tracked to the latest iteration', async () => {
        api.getPrIterations.mockResolvedValue([
            { id: 1, sourceRefCommit: { commitId: 'src1' }, targetRefCommit: { commitId: 'tgt1' } },
            { id: 4, sourceRefCommit: { commitId: 'src4' }, targetRefCommit: { commitId: 'tgt4' } },
        ]);
        api.getPrChanges.mockResolvedValue([]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        await provider.getChildren();

        expect(api.getPrThreads).toHaveBeenCalledWith('org', 'proj', 'repo1', 42, 'token', 4, 4);
    });
});
