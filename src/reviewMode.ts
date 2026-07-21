import * as vscode from 'vscode';
import * as path from 'path';
import { parseRemoteUrl } from './config';
import { getCurrentBranch, getRemoteUrl, getRepositoryRoot } from './git';

export interface ReviewModeRepository {
    organization: string;
    project: string;
    repository: string;
}

interface WorkspaceRepository {
    root: string;
    remoteUrl: string;
}

let workspaceRepositoryCache: {
    key: string;
    repository: Promise<WorkspaceRepository | undefined>;
} | undefined;

function workspaceRepositoryCacheKey(): string {
    return (vscode.workspace.workspaceFolders ?? [])
        .map((folder) => folder.uri.fsPath.toLowerCase())
        .join('\0');
}

function hasRepositoryIdentity(
    remoteUrl: string,
    repository: ReviewModeRepository,
): boolean {
    const remote = parseRemoteUrl(remoteUrl);
    return remote.organization?.toLowerCase() === repository.organization.toLowerCase()
        && remote.project?.toLowerCase() === repository.project.toLowerCase()
        && remote.repository?.toLowerCase() === repository.repository.toLowerCase();
}

async function discoverWorkspaceRepository(): Promise<WorkspaceRepository | undefined> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
        return undefined;
    }

    const [repositoryRoot, remoteUrl] = await Promise.all([
        getRepositoryRoot(cwd),
        getRemoteUrl(cwd),
    ]);

    return repositoryRoot && remoteUrl
        ? { root: repositoryRoot, remoteUrl }
        : undefined;
}

function getWorkspaceRepository(): Promise<WorkspaceRepository | undefined> {
    const key = workspaceRepositoryCacheKey();
    if (workspaceRepositoryCache?.key === key) {
        return workspaceRepositoryCache.repository;
    }

    const repository = discoverWorkspaceRepository();
    workspaceRepositoryCache = { key, repository };
    void repository.then(
        (resolvedRepository) => {
            if (!resolvedRepository && workspaceRepositoryCache?.repository === repository) {
                workspaceRepositoryCache = undefined;
            }
        },
        () => {
            if (workspaceRepositoryCache?.repository === repository) {
                workspaceRepositoryCache = undefined;
            }
        },
    );
    return repository;
}

export async function findMatchingWorkspaceRepositoryRoot(
    repository: ReviewModeRepository,
): Promise<string | undefined> {
    const workspaceRepository = await getWorkspaceRepository();
    return workspaceRepository
        && hasRepositoryIdentity(workspaceRepository.remoteUrl, repository)
        ? workspaceRepository.root
        : undefined;
}

/**
 * Starts resolving the local workspace repository for a PR before a reviewer
 * opens a changed file. The cached repository remains valid while the workspace
 * folder set is unchanged; branch state is always checked when opening.
 */
export function preloadReviewModeRepository(
    repository: ReviewModeRepository,
): Promise<string | undefined> {
    return findMatchingWorkspaceRepositoryRoot(repository);
}

async function tryGetReviewModeUriInRepository(
    repositoryRoot: string,
    sourceBranch: string,
    relativePath: string,
): Promise<vscode.Uri | undefined> {
    if (await getCurrentBranch(repositoryRoot) !== sourceBranch) {
        return undefined;
    }

    const fileUri = vscode.Uri.file(path.join(repositoryRoot, relativePath));
    try {
        await vscode.workspace.fs.stat(fileUri);
        return fileUri;
    } catch {
        // This matching repository does not contain the reviewed file.
        return undefined;
    }
}

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
    repository?: ReviewModeRepository,
): Promise<vscode.Uri | undefined> {
    if (!sourceBranch) { return undefined; }
    const relative = filePath.startsWith('/') ? filePath.slice(1) : filePath;

    if (repository) {
        const repositoryRoot = await findMatchingWorkspaceRepositoryRoot(repository);
        return repositoryRoot
            ? tryGetReviewModeUriInRepository(repositoryRoot, sourceBranch, relative)
            : undefined;
    }

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const [currentBranch, repoRoot] = await Promise.all([
        getCurrentBranch(cwd),
        getRepositoryRoot(cwd),
    ]);
    if (!currentBranch || currentBranch !== sourceBranch || !repoRoot) {
        return undefined;
    }

    const fileUri = vscode.Uri.file(path.join(repoRoot, relative));
    try {
        await vscode.workspace.fs.stat(fileUri);
        return fileUri;
    } catch {
        // The current workspace repository does not contain the reviewed file.
        return undefined;
    }
}
