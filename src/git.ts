import * as vscode from 'vscode';
import { execFile } from 'child_process';

function getWorkspaceFolder(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function runGitCommand(args: string[], overrideCwd?: string): Promise<string | undefined> {
    const cwd = overrideCwd ?? getWorkspaceFolder();
    if (!cwd) {
        return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
        execFile('git', args, { cwd, encoding: 'utf-8', windowsHide: true }, (error, stdout) => {
            if (error) {
                resolve(undefined);
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

export async function getCurrentBranch(cwd?: string): Promise<string | undefined> {
    return runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

export async function getDefaultBranch(cwd?: string): Promise<string> {
    const result = await runGitCommand(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);
    if (result) {
        const parts = result.split('/');
        return parts[parts.length - 1];
    }
    return 'main';
}

export async function getRepositoryRoot(cwd?: string): Promise<string | undefined> {
    return runGitCommand(['rev-parse', '--show-toplevel'], cwd);
}

export async function getRemoteUrl(cwd?: string): Promise<string | undefined> {
    return runGitCommand(['remote', 'get-url', 'origin'], cwd);
}

export async function branchExistsOnRemote(branch: string, cwd?: string): Promise<boolean> {
    const result = await runGitCommand(['ls-remote', '--heads', 'origin', branch], cwd);
    return result !== undefined && result.length > 0;
}

export async function pushBranchToRemote(branch: string, cwd?: string): Promise<boolean> {
    const workDir = cwd ?? getWorkspaceFolder();
    if (!workDir) {
        return false;
    }
    return new Promise((resolve) => {
        execFile('git', ['push', '-u', 'origin', branch], { cwd: workDir, windowsHide: true }, (error) => {
            resolve(!error);
        });
    });
}
