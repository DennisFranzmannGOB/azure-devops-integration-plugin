import * as vscode from 'vscode';
import { registerEditorVoteCommands } from '../commands/prActions';

jest.mock('../auth', () => ({
    getToken: jest.fn().mockResolvedValue('token'),
    getAuthenticationRequiredMessage: jest.fn().mockReturnValue('Authentication required'),
}));

jest.mock('../api', () => ({
    updateReviewerVote: jest.fn().mockResolvedValue(undefined),
    completePullRequest: jest.fn(),
    abandonPullRequest: jest.fn(),
    addPullRequestComment: jest.fn(),
    getPullRequestDetails: jest.fn(),
    updatePullRequestTitle: jest.fn(),
}));

jest.mock('../prLinks', () => ({
    buildPullRequestUrl: jest.fn().mockReturnValue('https://example.com'),
}));

jest.mock('../prContentProvider', () => ({
    parsePrFileUri: jest.fn().mockReturnValue(undefined),
    buildPrFileUri: jest.fn(),
}));

const api = jest.requireMock('../api') as { updateReviewerVote: jest.Mock };
const parsePrFileUri = jest.requireMock('../prContentProvider').parsePrFileUri as jest.Mock;

const mockPr = {
    pullRequestId: 42,
    title: 'My PR',
    repository: {
        id: 'repo1',
        name: 'myrepo',
        project: { id: 'p1', name: 'proj' },
    },
};

function buildMockProvider() {
    return {
        secretStorage: {} as vscode.SecretStorage,
        cachedUserId: 'user1',
        getPullRequestById: jest.fn().mockReturnValue(mockPr),
        refresh: jest.fn(),
    };
}

function buildMockContext() {
    const subscriptions: unknown[] = [];
    return { subscriptions, extensionUri: vscode.Uri.parse('file:///ext') } as unknown as vscode.ExtensionContext;
}

describe('registerEditorVoteCommands — review-mode fallback', () => {
    beforeEach(() => {
        api.updateReviewerVote.mockReset();
        api.updateReviewerVote.mockResolvedValue(undefined);
        parsePrFileUri.mockReset();
        parsePrFileUri.mockReturnValue(undefined);
        (vscode.window.showErrorMessage as jest.Mock).mockReset();
        (vscode.window.showInformationMessage as jest.Mock).mockReset();
    });

    it('calls updateReviewerVote with org and prId from getReviewModeFileInfo when parsePrFileUri returns nothing', async () => {
        const realUri = vscode.Uri.parse('file:///repo/src/app.ts');
        (vscode.window as any).activeTextEditor = { document: { uri: realUri } };

        const getReviewModeFileInfo = jest.fn().mockReturnValue({ org: 'myorg', prId: 42 });
        const mockContext = buildMockContext();
        const mockProvider = buildMockProvider();

        registerEditorVoteCommands(mockContext, mockProvider as any, getReviewModeFileInfo);

        // subscriptions[0] is the editorApprovePr callback (vote = 10)
        const approveHandler = mockContext.subscriptions[0] as unknown as () => Promise<void>;
        await approveHandler();

        expect(api.updateReviewerVote).toHaveBeenCalledWith('myorg', 'proj', 'repo1', 42, 'user1', 10, 'token');
    });

    it('passes all three vote commands through review-mode fallback', async () => {
        const realUri = vscode.Uri.parse('file:///repo/src/app.ts');
        (vscode.window as any).activeTextEditor = { document: { uri: realUri } };

        const getReviewModeFileInfo = jest.fn().mockReturnValue({ org: 'myorg', prId: 42 });
        const mockContext = buildMockContext();
        const mockProvider = buildMockProvider();

        registerEditorVoteCommands(mockContext, mockProvider as any, getReviewModeFileInfo);

        // subscriptions: [0]=approve(10), [1]=reject(-10), [2]=waitForAuthor(-5)
        const handlers = mockContext.subscriptions as unknown as Array<() => Promise<void>>;
        await handlers[0](); // approve
        await handlers[1](); // reject
        await handlers[2](); // wait for author

        expect(api.updateReviewerVote).toHaveBeenCalledTimes(3);
        expect(api.updateReviewerVote).toHaveBeenNthCalledWith(1, 'myorg', 'proj', 'repo1', 42, 'user1', 10, 'token');
        expect(api.updateReviewerVote).toHaveBeenNthCalledWith(2, 'myorg', 'proj', 'repo1', 42, 'user1', -10, 'token');
        expect(api.updateReviewerVote).toHaveBeenNthCalledWith(3, 'myorg', 'proj', 'repo1', 42, 'user1', -5, 'token');
    });

    it('uses parsed org/prId when parsePrFileUri succeeds (virtual document)', async () => {
        const virtualUri = vscode.Uri.parse('azuredevops-pr://org/proj/repo1/src123/src/app.ts?prId=42&side=right');
        (vscode.window as any).activeTextEditor = { document: { uri: virtualUri } };

        parsePrFileUri.mockReturnValue({ org: 'parsed-org', project: 'proj', repoId: 'repo1', prId: 42, filePath: '/src/app.ts', side: 'right' });
        const getReviewModeFileInfo = jest.fn();
        const mockContext = buildMockContext();
        const mockProvider = buildMockProvider();

        registerEditorVoteCommands(mockContext, mockProvider as any, getReviewModeFileInfo);

        const approveHandler = mockContext.subscriptions[0] as unknown as () => Promise<void>;
        await approveHandler();

        // getReviewModeFileInfo should NOT have been called since parsePrFileUri succeeded
        expect(getReviewModeFileInfo).not.toHaveBeenCalled();
        expect(api.updateReviewerVote).toHaveBeenCalledWith('parsed-org', 'proj', 'repo1', 42, 'user1', 10, 'token');
    });

    it('shows error when both parsePrFileUri and getReviewModeFileInfo return nothing', async () => {
        const realUri = vscode.Uri.parse('file:///repo/src/unrelated.ts');
        (vscode.window as any).activeTextEditor = { document: { uri: realUri } };

        const getReviewModeFileInfo = jest.fn().mockReturnValue(undefined);
        const mockContext = buildMockContext();
        const mockProvider = buildMockProvider();

        registerEditorVoteCommands(mockContext, mockProvider as any, getReviewModeFileInfo);

        const approveHandler = mockContext.subscriptions[0] as unknown as () => Promise<void>;
        await approveHandler();

        expect(api.updateReviewerVote).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            'No pull request found. Open a PR diff file to use this command.'
        );
    });

    it('shows error when no active editor is open', async () => {
        (vscode.window as any).activeTextEditor = undefined;

        const mockContext = buildMockContext();
        const mockProvider = buildMockProvider();

        registerEditorVoteCommands(mockContext, mockProvider as any);

        const approveHandler = mockContext.subscriptions[0] as unknown as () => Promise<void>;
        await approveHandler();

        expect(api.updateReviewerVote).not.toHaveBeenCalled();
    });

    it('works correctly without the optional getReviewModeFileInfo argument', async () => {
        const realUri = vscode.Uri.parse('file:///repo/src/app.ts');
        (vscode.window as any).activeTextEditor = { document: { uri: realUri } };

        const mockContext = buildMockContext();
        const mockProvider = buildMockProvider();

        // Should not throw, just show error
        registerEditorVoteCommands(mockContext, mockProvider as any);

        const approveHandler = mockContext.subscriptions[0] as unknown as () => Promise<void>;
        await approveHandler();

        expect(api.updateReviewerVote).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            'No pull request found. Open a PR diff file to use this command.'
        );
    });
});
