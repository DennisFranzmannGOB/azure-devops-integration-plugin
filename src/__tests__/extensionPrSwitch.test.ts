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
    replyToDiscussionThread: jest.fn(),
    changeThreadStatus: jest.fn().mockResolvedValue(undefined),
    addGeneralComment: jest.fn(),
    onIterationResolved: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    resetCurrentPr: jest.fn(),
    getAdjacentFile: jest.fn(),
    getFileItem: jest.fn(),
    setReviewed: jest.fn(),
};

const mockPrCommentController = {
    loadExisting: jest.fn(),
    clearAll: jest.fn(),
    selectPr: jest.fn().mockResolvedValue(undefined),
    refreshAll: jest.fn().mockResolvedValue(undefined),
    replyToThread: jest.fn(),
    changeStatus: jest.fn(),
    registerReviewModeFile: jest.fn(),
    getReviewModeFileInfo: jest.fn(),
    getReviewModeFileContext: jest.fn(),
    isReviewModeFile: jest.fn().mockReturnValue(false),
    onDidAddComment: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    dispose: jest.fn(),
};

const mockDiscussionNavigator = {
    clear: jest.fn(),
    openThread: jest.fn(),
    openThreadById: jest.fn(),
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
    parsePrFileUri: jest.fn(),
}));
jest.mock('../prComments', () => ({
    PrCommentController: jest.fn().mockImplementation(() => mockPrCommentController),
}));
jest.mock('../prCommentDocProvider', () => ({
    PrCommentDocProvider: jest.fn().mockImplementation(() => ({})),
    PR_COMMENT_SCHEME: 'azuredevops-pr-comment',
}));
jest.mock('../discussionNavigation', () => ({
    DiscussionNavigator: jest.fn().mockImplementation(() => mockDiscussionNavigator),
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
    let prChangesTree: { reveal: jest.Mock };

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
        mockPrChangesProvider.getAdjacentFile.mockReset();
        mockPrChangesProvider.getFileItem.mockReset();
        mockPrChangesProvider.setReviewed.mockReset();
        mockDiscussionNavigator.clear.mockReset();
        mockDiscussionNavigator.openThread.mockReset();
        mockDiscussionNavigator.openThreadById.mockReset();
        const { tryGetReviewModeUri } = jest.requireMock('../reviewMode') as { tryGetReviewModeUri: jest.Mock };
        tryGetReviewModeUri.mockResolvedValue(undefined);

        prChangesTree = { reveal: jest.fn().mockResolvedValue(undefined) };
        (vscode.window as any).createTreeView = jest.fn().mockReturnValue({
            title: 'PR Changes',
            dispose: jest.fn(),
            reveal: prChangesTree.reveal,
            onDidChangeCheckboxState: jest.fn().mockReturnValue({ dispose: jest.fn() }),
        });
        (vscode.window as any).onDidChangeActiveTextEditor = jest.fn().mockReturnValue({ dispose: jest.fn() });
        (vscode.workspace as any).registerTextDocumentContentProvider = jest.fn().mockReturnValue({ dispose: jest.fn() });
        (vscode.workspace as any).registerFileSystemProvider = jest.fn().mockReturnValue({ dispose: jest.fn() });
        (vscode.workspace as any).textDocuments = [];
        (vscode.commands.executeCommand as jest.Mock).mockReset();
        (vscode.commands.registerCommand as jest.Mock).mockClear();
        (vscode.window as any).activeTextEditor = undefined;

        activate({ secrets: {}, subscriptions: [], workspaceState: { get: jest.fn().mockReturnValue({}), update: jest.fn(), keys: jest.fn().mockReturnValue([]) } } as any);
    });

    it('does not register the retired pull request authoring command', () => {
        expect(vscode.commands.registerCommand).not.toHaveBeenCalledWith(
            'azureDevops.createPullRequest',
            expect.any(Function),
        );
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
        expect(mockDiscussionNavigator.openThreadById).toHaveBeenCalledWith(expect.objectContaining({ pullRequestId: 77 }), 'org', 123);
        expect(mockPrCommentController.clearAll.mock.invocationCallOrder[0]).toBeLessThan(
            mockDiscussionNavigator.openThreadById.mock.invocationCallOrder[0]
        );
    });

    it('delegates discussion opening to the navigation module', async () => {
        const openDiscussionComment = getRegisteredCommand('azureDevops.openDiscussionComment');
        const item = { thread: { id: 123 } };

        await openDiscussionComment(item);

        expect(mockDiscussionNavigator.openThread).toHaveBeenCalledWith(item);
        expect(mockPrCommentController.refreshAll).not.toHaveBeenCalled();
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

    it('changes an inline thread to the status selected from the status picker', async () => {
        const changeInlineThreadStatus = getRegisteredCommand('azureDevops.inlineChangeThreadStatus');
        const thread = {} as vscode.CommentThread;
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'Pending', status: 'pending' });

        await changeInlineThreadStatus(thread);

        expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ label: 'Pending', status: 'pending' }),
                expect.objectContaining({ label: "Won't Fix", status: 'wontFix' }),
                expect.objectContaining({ label: 'By Design', status: 'byDesign' }),
                expect.objectContaining({ label: 'Closed', status: 'closed' }),
            ]),
            expect.objectContaining({ placeHolder: 'Set thread status' }),
        );
        expect(mockPrCommentController.changeStatus).toHaveBeenCalledWith(thread, 'pending');
    });

    it('offers pending inline threads every status except pending itself', async () => {
        const changeInlineThreadStatus = getRegisteredCommand('azureDevops.inlineChangeThreadStatus');
        const thread = { contextValue: 'prCommentThread.pending' } as vscode.CommentThread;
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'Active', status: 'active' });

        await changeInlineThreadStatus(thread);

        const [choices] = (vscode.window.showQuickPick as jest.Mock).mock.calls.at(-1);
        expect(choices).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'Active', status: 'active' }),
            expect.objectContaining({ label: "Won't Fix", status: 'wontFix' }),
            expect.objectContaining({ label: 'By Design', status: 'byDesign' }),
            expect.objectContaining({ label: 'Closed', status: 'closed' }),
        ]));
        expect(choices).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'Pending', status: 'pending' }),
        ]));
        expect(mockPrCommentController.changeStatus).toHaveBeenCalledWith(thread, 'active');
    });

    it('refreshes the PR Changes tree after resolving a thread inline', async () => {
        const inlineResolveThread = getRegisteredCommand('azureDevops.inlineResolveThread');
        const thread = {} as vscode.CommentThread;

        await inlineResolveThread(thread);

        expect(mockPrCommentController.changeStatus).toHaveBeenCalledWith(thread, 'fixed');
        expect(mockPrChangesProvider.refresh).toHaveBeenCalled();
    });

    it('refreshes the PR Changes tree after picking a status from the inline status picker', async () => {
        const changeInlineThreadStatus = getRegisteredCommand('azureDevops.inlineChangeThreadStatus');
        const thread = {} as vscode.CommentThread;
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'Pending', status: 'pending' });

        await changeInlineThreadStatus(thread);

        expect(mockPrChangesProvider.refresh).toHaveBeenCalled();
    });

    it('refreshes the PR Changes tree after reactivating a thread inline', async () => {
        const inlineReactivateThread = getRegisteredCommand('azureDevops.inlineReactivateThread');
        const thread = {} as vscode.CommentThread;

        await inlineReactivateThread(thread);

        expect(mockPrCommentController.changeStatus).toHaveBeenCalledWith(thread, 'active');
        expect(mockPrChangesProvider.refresh).toHaveBeenCalled();
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
        expect(mockPrChangesProvider.setReviewed).not.toHaveBeenCalled();
    });

    it('finishes opening a PR diff before inline comments finish reloading', async () => {
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
        let resolveRefresh: (() => void) | undefined;
        mockPrCommentController.refreshAll.mockImplementationOnce(() => new Promise<void>((resolve) => {
            resolveRefresh = resolve;
        }));

        let completed = false;
        const opening = openPrFileDiff(fileItem).then(() => {
            completed = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        try {
            expect(completed).toBe(true);
        } finally {
            resolveRefresh?.();
            await opening;
        }
    });

    it('waits for a pending review-mode lookup so the local file is preserved', async () => {
        const openPrFileDiff = getRegisteredCommand('azureDevops.openPrFileDiff');
        const { tryGetReviewModeUri } = jest.requireMock('../reviewMode') as { tryGetReviewModeUri: jest.Mock };
        const reviewModeUri = { toString: () => 'file:///repo/src/app.ts' };
        let resolveReviewModeLookup: ((uri: typeof reviewModeUri) => void) | undefined;
        tryGetReviewModeUri.mockImplementationOnce(() => new Promise<typeof reviewModeUri>((resolve) => {
            resolveReviewModeLookup = resolve;
        }));

        let completed = false;
        const opening = openPrFileDiff({
            change: { changeType: 'edit', item: { path: '/src/app.ts' } },
            sourceBranch: 'feature/example',
            org: 'org',
            project: 'proj',
            repoId: 'repo1',
            sourceCommitId: 'source',
            targetCommitId: 'target',
            prId: 42,
            repositoryName: 'repo-name',
        }).then(() => {
            completed = true;
        });

        try {
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(completed).toBe(false);
            expect(tryGetReviewModeUri).toHaveBeenCalledWith('feature/example', '/src/app.ts', {
                organization: 'org',
                project: 'proj',
                repository: 'repo-name',
            });
            resolveReviewModeLookup!(reviewModeUri);
            await opening;
            expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
                'vscode.diff',
                expect.anything(),
                reviewModeUri,
                '/src/app.ts',
            );
        } finally {
            resolveReviewModeLookup?.(reviewModeUri);
            await opening;
        }
    });

    it('uses the local file when review-mode lookup takes longer than 100 ms', async () => {
        const openPrFileDiff = getRegisteredCommand('azureDevops.openPrFileDiff');
        const reviewModeUri = { toString: () => 'file:///repo/src/app.ts' };
        const { tryGetReviewModeUri } = jest.requireMock('../reviewMode') as { tryGetReviewModeUri: jest.Mock };
        tryGetReviewModeUri.mockImplementationOnce(() => new Promise((resolve) => {
            setTimeout(() => resolve(reviewModeUri), 150);
        }));

        await openPrFileDiff({
            change: { changeType: 'edit', item: { path: '/src/app.ts' } },
            sourceBranch: 'feature/example',
            org: 'org',
            project: 'proj',
            repoId: 'repo1',
            sourceCommitId: 'source',
            targetCommitId: 'target',
            prId: 42,
            repositoryName: 'repo-name',
        });

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode.diff',
            expect.anything(),
            reviewModeUri,
            '/src/app.ts',
        );
    });

    it('marks a file reviewed after opening its diff when auto marking is enabled', async () => {
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
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValueOnce({
            get: jest.fn().mockImplementation((key: string, defaultValue: unknown) =>
                key === 'autoMarkFilesReviewed' ? true : defaultValue
            ),
        });

        await openPrFileDiff(fileItem);

        expect(mockPrChangesProvider.setReviewed).toHaveBeenCalledWith(fileItem, true);
        expect((vscode.commands.executeCommand as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
            mockPrChangesProvider.setReviewed.mock.invocationCallOrder[0],
        );
    });

    it('enables PR diff keybindings after registering a review-mode file', async () => {
        const openPrFileDiff = getRegisteredCommand('azureDevops.openPrFileDiff');
        const reviewModeUri = { toString: () => 'file:///repo/src/app.ts' };
        const { tryGetReviewModeUri } = jest.requireMock('../reviewMode') as { tryGetReviewModeUri: jest.Mock };
        tryGetReviewModeUri.mockResolvedValue(reviewModeUri);
        (vscode.window as any).activeTextEditor = { document: { uri: reviewModeUri } };
        mockPrCommentController.isReviewModeFile.mockReturnValue(true);

        await openPrFileDiff({
            change: { changeType: 'edit', item: { path: '/src/app.ts' } },
            sourceBranch: 'feature/example',
            org: 'org',
            project: 'proj',
            repoId: 'repo1',
            sourceCommitId: 'source',
            targetCommitId: 'target',
            prId: 42,
        });

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'setContext',
            'azureDevops.prDiffActive',
            true,
        );
    });

    it('opens and reveals the next changed file from the active PR diff', async () => {
        const nextChangedFile = getRegisteredCommand('azureDevops.nextPrChangedFile');
        const nextFile = {
            change: { changeType: 'edit', item: { path: '/src/next.ts' } },
        };
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42 });
        mockPrChangesProvider.getAdjacentFile.mockResolvedValue(nextFile);
        (vscode.window as any).activeTextEditor = { document: { uri: {} } };
        const { parsePrFileUri } = jest.requireMock('../prContentProvider') as { parsePrFileUri: jest.Mock };
        parsePrFileUri.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42, filePath: '/src/current.ts' });

        await nextChangedFile();

        expect(mockPrChangesProvider.getAdjacentFile).toHaveBeenCalledWith('/src/current.ts', 'next');
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('azureDevops.openPrFileDiff', nextFile);
        expect(prChangesTree.reveal).toHaveBeenCalledWith(nextFile, { select: true, focus: false, expand: true });
    });

    it('reveals the next file before opening its diff can refresh PR Changes', async () => {
        const nextChangedFile = getRegisteredCommand('azureDevops.nextPrChangedFile');
        const nextFile = {
            change: { changeType: 'edit', item: { path: '/src/next.ts' } },
        };
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42 });
        mockPrChangesProvider.getAdjacentFile.mockResolvedValue(nextFile);
        (vscode.window as any).activeTextEditor = { document: { uri: {} } };
        const { parsePrFileUri } = jest.requireMock('../prContentProvider') as { parsePrFileUri: jest.Mock };
        parsePrFileUri.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42, filePath: '/src/current.ts' });
        let diffOpeningStarted = false;
        (vscode.commands.executeCommand as jest.Mock).mockImplementation((command: string) => {
            if (command === 'azureDevops.openPrFileDiff') {
                diffOpeningStarted = true;
            }
            return Promise.resolve();
        });
        prChangesTree.reveal.mockImplementation(() => {
            if (diffOpeningStarted) {
                return Promise.reject(new Error('Cannot resolve tree item for element'));
            }
            return Promise.resolve();
        });

        await expect(nextChangedFile()).resolves.toBeUndefined();

        expect(prChangesTree.reveal).toHaveBeenCalledWith(nextFile, { select: true, focus: false, expand: true });
    });

    it('opens the next file when a refresh invalidates its tree item before reveal completes', async () => {
        const nextChangedFile = getRegisteredCommand('azureDevops.nextPrChangedFile');
        const nextFile = {
            change: { changeType: 'edit', item: { path: '/src/next.ts' } },
        };
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42 });
        mockPrChangesProvider.getAdjacentFile.mockResolvedValue(nextFile);
        (vscode.window as any).activeTextEditor = { document: { uri: {} } };
        const { parsePrFileUri } = jest.requireMock('../prContentProvider') as { parsePrFileUri: jest.Mock };
        parsePrFileUri.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42, filePath: '/src/current.ts' });
        prChangesTree.reveal.mockRejectedValue(new Error('Cannot resolve tree item for element /src/next.ts'));

        await expect(nextChangedFile()).resolves.toBeUndefined();

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('azureDevops.openPrFileDiff', nextFile);
    });

    it('advances through consecutive files when next navigation is triggered rapidly', async () => {
        const nextChangedFile = getRegisteredCommand('azureDevops.nextPrChangedFile');
        const nextFile = {
            change: { changeType: 'edit', item: { path: '/src/next.ts' } },
        };
        const finalFile = {
            change: { changeType: 'edit', item: { path: '/src/final.ts' } },
        };
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42 });
        mockPrChangesProvider.getAdjacentFile.mockImplementation((filePath: string) =>
            Promise.resolve(filePath === '/src/current.ts' ? nextFile : finalFile)
        );
        (vscode.window as any).activeTextEditor = { document: { uri: {} } };
        const { parsePrFileUri } = jest.requireMock('../prContentProvider') as { parsePrFileUri: jest.Mock };
        parsePrFileUri.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42, filePath: '/src/current.ts' });

        await Promise.all([nextChangedFile(), nextChangedFile()]);

        expect(mockPrChangesProvider.getAdjacentFile).toHaveBeenNthCalledWith(1, '/src/current.ts', 'next');
        expect(mockPrChangesProvider.getAdjacentFile).toHaveBeenNthCalledWith(2, '/src/next.ts', 'next');
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('azureDevops.openPrFileDiff', finalFile);
        expect(prChangesTree.reveal).toHaveBeenCalledWith(finalFile, { select: true, focus: false, expand: true });
    });

    it('navigates from the manually reactivated PR diff instead of a prior navigation target', async () => {
        const nextChangedFile = getRegisteredCommand('azureDevops.nextPrChangedFile');
        const nextFile = {
            change: { changeType: 'edit', item: { path: '/src/next.ts' } },
        };
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42 });
        mockPrChangesProvider.getAdjacentFile.mockResolvedValue(nextFile);
        (vscode.window as any).activeTextEditor = { document: { uri: {} } };
        const { parsePrFileUri } = jest.requireMock('../prContentProvider') as { parsePrFileUri: jest.Mock };
        parsePrFileUri.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42, filePath: '/src/current.ts' });

        await nextChangedFile();
        await nextChangedFile();

        expect(mockPrChangesProvider.getAdjacentFile).toHaveBeenNthCalledWith(1, '/src/current.ts', 'next');
        expect(mockPrChangesProvider.getAdjacentFile).toHaveBeenNthCalledWith(2, '/src/current.ts', 'next');
    });

    it('does not reveal a next file that auto-review hides', async () => {
        const nextChangedFile = getRegisteredCommand('azureDevops.nextPrChangedFile');
        const nextFile = {
            change: { changeType: 'edit', item: { path: '/src/next.ts' } },
        };
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42 });
        mockPrChangesProvider.getAdjacentFile.mockResolvedValue(nextFile);
        (vscode.window as any).activeTextEditor = { document: { uri: {} } };
        const { parsePrFileUri } = jest.requireMock('../prContentProvider') as { parsePrFileUri: jest.Mock };
        parsePrFileUri.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42, filePath: '/src/current.ts' });
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValueOnce({
            get: jest.fn().mockImplementation((key: string, defaultValue: unknown) =>
                key === 'autoMarkFilesReviewed' || key === 'hideReviewedFiles' ? true : defaultValue
            ),
        });

        await nextChangedFile();

        expect(prChangesTree.reveal).not.toHaveBeenCalled();
    });

    it('toggles the reviewed state of the active PR diff file', async () => {
        const toggleReviewed = getRegisteredCommand('azureDevops.togglePrFileReviewed');
        const currentFile = {
            change: { changeType: 'edit', item: { path: '/src/current.ts' } },
            checkboxState: vscode.TreeItemCheckboxState.Unchecked,
        };
        mockPrChangesProvider.getSelectedPrContext.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42 });
        mockPrChangesProvider.getFileItem.mockResolvedValue(currentFile);
        (vscode.window as any).activeTextEditor = { document: { uri: {} } };
        const { parsePrFileUri } = jest.requireMock('../prContentProvider') as { parsePrFileUri: jest.Mock };
        parsePrFileUri.mockReturnValue({ org: 'org', repoId: 'repo1', prId: 42, filePath: '/src/current.ts' });

        await toggleReviewed();

        expect(mockPrChangesProvider.getFileItem).toHaveBeenCalledWith('/src/current.ts');
        expect(mockPrChangesProvider.setReviewed).toHaveBeenCalledWith(currentFile, true);
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
