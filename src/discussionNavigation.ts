import * as vscode from 'vscode';
import {
    EnrichedPullRequest,
    getPrChanges,
    getPrIterations,
    getPrThreads,
    PrChange,
    PrThread,
} from './api';
import { getToken } from './auth';
import { PrCommentDocProvider, buildCommentDocUri } from './prCommentDocProvider';
import { buildEmptyPrFileUri, buildPrFileUri } from './prContentProvider';

export interface ResolvedThreadPaths {
    displayFilePath?: string;
    leftFilePath?: string;
    rightFilePath?: string;
}

export interface DiscussionThreadTarget {
    thread: PrThread;
    org: string;
    project: string;
    repoId: string;
    prId: number;
    sourceCommitId: string;
    targetCommitId: string;
    diffPaths: ResolvedThreadPaths;
}

export interface InlineCommentAdapter {
    refreshAll(): Promise<void>;
}

export function resolveThreadPaths(thread: PrThread, changes: PrChange[] = []): ResolvedThreadPaths {
    const threadFilePath = thread.threadContext?.filePath;
    if (!threadFilePath) {
        return {};
    }

    const matchingChange = changes.find((change) => change.item?.path === threadFilePath)
        ?? changes.find((change) => change.originalPath === threadFilePath);

    const currentPath = matchingChange?.item?.path ?? threadFilePath;
    const originalPath = matchingChange?.originalPath ?? threadFilePath;

    switch (matchingChange?.changeType) {
        case 'add':
            return {
                displayFilePath: currentPath,
                rightFilePath: currentPath,
            };
        case 'delete':
            return {
                displayFilePath: currentPath,
                leftFilePath: originalPath,
            };
        default:
            return {
                displayFilePath: currentPath,
                leftFilePath: originalPath,
                rightFilePath: currentPath,
            };
    }
}

export class DiscussionNavigator {
    private sessionGeneration = 0;

    constructor(
        private readonly secretStorage: vscode.SecretStorage,
        private readonly transcripts: PrCommentDocProvider,
        private readonly inlineComments: InlineCommentAdapter,
    ) { }

    clear(): void {
        this.sessionGeneration++;
        this.transcripts.clear();
    }

    async openThread(target: DiscussionThreadTarget): Promise<void> {
        const sessionGeneration = this.sessionGeneration;
        const opened = await this.openThreadForGeneration(target, sessionGeneration);
        if (opened && this.isCurrentSession(sessionGeneration)) {
            await this.inlineComments.refreshAll();
        }
    }

    private async openThreadForGeneration(
        target: DiscussionThreadTarget,
        sessionGeneration: number,
    ): Promise<boolean> {
        if (!this.isCurrentSession(sessionGeneration)) {
            return false;
        }

        const context = target.thread.threadContext;
        const hasRequiredCommitContext =
            (!target.diffPaths.leftFilePath || !!target.targetCommitId) &&
            (!target.diffPaths.rightFilePath || !!target.sourceCommitId);

        if (!context?.filePath || !hasRequiredCommitContext) {
            return this.openTranscript(target, sessionGeneration);
        }

        return this.openDiffOrTranscript(target, sessionGeneration);
    }

    async openThreadById(pr: EnrichedPullRequest, org: string, threadId: number): Promise<boolean> {
        const sessionGeneration = this.sessionGeneration;
        const token = await getToken(this.secretStorage);
        if (!token || !this.isCurrentSession(sessionGeneration)) {
            return false;
        }

        const project = pr.repository?.project?.name ?? '';
        const repoId = pr.repository?.id ?? '';
        if (!project || !repoId) {
            return false;
        }

        try {
            const iterations = await getPrIterations(org, project, repoId, pr.pullRequestId, token);
            if (!this.isCurrentSession(sessionGeneration)) {
                return false;
            }

            const lastIteration = iterations.at(-1);
            const iterationId = lastIteration?.id;
            const sourceCommitId = lastIteration?.sourceRefCommit?.commitId ?? '';
            const targetCommitId = lastIteration?.targetRefCommit?.commitId ?? '';
            const [threads, changes] = await Promise.all([
                getPrThreads(org, project, repoId, pr.pullRequestId, token, iterationId, iterationId),
                iterationId
                    ? getPrChanges(org, project, repoId, pr.pullRequestId, iterationId, token)
                    : Promise.resolve([]),
            ]);
            if (!this.isCurrentSession(sessionGeneration)) {
                return false;
            }

            const thread = threads.find((candidate) =>
                candidate.id === threadId
                && !candidate.isDeleted
                && candidate.comments.some((comment) => !comment.isDeleted && comment.commentType !== 'system'),
            );
            if (!thread) {
                return false;
            }

            const opened = await this.openThreadForGeneration({
                thread,
                org,
                project,
                repoId,
                prId: pr.pullRequestId,
                sourceCommitId,
                targetCommitId,
                diffPaths: resolveThreadPaths(thread, changes),
            }, sessionGeneration);
            if (opened && this.isCurrentSession(sessionGeneration)) {
                await this.inlineComments.refreshAll();
                return true;
            }

            return false;
        } catch {
            return false;
        }
    }

    private async openDiffOrTranscript(
        target: DiscussionThreadTarget,
        sessionGeneration: number,
    ): Promise<boolean> {
        const context = target.thread.threadContext;
        const position = context?.rightFileStart ?? context?.leftFileStart;
        const line = Math.max(0, (position?.line ?? 1) - 1);
        const label = target.diffPaths.displayFilePath ?? context?.filePath ?? '';
        const leftUri = target.diffPaths.leftFilePath
            ? buildPrFileUri(
                target.org,
                target.project,
                target.repoId,
                target.targetCommitId,
                target.diffPaths.leftFilePath,
                target.prId,
                'left',
            )
            : buildEmptyPrFileUri();
        const rightUri = target.diffPaths.rightFilePath
            ? buildPrFileUri(
                target.org,
                target.project,
                target.repoId,
                target.sourceCommitId,
                target.diffPaths.rightFilePath,
                target.prId,
                'right',
            )
            : buildEmptyPrFileUri();

        try {
            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, label);
        } catch {
            return this.openTranscript(target, sessionGeneration);
        }

        if (!this.isCurrentSession(sessionGeneration)) {
            return false;
        }

        if (context?.rightFileStart && target.diffPaths.rightFilePath) {
            setTimeout(() => {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const range = new vscode.Range(line, 0, line, 0);
                    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                    editor.selection = new vscode.Selection(line, 0, line, 0);
                }
            }, 300);
        }

        return true;
    }

    private async openTranscript(
        target: DiscussionThreadTarget,
        sessionGeneration: number,
    ): Promise<boolean> {
        if (!this.isCurrentSession(sessionGeneration)) {
            return false;
        }

        const markdown = this.formatTranscript(target.thread);
        if (!markdown) {
            return false;
        }

        this.transcripts.setCommentContent(
            target.org,
            target.repoId,
            target.prId,
            target.thread.id,
            markdown,
        );

        const uri = buildCommentDocUri(target.org, target.repoId, target.prId, target.thread.id);
        const document = await vscode.workspace.openTextDocument(uri);
        if (!this.isCurrentSession(sessionGeneration)) {
            return false;
        }

        await vscode.window.showTextDocument(document, { preview: true });
        return this.isCurrentSession(sessionGeneration);
    }

    private formatTranscript(thread: PrThread): string | undefined {
        const comments = thread.comments.filter(
            (comment) => !comment.isDeleted && comment.commentType !== 'system',
        );
        if (comments.length === 0) {
            return undefined;
        }

        return comments
            .map((comment) => `**${comment.author.displayName}**\n\n${comment.content}`)
            .join('\n\n---\n\n');
    }

    private isCurrentSession(sessionGeneration: number): boolean {
        return this.sessionGeneration === sessionGeneration;
    }
}
