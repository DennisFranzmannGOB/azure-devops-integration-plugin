import * as vscode from 'vscode';
import { PrChangesProvider } from '../prChangesProvider';
import { EnrichedPullRequest } from '../api';
import { parsePrFileUri } from '../prContentProvider';

jest.mock('../auth', () => ({
    getToken: jest.fn().mockResolvedValue('token'),
}));

jest.mock('../api', () => ({
    getPrThreads: jest.fn(),
    getPrIterations: jest.fn(),
    getPrChanges: jest.fn(),
    addPullRequestComment: jest.fn(),
    replyToThread: jest.fn(),
}));

const api = jest.requireMock('../api') as {
    getPrThreads: jest.Mock;
    getPrIterations: jest.Mock;
    getPrChanges: jest.Mock;
};

function makePr(): EnrichedPullRequest {
    return {
        pullRequestId: 42,
        title: 'Example PR',
        sourceRefName: 'refs/heads/main',
        createdBy: { displayName: 'User', id: 'user1' },
        reviewers: [],
        repository: { id: 'repo1', name: 'repo', project: { id: 'proj1', name: 'proj' } },
        status: 'active',
        isDraft: false,
        url: '',
        unresolvedCommentCount: 1,
        commentThreads: [],
        checksStatus: 'none',
        checks: [],
        workItems: [],
    };
}

describe('PrChangesProvider.openThreadById', () => {
    beforeEach(() => {
        api.getPrIterations.mockReset();
        api.getPrThreads.mockReset();
        api.getPrChanges.mockReset();
        (vscode.commands.executeCommand as jest.Mock).mockReset();
        (vscode.workspace.openTextDocument as jest.Mock).mockReset();
        (vscode.window.showTextDocument as jest.Mock).mockReset();
    });

    it('opens a file thread in a diff view', async () => {
        api.getPrIterations.mockResolvedValue([{
            id: 1,
            sourceRefCommit: { commitId: 'src123' },
            targetRefCommit: { commitId: 'tgt456' },
        }]);
        api.getPrChanges.mockResolvedValue([
            {
                changeType: 'edit',
                item: { path: '/src/app.ts' },
            },
        ]);
        api.getPrThreads.mockResolvedValue([{
            id: 9,
            status: 'active',
            isDeleted: false,
            threadContext: {
                filePath: '/src/app.ts',
                rightFileStart: { line: 12, offset: 1 },
                rightFileEnd: { line: 12, offset: 1 },
            },
            comments: [{
                id: 1,
                parentCommentId: 0,
                content: 'Hello',
                author: { displayName: 'Alice', id: 'a1' },
                publishedDate: '2024-01-15T10:00:00Z',
                commentType: 'text',
                isDeleted: false,
            }],
        }]);

        const provider = new PrChangesProvider({} as any);
        const result = await provider.openThreadById(makePr(), 'org', 9);

        expect(result).toBe(true);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode.diff',
            expect.anything(),
            expect.anything(),
            '/src/app.ts'
        );

        const [, leftUri, rightUri] = (vscode.commands.executeCommand as jest.Mock).mock.calls[0];
        expect(parsePrFileUri(leftUri)?.filePath).toBe('/src/app.ts');
        expect(parsePrFileUri(rightUri)?.filePath).toBe('/src/app.ts');
    });

    it('opens a renamed file thread with original path on the left and current path on the right', async () => {
        api.getPrIterations.mockResolvedValue([{
            id: 1,
            sourceRefCommit: { commitId: 'src123' },
            targetRefCommit: { commitId: 'tgt456' },
        }]);
        api.getPrChanges.mockResolvedValue([
            {
                changeType: 'rename',
                item: { path: '/src/new-name.ts' },
                originalPath: '/src/old-name.ts',
            },
        ]);
        api.getPrThreads.mockResolvedValue([{
            id: 12,
            status: 'active',
            isDeleted: false,
            threadContext: {
                filePath: '/src/new-name.ts',
                rightFileStart: { line: 7, offset: 1 },
                rightFileEnd: { line: 7, offset: 1 },
            },
            comments: [{
                id: 1,
                parentCommentId: 0,
                content: 'Renamed file comment',
                author: { displayName: 'Alice', id: 'a1' },
                publishedDate: '2024-01-15T10:00:00Z',
                commentType: 'text',
                isDeleted: false,
            }],
        }]);

        const provider = new PrChangesProvider({} as any);
        const result = await provider.openThreadById(makePr(), 'org', 12);

        expect(result).toBe(true);
        const [, leftUri, rightUri, label] = (vscode.commands.executeCommand as jest.Mock).mock.calls[0];
        expect(parsePrFileUri(leftUri)?.filePath).toBe('/src/old-name.ts');
        expect(parsePrFileUri(rightUri)?.filePath).toBe('/src/new-name.ts');
        expect(label).toBe('/src/new-name.ts');
    });

    it('opens a deleted file thread with an empty right side', async () => {
        api.getPrIterations.mockResolvedValue([{
            id: 1,
            sourceRefCommit: { commitId: 'src123' },
            targetRefCommit: { commitId: 'tgt456' },
        }]);
        api.getPrChanges.mockResolvedValue([
            {
                changeType: 'delete',
                item: { path: '/src/deleted.ts' },
            },
        ]);
        api.getPrThreads.mockResolvedValue([{
            id: 13,
            status: 'active',
            isDeleted: false,
            threadContext: {
                filePath: '/src/deleted.ts',
                leftFileStart: { line: 3, offset: 1 },
                leftFileEnd: { line: 3, offset: 1 },
            },
            comments: [{
                id: 1,
                parentCommentId: 0,
                content: 'Deleted file comment',
                author: { displayName: 'Alice', id: 'a1' },
                publishedDate: '2024-01-15T10:00:00Z',
                commentType: 'text',
                isDeleted: false,
            }],
        }]);

        const provider = new PrChangesProvider({} as any);
        const result = await provider.openThreadById(makePr(), 'org', 13);

        expect(result).toBe(true);
        const [, leftUri, rightUri] = (vscode.commands.executeCommand as jest.Mock).mock.calls[0];
        expect(parsePrFileUri(leftUri)?.filePath).toBe('/src/deleted.ts');
        expect(rightUri.authority).toBe('empty');
    });

    it('falls back to markdown when file-thread commit context is missing', async () => {
        api.getPrIterations.mockResolvedValue([{
            id: 1,
            sourceRefCommit: { commitId: '' },
            targetRefCommit: { commitId: '' },
        }]);
        api.getPrChanges.mockResolvedValue([
            {
                changeType: 'edit',
                item: { path: '/src/app.ts' },
            },
        ]);
        api.getPrThreads.mockResolvedValue([{
            id: 14,
            status: 'active',
            isDeleted: false,
            threadContext: {
                filePath: '/src/app.ts',
                rightFileStart: { line: 4, offset: 1 },
                rightFileEnd: { line: 4, offset: 1 },
            },
            comments: [{
                id: 1,
                parentCommentId: 0,
                content: 'Fallback comment',
                author: { displayName: 'Alice', id: 'a1' },
                publishedDate: '2024-01-15T10:00:00Z',
                commentType: 'text',
                isDeleted: false,
            }],
        }]);
        (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({ uri: 'doc' });

        const provider = new PrChangesProvider({} as any);
        const result = await provider.openThreadById(makePr(), 'org', 14);

        expect(result).toBe(true);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
            'vscode.diff',
            expect.anything(),
            expect.anything(),
            expect.anything(),
        );
        expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
        expect(vscode.window.showTextDocument).toHaveBeenCalledWith({ uri: 'doc' }, { preview: true });
    });

    it('opens a general thread in the markdown document view', async () => {
        api.getPrIterations.mockResolvedValue([{
            id: 1,
            sourceRefCommit: { commitId: 'src123' },
            targetRefCommit: { commitId: 'tgt456' },
        }]);
        api.getPrChanges.mockResolvedValue([]);
        api.getPrThreads.mockResolvedValue([{
            id: 11,
            status: 'active',
            isDeleted: false,
            comments: [{
                id: 1,
                parentCommentId: 0,
                content: 'General comment',
                author: { displayName: 'Alice', id: 'a1' },
                publishedDate: '2024-01-15T10:00:00Z',
                commentType: 'text',
                isDeleted: false,
            }],
        }]);
        (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({ uri: 'doc' });

        const provider = new PrChangesProvider({} as any);
        const result = await provider.openThreadById(makePr(), 'org', 11);

        expect(result).toBe(true);
        expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
        expect(vscode.window.showTextDocument).toHaveBeenCalledWith({ uri: 'doc' }, { preview: true });
    });

    it('returns false when the requested thread no longer exists instead of opening a different one', async () => {
        api.getPrIterations.mockResolvedValue([{
            id: 1,
            sourceRefCommit: { commitId: 'src123' },
            targetRefCommit: { commitId: 'tgt456' },
        }]);
        api.getPrChanges.mockResolvedValue([]);
        api.getPrThreads.mockResolvedValue([{
            id: 11,
            status: 'active',
            isDeleted: false,
            comments: [{
                id: 1,
                parentCommentId: 0,
                content: 'Different thread',
                author: { displayName: 'Alice', id: 'a1' },
                publishedDate: '2024-01-15T10:00:00Z',
                commentType: 'text',
                isDeleted: false,
            }],
        }]);

        const provider = new PrChangesProvider({} as any);
        const result = await provider.openThreadById(makePr(), 'org', 99);

        expect(result).toBe(false);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });

    it('lists general comments before changed files in the root tree', async () => {
        api.getPrIterations.mockResolvedValue([{
            id: 1,
            sourceRefCommit: { commitId: 'src123' },
            targetRefCommit: { commitId: 'tgt456' },
        }]);
        api.getPrChanges.mockResolvedValue([
            {
                changeType: 'edit',
                item: { path: '/src/app.ts' },
            },
        ]);
        api.getPrThreads.mockResolvedValue([
            {
                id: 11,
                status: 'active',
                isDeleted: false,
                comments: [{
                    id: 1,
                    parentCommentId: 0,
                    content: 'General comment',
                    author: { displayName: 'Alice', id: 'a1' },
                    publishedDate: '2024-01-15T10:00:00Z',
                    commentType: 'text',
                    isDeleted: false,
                }],
            },
            {
                id: 12,
                status: 'active',
                isDeleted: false,
                threadContext: {
                    filePath: '/src/app.ts',
                    rightFileStart: { line: 12, offset: 1 },
                    rightFileEnd: { line: 12, offset: 1 },
                },
                comments: [{
                    id: 2,
                    parentCommentId: 0,
                    content: 'File comment',
                    author: { displayName: 'Bob', id: 'b1' },
                    publishedDate: '2024-01-15T10:05:00Z',
                    commentType: 'text',
                    isDeleted: false,
                }],
            },
        ]);

        const provider = new PrChangesProvider({} as any);
        provider.selectPr(makePr(), 'org');
        const items = await provider.getChildren();

        // Root has general-comments node + a folder node ('src') for /src/app.ts
        expect(items).toHaveLength(2);
        expect(items[0].label).toBe('General Comments (1)');
        expect(items[1].label).toBe('src');
    });
});
