import * as vscode from 'vscode';
import { getToken } from '../auth';
import { getOrganization } from '../config';
import { EnrichedPullRequest, getMyPullRequests, getUserId, MyPullRequests, PrThreadSummary } from '../api';
import { PullRequestTreeProvider } from '../prSidebar';

jest.mock('../auth', () => ({
    getToken: jest.fn(),
}));

jest.mock('../config', () => ({
    getOrganization: jest.fn(),
    parseRemoteUrl: jest.fn(),
}));

jest.mock('../api', () => ({
    getMyPullRequests: jest.fn(),
    getUserId: jest.fn(),
}));

function makePullRequest(latestCommentId: number): EnrichedPullRequest {
    const thread: PrThreadSummary = {
        threadId: 10,
        status: 'active',
        latestCommentId,
    };

    return {
        pullRequestId: 1,
        title: 'My pull request',
        sourceRefName: 'refs/heads/feature/polling',
        createdBy: { displayName: 'Author', id: 'author-id' },
        reviewers: [],
        repository: {
            id: 'repo-id',
            name: 'repo',
            project: { id: 'project-id', name: 'project' },
        },
        status: 'active',
        isDraft: false,
        url: '',
        unresolvedCommentCount: 1,
        commentThreads: [thread],
        checksStatus: 'none',
        checks: [],
        workItems: [],
    };
}

function makePullRequestResult(latestCommentId: number): MyPullRequests {
    return {
        createdByMe: [makePullRequest(latestCommentId)],
        assignedToMe: [],
        assignedToMyTeams: [],
    };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('PullRequestTreeProvider.pollForNewComments', () => {
    const getTokenMock = getToken as jest.MockedFunction<typeof getToken>;
    const getOrganizationMock = getOrganization as jest.MockedFunction<typeof getOrganization>;
    const getUserIdMock = getUserId as jest.MockedFunction<typeof getUserId>;
    const getMyPullRequestsMock = getMyPullRequests as jest.MockedFunction<typeof getMyPullRequests>;

    beforeEach(() => {
        jest.clearAllMocks();
        getTokenMock.mockResolvedValue('token');
        getOrganizationMock.mockResolvedValue('org');
        getUserIdMock.mockResolvedValue('user-id');
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn().mockImplementation((_key: string, defaultValue?: unknown) => defaultValue),
        });
        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
    });

    it('shares an in-flight poll instead of starting a second Azure DevOps refresh', async () => {
        const provider = new PullRequestTreeProvider({} as vscode.SecretStorage);
        const inFlightResult = deferred<MyPullRequests>();
        getMyPullRequestsMock.mockImplementation(() => inFlightResult.promise);

        const firstPoll = provider.pollForNewComments();
        const secondPoll = provider.pollForNewComments();
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(getMyPullRequestsMock).toHaveBeenCalledTimes(1);

        inFlightResult.resolve(makePullRequestResult(102));
        await Promise.all([firstPoll, secondPoll]);

        expect(provider.getPullRequestById(1)?.commentThreads[0].latestCommentId).toBe(102);
    });

    it('shares the startup poll with the initial sidebar load', async () => {
        const provider = new PullRequestTreeProvider({} as vscode.SecretStorage);
        const inFlightResult = deferred<MyPullRequests>();
        getMyPullRequestsMock.mockImplementation(() => inFlightResult.promise);

        const startupPoll = provider.pollForNewComments();
        const initialLoad = provider.getChildren();
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(getMyPullRequestsMock).toHaveBeenCalledTimes(1);

        inFlightResult.resolve(makePullRequestResult(102));
        await Promise.all([startupPoll, initialLoad]);
    });
});
