import * as vscode from 'vscode';
import { PullRequestItem } from '../prSidebar';
import { execFile } from 'child_process';
import { parseRemoteUrl } from '../config';
import { getRemoteUrl } from '../git';

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

async function getPullRequestWorkspace(item: PullRequestItem): Promise<string | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const organization = item.org;
    const project = item.pr?.repository?.project?.name;
    const repository = item.pr?.repository?.name;
    if (!organization || !project || !repository) {
        return workspaceFolders[0]?.uri.fsPath;
    }

    const expectedOrganization = organization.toLowerCase();
    const expectedProject = project.toLowerCase();
    const expectedRepository = repository.toLowerCase();
    const candidates = await Promise.all(workspaceFolders.map(async (folder) => ({
        cwd: folder.uri.fsPath,
        remoteUrl: await getRemoteUrl(folder.uri.fsPath),
    })));

    return candidates.find(({ remoteUrl }) => {
        if (!remoteUrl) {
            return false;
        }
        const parsed = parseRemoteUrl(remoteUrl);
        return parsed.organization?.toLowerCase() === expectedOrganization
            && parsed.project?.toLowerCase() === expectedProject
            && parsed.repository?.toLowerCase() === expectedRepository;
    })?.cwd;
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

    const cwd = await getPullRequestWorkspace(item);
    if (!cwd) {
        const repository = pr.repository?.name;
        vscode.window.showErrorMessage(
            repository
                ? `No open workspace folder matches the pull request repository "${repository}".`
                : 'No workspace folder open.',
        );
        return false;
    }

    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Checking out ${branch}...` },
            async () => {
                try {
                    await runGit(['checkout', branch], cwd);
                } catch {
                    await runGit(['fetch', 'origin'], cwd);
                    await runGit(['checkout', branch], cwd);
                }
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
