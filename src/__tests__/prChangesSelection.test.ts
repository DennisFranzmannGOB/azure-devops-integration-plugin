import { PrChangesProvider } from '../prChangesProvider';
import { EnrichedPullRequest } from '../api';

jest.mock('../reviewMode', () => ({
    preloadReviewModeRepository: jest.fn().mockResolvedValue([]),
}));

const { preloadReviewModeRepository } = jest.requireMock('../reviewMode') as {
    preloadReviewModeRepository: jest.Mock;
};

function makePr(pullRequestId: number, repoId: string): EnrichedPullRequest {
    return {
        pullRequestId,
        title: `PR ${pullRequestId}`,
        sourceRefName: `refs/heads/feature/${pullRequestId}`,
        createdBy: { displayName: 'User', id: 'user1' },
        reviewers: [],
        repository: { id: repoId, name: 'repo', project: { id: 'proj1', name: 'proj' } },
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

describe('PrChangesProvider selection tracking', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('preloads the matching workspace repository when selecting a PR', () => {
        const provider = new PrChangesProvider({} as any);

        provider.selectPr(makePr(42, 'repo1'), 'org');

        expect(preloadReviewModeRepository).toHaveBeenCalledWith({
            organization: 'org',
            project: 'proj',
            repository: 'repo',
        });
    });

    it('does not report a switch on the first selected PR', () => {
        const provider = new PrChangesProvider({} as any);

        const switched = provider.selectPr(makePr(42, 'repo1'), 'org');

        expect(switched).toBe(false);
        expect(provider.getSelectedPrContext()).toEqual({ org: 'org', repoId: 'repo1', prId: 42 });
    });

    it('does not report a switch when re-selecting the same PR', () => {
        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(42, 'repo1'), 'org');

        const switched = provider.selectPr(makePr(42, 'repo1'), 'org');

        expect(switched).toBe(false);
    });

    it('reports a switch when selecting a different PR', () => {
        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(42, 'repo1'), 'org');

        const switched = provider.selectPr(makePr(99, 'repo1'), 'org');

        expect(switched).toBe(true);
        expect(provider.getSelectedPrContext()).toEqual({ org: 'org', repoId: 'repo1', prId: 99 });
    });

    it('treats same PR id in another repo as a switch', () => {
        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(42, 'repo1'), 'org');

        const switched = provider.selectPr(makePr(42, 'repo2'), 'org');
        expect(switched).toBe(true);
        expect(provider.getSelectedPrContext()).toEqual({ org: 'org', repoId: 'repo2', prId: 42 });
        expect(provider.getSelectedPrContext()).toEqual({ org: 'org', repoId: 'repo2', prId: 42 });
    });
});
