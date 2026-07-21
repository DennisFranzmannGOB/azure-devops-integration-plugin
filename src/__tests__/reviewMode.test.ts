import * as vscode from 'vscode';
import { preloadReviewModeRepository, tryGetReviewModeUri } from '../reviewMode';

jest.mock('../git', () => ({
    getCurrentBranch: jest.fn(),
    getRepositoryRoot: jest.fn(),
    getRemoteUrl: jest.fn(),
}));

const git = jest.requireMock('../git') as {
    getCurrentBranch: jest.Mock;
    getRepositoryRoot: jest.Mock;
    getRemoteUrl: jest.Mock;
};

describe('tryGetReviewModeUri', () => {
    beforeEach(() => {
        git.getCurrentBranch.mockReset();
        git.getRepositoryRoot.mockReset();
        git.getRemoteUrl.mockReset();
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

    it('uses only the first workspace folder by default', async () => {
        (vscode.workspace as any).workspaceFolders = [
            { uri: { fsPath: 'C:\\workspaces\\first-repository' } },
            { uri: { fsPath: 'C:\\workspaces\\reviewed-repository' } },
        ];
        git.getCurrentBranch.mockImplementation(async (cwd: string) =>
            cwd.includes('first-repository') ? 'main' : 'feature/review'
        );
        git.getRepositoryRoot.mockImplementation(async (cwd: string) => cwd);
        (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: { fsPath: string }) => {
            if (uri.fsPath.startsWith('C:\\workspaces\\first-repository')) {
                throw new Error('ENOENT: not found');
            }
            return {};
        });

        const result = await tryGetReviewModeUri(
            'feature/review',
            '/extensions/sample-extension/src/Codeunit.al',
        );

        expect(result).toBeUndefined();
        expect(git.getCurrentBranch).toHaveBeenCalledTimes(1);
        expect(git.getCurrentBranch).toHaveBeenCalledWith('C:\\workspaces\\first-repository');
    });

    it('resolves a multi-root workspace through its single shared repository', async () => {
        (vscode.workspace as any).workspaceFolders = [
            { uri: { fsPath: 'C:\\workspaces\\repository\\extensions\\first-module' } },
            { uri: { fsPath: 'C:\\workspaces\\repository\\extensions\\second-module' } },
        ];
        git.getCurrentBranch.mockResolvedValue('feature/review');
        git.getRepositoryRoot.mockImplementation(async (cwd: string) => {
            if (cwd.includes('second-module')) {
                throw new Error('The second workspace folder must not be inspected');
            }
            return 'C:\\workspaces\\repository';
        });
        git.getRemoteUrl.mockResolvedValue('https://dev.azure.com/org/proj/_git/repository');
        (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});

        const result = await tryGetReviewModeUri(
            'feature/review',
            '/extensions/second-module/src/Codeunit.al',
            { organization: 'org', project: 'proj', repository: 'repository' },
        );

        expect(result?.fsPath).toBe(
            'C:\\workspaces\\repository\\extensions\\second-module\\src\\Codeunit.al',
        );
    });

    it('reuses the preloaded workspace repository when opening a diff', async () => {
        (vscode.workspace as any).workspaceFolders = [
            { uri: { fsPath: 'C:\\workspaces\\preloaded-repository' } },
        ];
        git.getRepositoryRoot.mockResolvedValue('C:\\workspaces\\preloaded-repository');
        git.getRemoteUrl.mockResolvedValue('https://dev.azure.com/org/proj/_git/preloaded-repository');
        git.getCurrentBranch.mockResolvedValue('feature/review');
        (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});
        const repository = { organization: 'org', project: 'proj', repository: 'preloaded-repository' };

        await preloadReviewModeRepository(repository);
        git.getRepositoryRoot.mockClear();
        git.getRemoteUrl.mockClear();

        const result = await tryGetReviewModeUri('feature/review', '/src/Codeunit.al', repository);

        expect(result?.fsPath).toBe('C:\\workspaces\\preloaded-repository\\src\\Codeunit.al');
        expect(git.getRepositoryRoot).not.toHaveBeenCalled();
        expect(git.getRemoteUrl).not.toHaveBeenCalled();
    });

    it('retries repository discovery after a transient Git failure', async () => {
        (vscode.workspace as any).workspaceFolders = [
            { uri: { fsPath: 'C:\\workspaces\\retry-repository' } },
        ];
        git.getRepositoryRoot
            .mockResolvedValueOnce(undefined)
            .mockResolvedValue('C:\\workspaces\\retry-repository');
        git.getRemoteUrl.mockResolvedValue('https://dev.azure.com/org/proj/_git/retry-repository');
        git.getCurrentBranch.mockResolvedValue('feature/review');
        (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});
        const repository = { organization: 'org', project: 'proj', repository: 'retry-repository' };

        await expect(preloadReviewModeRepository(repository)).resolves.toBeUndefined();

        const result = await tryGetReviewModeUri('feature/review', '/src/Codeunit.al', repository);

        expect(result?.fsPath).toBe('C:\\workspaces\\retry-repository\\src\\Codeunit.al');
    });
});
