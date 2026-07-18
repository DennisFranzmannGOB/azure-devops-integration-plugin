import * as vscode from 'vscode';
import { activate } from '../extension';
import { EnrichedPullRequest } from '../api';

const mockPrProvider = {
    refresh: jest.fn(),
    setCommentNotificationHandlers: jest.fn(),
    revealPullRequest: jest.fn().mockResolvedValue(undefined),
    replayDetectedCurrentBranchMatch: jest.fn(),
    onDidDetectCurrentBranchMatch: jest.fn(),
};

const mockPrChangesProvider = {
    selectPr: jest.fn(),
    getSelectedPrContext: jest.fn(),
    clear: jest.fn(),
    refresh: jest.fn(),
    openThreadById: jest.fn(),
    openComment: jest.fn(),
    replyToDiscussionThread: jest.fn(),
    changeThreadStatus: jest.fn().mockResolvedValue(undefined),
    addGeneralComment: jest.fn(),
    onIterationResolved: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    resetCurrentPr: jest.fn(),
};

const mockPrCommentController = {
    loadExisting: jest.fn(),
    clearAll: jest.fn(),
    refreshAll: jest.fn(),
    replyToThread: jest.fn(),
    changeStatus: jest.fn(),
    registerReviewModeFile: jest.fn(),
    getReviewModeFileInfo: jest.fn(),
    isReviewModeFile: jest.fn().mockReturnValue(false),
    onDidAddComment: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    dispose: jest.fn(),
};

const mockCheckoutPrBranch = jest.fn();

jest.mock('../prSidebar', () => ({
    registerPrSidebar: jest.fn(() => mockPrProvider),
}));

jest.mock('../commands/prActions', () => ({
    registerPrActions: jest.fn(),
    registerEditorVoteCommands: jest.fn(),
}));

jest.mock('../commands/checkoutBranch', () => ({
    checkoutPrBranch: (...args: unknown[]) => mockCheckoutPrBranch(...args),
}));

jest.mock('../commands/createPr', () => ({ createPullRequest: jest.fn() }));
jest.mock('../commands/openRepo', () => ({ openRepository: jest.fn() }));
jest.mock('../commands/openWorkItem', () => ({ openWorkItem: jest.fn() }));
jest.mock('../auth', () => ({
    configureAuthentication: jest.fn(),
    setToken: jest.fn(),
    removeToken: jest.fn(),
    loginWithAzureAd: jest.fn(),
    logoutFromAzureAd: jest.fn(),
}));
jest.mock('../commands/createTask', () => ({ createTaskForPr: jest.fn() }));
jest.mock('../statusBar', () => ({ createStatusBarItem: jest.fn() }));
jest.mock('../commands/editPrDescription', () => ({ editExistingPrDescription: jest.fn() }));
jest.mock('../prContentProvider', () => ({
    PrContentProvider: jest.fn().mockImplementation(() => ({})),
    buildPrFileUri: jest.fn(() => 'azuredevops-pr://org/proj/repo/commit/path'),
    buildEmptyPrFileUri: jest.fn(() => 'azuredevops-pr://empty/empty'),
}));
jest.mock('../prComments', () => ({
    PrCommentController: jest.fn().mockImplementation(() => mockPrCommentController),
}));
jest.mock('../prCommentDocProvider', () => ({
    PrCommentDocProvider: jest.fn().mockImplementation(() => ({})),
    PR_COMMENT_SCHEME: 'azuredevops-pr-comment',
}));
jest.mock('../prLinks', () => ({ buildPullRequestThreadUrl: jest.fn(() => 'https://example.invalid/pr/thread') }));
jest.mock('../reviewMode', () => ({ tryGetReviewModeUri: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../prChangesProvider', () => {
    const actual = jest.requireActual('../prChangesProvider');
    return {
        ...actual,
        PrChangesProvider: jest.fn().mockImplementation(() => mockPrChangesProvider),
    };
});

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

function getRegisteredCommand(commandId: string): (...args: any[]) => any {
    const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([id]) => id === commandId);
    if (!call) {
        throw new Error(`Command ${commandId} was not registered`);
    }

    return call[1];
}

describe('extension PR switching cleanup', () => {
    let handlers: { openComment: (event: any) => Promise<void> } | undefined;
    let branchMatchHandler: ((item: any) => Promise<void> | void) | undefined;

    beforeEach(() => {
        jest.clearAllMocks();
        handlers = undefined;
        branchMatchHandler = undefined;
        mockPrProvider.setCommentNotificationHandlers.mockImplementation((value) => {
            handlers = value;
        });
        mockPrProvider.onDidDetectCurrentBranchMatch.mockImplementation((value) => {
            branchMatchHandler = value;
            return { dispose: jest.fn() };
        });
        mockPrChangesProvider.selectPr.mockReturnValue(false);
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue(undefined);
        mockCheckoutPrBranch.mockResolvedValue(true);
        mockPrCommentController.isReviewModeFile.mockReturnValue(false);

        (vscode.window as any).createTreeView = jest.fn().mockReturnValue({ title: 'PR Changes', dispose: jest.fn(), onDidChangeCheckboxState: jest.fn().mockReturnValue({ dispose: jest.fn() }) });
        (vscode.window as any).onDidChangeActiveTextEditor = jest.fn().mockReturnValue({ dispose: jest.fn() });
        (vscode.workspace as any).registerTextDocumentContentProvider = jest.fn().mockReturnValue({ dispose: jest.fn() });
        (vscode.workspace as any).registerFileSystemProvider = jest.fn().mockReturnValue({ dispose: jest.fn() });
        (vscode.workspace as any).textDocuments = [];
        (vscode.commands.executeCommand as jest.Mock).mockReset();
        (vscode.commands.registerCommand as jest.Mock).mockClear();

        activate({ secrets: {}, subscriptions: [], workspaceState: { get: jest.fn().mockReturnValue({}), update: jest.fn(), keys: jest.fn().mockReturnValue([]) } } as any);
    });

    it('clears inline comment threads when review switches to another PR', async () => {
        const reviewPrChanges = getRegisteredCommand('azureDevops.reviewPrChanges');
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42 });

        await reviewPrChanges({ pr: makePr(99, 'repo1'), org: 'org' });

        expect(mockPrChangesProvider.selectPr).toHaveBeenCalledWith(expect.objectContaining({ pullRequestId: 99 }), 'org');
        expect(mockPrCommentController.clearAll).toHaveBeenCalledTimes(1);
    });

    it('keeps current inline comments when re-selecting the same PR', async () => {
        const reviewPrChanges = getRegisteredCommand('azureDevops.reviewPrChanges');
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42 });

        await reviewPrChanges({ pr: makePr(42, 'repo1'), org: 'org' });

        expect(mockPrCommentController.clearAll).not.toHaveBeenCalled();
    });

    it('auto-selects the current branch PR when nothing is selected yet', async () => {
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue(undefined);

        await branchMatchHandler!({ pr: makePr(42, 'repo1'), org: 'org' });

        expect(mockPrProvider.revealPullRequest).toHaveBeenCalledWith(
            expect.objectContaining({ pr: expect.objectContaining({ pullRequestId: 42 }), org: 'org' })
        );
        expect(mockPrChangesProvider.selectPr).toHaveBeenCalledWith(
            expect.objectContaining({ pullRequestId: 42 }),
            'org'
        );
    });

    it('does not override a different manually selected PR during branch auto-select', async () => {
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo9', prId: 99 });

        await branchMatchHandler!({ pr: makePr(42, 'repo1'), org: 'org' });

        expect(mockPrProvider.revealPullRequest).not.toHaveBeenCalled();
        expect(mockPrChangesProvider.selectPr).not.toHaveBeenCalled();
    });

    it('clears stale threads before opening a notification comment on another PR', async () => {
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42 });

        await handlers!.openComment({ org: 'org', pr: makePr(77, 'repo1'), thread: { threadId: 123 } });

        expect(mockPrCommentController.clearAll).toHaveBeenCalledTimes(1);
        expect(mockPrChangesProvider.openThreadById).toHaveBeenCalledWith(expect.objectContaining({ pullRequestId: 77 }), 'org', 123);
        expect(mockPrCommentController.clearAll.mock.invocationCallOrder[0]).toBeLessThan(
            mockPrChangesProvider.openThreadById.mock.invocationCallOrder[0]
        );
    });

    it('reloads inline comments after opening a file-backed discussion from the tree', async () => {
        const openDiscussionComment = getRegisteredCommand('azureDevops.openDiscussionComment');
        const item = { thread: { id: 123 } };

        await openDiscussionComment(item);

        expect(mockPrChangesProvider.openComment).toHaveBeenCalledWith(item);
        expect(mockPrCommentController.refreshAll).toHaveBeenCalledTimes(1);
        expect(mockPrChangesProvider.openComment.mock.invocationCallOrder[0]).toBeLessThan(
            mockPrCommentController.refreshAll.mock.invocationCallOrder[0]
        );
    });

    it('reloads inline comments after replying from the discussion tree', async () => {
        const replyToDiscussionThread = getRegisteredCommand('azureDevops.replyToDiscussionThread');
        const item = { thread: { id: 123 } };
        mockPrChangesProvider.replyToDiscussionThread.mockResolvedValue(true);

        await replyToDiscussionThread(item);

        expect(mockPrChangesProvider.replyToDiscussionThread).toHaveBeenCalledWith(item);
        expect(mockPrCommentController.refreshAll).toHaveBeenCalledTimes(1);
    });

    it('does not reload inline comments when posting a discussion reply fails or is cancelled', async () => {
        const replyToDiscussionThread = getRegisteredCommand('azureDevops.replyToDiscussionThread');
        mockPrChangesProvider.replyToDiscussionThread.mockResolvedValue(false);

        await replyToDiscussionThread({ thread: { id: 123 } });

        expect(mockPrCommentController.refreshAll).not.toHaveBeenCalled();
    });

    it('reloads inline comments whenever a PR file diff opens', async () => {
        const openPrFileDiff = getRegisteredCommand('azureDevops.openPrFileDiff');
        const fileItem = {
            change: { changeType: 'edit', item: { path: '/src/app.ts' } },
            sourceBranch: 'feature/example',
            org: 'org',
            project: 'proj',
            repoId: 'repo1',
            sourceCommitId: 'source',
            targetCommitId: 'target',
            prId: 42,
        };

        await openPrFileDiff(fileItem);

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode.diff',
            expect.anything(),
            expect.anything(),
            '/src/app.ts',
        );
        expect(mockPrCommentController.refreshAll).toHaveBeenCalledTimes(1);
    });

    it('switches review state after checking out a different PR branch', async () => {
        const checkout = getRegisteredCommand('azureDevops.checkoutPrBranch');
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42 });
        mockCheckoutPrBranch.mockResolvedValue(true);

        await checkout({ pr: makePr(99, 'repo1'), org: 'org' });

        expect(mockCheckoutPrBranch).toHaveBeenCalled();
        expect(mockPrChangesProvider.selectPr).toHaveBeenCalledWith(
            expect.objectContaining({ pullRequestId: 99 }),
            'org',
        );
        expect(mockPrChangesProvider.clear).not.toHaveBeenCalled();
        expect(mockPrCommentController.clearAll).toHaveBeenCalledTimes(1);
    });

    it('keeps inline comment state when checkout stays on the selected PR', async () => {
        const checkout = getRegisteredCommand('azureDevops.checkoutPrBranch');
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42 });
        mockCheckoutPrBranch.mockResolvedValue(true);

        await checkout({ pr: makePr(42, 'repo1'), org: 'org' });

        expect(mockPrChangesProvider.clear).not.toHaveBeenCalled();
        expect(mockPrCommentController.clearAll).not.toHaveBeenCalled();
        expect(mockPrChangesProvider.selectPr).toHaveBeenCalledWith(
            expect.objectContaining({ pullRequestId: 42 }),
            'org',
        );
    });
});
