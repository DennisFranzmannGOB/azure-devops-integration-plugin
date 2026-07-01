import * as vscode from 'vscode';
import { EnrichedPullRequest } from '../api';

jest.mock('../auth', () => ({
    getToken: jest.fn().mockResolvedValue('token'),
    getAuthenticationRequiredMessage: jest.fn().mockReturnValue('Authentication required'),
}));

jest.mock('../api', () => ({
    updateReviewerVote: jest.fn(),
    completePullRequest: jest.fn(),
    abandonPullRequest: jest.fn(),
    addPullRequestComment: jest.fn(),
    getPullRequestDetails: jest.fn(),
    searchIdentitiesByDisplayName: jest.fn(),
    updatePullRequestTitle: jest.fn(),
}));

jest.mock('../prLinks', () => ({
    buildPullRequestUrl: jest.fn().mockReturnValue('https://example.com'),
}));

const api = jest.requireMock('../api') as {
    addPullRequestComment: jest.Mock;
    searchIdentitiesByDisplayName: jest.Mock;
};

function makePr(overrides: Partial<EnrichedPullRequest> = {}): EnrichedPullRequest {
    return {
        pullRequestId: 42,
        title: 'Example PR',
        description: 'Current description',
        sourceRefName: 'refs/heads/feature/branch',
        createdBy: { displayName: 'User', id: 'user1' },
        reviewers: [],
        repository: {
            id: 'repo1',
            name: 'repo',
            project: { id: 'proj1', name: 'proj' },
        },
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

function makeItem(pr: EnrichedPullRequest, org = 'org') {
    return { pr, org } as any;
}

function makeProvider() {
    return {
        secretStorage: {},
        cachedUserId: 'user1',
        refresh: jest.fn(),
    } as any;
}

describe('addCommentPr command mention handling', () => {
    let registerPrActions: typeof import('../commands/prActions').registerPrActions;

    beforeAll(() => {
        ({ registerPrActions } = require('../commands/prActions'));
    });

    beforeEach(() => {
        api.addPullRequestComment.mockReset();
        api.addPullRequestComment.mockResolvedValue(undefined);
        api.searchIdentitiesByDisplayName.mockReset();
        api.searchIdentitiesByDisplayName.mockResolvedValue([]);
        (vscode.window.showInputBox as jest.Mock).mockReset();
        (vscode.window.showErrorMessage as jest.Mock).mockReset();
        (vscode.window.showInformationMessage as jest.Mock).mockReset();
    });

    function getAddCommentHandler(provider: any) {
        (vscode.commands.registerCommand as jest.Mock).mockClear();
        const context = { subscriptions: { push: jest.fn() } } as any;
        registerPrActions(context, provider);
        const registerCalls = (vscode.commands.registerCommand as jest.Mock).mock.calls;
        return registerCalls.find(([cmd]: [string]) => cmd === 'azureDevops.addCommentPr')![1];
    }

    it('rewrites a leading mention before posting the comment', async () => {
        api.searchIdentitiesByDisplayName.mockResolvedValue([
            { id: 'user-1', displayName: 'Dennis Mike' },
        ]);
        (vscode.window.showInputBox as jest.Mock).mockResolvedValue('@Dennis Mike: das ist ein Test');

        const provider = makeProvider();
        const handler = getAddCommentHandler(provider);

        await handler(makeItem(makePr()));

        expect(api.searchIdentitiesByDisplayName).toHaveBeenCalledWith('org', 'Dennis Mike', 'token');
        expect(api.addPullRequestComment).toHaveBeenCalledWith(
            'org', 'proj', 'repo1', 42, '@<user-1> Dennis das ist ein Test', 'token'
        );
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Comment added.');
        expect(provider.refresh).toHaveBeenCalled();
    });

    it('shows an error and skips posting when the mention is ambiguous', async () => {
        api.searchIdentitiesByDisplayName.mockResolvedValue([
            { id: 'user-1', displayName: 'Dennis Mike' },
            { id: 'user-2', displayName: 'Dennis Mike' },
        ]);
        (vscode.window.showInputBox as jest.Mock).mockResolvedValue('@Dennis Mike: ping');

        const provider = makeProvider();
        const handler = getAddCommentHandler(provider);

        await handler(makeItem(makePr()));

        expect(api.addPullRequestComment).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            'Failed to add comment: Multiple Azure DevOps users matched "Dennis Mike". Use "@FirstName LastName: your comment".'
        );
    });
});
