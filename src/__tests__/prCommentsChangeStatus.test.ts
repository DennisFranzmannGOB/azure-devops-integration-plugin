import * as vscode from 'vscode';
import { PrCommentController } from '../prComments';
import { PrThread } from '../api';

jest.mock('../auth', () => ({
    getToken: jest.fn().mockResolvedValue('token'),
    getAuthenticationRequiredMessage: jest.fn().mockReturnValue('Authentication required'),
}));

jest.mock('../api', () => ({
    getPrThreads: jest.fn(),
    addPullRequestFileComment: jest.fn(),
    replyToThread: jest.fn(),
    updateThreadStatus: jest.fn(),
}));

const api = jest.requireMock('../api') as {
    getPrThreads: jest.Mock;
    updateThreadStatus: jest.Mock;
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

/** Build a controller whose createCommentThread returns a specific mock thread object. */
function buildController(mockVsThread: Record<string, unknown>): PrCommentController {
    const mockController = {
        set commentingRangeProvider(_: unknown) {},
        createCommentThread: jest.fn().mockReturnValue(mockVsThread),
        dispose: jest.fn(),
    };
    (vscode.comments.createCommentController as jest.Mock).mockReturnValue(mockController);
    return new PrCommentController({} as any);
}

describe('PrCommentController.changeStatus', () => {
    beforeEach(() => {
        api.getPrThreads.mockReset();
        api.updateThreadStatus.mockReset();
        api.updateThreadStatus.mockResolvedValue(undefined);
        auth.getToken.mockReset();
        auth.getToken.mockResolvedValue('token');
        (vscode.window.showErrorMessage as jest.Mock).mockReset();
        (vscode.workspace as any).textDocuments = [];
        (vscode.comments.createCommentController as jest.Mock).mockClear();
    });

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

        // Provide a document whose URI matches what placeFileThread looks for
        const docUri = vscode.Uri.parse(
            'azuredevops-pr://org/proj/repo1/src123/src/app.ts?prId=42&side=right'
        );
        (vscode.workspace as any).textDocuments = [{ uri: docUri }];

        api.getPrThreads.mockResolvedValue([makeThread({ status })]);
        await controller.loadThreads('org', 'proj', 'repo1', 42);

        return { controller, mockVsThread };
    }

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
            set commentingRangeProvider(_: unknown) {},
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
});
