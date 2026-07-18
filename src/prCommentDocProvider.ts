import * as vscode from 'vscode';

export const PR_COMMENT_SCHEME = 'azuredevops-pr-comment';

interface CommentDocument {
    uri: vscode.Uri;
    markdown: string;
}

function buildContentKey(org: string, repoId: string, prId: number, threadId: number): string {
    return `${org}\u0000${repoId}\u0000${prId}\u0000${threadId}`;
}

function parseCommentDocUri(uri: vscode.Uri): { org: string; repoId: string; prId: number; threadId: number } | undefined {
    if (uri.scheme !== PR_COMMENT_SCHEME || uri.authority !== 'thread') {
        return undefined;
    }

    const parts = uri.path.split('/');
    if (parts.length !== 5) {
        return undefined;
    }

    const prId = Number(parts[3]);
    const threadMatch = parts[4].match(/^Thread-(\d+)\.md$/);
    if (!Number.isInteger(prId) || !threadMatch) {
        return undefined;
    }

    return {
        org: decodeURIComponent(parts[1]),
        repoId: decodeURIComponent(parts[2]),
        prId,
        threadId: Number(threadMatch[1]),
    };
}

/** Build a read-only virtual-document URI for a thread in a specific pull request. */
export function buildCommentDocUri(org: string, repoId: string, prId: number, threadId: number): vscode.Uri {
    return vscode.Uri.parse(
        `${PR_COMMENT_SCHEME}://thread/${encodeURIComponent(org)}/${encodeURIComponent(repoId)}/${prId}/Thread-${threadId}.md`,
    );
}

/**
 * Serves full PR comment threads as read-only Markdown documents.
 * Navigation owns when content is stored or cleared; this provider ensures that
 * already-open documents receive content-change notifications.
 */
export class PrCommentDocProvider implements vscode.TextDocumentContentProvider {
    private readonly contentStore = new Map<string, CommentDocument>();
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    readonly onDidChange = this._onDidChange.event;

    setCommentContent(org: string, repoId: string, prId: number, threadId: number, markdown: string): void {
        const key = buildContentKey(org, repoId, prId, threadId);
        const uri = buildCommentDocUri(org, repoId, prId, threadId);
        this.contentStore.set(key, { uri, markdown });
        this._onDidChange.fire(uri);
    }

    clear(): void {
        const uris = [...this.contentStore.values()].map((document) => document.uri);
        this.contentStore.clear();
        for (const uri of uris) {
            this._onDidChange.fire(uri);
        }
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        const context = parseCommentDocUri(uri);
        if (!context) {
            return '';
        }

        return this.contentStore.get(
            buildContentKey(context.org, context.repoId, context.prId, context.threadId),
        )?.markdown ?? '';
    }
}
