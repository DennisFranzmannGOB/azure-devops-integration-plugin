import * as vscode from 'vscode';
import { PullRequestTreeProvider } from '../prSidebar';
import { EnrichedPullRequest, MyPullRequests } from '../api';

jest.mock('vscode');

jest.mock('../git', () => ({
    getCurrentBranch: jest.fn(),
    getRemoteUrl: jest.fn(),
}));

const { getCurrentBranch, getRemoteUrl } = require('../git') as {
    getCurrentBranch: jest.Mock;
    getRemoteUrl: jest.Mock;
};

function makePr(id: number, branch: string, repoId: string, repoName: string): EnrichedPullRequest {
    return {
        pullRequestId: id,
        title: `PR ${id}`,
        sourceRefName: `refs/heads/${branch}`,
        createdBy: { displayName: 'User', id: 'user1' },
        reviewers: [],
        repository: { id: repoId, name: repoName, project: { id: 'proj1', name: 'proj' } },
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

function makeFetchResult(overrides: Partial<MyPullRequests> = {}): { org: string; result: MyPullRequests } {
    return {
        org: 'org',
        result: {
            createdByMe: [],
            assignedToMe: [],
            assignedToMyTeams: [],
            ...overrides,
        },
    };
}

describe('PullRequestTreeProvider current-branch auto-detection', () => {
    let provider: PullRequestTreeProvider;
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        provider = new PullRequestTreeProvider({} as any);
        provider.cachedOrg = 'org';
        fetchSpy = jest.spyOn(provider as any, 'fetchPullRequests');
        getCurrentBranch.mockResolvedValue('feature/current-work');
        getRemoteUrl.mockResolvedValue('https://dev.azure.com/org/proj/_git/repo1');

        const getConfigMock = vscode.workspace.getConfiguration as jest.Mock;
        getConfigMock.mockReturnValue({
            get: jest.fn().mockImplementation((_key: string, defaultValue?: unknown) => defaultValue),
        });
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    it('emits the PR from the current repository when multiple repos share the branch name', async () => {
        fetchSpy.mockResolvedValueOnce(makeFetchResult({
            createdByMe: [makePr(1, 'feature/current-work', 'repo-id-1', 'repo1')],
            assignedToMe: [makePr(2, 'feature/current-work', 'repo-id-2', 'repo2')],
        }));

        const handler = jest.fn();
        provider.onDidDetectCurrentBranchMatch(handler);

        await provider.getChildren();
        await new Promise(process.nextTick);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].pr.pullRequestId).toBe(1);
        expect(handler.mock.calls[0][0].pr.repository?.name).toBe('repo1');
    });

    it('does not emit when the current repo has multiple active PRs from the same branch', async () => {
        fetchSpy.mockResolvedValueOnce(makeFetchResult({
            createdByMe: [
                makePr(1, 'feature/current-work', 'repo-id-1', 'repo1'),
                makePr(2, 'feature/current-work', 'repo-id-1', 'repo1'),
            ],
        }));

        const handler = jest.fn();
        provider.onDidDetectCurrentBranchMatch(handler);

        await provider.getChildren();
        await new Promise(process.nextTick);

        expect(handler).not.toHaveBeenCalled();
    });
});