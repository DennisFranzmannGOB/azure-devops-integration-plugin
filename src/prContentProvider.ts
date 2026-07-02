import * as vscode from 'vscode';
import { getFileContent } from './api';
import { getAuthenticationRequiredMessage, getToken } from './auth';

const VIRTUAL_FILE_MTIME = 0;
const EMPTY_PR_FILE_URI = 'azuredevops-pr://empty/empty';

function buildReadOnlyError(): Error {
    return vscode.FileSystemError.NoPermissions('azuredevops-pr is read-only');
}

export class PrContentProvider implements vscode.TextDocumentContentProvider, vscode.FileSystemProvider {
    private readonly secretStorage: vscode.SecretStorage;
    private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

    readonly onDidChangeFile = this._onDidChangeFile.event;

    constructor(secretStorage: vscode.SecretStorage) {
        this.secretStorage = secretStorage;
    }

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        return this.getVirtualFileContent(uri);
    }

    watch(_uri: vscode.Uri, _options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
        return new vscode.Disposable(() => undefined);
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        if (uri.authority === 'empty') {
            return {
                type: vscode.FileType.File,
                ctime: 0,
                mtime: VIRTUAL_FILE_MTIME,
                size: 0,
            };
        }

        const parsed = parsePrFileUri(uri);
        if (parsed) {
            return {
                type: vscode.FileType.File,
                ctime: 0,
                mtime: VIRTUAL_FILE_MTIME,
                size: 0,
            };
        }

        if (this.isVirtualDirectoryUri(uri)) {
            return {
                type: vscode.FileType.Directory,
                ctime: 0,
                mtime: VIRTUAL_FILE_MTIME,
                size: 0,
            };
        }

        throw vscode.FileSystemError.FileNotFound(uri);
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        if (this.isVirtualDirectoryUri(uri)) {
            return [];
        }

        throw vscode.FileSystemError.FileNotADirectory(uri);
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const content = await this.getVirtualFileContent(uri);
        return Buffer.from(content, 'utf8');
    }

    async createDirectory(_uri: vscode.Uri): Promise<void> {
        throw buildReadOnlyError();
    }

    async writeFile(
        _uri: vscode.Uri,
        _content: Uint8Array,
        _options: { readonly create: boolean; readonly overwrite: boolean },
    ): Promise<void> {
        throw buildReadOnlyError();
    }

    async delete(_uri: vscode.Uri, _options: { readonly recursive: boolean }): Promise<void> {
        throw buildReadOnlyError();
    }

    async rename(
        _oldUri: vscode.Uri,
        _newUri: vscode.Uri,
        _options: { readonly overwrite: boolean },
    ): Promise<void> {
        throw buildReadOnlyError();
    }

    private isVirtualDirectoryUri(uri: vscode.Uri): boolean {
        if (uri.scheme !== 'azuredevops-pr' || uri.authority === 'empty') {
            return false;
        }

        const parts = uri.path.split('/').filter((part) => part.length > 0);
        return parts.length < 4;
    }

    private async getVirtualFileContent(uri: vscode.Uri): Promise<string> {
        if (uri.authority === 'empty') {
            return '';
        }

        const parsed = parsePrFileUri(uri);
        if (!parsed) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        const token = await getToken(this.secretStorage);
        if (!token) {
            throw new Error(getAuthenticationRequiredMessage());
        }

        return await getFileContent(
            parsed.org,
            parsed.project,
            parsed.repoId,
            parsed.filePath,
            parsed.commitId,
            token,
        );
    }
}

export function buildEmptyPrFileUri(): vscode.Uri {
    // Custom file-system resources must use an absolute path segment. A bare
    // `azuredevops-pr://empty` URI can be treated by VS Code as a relative
    // path before our provider is consulted, so use a synthetic absolute file.
    return vscode.Uri.parse(EMPTY_PR_FILE_URI);
}

export function buildPrFileUri(
    org: string, project: string, repoId: string, commitId: string, filePath: string,
    prId?: number, side?: 'left' | 'right'
): vscode.Uri {
    // Encode each path segment so spaces and special characters in directory/file
    // names produce a valid URI. Slashes are preserved as separators.
    const encodedFilePath = filePath.split('/').map(encodeURIComponent).join('/');
    const base = `azuredevops-pr://${encodeURIComponent(org)}/${encodeURIComponent(project)}/${repoId}/${commitId}${encodedFilePath}`;
    const params = new URLSearchParams();
    if (prId !== undefined) { params.set('prId', String(prId)); }
    if (side) { params.set('side', side); }
    const query = params.toString();
    if (query) {
        return vscode.Uri.parse(base).with({ query });
    }
    return vscode.Uri.parse(base);
}

export interface PrFileUriContext {
    org: string;
    project: string;
    repoId: string;
    commitId: string;
    filePath: string;
    prId?: number;
    side?: 'left' | 'right';
}

export function parsePrFileUri(uri: vscode.Uri): PrFileUriContext | undefined {
    if (uri.scheme !== 'azuredevops-pr' || uri.authority === 'empty') {
        return undefined;
    }
    const org = decodeURIComponent(uri.authority);
    const parts = uri.path.split('/');
    // parts[0] is empty (leading slash), parts[1] = project, parts[2] = repoId, parts[3] = commitId, rest = filePath
    if (parts.length < 5) {
        return undefined;
    }
    const project = decodeURIComponent(parts[1]);
    const repoId = parts[2];
    const commitId = parts[3];
    const filePath = '/' + parts.slice(4).join('/');

    const queryParams = new URLSearchParams(uri.query);
    const prIdStr = queryParams.get('prId');
    const prId = prIdStr ? parseInt(prIdStr, 10) : undefined;
    const sideStr = queryParams.get('side');
    const side = (sideStr === 'left' || sideStr === 'right') ? sideStr : undefined;

    return { org, project, repoId, commitId, filePath, prId, side };
}
