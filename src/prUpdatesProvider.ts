import * as vscode from 'vscode';
import { EnrichedPullRequest, getPrIterations, getPrChanges, PrChange } from './api';
import { getToken } from './auth';

export type PrUpdatesTreeItem = PrIterationItem | PrIterationFileItem;

export class PrIterationItem extends vscode.TreeItem {
    constructor(
        public readonly iterationId: number,
        public readonly sourceCommitId: string,
        /** The commit to diff against (previous iteration's source, or base for iteration 1) */
        public readonly baseCommitId: string,
        createdDate?: string,
        author?: string,
    ) {
        super(`Iteration ${iterationId}`, vscode.TreeItemCollapsibleState.Collapsed);

        const parts: string[] = [];
        if (author) { parts.push(author); }
        if (createdDate) {
            parts.push(new Date(createdDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
        }
        if (parts.length > 0) {
            this.description = parts.join(' · ');
        }

        this.iconPath = new vscode.ThemeIcon('git-commit');
        this.contextValue = 'prIteration';
        this.tooltip = createdDate
            ? new Date(createdDate).toLocaleString()
            : undefined;
    }
}

export class PrIterationFileItem extends vscode.TreeItem {
    constructor(
        public readonly change: PrChange,
        public readonly org: string,
        public readonly project: string,
        public readonly repoId: string,
        public readonly leftCommitId: string,
        public readonly rightCommitId: string,
    ) {
        const fileName = change.item.path.split('/').pop() ?? change.item.path;
        super(fileName, vscode.TreeItemCollapsibleState.None);

        this.description = change.item.path.split('/').slice(0, -1).join('/') || undefined;
        this.tooltip = `${change.changeType}: ${change.item.path}`;

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
            command: 'azureDevops.openPrIterationDiff',
            title: 'Open Diff',
            arguments: [this],
        };
        this.contextValue = 'prIterationFile';
    }
}

export class PrUpdatesProvider implements vscode.TreeDataProvider<PrUpdatesTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<PrUpdatesTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private selectedPr?: EnrichedPullRequest;
    private selectedOrg?: string;
    private selectionGeneration = 0;

    constructor(private readonly secretStorage: vscode.SecretStorage) { }

    selectPr(pr: EnrichedPullRequest, org: string): void {
        this.selectionGeneration++;
        this.selectedPr = pr;
        this.selectedOrg = org;
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.selectionGeneration++;
        this.selectedPr = undefined;
        this.selectedOrg = undefined;
        this._onDidChangeTreeData.fire();
    }

    refresh(): void {
        this.selectionGeneration++;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PrUpdatesTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: PrUpdatesTreeItem): Promise<PrUpdatesTreeItem[]> | PrUpdatesTreeItem[] {
        if (element instanceof PrIterationItem) {
            return this.getIterationFiles(element);
        }
        if (element instanceof PrIterationFileItem) {
            return [];
        }
        return this.getRootItems();
    }

    private async getRootItems(): Promise<PrIterationItem[]> {
        if (!this.selectedPr || !this.selectedOrg) { return []; }

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

            // Build items newest-first; each item needs to know its "base" (previous push HEAD)
            const items: PrIterationItem[] = [];
            for (let i = iterations.length - 1; i >= 0; i--) {
                const iter = iterations[i];
                const prev = i > 0 ? iterations[i - 1] : undefined;
                // For iteration 1 (no previous): base = the merge target commit (branch point)
                const baseCommitId = prev
                    ? prev.sourceRefCommit?.commitId ?? ''
                    : iter.targetRefCommit?.commitId ?? '';
                items.push(new PrIterationItem(
                    iter.id,
                    iter.sourceRefCommit?.commitId ?? '',
                    baseCommitId,
                    iter.createdDate,
                    iter.author?.displayName,
                ));
            }
            return items;
        } catch (e: unknown) {
            if (!this.isCurrentSelection(pr, org, selectionGeneration)) { return []; }
            const msg = e instanceof Error ? e.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load PR updates: ${msg}`);
            return [];
        }
    }

    private async getIterationFiles(item: PrIterationItem): Promise<PrIterationFileItem[]> {
        if (!this.selectedPr || !this.selectedOrg) { return []; }

        const selectionGeneration = this.selectionGeneration;
        const pr = this.selectedPr;
        const org = this.selectedOrg;
        const token = await getToken(this.secretStorage);
        if (!token || !this.isCurrentSelection(pr, org, selectionGeneration)) { return []; }

        const project = pr.repository?.project?.name ?? '';
        const repoId = pr.repository?.id ?? '';

        try {
            // compareToIterationId = iterationId - 1 gives the delta for this push.
            // For iteration 1, compareToIterationId = 0 compares against the merge base.
            const compareToIterationId = item.iterationId - 1;
            const changes = await getPrChanges(
                org, project, repoId, pr.pullRequestId,
                item.iterationId, token,
                compareToIterationId,
            );
            if (!this.isCurrentSelection(pr, org, selectionGeneration)) { return []; }
            return changes
                .filter(c => c.item?.path)
                .map(c => new PrIterationFileItem(
                    c, org, project, repoId,
                    item.baseCommitId,
                    item.sourceCommitId,
                ));
        } catch (e: unknown) {
                if (!this.isCurrentSelection(pr, org, selectionGeneration)) { return []; }
                const msg = e instanceof Error ? e.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to load iteration changes: ${msg}`);
                return [];
        }
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
}
