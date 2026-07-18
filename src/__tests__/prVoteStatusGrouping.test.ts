import * as vscode from 'vscode';
import {
    PullRequestItem,
    getMyVoteStatus,
    getCreatorPrStatus,
} from '../prSidebar';
import { EnrichedPullRequest } from '../api';

function makePr(overrides: Partial<EnrichedPullRequest> = {}): EnrichedPullRequest {
    return {
        pullRequestId: 1,
        title: 'Test PR',
        sourceRefName: 'refs/heads/feature',
        createdBy: { displayName: 'User', id: 'user1' },
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
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// getMyVoteStatus
// ---------------------------------------------------------------------------
describe('getMyVoteStatus', () => {
    const userId = 'user1';

    it('returns declined when hasDeclined is true (regardless of vote)', () => {
        const pr = makePr({ reviewers: [{ displayName: 'User', id: userId, vote: 0, hasDeclined: true }] });
        expect(getMyVoteStatus(pr, userId)).toBe('declined');
    });

    it('returns needs-review when user is not a reviewer', () => {
        const pr = makePr({ reviewers: [] });
        expect(getMyVoteStatus(pr, userId)).toBe('needs-review');
    });

    it('returns needs-review when vote is 0', () => {
        const pr = makePr({ reviewers: [{ displayName: 'User', id: userId, vote: 0 }] });
        expect(getMyVoteStatus(pr, userId)).toBe('needs-review');
    });

    it('returns rejected when vote is -10', () => {
        const pr = makePr({ reviewers: [{ displayName: 'User', id: userId, vote: -10 }] });
        expect(getMyVoteStatus(pr, userId)).toBe('rejected');
    });

    it('returns waiting-for-author when vote is -5', () => {
        const pr = makePr({ reviewers: [{ displayName: 'User', id: userId, vote: -5 }] });
        expect(getMyVoteStatus(pr, userId)).toBe('waiting-for-author');
    });

    it('returns approved-suggestions when vote is 5', () => {
        const pr = makePr({ reviewers: [{ displayName: 'User', id: userId, vote: 5 }] });
        expect(getMyVoteStatus(pr, userId)).toBe('approved-suggestions');
    });

    it('returns approved when vote is 10', () => {
        const pr = makePr({ reviewers: [{ displayName: 'User', id: userId, vote: 10 }] });
        expect(getMyVoteStatus(pr, userId)).toBe('approved');
    });

    it('ignores votes from other users', () => {
        const pr = makePr({
            reviewers: [
                { displayName: 'Other', id: 'other', vote: -10 },
                { displayName: 'User', id: userId, vote: 0 },
            ],
        });
        expect(getMyVoteStatus(pr, userId)).toBe('needs-review');
    });
});

// ---------------------------------------------------------------------------
// getCreatorPrStatus
// ---------------------------------------------------------------------------
describe('getCreatorPrStatus', () => {
    it('returns waiting-for-review when there are no reviewers', () => {
        const pr = makePr({ reviewers: [] });
        expect(getCreatorPrStatus(pr)).toBe('waiting-for-review');
    });

    it('returns waiting-for-review when all votes are 0', () => {
        const pr = makePr({
            reviewers: [
                { displayName: 'A', id: 'a', vote: 0 },
                { displayName: 'B', id: 'b', vote: 0 },
            ],
        });
        expect(getCreatorPrStatus(pr)).toBe('waiting-for-review');
    });

    it('returns rejected when any reviewer voted -10', () => {
        const pr = makePr({
            reviewers: [
                { displayName: 'A', id: 'a', vote: 10 },
                { displayName: 'B', id: 'b', vote: -10 },
            ],
        });
        expect(getCreatorPrStatus(pr)).toBe('rejected');
    });

    it('returns changes-requested when any reviewer voted -5', () => {
        const pr = makePr({
            reviewers: [
                { displayName: 'A', id: 'a', vote: 10 },
                { displayName: 'B', id: 'b', vote: -5 },
            ],
        });
        expect(getCreatorPrStatus(pr)).toBe('changes-requested');
    });

    it('prefers rejected over changes-requested', () => {
        const pr = makePr({
            reviewers: [
                { displayName: 'A', id: 'a', vote: -10 },
                { displayName: 'B', id: 'b', vote: -5 },
            ],
        });
        expect(getCreatorPrStatus(pr)).toBe('rejected');
    });

    it('returns approved when all reviewers have vote >= 5', () => {
        const pr = makePr({
            reviewers: [
                { displayName: 'A', id: 'a', vote: 10 },
                { displayName: 'B', id: 'b', vote: 5 },
            ],
        });
        expect(getCreatorPrStatus(pr)).toBe('approved');
    });

    it('returns waiting-for-review when some reviewers have not voted', () => {
        const pr = makePr({
            reviewers: [
                { displayName: 'A', id: 'a', vote: 10 },
                { displayName: 'B', id: 'b', vote: 0 },
            ],
        });
        expect(getCreatorPrStatus(pr)).toBe('waiting-for-review');
    });
});

// ---------------------------------------------------------------------------
// fromCategory with vote-status sub-groups (reviewer perspective)
// ---------------------------------------------------------------------------
describe('fromCategory — reviewer vote-status sub-groups', () => {
    const userId = 'user1';

    function makeItem(vote: number, prId = 1): PullRequestItem {
        const pr = makePr({
            pullRequestId: prId,
            reviewers: [{ displayName: 'User', id: userId, vote }],
        });
        return PullRequestItem.fromPullRequest(pr, 'org');
    }

    it('places hasDeclined PRs in the Declined group', () => {
        const pr = makePr({ pullRequestId: 10, reviewers: [{ displayName: 'User', id: userId, vote: 0, hasDeclined: true }] });
        const item = PullRequestItem.fromPullRequest(pr, 'org');
        const category = PullRequestItem.fromCategory('Assigned to me', [item], userId, false);
        expect(category.children).toHaveLength(1);
        expect(category.children![0].label).toBe('Declined (1)');
    });

    it('creates a sub-group for each non-empty vote status', () => {
        const items = [
            makeItem(0, 1),
            makeItem(-10, 2),
            makeItem(10, 3),
        ];
        const category = PullRequestItem.fromCategory('Assigned to me', items, userId, false);

        // Category label includes total count
        expect(category.label).toBe('Assigned to me (3)');

        // Three non-empty status groups
        expect(category.children).toHaveLength(3);
    });

    it('orders groups: rejected → needs-review → waiting-for-author → approved-suggestions → approved', () => {
        const items = [
            makeItem(10, 1),   // approved
            makeItem(-5, 2),   // waiting-for-author
            makeItem(-10, 3),  // rejected
            makeItem(0, 4),    // needs-review
            makeItem(5, 5),    // approved-suggestions
        ];
        const category = PullRequestItem.fromCategory('Assigned to me', items, userId, false);
        const labels = category.children!.map((c) => (c.label as string).split(' (')[0]);
        expect(labels).toEqual([
            'Rejected',
            'Needs Review',
            'Waiting for Author',
            'Approved with Suggestions',
            'Approved',
        ]);
    });

    it('hides empty status groups', () => {
        const items = [makeItem(0, 1), makeItem(0, 2)]; // both needs-review
        const category = PullRequestItem.fromCategory('Assigned to me', items, userId, false);
        expect(category.children).toHaveLength(1);
        expect(category.children![0].label).toBe('Needs Review (2)');
    });

    it('each group label shows item count', () => {
        const items = [makeItem(0, 1), makeItem(0, 2), makeItem(-10, 3)];
        const category = PullRequestItem.fromCategory('Assigned to me', items, userId, false);
        const needsReview = category.children!.find(
            (c) => (c.label as string).startsWith('Needs Review')
        );
        expect(needsReview?.label).toBe('Needs Review (2)');
    });

    it('sets contextValue to voteStatusGroup on sub-group nodes', () => {
        const items = [makeItem(0, 1)];
        const category = PullRequestItem.fromCategory('Assigned to me', items, userId, false);
        expect(category.children![0].contextValue).toBe('voteStatusGroup');
    });

    it('falls back to repo-only grouping when userId is undefined', () => {
        const items = [makeItem(0, 1), makeItem(-10, 2)];
        const category = PullRequestItem.fromCategory('Assigned to me', items, undefined, false);
        // Without userId, children are the PR items directly (single repo)
        expect(category.children).toHaveLength(2);
        expect(category.children![0].contextValue).toBe('pullRequest');
    });
});

// ---------------------------------------------------------------------------
// fromCategory with vote-status sub-groups (creator perspective)
// ---------------------------------------------------------------------------
describe('fromCategory — creator vote-status sub-groups', () => {
    const userId = 'author1';

    function makeCreatorItem(reviewerVotes: number[], prId = 1): PullRequestItem {
        const pr = makePr({
            pullRequestId: prId,
            reviewers: reviewerVotes.map((vote, i) => ({
                displayName: `Reviewer ${i}`,
                id: `reviewer${i}`,
                vote,
            })),
        });
        return PullRequestItem.fromPullRequest(pr, 'org');
    }

    it('groups creator PRs by aggregate reviewer consensus', () => {
        const items = [
            makeCreatorItem([10, 10], 1),   // approved
            makeCreatorItem([-5], 2),        // changes-requested
            makeCreatorItem([0], 3),         // waiting-for-review
            makeCreatorItem([-10], 4),       // rejected
        ];
        const category = PullRequestItem.fromCategory('Created by me', items, userId, true);
        const labels = category.children!.map((c) => (c.label as string).split(' (')[0]);
        expect(labels).toEqual([
            'Rejected',
            'Changes Requested',
            'Waiting for Review',
            'Approved',
        ]);
    });

    it('hides empty creator status groups', () => {
        const items = [makeCreatorItem([10, 10], 1)]; // only approved
        const category = PullRequestItem.fromCategory('Created by me', items, userId, true);
        expect(category.children).toHaveLength(1);
        expect(category.children![0].label).toBe('Approved (1)');
    });
});

// ---------------------------------------------------------------------------
// Repo sub-grouping is preserved inside vote-status groups
// ---------------------------------------------------------------------------
describe('fromCategory — repo sub-grouping inside vote-status groups', () => {
    const userId = 'user1';

    function makeItemForRepo(repoName: string, vote: number, prId: number, repoId = repoName): PullRequestItem {
        const pr = makePr({
            pullRequestId: prId,
            repository: { id: repoId, name: repoName, project: { id: 'proj1', name: 'proj' } },
            reviewers: [{ displayName: 'User', id: userId, vote }],
        });
        return PullRequestItem.fromPullRequest(pr, 'org');
    }

    it('adds repo sub-groups when a status group spans multiple repos', () => {
        const items = [
            makeItemForRepo('RepoA', 0, 1),
            makeItemForRepo('RepoB', 0, 2),
            makeItemForRepo('RepoA', 0, 3),
        ];
        const category = PullRequestItem.fromCategory('Assigned to me', items, userId, false);

        // Single status group (all needs-review)
        expect(category.children).toHaveLength(1);
        const statusGroup = category.children![0];
        expect(statusGroup.label).toBe('Needs Review (3)');

        // Two repo sub-groups inside
        expect(statusGroup.children).toHaveLength(2);
        const repoLabels = statusGroup.children!.map((c) => c.label as string).sort();
        expect(repoLabels).toEqual(['RepoA (2)', 'RepoB (1)']);
    });

    it('keeps repositories with the same name but different IDs in separate groups', () => {
        const items = [
            makeItemForRepo('Shared repo', 0, 1, 'repo-id-one'),
            makeItemForRepo('Shared repo', 0, 2, 'repo-id-two'),
        ];
        const category = PullRequestItem.fromCategory('Assigned to me', items, userId, false);
        const statusGroup = category.children![0];

        expect(statusGroup.children).toHaveLength(2);
        expect(statusGroup.children!.every((child) => child.contextValue !== 'pullRequest')).toBe(true);
    });

    it('does not add repo sub-group when all PRs in a status group are from one repo', () => {
        const items = [
            makeItemForRepo('RepoA', 0, 1),
            makeItemForRepo('RepoA', 0, 2),
        ];
        const category = PullRequestItem.fromCategory('Assigned to me', items, userId, false);
        const statusGroup = category.children![0];
        // Children should be PR items directly, not repo groups
        expect(statusGroup.children![0].contextValue).toBe('pullRequest');
    });
});
