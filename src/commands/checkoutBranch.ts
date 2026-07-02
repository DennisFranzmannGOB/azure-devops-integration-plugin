import * as vscode from 'vscode';
import { PullRequestItem } from '../prSidebar';
import { execFile } from 'child_process';

function runGit(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd, encoding: 'utf-8', windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

export async function checkoutPrBranch(item: PullRequestItem): Promise<boolean> {
    const pr = item.pr;
    if (!pr) {
        vscode.window.showErrorMessage('No pull request data available.');
        return false;
    }

    const branch = pr.sourceRefName?.replace(/^refs\/heads\//, '');
    if (!branch) {
        vscode.window.showErrorMessage('No source branch found.');
        return false;
    }

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return false;
    }

    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Checking out ${branch}...` },
            async () => {
                await runGit(['fetch', 'origin'], cwd);
                await runGit(['checkout', branch], cwd);
            }
        );
        vscode.window.showInformationMessage(`Checked out branch: ${branch}`);
        return true;
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to checkout: ${message}`);
        return false;
    }
}
