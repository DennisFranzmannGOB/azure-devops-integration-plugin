import * as vscode from 'vscode';
import * as path from 'path';
import { getCurrentBranch, getRepositoryRoot } from './git';

/**
 * Returns a real `file://` URI for the modified side of a PR diff when the
 * PR source branch is currently checked out. This enables native language
 * features (Go to Definition, hover, Find References) on the diff's right side.
 *
 * Returns `undefined` when the branch is not checked out or the file is not
 * present on disk.
 */
export async function tryGetReviewModeUri(
    sourceBranch: string,
    filePath: string,
): Promise<vscode.Uri | undefined> {
    if (!sourceBranch) { return undefined; }
    const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [undefined];
    const relative = filePath.startsWith('/') ? filePath.slice(1) : filePath;

    for (const cwd of workspaceRoots) {
        const [currentBranch, repoRoot] = await Promise.all([
            getCurrentBranch(cwd),
            getRepositoryRoot(cwd),
        ]);
        if (!currentBranch || currentBranch !== sourceBranch || !repoRoot) {
            continue;
        }

        const fileUri = vscode.Uri.file(path.join(repoRoot, relative));
        try {
            await vscode.workspace.fs.stat(fileUri);
            return fileUri;
        } catch {
            // This workspace folder is not the checked-out PR repository.
        }
    }

    return undefined;
}
