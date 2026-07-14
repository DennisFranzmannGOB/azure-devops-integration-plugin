import * as vscode from 'vscode';
import { PrCommentController } from '../prComments';
import { PrThread } from '../api';

jest.mock('../auth', () => ({
    getToken: jest.fn().mockResolvedValue('token'),
    getAuthenticationRequiredMessage: jest.fn().mockReturnValue('Authentication required'),
}));

jest.mock('../api', () => ({
    getPrThreads: jest.fn(),
    getPrIterations: jest.fn(),
    addPullRequestFileComment: jest.fn(),
    replyToThread: jest.fn(),
    searchIdentitiesByDisplayName: jest.fn(),
    updateThreadStatus: jest.fn(),
}));

const api = jest.requireMock('../api') as {
    getPrThreads: jest.Mock;
    getPrIterations: jest.Mock;
    updateThreadStatus: jest.Mock;
    addPullRequestFileComment: jest.Mock;
    replyToThread: jest.Mock;
    searchIdentitiesByDisplayName: jest.Mock;
};

const auth = jest.requireMock('../auth') as {
    getToken: jest.Mock;
};

function makeThread(overrides: Partial<PrThread> = {}): PrThread {
    return {
        id: 7,
        status: 'active',
        isDeleted: false,
        threadContext: {
            filePath: '/src/app.ts',
            rightFileStart: { line: 10, offset: 1 },
            rightFileEnd: { line: 10, offset: 1 },
        },
        comments: [{
            id: 1, parentCommentId: 0, content: 'Fix this',
            author: { displayName: 'Alice', id: 'a1' },
            publishedDate: '2024-01-15T10:00:00Z',
            commentType: 'text', isDeleted: false,
        }],
        ...overrides,
    };
}

function makeThreadWithReply(): PrThread {
    return makeThread({
        comments: [
            {
                id: 1, parentCommentId: 0, content: 'Fix this',
                author: { displayName: 'Alice', id: 'a1' },
                publishedDate: '2024-01-15T10:00:00Z',
                commentType: 'text', isDeleted: false,
            },
            {
                id: 2, parentCommentId: 1, content: 'Fixed in the next commit',
                author: { displayName: 'Bob', id: 'b1' },
                publishedDate: '2024-01-15T11:00:00Z',
                commentType: 'text', isDeleted: false,
            },
        ],
    });
}

/** Build a controller whose createCommentThread returns a specific mock thread object. */
function buildController(mockVsThread: Record<string, unknown>): PrCommentController {
    const mockController = {
        set commentingRangeProvider(_: unknown) { },
        createCommentThread: jest.fn().mockReturnValue(mockVsThread),
        dispose: jest.fn(),
    };
    (vscode.comments.createCommentController as jest.Mock).mockReturnValue(mockController);
    return new PrCommentController({} as any);
}

async function setupPlacedThread(status: PrThread['status'] = 'active') {
    const mockVsThread = {
        uri: undefined as unknown,
        range: undefined as unknown,
        comments: [] as unknown[],
        canReply: false,
        label: undefined as string | undefined,
        collapsibleState: 1,
        contextValue: undefined as string | undefined,
        dispose: jest.fn(),
    };

    const controller = buildController(mockVsThread);

    const docUri = vscode.Uri.parse(
        'azuredevops-pr://org/proj/repo1/src123/src/app.ts?prId=42&side=right'
    );
    (vscode.workspace as any).textDocuments = [{ uri: docUri }];

    api.getPrThreads.mockResolvedValue([makeThread({ status })]);
    await controller.loadThreads('org', 'proj', 'repo1', 42);

    return { controller, mockVsThread };
}

describe('PrCommentController.changeStatus', () => {
    beforeEach(() => {
        api.getPrIterations.mockReset();
        api.getPrIterations.mockResolvedValue([{
            id: 3,
            sourceRefCommit: { commitId: 'src123' },
            targetRefCommit: { commitId: 'tgt456' },
        }]);
        api.getPrThreads.mockReset();
        api.updateThreadStatus.mockReset();
        api.updateThreadStatus.mockResolvedValue(undefined);
        auth.getToken.mockReset();
        auth.getToken.mockResolvedValue('token');
        (vscode.window.showErrorMessage as jest.Mock).mockReset();
        (vscode.workspace as any).textDocuments = [];
        (vscode.comments.createCommentController as jest.Mock).mockClear();
    });

    it('calls updateThreadStatus with the requested status', async () => {
        const { controller, mockVsThread } = await setupPlacedThread('active');

        await controller.changeStatus(mockVsThread as vscode.CommentThread, 'fixed');

        expect(api.updateThreadStatus).toHaveBeenCalledWith(
            'org', 'proj', 'repo1', 42, 7, 'fixed', 'token'
        );
    });

    it('updates vsThread label to status value for non-active statuses', async () => {
        const { controller, mockVsThread } = await setupPlacedThread('active');

        await controller.changeStatus(mockVsThread as vscode.CommentThread, 'wontFix');

        expect(mockVsThread.label).toBe('wontFix');
    });

    it('updates vsThread label to "Active" when reactivating', async () => {
        const { controller, mockVsThread } = await setupPlacedThread('fixed');

        await controller.changeStatus(mockVsThread as vscode.CommentThread, 'active');

        expect(mockVsThread.label).toBe('Active');
    });

    it('updates vsThread contextValue to per-status value', async () => {
        const { controller, mockVsThread } = await setupPlacedThread('active');

        await controller.changeStatus(mockVsThread as vscode.CommentThread, 'byDesign');

        expect(mockVsThread.contextValue).toBe('prCommentThread.byDesign');
    });

    it('does nothing when threadMeta is not found for the vsThread', async () => {
        const mockVsThread = { dispose: jest.fn() };
        const mockController = {
            set commentingRangeProvider(_: unknown) { },
            createCommentThread: jest.fn(),
            dispose: jest.fn(),
        };
        (vscode.comments.createCommentController as jest.Mock).mockReturnValue(mockController);
        const controller = new PrCommentController({} as any);

        await controller.changeStatus(mockVsThread as unknown as vscode.CommentThread, 'fixed');

        expect(api.updateThreadStatus).not.toHaveBeenCalled();
    });

    it('does nothing when no token is available', async () => {
        auth.getToken.mockResolvedValue(null);
        const { controller, mockVsThread } = await setupPlacedThread('active');

        await controller.changeStatus(mockVsThread as vscode.CommentThread, 'fixed');

        expect(api.updateThreadStatus).not.toHaveBeenCalled();
    });

    it('shows error message on API failure', async () => {
        api.updateThreadStatus.mockRejectedValue(new Error('HTTP 403: Forbidden'));
        const { controller, mockVsThread } = await setupPlacedThread('active');

        await controller.changeStatus(mockVsThread as vscode.CommentThread, 'fixed');

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            'Failed to update thread status: HTTP 403: Forbidden'
        );
    });

    it('sets contextValue to prCommentThread.active on newly placed threads', async () => {
        const { mockVsThread } = await setupPlacedThread('active');

        expect(mockVsThread.contextValue).toBe('prCommentThread.active');
    });

    it('sets contextValue to per-status value on non-active placed threads', async () => {
        const { mockVsThread } = await setupPlacedThread('fixed');

        expect(mockVsThread.contextValue).toBe('prCommentThread.fixed');
    });

    it('loads threads tracked to the latest PR iteration', async () => {
        await setupPlacedThread('active');

        expect(api.getPrIterations).toHaveBeenCalledWith('org', 'proj', 'repo1', 42, 'token');
        expect(api.getPrThreads).toHaveBeenCalledWith('org', 'proj', 'repo1', 42, 'token', 3, 3);
    });

    it('renders the original comment and every reply in an inline thread', async () => {
        const mockVsThread = {
            uri: undefined as unknown,
            range: undefined as unknown,
            comments: [] as unknown[],
            canReply: false,
            label: undefined as string | undefined,
            collapsibleState: 1,
            contextValue: undefined as string | undefined,
            dispose: jest.fn(),
        };
        const controller = buildController(mockVsThread);
        const docUri = vscode.Uri.parse(
            'azuredevops-pr://org/proj/repo1/src123/src/app.ts?prId=42&side=right'
        );
        (vscode.workspace as any).textDocuments = [{ uri: docUri }];
        api.getPrThreads.mockResolvedValue([makeThreadWithReply()]);

        await controller.loadThreads('org', 'proj', 'repo1', 42);

        const innerController = (vscode.comments.createCommentController as jest.Mock).mock.results.at(-1)?.value;
        const [, , comments] = innerController.createCommentThread.mock.calls[0];
        expect(comments).toHaveLength(2);
        expect(comments.map((comment: vscode.Comment) => (comment.body as vscode.MarkdownString).value)).toEqual([
            'Fix this',
            'Fixed in the next commit',
        ]);
    });

    it('refreshes an inline thread with replies added after its first load', async () => {
        const mockVsThread = {
            uri: undefined as unknown,
            range: undefined as unknown,
            comments: [] as unknown[],
            canReply: false,
            label: undefined as string | undefined,
            collapsibleState: 1,
            contextValue: undefined as string | undefined,
            dispose: jest.fn(),
        };
        const controller = buildController(mockVsThread);
        const docUri = vscode.Uri.parse(
            'azuredevops-pr://org/proj/repo1/src123/src/app.ts?prId=42&side=right'
        );
        (vscode.workspace as any).textDocuments = [{ uri: docUri }];
        api.getPrThreads.mockResolvedValueOnce([makeThread()]).mockResolvedValueOnce([makeThreadWithReply()]);

        await controller.loadThreads('org', 'proj', 'repo1', 42);
        await controller.refreshAll();

        const innerController = (vscode.comments.createCommentController as jest.Mock).mock.results.at(-1)?.value;
        const [, , refreshedComments] = innerController.createCommentThread.mock.calls[1];
        expect(refreshedComments).toHaveLength(2);
        expect(mockVsThread.dispose).toHaveBeenCalledTimes(1);
    });
});

describe('PrCommentController review-mode file tracking', () => {
    beforeEach(() => {
        api.getPrIterations.mockReset();
        api.getPrIterations.mockResolvedValue([{
            id: 3,
            sourceRefCommit: { commitId: 'src123' },
            targetRefCommit: { commitId: 'tgt456' },
        }]);
        api.getPrThreads.mockReset();
        api.getPrThreads.mockResolvedValue([]);
        auth.getToken.mockReset();
        auth.getToken.mockResolvedValue('token');
        (vscode.workspace as any).textDocuments = [];
        (vscode.comments.createCommentController as jest.Mock).mockClear();
    });

    it('isReviewModeFile returns false for an unregistered URI', () => {
        const controller = buildController({});
        const uri = vscode.Uri.parse('file:///repo/src/app.ts');
        expect(controller.isReviewModeFile(uri)).toBe(false);
    });

    it('isReviewModeFile returns true after registerReviewModeFile', async () => {
        const controller = buildController({});
        const uri = vscode.Uri.parse('file:///repo/src/app.ts');
        await controller.registerReviewModeFile(uri, 'org', 'proj', 'repo1', 42, '/src/app.ts');
        expect(controller.isReviewModeFile(uri)).toBe(true);
    });

    it('getReviewModeFileInfo returns undefined for an unregistered URI', () => {
        const controller = buildController({});
        const uri = vscode.Uri.parse('file:///repo/src/app.ts');
        expect(controller.getReviewModeFileInfo(uri)).toBeUndefined();
    });

    it('getReviewModeFileInfo returns org and prId for a registered URI', async () => {
        const controller = buildController({});
        const uri = vscode.Uri.parse('file:///repo/src/app.ts');
        await controller.registerReviewModeFile(uri, 'myorg', 'proj', 'repo1', 99, '/src/app.ts');
        expect(controller.getReviewModeFileInfo(uri)).toEqual({ org: 'myorg', prId: 99 });
    });

    it('isReviewModeFile returns false after clearAll', async () => {
        const controller = buildController({});
        const uri = vscode.Uri.parse('file:///repo/src/app.ts');
        await controller.registerReviewModeFile(uri, 'org', 'proj', 'repo1', 42, '/src/app.ts');
        controller.clearAll();
        expect(controller.isReviewModeFile(uri)).toBe(false);
    });

    it('refreshAll preserves registration for a still-open document', async () => {
        const uri = vscode.Uri.parse('file:///repo/src/app.ts');
        (vscode.workspace as any).textDocuments = [{ uri }];
        const controller = buildController({ dispose: jest.fn() });
        await controller.registerReviewModeFile(uri, 'org', 'proj', 'repo1', 42, '/src/app.ts');

        await controller.refreshAll();

        expect(controller.isReviewModeFile(uri)).toBe(true);
    });

    it('refreshAll drops registration for a closed document', async () => {
        const uri = vscode.Uri.parse('file:///repo/src/app.ts');
        (vscode.workspace as any).textDocuments = [{ uri }];
        const controller = buildController({ dispose: jest.fn() });
        await controller.registerReviewModeFile(uri, 'org', 'proj', 'repo1', 42, '/src/app.ts');

        (vscode.workspace as any).textDocuments = [];
        await controller.refreshAll();

        expect(controller.isReviewModeFile(uri)).toBe(false);
    });

    it('places threads on a matching real file document after registration', async () => {
        const realUri = vscode.Uri.parse('file:///repo/src/app.ts');
        (vscode.workspace as any).textDocuments = [{ uri: realUri }];

        const mockVsThread = {
            uri: realUri, range: undefined, comments: [], canReply: false,
            label: undefined, collapsibleState: 1, contextValue: undefined, dispose: jest.fn(),
        };
        const controller = buildController(mockVsThread);
        api.getPrThreads.mockResolvedValue([makeThread({ status: 'active' })]);

        await controller.registerReviewModeFile(realUri, 'org', 'proj', 'repo1', 42, '/src/app.ts');

        const innerController = (vscode.comments.createCommentController as jest.Mock).mock.results.at(-1)?.value;
        expect(innerController.createCommentThread).toHaveBeenCalledWith(
            realUri, expect.anything(), expect.anything()
        );
    });
});

describe('PrCommentController.createThread on review-mode files', () => {
    beforeEach(() => {
        api.getPrIterations.mockReset();
        api.getPrIterations.mockResolvedValue([{
            id: 3,
            sourceRefCommit: { commitId: 'src123' },
            targetRefCommit: { commitId: 'tgt456' },
        }]);
        api.getPrThreads.mockReset();
        api.getPrThreads.mockResolvedValue([]);
        api.addPullRequestFileComment.mockReset();
        api.addPullRequestFileComment.mockResolvedValue({ id: 99 });
        api.replyToThread.mockReset();
        api.replyToThread.mockResolvedValue({ id: 100 });
        api.searchIdentitiesByDisplayName.mockReset();
        api.searchIdentitiesByDisplayName.mockResolvedValue([]);
        auth.getToken.mockReset();
        auth.getToken.mockResolvedValue('token');
        (vscode.workspace as any).textDocuments = [];
        (vscode.comments.createCommentController as jest.Mock).mockClear();
        (vscode.window.showErrorMessage as jest.Mock).mockReset();
    });

    it('posts a comment using review-mode context for real file URIs', async () => {
        const realUri = vscode.Uri.parse('file:///repo/src/app.ts');
        const mockVsThread = {
            uri: realUri, range: new vscode.Range(4, 0, 4, 0),
            comments: [], canReply: false, label: undefined,
            collapsibleState: 1, contextValue: undefined, dispose: jest.fn(),
        };
        const controller = buildController(mockVsThread);
        await controller.registerReviewModeFile(realUri, 'org', 'proj', 'repo1', 42, '/src/app.ts');

        await controller.createThread({
            thread: mockVsThread as unknown as vscode.CommentThread,
            text: 'Hello from review mode',
        } as vscode.CommentReply);

        expect(api.addPullRequestFileComment).toHaveBeenCalledWith(
            'org', 'proj', 'repo1', 42,
            'Hello from review mode',
            expect.objectContaining({ filePath: '/src/app.ts', rightFileStart: expect.anything() }),
            'token'
        );
    });

    it('sets contextValue to prCommentThread.active after posting on a real file', async () => {
        const realUri = vscode.Uri.parse('file:///repo/src/app.ts');
        const mockVsThread = {
            uri: realUri, range: new vscode.Range(4, 0, 4, 0),
            comments: [], canReply: false, label: undefined,
            collapsibleState: 1, contextValue: undefined, dispose: jest.fn(),
        };
        const controller = buildController(mockVsThread);
        await controller.registerReviewModeFile(realUri, 'org', 'proj', 'repo1', 42, '/src/app.ts');

        await controller.createThread({
            thread: mockVsThread as unknown as vscode.CommentThread,
            text: 'Reviewed',
        } as vscode.CommentReply);

        expect(mockVsThread.contextValue).toBe('prCommentThread.active');
    });

    it('does nothing for a real file URI that is not registered', async () => {
        const realUri = vscode.Uri.parse('file:///repo/src/app.ts');
        const mockVsThread = {
            uri: realUri, range: new vscode.Range(4, 0, 4, 0),
            comments: [], canReply: false, dispose: jest.fn(),
        };
        const controller = buildController(mockVsThread);

        await controller.createThread({
            thread: mockVsThread as unknown as vscode.CommentThread,
            text: 'Should not post',
        } as vscode.CommentReply);

        expect(api.addPullRequestFileComment).not.toHaveBeenCalled();
    });

    it('rewrites a leading mention before posting a new inline comment', async () => {
        api.searchIdentitiesByDisplayName.mockResolvedValue([
            { id: 'user-1', displayName: 'Dennis Mike' },
        ]);

        const realUri = vscode.Uri.parse('file:///repo/src/app.ts');
        const mockVsThread = {
            uri: realUri, range: new vscode.Range(4, 0, 4, 0),
            comments: [], canReply: false, label: undefined,
            collapsibleState: 1, contextValue: undefined, dispose: jest.fn(),
        };
        const controller = buildController(mockVsThread);
        await controller.registerReviewModeFile(realUri, 'org', 'proj', 'repo1', 42, '/src/app.ts');

        await controller.createThread({
            thread: mockVsThread as unknown as vscode.CommentThread,
            text: '@Dennis Mike: das ist ein Test',
        } as vscode.CommentReply);

        expect(api.searchIdentitiesByDisplayName).toHaveBeenCalledWith('org', 'Dennis Mike', 'token');
        expect(api.addPullRequestFileComment).toHaveBeenCalledWith(
            'org', 'proj', 'repo1', 42,
            '@<user-1> Dennis das ist ein Test',
            expect.objectContaining({ filePath: '/src/app.ts', rightFileStart: expect.anything() }),
            'token'
        );
        expect((mockVsThread.comments[0] as any).body.value).toBe('@<user-1> Dennis das ist ein Test');
    });

    it('shows an error and skips posting when an inline mention is ambiguous', async () => {
        api.searchIdentitiesByDisplayName.mockResolvedValue([
            { id: 'user-1', displayName: 'Dennis Mike' },
            { id: 'user-2', displayName: 'Dennis Mike' },
        ]);

        const realUri = vscode.Uri.parse('file:///repo/src/app.ts');
        const mockVsThread = {
            uri: realUri, range: new vscode.Range(4, 0, 4, 0),
            comments: [], canReply: false, label: undefined,
            collapsibleState: 1, contextValue: undefined, dispose: jest.fn(),
        };
        const controller = buildController(mockVsThread);
        await controller.registerReviewModeFile(realUri, 'org', 'proj', 'repo1', 42, '/src/app.ts');

        await controller.createThread({
            thread: mockVsThread as unknown as vscode.CommentThread,
            text: '@Dennis Mike: ping',
        } as vscode.CommentReply);

        expect(api.addPullRequestFileComment).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            'Failed to add comment: Multiple Azure DevOps users matched "Dennis Mike". Use "@FirstName LastName: your comment".'
        );
    });
});

describe('PrCommentController.replyToThread mention handling', () => {
    beforeEach(() => {
        api.getPrIterations.mockReset();
        api.getPrIterations.mockResolvedValue([{
            id: 3,
            sourceRefCommit: { commitId: 'src123' },
            targetRefCommit: { commitId: 'tgt456' },
        }]);
        api.getPrThreads.mockReset();
        api.getPrThreads.mockResolvedValue([]);
        api.replyToThread.mockReset();
        api.replyToThread.mockResolvedValue({ id: 101 });
        api.searchIdentitiesByDisplayName.mockReset();
        api.searchIdentitiesByDisplayName.mockResolvedValue([]);
        auth.getToken.mockReset();
        auth.getToken.mockResolvedValue('token');
        (vscode.workspace as any).textDocuments = [];
        (vscode.comments.createCommentController as jest.Mock).mockClear();
        (vscode.window.showErrorMessage as jest.Mock).mockReset();
    });

    it('rewrites a leading mention before replying to an existing thread', async () => {
        api.searchIdentitiesByDisplayName.mockResolvedValue([
            { id: 'user-1', displayName: 'Dennis Mike' },
        ]);

        const { controller, mockVsThread } = await setupPlacedThread('active');

        await controller.replyToThread({
            thread: mockVsThread as vscode.CommentThread,
            text: '@Dennis Mike: reply text',
        } as vscode.CommentReply);

        expect(api.replyToThread).toHaveBeenCalledWith(
            'org', 'proj', 'repo1', 42, 7, '@<user-1> Dennis reply text', 'token'
        );
        expect(((mockVsThread.comments as any[]).at(-1) as any).body.value).toBe('@<user-1> Dennis reply text');
    });
});
