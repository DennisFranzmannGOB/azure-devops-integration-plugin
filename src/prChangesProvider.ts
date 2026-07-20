import * as vscode from 'vscode';
import { EnrichedPullRequest, getPrIterations, getPrChanges, getPrThreads, PrChange, PrThread, replyToThread, addPullRequestComment, searchIdentitiesByDisplayName, ThreadStatus, updateThreadStatus } from './api';
import { getToken } from './auth';
import { prepareCommentContentWithMentions } from './commentMentions';
import { ResolvedThreadPaths, resolveThreadPaths } from './discussionNavigation';
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

export type PrChangesTreeItem = PrFileItem | PrFolderItem | PrCommentThreadItem | PrCommentReplyItem | PrGeneralCommentsItem;
export type PrChangeNavigationDirection = 'next' | 'previous';

// --- Tree item types ---

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
        public readonly repoName: string = '',
        public readonly diffPaths: ResolvedThreadPaths = resolveThreadPaths(thread),
    ) {
        const userComments = thread.comments.filter(
            (c) => !c.isDeleted && c.commentType !== 'system'
        );
        const firstComment = userComments[0];
        const author = firstComment?.author.displayName ?? 'Unknown';
        const preview = firstComment
            ? firstComment.content.replaceAll('\n', ' ').slice(0, 80)
            : '';

        const filePath = diffPaths.displayFilePath ?? thread.threadContext?.filePath;
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

        if (isGeneral || ((diffPaths.leftFilePath || diffPaths.rightFilePath) && sourceCommitId && targetCommitId)) {
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

    private _onIterationResolved = new vscode.EventEmitter<number | undefined>();
    readonly onIterationResolved = this._onIterationResolved.event;

    private selectedPr?: EnrichedPullRequest;
    private selectedOrg?: string;
    private currentIterationId?: number;
    private selectionGeneration = 0;
    private readonly secretStorage: vscode.SecretStorage;
    private readonly reviewedStore?: ReviewedFilesStore;
    private allFileItems: PrFileItem[] = [];
    private visibleFileItems: PrFileItem[] = [];

    constructor(
        secretStorage: vscode.SecretStorage,
        reviewedStore?: ReviewedFilesStore,
    ) {
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

        this.selectionGeneration++;
        this.selectedPr = pr;
        this.selectedOrg = org;
        this.currentIterationId = undefined;
        this.clearFileItems();
        this._onDidChangeTreeData.fire();

        return switchedPr;
    }

    refresh(): void {
        this.selectionGeneration++;
        this.clearFileItems();
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.selectionGeneration++;
        this.selectedPr = undefined;
        this.selectedOrg = undefined;
        this.currentIterationId = undefined;
        this.clearFileItems();
        this._onIterationResolved.fire(undefined);
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

    async getAdjacentFile(
        filePath: string,
        direction: PrChangeNavigationDirection,
    ): Promise<PrFileItem | undefined> {
        await this.getRootItems();
        const currentIndex = this.allFileItems.findIndex((item) => item.change.item.path === filePath);
        if (currentIndex === -1) {
            return undefined;
        }

        const visiblePaths = new Set(this.visibleFileItems.map((item) => item.change.item.path));
        const increment = direction === 'next' ? 1 : -1;
        for (
            let index = currentIndex + increment;
            index >= 0 && index < this.allFileItems.length;
            index += increment
        ) {
            const candidate = this.allFileItems[index];
            if (visiblePaths.has(candidate.change.item.path)) {
                return candidate;
            }
        }

        return undefined;
    }

    async getFileItem(filePath: string): Promise<PrFileItem | undefined> {
        await this.getRootItems();
        return this.allFileItems.find((item) => item.change.item.path === filePath);
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
            this.clearFileItems();
            return [];
        }

        const selectionGeneration = this.selectionGeneration;
        const pr = this.selectedPr;
        const org = this.selectedOrg;
        const token = await getToken(this.secretStorage);
        if (!token || !this.isCurrentSelection(pr, org, selectionGeneration)) { return []; }

        const project = pr.repository?.project?.name ?? '';
        const repoId = pr.repository?.id ?? '';

        try {
            const iterations = await getPrIterations(org, project, repoId, pr.pullRequestId, token);
            if (!this.isCurrentSelection(pr, org, selectionGeneration)) { return []; }
            if (iterations.length === 0) { return []; }

            const lastIteration = iterations[iterations.length - 1];
            const [changes, threads] = await Promise.all([
                getPrChanges(org, project, repoId, pr.pullRequestId, lastIteration.id, token),
                getPrThreads(org, project, repoId, pr.pullRequestId, token, lastIteration.id, lastIteration.id),
            ]);
            if (!this.isCurrentSelection(pr, org, selectionGeneration)) { return []; }

            const sourceCommitId = lastIteration.sourceRefCommit?.commitId ?? '';
            const targetCommitId = lastIteration.targetRefCommit?.commitId ?? '';

            // Reviewed-files state: if a new iteration arrived, fetch only the files
            // that changed between the previous and current iteration and remove marks
            // for those — unchanged files keep their marks (matches ADO web portal behaviour).
            this.currentIterationId = lastIteration.id;
            this._onIterationResolved.fire(lastIteration.id);
            if (this.reviewedStore) {
                const storedIterationId = this.reviewedStore.getStoredIterationId(pr.pullRequestId);
                const isNewIteration = storedIterationId !== undefined && storedIterationId !== lastIteration.id;
                if (isNewIteration) {
                    try {
                        const deltaChanges = await getPrChanges(
                            org, project, repoId, pr.pullRequestId, lastIteration.id, token, storedIterationId
                        );
                        if (!this.isCurrentSelection(pr, org, selectionGeneration)) { return []; }
                        const changedPaths = deltaChanges
                            .filter(c => c.item?.path)
                            .map(c => c.item.path);
                        this.reviewedStore.advanceIteration(pr.pullRequestId, lastIteration.id, changedPaths);
                    } catch {
                        if (!this.isCurrentSelection(pr, org, selectionGeneration)) { return []; }
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
                const resolvedPaths = resolveThreadPaths(thread, changes);
                const filePath = resolvedPaths.displayFilePath;
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
            const allFileItems = changes
                .filter(c => c.item?.path)
                .map(c => {
                    const item = new PrFileItem(
                        c, org, project, repoId, sourceCommitId, targetCommitId, pr.pullRequestId, sourceBranch,
                        reviewed.has(c.item.path),
                    );
                    const threads = fileThreads.get(c.item.path);
                    if (threads && threads.length > 0) {
                        item.children = threads.map((t) =>
                            new PrCommentThreadItem(
                                t,
                                org,
                                project,
                                repoId,
                                pr.pullRequestId,
                                sourceCommitId,
                                targetCommitId,
                                pr.repository?.name ?? '',
                                resolveThreadPaths(t, changes),
                            )
                        );
                        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                    }
                    return item;
                });
            const visibleFileItems = hideReviewed
                ? allFileItems.filter((item) => !reviewed.has(item.change.item.path))
                : allFileItems;
            const allFileTree = buildFolderTree(allFileItems);
            const visibleFileTree = hideReviewed ? buildFolderTree(visibleFileItems) : allFileTree;
            this.allFileItems = collectAllFiles(allFileTree);
            this.visibleFileItems = hideReviewed
                ? collectAllFiles(visibleFileTree)
                : this.allFileItems;

            const rootItems: PrChangesTreeItem[] = [];

            // Show general comments first so they are easy to spot without
            // scrolling past the changed files list.
            if (generalThreads.length > 0) {
                const generalChildren = generalThreads.map((t) =>
                    new PrCommentThreadItem(t, org, project, repoId, pr.pullRequestId, sourceCommitId, targetCommitId, pr.repository?.name ?? '')
                );
                rootItems.push(new PrGeneralCommentsItem(generalChildren));
            }

            // Nest files in a folder tree
            rootItems.push(...visibleFileTree);

            return rootItems;
        } catch (error: unknown) {
            if (!this.isCurrentSelection(pr, org, selectionGeneration)) { return []; }
            this.clearFileItems();
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load PR changes: ${message}`);
            return [];
        }
    }

    private clearFileItems(): void {
        this.allFileItems = [];
        this.visibleFileItems = [];
    }

    private isCurrentSelection(
        pr: EnrichedPullRequest,
        org: string,
        selectionGeneration: number,
    ): boolean {
        return this.selectionGeneration === selectionGeneration
            && this.selectedPr === pr
            && this.selectedOrg === org;
    }

    // --- Discussion actions (ported from PrDiscussionProvider) ---

    async replyToDiscussionThread(item: PrCommentThreadItem): Promise<boolean> {
        const token = await getToken(this.secretStorage);
        if (!token || !this.selectedPr || !this.selectedOrg) { return false; }

        const content = await vscode.window.showInputBox({
            prompt: 'Reply to this thread',
            placeHolder: 'Type your reply\u2026',
        });
        if (!content) { return false; }

        const pr = this.selectedPr;
        const org = this.selectedOrg;
        const project = pr.repository?.project?.name ?? '';
        const repoId = pr.repository?.id ?? '';

        try {
            const preparedContent = await prepareCommentContentWithMentions(
                content,
                (lookupName) => searchIdentitiesByDisplayName(org, lookupName, token),
            );
            await replyToThread(org, project, repoId, pr.pullRequestId, item.thread.id, preparedContent, token);
            this.refresh();
            return true;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to reply: ${msg}`);
            return false;
        }
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

        try {
            const preparedContent = await prepareCommentContentWithMentions(
                content,
                (lookupName) => searchIdentitiesByDisplayName(org, lookupName, token),
            );
            await addPullRequestComment(org, project, repoId, pr.pullRequestId, preparedContent, token);
            this.refresh();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to add comment: ${msg}`);
        }
    }

}
