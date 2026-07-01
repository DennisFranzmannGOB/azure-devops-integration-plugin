import * as vscode from 'vscode';
import { tryGetReviewModeUri } from '../reviewMode';

jest.mock('../git', () => ({
    getCurrentBranch: jest.fn(),
    getRepositoryRoot: jest.fn(),
}));

const git = jest.requireMock('../git') as {
    getCurrentBranch: jest.Mock;
    getRepositoryRoot: jest.Mock;
};

describe('tryGetReviewModeUri', () => {
    beforeEach(() => {
        git.getCurrentBranch.mockReset();
        git.getRepositoryRoot.mockReset();
        (vscode.workspace.fs.stat as jest.Mock).mockReset();
        (vscode.workspace as any).workspaceFolders = undefined;
    });

    it('returns undefined when sourceBranch is empty', async () => {
        const result = await tryGetReviewModeUri('', '/src/foo.ts');
        expect(result).toBeUndefined();
        expect(git.getCurrentBranch).not.toHaveBeenCalled();
    });

    it('returns undefined when current branch does not match sourceBranch', async () => {
        git.getCurrentBranch.mockResolvedValue('main');
        git.getRepositoryRoot.mockResolvedValue('/repo');

        const result = await tryGetReviewModeUri('feature/my-pr', '/src/foo.ts');

        expect(result).toBeUndefined();
    });

    it('returns undefined when current branch is undefined', async () => {
        git.getCurrentBranch.mockResolvedValue(undefined);
        git.getRepositoryRoot.mockResolvedValue('/repo');

        const result = await tryGetReviewModeUri('feature/my-pr', '/src/foo.ts');

        expect(result).toBeUndefined();
    });

    it('returns undefined when repoRoot is undefined', async () => {
        git.getCurrentBranch.mockResolvedValue('feature/my-pr');
        git.getRepositoryRoot.mockResolvedValue(undefined);

        const result = await tryGetReviewModeUri('feature/my-pr', '/src/foo.ts');

        expect(result).toBeUndefined();
    });

    it('returns file URI when branch matches and file exists on disk', async () => {
        git.getCurrentBranch.mockResolvedValue('feature/my-pr');
        git.getRepositoryRoot.mockResolvedValue('/repo');
        (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});

        const result = await tryGetReviewModeUri('feature/my-pr', '/src/foo.ts');

        expect(result).toBeDefined();
        expect(vscode.workspace.fs.stat).toHaveBeenCalledTimes(1);
    });

    it('returns undefined when file does not exist on disk', async () => {
        git.getCurrentBranch.mockResolvedValue('feature/my-pr');
        git.getRepositoryRoot.mockResolvedValue('/repo');
        (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('ENOENT: not found'));

        const result = await tryGetReviewModeUri('feature/my-pr', '/src/foo.ts');

        expect(result).toBeUndefined();
    });

    it('strips leading slash from filePath before joining with repoRoot', async () => {
        git.getCurrentBranch.mockResolvedValue('my-branch');
        git.getRepositoryRoot.mockResolvedValue('/repo');
        (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});

        await tryGetReviewModeUri('my-branch', '/extensions/unitop/foo.al');

        // stat should have been called once, with a URI built from the joined path
        expect(vscode.workspace.fs.stat).toHaveBeenCalledTimes(1);
        const statArg = (vscode.workspace.fs.stat as jest.Mock).mock.calls[0][0];
        // The URI should not contain double slashes from joining '/repo' + '/extensions/...'
        expect(JSON.stringify(statArg)).not.toContain('//extensions');
    });

    it('passes workspaceFolders cwd to git helpers', async () => {
        (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/my/workspace' } }];
        git.getCurrentBranch.mockResolvedValue('my-branch');
        git.getRepositoryRoot.mockResolvedValue('/my/workspace');
        (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});

        await tryGetReviewModeUri('my-branch', '/src/file.ts');

        expect(git.getCurrentBranch).toHaveBeenCalledWith('/my/workspace');
        expect(git.getRepositoryRoot).toHaveBeenCalledWith('/my/workspace');
    });
});
