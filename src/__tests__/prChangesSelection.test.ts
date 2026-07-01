import { PrChangesProvider } from '../prChangesProvider';
import { EnrichedPullRequest } from '../api';

jest.mock('../prCommentDocProvider', () => ({
    setCommentContent: jest.fn(),
    buildCommentDocUri: jest.fn(),
    clearCommentContent: jest.fn(),
}));

const commentDocs = jest.requireMock('../prCommentDocProvider') as {
    clearCommentContent: jest.Mock;
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
        commentDocs.clearCommentContent.mockReset();
    });

    it('does not report a switch on the first selected PR', () => {
        const provider = new PrChangesProvider({} as any);

        const switched = provider.selectPr(makePr(42, 'repo1'), 'org');

        expect(switched).toBe(false);
        expect(provider.getSelectedPrContext()).toEqual({ org: 'org', repoId: 'repo1', prId: 42 });
        expect(commentDocs.clearCommentContent).not.toHaveBeenCalled();
    });

    it('does not clear comment docs when re-selecting the same PR', () => {
        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(42, 'repo1'), 'org');

        const switched = provider.selectPr(makePr(42, 'repo1'), 'org');

        expect(switched).toBe(false);
        expect(commentDocs.clearCommentContent).not.toHaveBeenCalled();
    });

    it('clears comment docs when switching to a different PR', () => {
        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(42, 'repo1'), 'org');

        const switched = provider.selectPr(makePr(99, 'repo1'), 'org');

        expect(switched).toBe(true);
        expect(provider.getSelectedPrContext()).toEqual({ org: 'org', repoId: 'repo1', prId: 99 });
        expect(commentDocs.clearCommentContent).toHaveBeenCalledTimes(1);
    });

    it('treats same PR id in another repo as a switch', () => {
        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(42, 'repo1'), 'org');

        const switched = provider.selectPr(makePr(42, 'repo2'), 'org');

        expect(switched).toBe(true);
        expect(provider.getSelectedPrContext()).toEqual({ org: 'org', repoId: 'repo2', prId: 42 });
        expect(commentDocs.clearCommentContent).toHaveBeenCalledTimes(1);
    });
});
