import * as vscode from 'vscode';
import { PrThread, getPrThreads, getPrIterations, addPullRequestFileComment, replyToThread, searchIdentitiesByDisplayName, updateThreadStatus, ThreadStatus } from './api';
import { parsePrFileUri } from './prContentProvider';
import { getAuthenticationRequiredMessage, getToken } from './auth';
import { prepareCommentContentWithMentions } from './commentMentions';

interface ThreadMeta {
    org: string;
    project: string;
    repoId: string;
    prId: number;
    threadId: number;
}

interface ReviewModeFileContext {
    org: string;
    project: string;
    repoId: string;
    prId: number;
    filePath: string;
}

export class PrCommentController implements vscode.Disposable {
    private readonly controller: vscode.CommentController;
    private readonly secretStorage: vscode.SecretStorage;
    private readonly vsThreads = new Map<string, vscode.CommentThread[]>();
    private readonly apiData = new Map<string, PrThread[]>();
    private readonly loadingKeys = new Set<string>();
    private readonly placedThreadIds = new Set<string>();
    private readonly disposables: vscode.Disposable[] = [];
    private readonly threadMeta = new WeakMap<vscode.CommentThread, ThreadMeta>();
    private readonly reviewModeFiles = new Map<string, ReviewModeFileContext>();

    private readonly _onDidAddComment = new vscode.EventEmitter<void>();
    readonly onDidAddComment = this._onDidAddComment.event;

    constructor(secretStorage: vscode.SecretStorage) {
        this.secretStorage = secretStorage;
        this.controller = vscode.comments.createCommentController(
            'azureDevopsPrComments',
            'Azure DevOps PR Comments'
        );
        this.controller.commentingRangeProvider = {
            provideCommentingRanges: (document: vscode.TextDocument) => {
                const ctx = parsePrFileUri(document.uri);
                if (ctx?.prId && ctx.side !== 'left') {
                    return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
                }
                // Also allow commenting on real (review-mode) files
                if (this.reviewModeFiles.has(document.uri.toString())) {
                    return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
                }
                return [];
            },
        };

        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument((doc) => this.onDocumentOpen(doc))
        );
    }

    /** Register a real (file://) document as the modified side of a PR diff, enabling
     *  comment creation and placement when the PR branch is checked out locally. */
    async registerReviewModeFile(
        fileUri: vscode.Uri,
        org: string, project: string, repoId: string, prId: number, filePath: string
    ): Promise<void> {
        this.reviewModeFiles.set(fileUri.toString(), { org, project, repoId, prId, filePath });

        // Re-assign commentingRangeProvider so VS Code re-queries provideCommentingRanges
        // for all currently open documents. Without this, the comment gutter "+" button
        // won't appear when the diff was already open before this registration ran.
        this.controller.commentingRangeProvider = this.controller.commentingRangeProvider;

        const cacheKey = `${org}/${project}/${repoId}/${prId}`;
        if (this.apiData.has(cacheKey)) {
            // Threads already loaded — re-run placement for any unplaced threads
            this.placeThreadsForOpenDocs(cacheKey, org, project, repoId, prId);
        } else {
            // loadThreads fetches data and calls placeThreadsForOpenDocs internally
            await this.loadThreads(org, project, repoId, prId);
        }
    }

    /** Call after construction to load comments for already-open documents. */
    loadExisting(): void {
        for (const doc of vscode.workspace.textDocuments) {
            this.onDocumentOpen(doc);
        }
    }

    private async onDocumentOpen(doc: vscode.TextDocument): Promise<void> {
        const ctx = parsePrFileUri(doc.uri);
        if (!ctx?.prId) { return; }

        const cacheKey = `${ctx.org}/${ctx.project}/${ctx.repoId}/${ctx.prId}`;

        if (this.apiData.has(cacheKey)) {
            // API data already fetched — just place threads for this newly opened doc
            this.placeThreadsForOpenDocs(cacheKey, ctx.org, ctx.project, ctx.repoId, ctx.prId);
            return;
        }

        await this.loadThreads(ctx.org, ctx.project, ctx.repoId, ctx.prId);
    }

    async loadThreads(org: string, project: string, repoId: string, prId: number): Promise<void> {
        const cacheKey = `${org}/${project}/${repoId}/${prId}`;

        // Prevent concurrent loads for the same PR
        if (this.loadingKeys.has(cacheKey) || this.apiData.has(cacheKey)) {
            return;
        }
        this.loadingKeys.add(cacheKey);

        try {
            const token = await getToken(this.secretStorage);
            if (!token) { return; }

            const iterations = await getPrIterations(org, project, repoId, prId, token).catch(() => undefined);
            const latestIterationId = iterations?.at(-1)?.id;
            const apiThreads = await getPrThreads(org, project, repoId, prId, token, latestIterationId, latestIterationId,);
            this.apiData.set(cacheKey, apiThreads);
            this.placeThreadsForOpenDocs(cacheKey, org, project, repoId, prId);
        } catch {
            // silently fail
        } finally {
            this.loadingKeys.delete(cacheKey);
        }
    }

    private placeThreadsForOpenDocs(
        cacheKey: string, org: string, project: string, repoId: string, prId: number
    ): void {
        const apiThreads = this.apiData.get(cacheKey);
        if (!apiThreads) { return; }

        for (const thread of apiThreads) {
            const threadKey = `${cacheKey}/${thread.id}`;
            if (this.placedThreadIds.has(threadKey)) { continue; }
            if (thread.isDeleted) { continue; }

            const userComments = thread.comments.filter(
                (c) => !c.isDeleted && c.commentType !== 'system'
            );
            if (userComments.length === 0) { continue; }

            const vsThread = thread.threadContext?.filePath
                ? this.placeFileThread(thread, userComments, org, project, repoId, prId)
                : undefined;

            if (vsThread) {
                this.placedThreadIds.add(threadKey);
                const existing = this.vsThreads.get(cacheKey) ?? [];
                existing.push(vsThread);
                this.vsThreads.set(cacheKey, existing);
            }
        }
    }

    private placeFileThread(
        thread: PrThread,
        userComments: PrThread['comments'],
        org: string, project: string, repoId: string, prId: number
    ): vscode.CommentThread | undefined {
        const ctx = thread.threadContext;
        if (!ctx) { return undefined; }

        const filePath = ctx.filePath;
        const isRight = !!ctx.rightFileStart;
        const startPos = isRight ? ctx.rightFileStart : ctx.leftFileStart;
        const endPos = isRight ? ctx.rightFileEnd : ctx.leftFileEnd;
        const startLine = startPos ? startPos.line - 1 : 0;
        const endLine = endPos ? endPos.line - 1 : startLine;
        const side = isRight ? 'right' : 'left';

        const matchingDoc = vscode.workspace.textDocuments.find((doc) => {
            const parsed = parsePrFileUri(doc.uri);
            if (parsed) {
                return parsed.org === org && parsed.repoId === repoId
                    && parsed.prId === prId && parsed.filePath === filePath
                    && parsed.side === side;
            }
            // Also match review-mode real files (right side only)
            if (side === 'right') {
                const rm = this.reviewModeFiles.get(doc.uri.toString());
                return rm?.org === org && rm.repoId === repoId
                    && rm.prId === prId && rm.filePath === filePath;
            }
            return false;
        });
        if (!matchingDoc) { return undefined; }

        const meta = { org, project, repoId, prId, threadId: thread.id };
        return this.createVsThread(matchingDoc.uri, startLine, endLine, thread, userComments, meta);
    }

    private createVsThread(
        uri: vscode.Uri, startLine: number, endLine: number, thread: PrThread,
        userComments: PrThread['comments'], meta: ThreadMeta
    ): vscode.CommentThread {
        const comments: vscode.Comment[] = userComments.map((c) => ({
            body: new vscode.MarkdownString(c.content),
            mode: vscode.CommentMode.Preview,
            author: { name: c.author.displayName },
            timestamp: new Date(c.publishedDate),
        }));

        const range = new vscode.Range(startLine, 0, endLine, 0);
        const vsThread = this.controller.createCommentThread(uri, range, comments);
        vsThread.canReply = true;
        vsThread.label = thread.status === 'active' ? 'Active' : thread.status;
        vsThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        vsThread.contextValue = `prCommentThread.${thread.status ?? 'unknown'}`;
        this.threadMeta.set(vsThread, meta);
        return vsThread;
    }

    async createThread(reply: vscode.CommentReply): Promise<void> {
        const uri = reply.thread.uri;
        const ctx = parsePrFileUri(uri);
        const rmCtx = !ctx?.prId ? this.reviewModeFiles.get(uri.toString()) : undefined;
        if (!ctx?.prId && !rmCtx) { return; }

        const org = ctx?.org ?? rmCtx!.org;
        const project = ctx?.project ?? rmCtx!.project;
        const repoId = ctx?.repoId ?? rmCtx!.repoId;
        const prId = ctx?.prId ?? rmCtx!.prId;
        const filePath = ctx?.filePath ?? rmCtx!.filePath;
        const isRight = rmCtx !== undefined ? true : ctx!.side !== 'left';

        const token = await getToken(this.secretStorage);
        if (!token) {
            vscode.window.showErrorMessage(getAuthenticationRequiredMessage());
            return;
        }

        const range = reply.thread.range;
        const startLine = (range?.start.line ?? 0) + 1;
        const endLine = (range?.end.line ?? range?.start.line ?? 0) + 1;
        const startPosition = { line: startLine, offset: 1 };
        const endPosition = { line: endLine, offset: 1 };

        try {
            const preparedText = await prepareCommentContentWithMentions(
                reply.text,
                (lookupName) => searchIdentitiesByDisplayName(org, lookupName, token),
            );
            const result = await addPullRequestFileComment(
                org, project, repoId, prId,
                preparedText,
                {
                    filePath,
                    ...(isRight
                        ? { rightFileStart: startPosition, rightFileEnd: endPosition }
                        : { leftFileStart: startPosition, leftFileEnd: endPosition }),
                },
                token
            );

            reply.thread.comments = [
                ...reply.thread.comments,
                {
                    body: new vscode.MarkdownString(preparedText),
                    mode: vscode.CommentMode.Preview,
                    author: { name: 'You' },
                    timestamp: new Date(),
                },
            ];
            reply.thread.canReply = true;
            reply.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
            reply.thread.contextValue = 'prCommentThread.active';

            this.threadMeta.set(reply.thread, { org, project, repoId, prId, threadId: result.id });

            const cacheKey = `${org}/${project}/${repoId}/${prId}`;
            const existing = this.vsThreads.get(cacheKey) ?? [];
            existing.push(reply.thread);
            this.vsThreads.set(cacheKey, existing);
            this._onDidAddComment.fire();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to add comment: ${msg}`);
        }
    }

    async replyToThread(reply: vscode.CommentReply): Promise<void> {
        const meta = this.threadMeta.get(reply.thread);
        if (!meta) {
            await this.createThread(reply);
            return;
        }

        const token = await getToken(this.secretStorage);
        if (!token) {
            vscode.window.showErrorMessage(getAuthenticationRequiredMessage());
            return;
        }

        try {
            const preparedText = await prepareCommentContentWithMentions(
                reply.text,
                (lookupName) => searchIdentitiesByDisplayName(meta.org, lookupName, token),
            );
            await replyToThread(
                meta.org, meta.project, meta.repoId, meta.prId,
                meta.threadId, preparedText, token
            );

            reply.thread.comments = [
                ...reply.thread.comments,
                {
                    body: new vscode.MarkdownString(preparedText),
                    mode: vscode.CommentMode.Preview,
                    author: { name: 'You' },
                    timestamp: new Date(),
                },
            ];
            this._onDidAddComment.fire();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to reply: ${msg}`);
        }
    }

    async changeStatus(vsThread: vscode.CommentThread, status: ThreadStatus): Promise<void> {
        const meta = this.threadMeta.get(vsThread);
        if (!meta) { return; }
        const token = await getToken(this.secretStorage);
        if (!token) { return; }
        try {
            await updateThreadStatus(meta.org, meta.project, meta.repoId, meta.prId, meta.threadId, status, token);
            vsThread.label = status === 'active' ? 'Active' : status;
            vsThread.contextValue = `prCommentThread.${status}`;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to update thread status: ${msg}`);
        }
    }

    isReviewModeFile(uri: vscode.Uri): boolean {
        return this.reviewModeFiles.has(uri.toString());
    }

    getReviewModeFileInfo(uri: vscode.Uri): { org: string; prId: number } | undefined {
        const ctx = this.reviewModeFiles.get(uri.toString());
        return ctx ? { org: ctx.org, prId: ctx.prId } : undefined;
    }

    async refreshAll(): Promise<void> {
        // Preserve review-mode registrations: clearAll drops them, but they belong
        // to diff editors that are still open and need comments/gutter to keep working.
        const savedReviewModeFiles = new Map(this.reviewModeFiles);
        this.clearAll();
        this.loadExisting();
        for (const [uriString, ctx] of savedReviewModeFiles) {
            const stillOpen = vscode.workspace.textDocuments.some(d => d.uri.toString() === uriString);
            if (stillOpen) {
                await this.registerReviewModeFile(
                    vscode.Uri.parse(uriString), ctx.org, ctx.project, ctx.repoId, ctx.prId, ctx.filePath
                );
            }
        }
    }

    clearAll(): void {
        for (const threads of this.vsThreads.values()) {
            for (const t of threads) { t.dispose(); }
        }
        this.vsThreads.clear();
        this.apiData.clear();
        this.placedThreadIds.clear();
        this.reviewModeFiles.clear();
    }

    dispose(): void {
        this.clearAll();
        this.controller.dispose();
        this._onDidAddComment.dispose();
        for (const d of this.disposables) { d.dispose(); }
    }
}
