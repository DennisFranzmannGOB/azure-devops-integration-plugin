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
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const [currentBranch, repoRoot] = await Promise.all([
        getCurrentBranch(cwd),
        getRepositoryRoot(cwd),
    ]);
    if (!currentBranch || currentBranch !== sourceBranch || !repoRoot) { return undefined; }
    const relative = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    const absolute = path.join(repoRoot, relative);
    const fileUri = vscode.Uri.file(absolute);
    try {
        await vscode.workspace.fs.stat(fileUri);
        return fileUri;
    } catch {
        return undefined;
    }
}
