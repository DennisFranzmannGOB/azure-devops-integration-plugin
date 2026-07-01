import * as vscode from 'vscode';
import { EnrichedPullRequest, getPrIterations, getPrChanges, getPrThreads, PrChange, PrThread, replyToThread, addPullRequestComment, ThreadStatus, updateThreadStatus } from './api';
import { getToken } from './auth';
import { buildPrFileUri } from './prContentProvider';
import { setCommentContent, buildCommentDocUri, clearCommentContent } from './prCommentDocProvider';
import { ReviewedFilesStore } from './reviewedFiles';

export interface SelectedPrContext {
    org: string;
    repoId: string;
    prId: number;
}

export function buildSelectedPrContext(pr: EnrichedPullRequest, org: string): SelectedPrContext {
    return {
        org,
        repoId: pr.repository?.id ?? '',
        prId: pr.pullRequestId,
    };
}

export function sameSelectedPrContext(
    left: SelectedPrContext | undefined,
    right: SelectedPrContext | undefined,
): boolean {
    return !!left && !!right
        && left.org === right.org
        && left.repoId === right.repoId
        && left.prId === right.prId;
}

// --- Tree item types ---

export type PrChangesTreeItem = PrFileItem | PrFolderItem | PrCommentThreadItem | PrCommentReplyItem | PrGeneralCommentsItem;

export class PrFileItem extends vscode.TreeItem {
    public children?: PrCommentThreadItem[];

    constructor(
        public readonly change: PrChange,
        public readonly org: string,
        public readonly project: string,
        public readonly repoId: string,
        public readonly sourceCommitId: string,
        public readonly targetCommitId: string,
        public readonly prId: number,
        public readonly sourceBranch: string = '',
        reviewed: boolean = false,
    ) {
        const fileName = change.item.path.split('/').pop() ?? change.item.path;
        super(fileName, vscode.TreeItemCollapsibleState.None);

        this.tooltip = `${change.changeType}: ${change.item.path}`;
        this.contextValue = 'prFile';
        this.checkboxState = reviewed
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked;

        switch (change.changeType) {
            case 'add':
                this.iconPath = new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
                break;
            case 'delete':
                this.iconPath = new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
                break;
            case 'rename':
                this.iconPath = new vscode.ThemeIcon('diff-renamed', new vscode.ThemeColor('gitDecoration.renamedResourceForeground'));
                break;
            default:
                this.iconPath = new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
                break;
        }

        this.command = {
            command: 'azureDevops.openPrFileDiff',
            title: 'Open Diff',
            arguments: [this],
        };
    }
}

export class PrCommentThreadItem extends vscode.TreeItem {
    public readonly replyItems: PrCommentReplyItem[];

    constructor(
        public readonly thread: PrThread,
        public readonly org: string,
        public readonly project: string,
        public readonly repoId: string,
        public readonly prId: number,
        public readonly sourceCommitId: string,
        public readonly targetCommitId: string,
    ) {
        const userComments = thread.comments.filter(
            (c) => !c.isDeleted && c.commentType !== 'system'
        );
        const firstComment = userComments[0];
        const author = firstComment?.author.displayName ?? 'Unknown';
        const preview = firstComment
            ? firstComment.content.replaceAll('\n', ' ').slice(0, 80)
            : '';

        const filePath = thread.threadContext?.filePath;
        const isGeneral = !filePath;

        const hasReplies = userComments.length > 1;
        super(
            `${author}: ${preview}`,
            hasReplies ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        );

        const replyCount = userComments.length - 1;
        this.description = replyCount > 0 ? `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` : '';

        const location = filePath ? `on \`${filePath}\`` : '(general PR comment)';
        const pos = thread.threadContext?.rightFileStart ?? thread.threadContext?.leftFileStart;
        const lineNum = pos?.line;
        const lineInfo = lineNum ? ` line ${lineNum}` : '';
        const replyInfo = replyCount > 0 ? `\n\n---\n*${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}*` : '';
        this.tooltip = new vscode.MarkdownString(
            `**${author}** ${location}${lineInfo}\n\n${firstComment?.content ?? ''}${replyInfo}`
        );

        this.replyItems = userComments.slice(1).map((c) =>
            new PrCommentReplyItem(c.author.displayName, c.content, this)
        );

        if (isGeneral) {
            this.iconPath = new vscode.ThemeIcon('megaphone', new vscode.ThemeColor('charts.blue'));
        } else {
            switch (thread.status) {
                case 'active':
                    this.iconPath = new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor('charts.yellow'));
                    break;
                case 'fixed':
                case 'closed':
                case 'wontFix':
                case 'byDesign':
                    this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
                    break;
                default:
                    this.iconPath = new vscode.ThemeIcon('comment');
                    break;
            }
        }

        this.contextValue = `discussionThread.${thread.status ?? 'unknown'}`;

        if (isGeneral || (filePath && sourceCommitId && targetCommitId)) {
            this.command = {
                command: 'azureDevops.openDiscussionComment',
                title: 'Open Comment',
                arguments: [this],
            };
        }
    }
}

export class PrCommentReplyItem extends vscode.TreeItem {
    constructor(
        public readonly author: string,
        public readonly content: string,
        parentItem: PrCommentThreadItem,
    ) {
        super(author, vscode.TreeItemCollapsibleState.None);
        const preview = content.replaceAll('\n', ' ').slice(0, 100);
        this.description = preview;
        this.tooltip = new vscode.MarkdownString(`**${author}**\n\n${content}`);
        this.iconPath = new vscode.ThemeIcon('comment');
        this.command = {
            command: 'azureDevops.openDiscussionComment',
            title: 'Open Comment',
            arguments: [parentItem],
        };
    }
}

export class PrGeneralCommentsItem extends vscode.TreeItem {
    constructor(public readonly children: PrCommentThreadItem[]) {
        super(
            `General Comments (${children.length})`,
            vscode.TreeItemCollapsibleState.Collapsed,
        );
        this.iconPath = new vscode.ThemeIcon('megaphone', new vscode.ThemeColor('charts.blue'));
        this.contextValue = 'generalComments';
    }
}

export class PrFolderItem extends vscode.TreeItem {
    constructor(
        label: string,
        public readonly children: (PrFolderItem | PrFileItem)[],
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'prFolder';
        this.checkboxState = computeFolderCheckboxState(children);
    }
}

function computeFolderCheckboxState(children: (PrFolderItem | PrFileItem)[]): vscode.TreeItemCheckboxState {
    const allFiles = collectAllFiles(children);
    if (allFiles.length === 0) { return vscode.TreeItemCheckboxState.Unchecked; }
    return allFiles.every(f => f.checkboxState === vscode.TreeItemCheckboxState.Checked)
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
}

function collectAllFiles(children: (PrFolderItem | PrFileItem)[]): PrFileItem[] {
    const result: PrFileItem[] = [];
    for (const child of children) {
        if (child instanceof PrFileItem) {
            result.push(child);
        } else {
            result.push(...collectAllFiles(child.children));
        }
    }
    return result;
}

// --- Folder-tree helpers ---

interface FolderNode {
    folders: Map<string, FolderNode>;
    files: PrFileItem[];
}

function buildFolderTree(fileItems: PrFileItem[]): (PrFolderItem | PrFileItem)[] {
    const root: FolderNode = { folders: new Map(), files: [] };
    for (const item of fileItems) {
        const parts = item.change.item.path.split('/').filter(p => p.length > 0);
        const dirParts = parts.slice(0, -1);
        let node = root;
        for (const part of dirParts) {
            if (!node.folders.has(part)) {
                node.folders.set(part, { folders: new Map(), files: [] });
            }
            node = node.folders.get(part)!;
        }
        node.files.push(item);
    }
    return folderNodeToChildren(root);
}

function folderNodeToChildren(node: FolderNode): (PrFolderItem | PrFileItem)[] {
    const items: (PrFolderItem | PrFileItem)[] = [];
    for (const [name, child] of node.folders) {
        items.push(compactFolderNode(name, child));
    }
    items.push(...node.files);
    items.sort((a, b) => {
        const aIsFolder = a instanceof PrFolderItem;
        const bIsFolder = b instanceof PrFolderItem;
        if (aIsFolder !== bIsFolder) { return aIsFolder ? -1 : 1; }
        const aLabel = typeof a.label === 'string' ? a.label : (a.label as vscode.TreeItemLabel)?.label ?? '';
        const bLabel = typeof b.label === 'string' ? b.label : (b.label as vscode.TreeItemLabel)?.label ?? '';
        return aLabel.localeCompare(bLabel);
    });
    return items;
}

function compactFolderNode(name: string, node: FolderNode): PrFolderItem {
    let displayName = name;
    let current = node;
    // Compact single-child-folder chains (no files, one sub-folder) like VS Code compact folders
    while (current.files.length === 0 && current.folders.size === 1) {
        const [childName, child] = [...current.folders.entries()][0];
        displayName += '/' + childName;
        current = child;
    }
    return new PrFolderItem(displayName, folderNodeToChildren(current));
}

// --- Provider ---

export class PrChangesProvider implements vscode.TreeDataProvider<PrChangesTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<PrChangesTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private selectedPr?: EnrichedPullRequest;
    private selectedOrg?: string;
    private currentIterationId?: number;
    private readonly secretStorage: vscode.SecretStorage;
    private readonly reviewedStore?: ReviewedFilesStore;

    constructor(secretStorage: vscode.SecretStorage, reviewedStore?: ReviewedFilesStore) {
        this.secretStorage = secretStorage;
        this.reviewedStore = reviewedStore;
    }

    getSelectedPrContext(): SelectedPrContext | undefined {
        if (!this.selectedPr || !this.selectedOrg) {
            return undefined;
        }

        return buildSelectedPrContext(this.selectedPr, this.selectedOrg);
    }

    selectPr(pr: EnrichedPullRequest, org: string): boolean {
        const current = this.getSelectedPrContext();
        const next = buildSelectedPrContext(pr, org);
        const switchedPr = !!current && !sameSelectedPrContext(current, next);

        this.selectedPr = pr;
        this.selectedOrg = org;
        if (switchedPr) {
            clearCommentContent();
        }
        this._onDidChangeTreeData.fire();

        return switchedPr;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.selectedPr = undefined;
        this.selectedOrg = undefined;
        this.currentIterationId = undefined;
        clearCommentContent();
        this._onDidChangeTreeData.fire();
    }

    setReviewed(item: PrFileItem, reviewed: boolean): void {
        if (!this.reviewedStore || !this.selectedPr || this.currentIterationId === undefined) { return; }
        this.reviewedStore.setReviewed(
            this.selectedPr.pullRequestId,
            this.currentIterationId,
            item.change.item.path,
            reviewed,
        );
        this._onDidChangeTreeData.fire();
    }

    resetCurrentPr(): void {
        if (!this.reviewedStore || !this.selectedPr) { return; }
        this.reviewedStore.resetPr(this.selectedPr.pullRequestId);
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PrChangesTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: PrChangesTreeItem): Promise<PrChangesTreeItem[]> | PrChangesTreeItem[] {
        if (element instanceof PrFolderItem) {
            return element.children;
        }
        if (element instanceof PrFileItem) {
            return element.children ?? [];
        }
        if (element instanceof PrCommentThreadItem) {
            return element.replyItems;
        }
        if (element instanceof PrGeneralCommentsItem) {
            return element.children;
        }
        if (element instanceof PrCommentReplyItem) {
            return [];
        }
        return this.getRootItems();
    }

    private async getRootItems(): Promise<PrChangesTreeItem[]> {
        if (!this.selectedPr || !this.selectedOrg) {
            return [];
        }

        const token = await getToken(this.secretStorage);
        if (!token) { return []; }

        const pr = this.selectedPr;
        const org = this.selectedOrg;
        const project = pr.repository?.project?.name ?? '';
        const repoId = pr.repository?.id ?? '';

        try {
            const iterations = await getPrIterations(org, project, repoId, pr.pullRequestId, token);
            if (iterations.length === 0) { return []; }

            const lastIteration = iterations[iterations.length - 1];
            const [changes, threads] = await Promise.all([
                getPrChanges(org, project, repoId, pr.pullRequestId, lastIteration.id, token),
                getPrThreads(org, project, repoId, pr.pullRequestId, token),
            ]);

            const sourceCommitId = lastIteration.sourceRefCommit?.commitId ?? '';
            const targetCommitId = lastIteration.targetRefCommit?.commitId ?? '';

            // Reviewed-files state: if a new iteration arrived, fetch only the files
            // that changed between the previous and current iteration and remove marks
            // for those — unchanged files keep their marks (matches ADO web portal behaviour).
            this.currentIterationId = lastIteration.id;
            if (this.reviewedStore) {
                const storedIterationId = this.reviewedStore.getStoredIterationId(pr.pullRequestId);
                const isNewIteration = storedIterationId !== undefined && storedIterationId !== lastIteration.id;
                if (isNewIteration) {
                    try {
                        const deltaChanges = await getPrChanges(
                            org, project, repoId, pr.pullRequestId, lastIteration.id, token, storedIterationId
                        );
                        const changedPaths = deltaChanges
                            .filter(c => c.item?.path)
                            .map(c => c.item.path);
                        this.reviewedStore.advanceIteration(pr.pullRequestId, lastIteration.id, changedPaths);
                    } catch {
                        // If the delta fetch fails, advance without removing any paths
                        // rather than silently clearing everything.
                        this.reviewedStore.advanceIteration(pr.pullRequestId, lastIteration.id, []);
                    }
                } else if (storedIterationId === undefined) {
                    // First load for this PR — record the iteration id with no marks removed.
                    this.reviewedStore.advanceIteration(pr.pullRequestId, lastIteration.id, []);
                }
            }
            const reviewed = this.reviewedStore?.getReviewedFiles(pr.pullRequestId) ?? new Set<string>();
            const hideReviewed = vscode.workspace.getConfiguration('azureDevops').get<boolean>('hideReviewedFiles', false);

            // Filter to visible threads (not deleted, has user comments)
            const visibleThreads = threads.filter((t) =>
                !t.isDeleted &&
                t.comments.some((c) => !c.isDeleted && c.commentType !== 'system')
            );

            // Group threads by file path
            const fileThreads = new Map<string, PrThread[]>();
            const generalThreads: PrThread[] = [];
            for (const thread of visibleThreads) {
                const filePath = thread.threadContext?.filePath;
                if (filePath) {
                    const existing = fileThreads.get(filePath) ?? [];
                    existing.push(thread);
                    fileThreads.set(filePath, existing);
                } else {
                    generalThreads.push(thread);
                }
            }

            const sourceBranch = pr.sourceRefName?.replace(/^refs\/heads\//, '') ?? '';

            // Build file items with thread children
            const fileItems = changes
                .filter(c => c.item?.path)
                .filter(c => !(hideReviewed && reviewed.has(c.item.path)))
                .map(c => {
                    const item = new PrFileItem(
                        c, org, project, repoId, sourceCommitId, targetCommitId, pr.pullRequestId, sourceBranch,
                        reviewed.has(c.item.path),
                    );
                    const threads = fileThreads.get(c.item.path);
                    if (threads && threads.length > 0) {
                        item.children = threads.map((t) =>
                            new PrCommentThreadItem(t, org, project, repoId, pr.pullRequestId, sourceCommitId, targetCommitId)
                        );
                        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                    }
                    return item;
                });

            const rootItems: PrChangesTreeItem[] = [];

            // Show general comments first so they are easy to spot without
            // scrolling past the changed files list.
            if (generalThreads.length > 0) {
                const generalChildren = generalThreads.map((t) =>
                    new PrCommentThreadItem(t, org, project, repoId, pr.pullRequestId, sourceCommitId, targetCommitId)
                );
                rootItems.push(new PrGeneralCommentsItem(generalChildren));
            }

            // Nest files in a folder tree
            rootItems.push(...buildFolderTree(fileItems));

            return rootItems;
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to load PR changes: ${e.message}`);
            return [];
        }
    }

    // --- Discussion actions (ported from PrDiscussionProvider) ---

    async replyToDiscussionThread(item: PrCommentThreadItem): Promise<void> {
        const token = await getToken(this.secretStorage);
        if (!token || !this.selectedPr || !this.selectedOrg) { return; }

        const content = await vscode.window.showInputBox({
            prompt: 'Reply to this thread',
            placeHolder: 'Type your reply\u2026',
        });
        if (!content) { return; }

        const pr = this.selectedPr;
        const org = this.selectedOrg;
        const project = pr.repository?.project?.name ?? '';
        const repoId = pr.repository?.id ?? '';

        await replyToThread(org, project, repoId, pr.pullRequestId, item.thread.id, content, token);
        this.refresh();
    }

    async changeThreadStatus(item: PrCommentThreadItem, status: ThreadStatus): Promise<void> {
        const token = await getToken(this.secretStorage);
        if (!token || !this.selectedPr || !this.selectedOrg) { return; }

        const pr = this.selectedPr;
        const org = this.selectedOrg;
        const project = pr.repository?.project?.name ?? '';
        const repoId = pr.repository?.id ?? '';

        try {
            await updateThreadStatus(org, project, repoId, pr.pullRequestId, item.thread.id, status, token);
            this.refresh();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to update thread status: ${msg}`);
        }
    }

    async addGeneralComment(): Promise<void> {
        const token = await getToken(this.secretStorage);
        if (!token || !this.selectedPr || !this.selectedOrg) {
            vscode.window.showWarningMessage('Select a PR first to add a comment.');
            return;
        }

        const content = await vscode.window.showInputBox({
            prompt: 'Add a general comment to this PR',
            placeHolder: 'Type your comment\u2026',
        });
        if (!content) { return; }

        const pr = this.selectedPr;
        const org = this.selectedOrg;
        const project = pr.repository?.project?.name ?? '';
        const repoId = pr.repository?.id ?? '';

        await addPullRequestComment(org, project, repoId, pr.pullRequestId, content, token);
        this.refresh();
    }

    async openComment(item: PrCommentThreadItem): Promise<void> {
        const ctx = item.thread.threadContext;
        if (!ctx?.filePath) {
            return this.showFullComment(item);
        }

        const filePath = ctx.filePath;
        const isRight = !!ctx.rightFileStart;
        const pos = ctx.rightFileStart ?? ctx.leftFileStart;
        const line = pos ? pos.line - 1 : 0;

        const leftUri = buildPrFileUri(
            item.org, item.project, item.repoId, item.targetCommitId, filePath, item.prId, 'left'
        );
        const rightUri = buildPrFileUri(
            item.org, item.project, item.repoId, item.sourceCommitId, filePath, item.prId, 'right'
        );

        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, filePath);

        if (isRight) {
            setTimeout(() => {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const range = new vscode.Range(line, 0, line, 0);
                    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                    editor.selection = new vscode.Selection(line, 0, line, 0);
                }
            }, 300);
        }
    }

    async openThreadById(pr: EnrichedPullRequest, org: string, threadId: number): Promise<boolean> {
        const token = await getToken(this.secretStorage);
        if (!token) { return false; }

        const project = pr.repository?.project?.name ?? '';
        const repoId = pr.repository?.id ?? '';
        if (!project || !repoId) { return false; }

        try {
            const [threads, iterations] = await Promise.all([
                getPrThreads(org, project, repoId, pr.pullRequestId, token),
                getPrIterations(org, project, repoId, pr.pullRequestId, token),
            ]);

            const lastIteration = iterations.at(-1);
            const sourceCommitId = lastIteration?.sourceRefCommit?.commitId ?? '';
            const targetCommitId = lastIteration?.targetRefCommit?.commitId ?? '';

            const visibleThreads = threads
                .filter((t) =>
                    !t.isDeleted &&
                    t.comments.some((c) => !c.isDeleted && c.commentType !== 'system')
                )
                .map((t) => new PrCommentThreadItem(
                    t, org, project, repoId, pr.pullRequestId,
                    sourceCommitId, targetCommitId
                ));

            const target = visibleThreads.find((item) => item.thread.id === threadId) ?? visibleThreads[0];
            if (!target) {
                return false;
            }

            await this.openComment(target);
            return true;
        } catch {
            return false;
        }
    }

    private async showFullComment(item: PrCommentThreadItem): Promise<void> {
        const userComments = item.thread.comments.filter(
            (c) => !c.isDeleted && c.commentType !== 'system'
        );
        if (userComments.length === 0) { return; }

        const lines: string[] = [];
        for (const comment of userComments) {
            lines.push(`**${comment.author.displayName}**`);
            lines.push('');
            lines.push(comment.content);
            lines.push('\n---\n');
        }
        lines.pop();

        const markdown = lines.join('\n');
        setCommentContent(item.thread.id, markdown);

        const uri = buildCommentDocUri(item.thread.id);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true });
    }
}
