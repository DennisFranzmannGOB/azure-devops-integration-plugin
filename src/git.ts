import * as vscode from 'vscode';
import { execFile } from 'child_process';

const GIT_COMMAND_TIMEOUT_MS = 5_000;

function getWorkspaceFolder(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function runGitCommand(args: string[], overrideCwd?: string): Promise<string | undefined> {
    const cwd = overrideCwd ?? getWorkspaceFolder();
    if (!cwd) {
        return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
        execFile('git', args, {
            cwd,
            encoding: 'utf-8',
            windowsHide: true,
            timeout: GIT_COMMAND_TIMEOUT_MS,
        }, (error, stdout) => {
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

export async function getRepositoryRoot(cwd?: string): Promise<string | undefined> {
    return runGitCommand(['rev-parse', '--show-toplevel'], cwd);
}

export async function getRemoteUrl(cwd?: string): Promise<string | undefined> {
    return runGitCommand(['remote', 'get-url', 'origin'], cwd);
}
