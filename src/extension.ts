import * as vscode from 'vscode';
import { createPullRequest } from './commands/createPr';
import { openRepository } from './commands/openRepo';
import { openWorkItem } from './commands/openWorkItem';
import { configureAuthentication, setToken, removeToken, loginWithAzureAd, logoutFromAzureAd } from './auth';
import { createTaskForPr } from './commands/createTask';
import { createStatusBarItem } from './statusBar';
import { registerPrSidebar, PrFilter, PrSort } from './prSidebar';
import type { PullRequestItem } from './prSidebar';
import { registerPrActions, registerEditorVoteCommands } from './commands/prActions';
import { checkoutPrBranch } from './commands/checkoutBranch';
import { editExistingPrDescription } from './commands/editPrDescription';
import {
    PrChangesProvider,
    PrFileItem,
    PrFolderItem,
    PrCommentThreadItem,
    buildSelectedPrContext,
    sameSelectedPrContext,
} from './prChangesProvider';
import { PrContentProvider, buildPrFileUri } from './prContentProvider';
import { PrCommentController } from './prComments';
import { PrCommentDocProvider, PR_COMMENT_SCHEME } from './prCommentDocProvider';
import { buildPullRequestThreadUrl } from './prLinks';
import { tryGetReviewModeUri } from './reviewMode';
import { ReviewedFilesStore } from './reviewedFiles';

export function activate(context: vscode.ExtensionContext) {
    const secretStorage = context.secrets;

    // Helper used by the checkbox handler to cascade folder ticks to all descendant files.
    function collectFolderFiles(folder: PrFolderItem): PrFileItem[] {
        const result: PrFileItem[] = [];
        for (const child of folder.children) {
            if (child instanceof PrFileItem) {
                result.push(child);
            } else {
                result.push(...collectFolderFiles(child));
            }
        }
        return result;
    }

    // Register PR sidebar first (needed by token commands)
    const prProvider = registerPrSidebar(context, secretStorage);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevops.createPullRequest', () => createPullRequest(secretStorage)),
        vscode.commands.registerCommand('azureDevops.createTaskForPr', () => createTaskForPr(secretStorage)),
        vscode.commands.registerCommand('azureDevops.openRepository', openRepository),
        vscode.commands.registerCommand('azureDevops.openWorkItem', openWorkItem),
        vscode.commands.registerCommand('azureDevops.configureAuthentication', () => configureAuthentication(secretStorage)),
        vscode.commands.registerCommand('azureDevops.setToken', async () => {
            await setToken(secretStorage);
            prProvider.refresh();
        }),
        vscode.commands.registerCommand('azureDevops.removeToken', async () => {
            await removeToken(secretStorage);
            prProvider.refresh();
        }),
        vscode.commands.registerCommand('azureDevops.loginAzureAd', async () => {
            const ok = await loginWithAzureAd();
            if (ok) { prProvider.refresh(); }
        }),
        vscode.commands.registerCommand('azureDevops.logoutAzureAd', async () => {
            await logoutFromAzureAd();
            prProvider.refresh();
        }),
        vscode.commands.registerCommand('azureDevops.refreshPullRequests', () => prProvider.refresh()),
        vscode.commands.registerCommand('azureDevops.openCheckInBrowser', async (url: string) => {
            if (url) {
                await vscode.env.openExternal(vscode.Uri.parse(url));
            }
        }),
        vscode.commands.registerCommand('azureDevops.editPrDescription', (item?: any) => {
            return editExistingPrDescription(prProvider, item);
        }),
        vscode.commands.registerCommand('azureDevops.editPrDescriptionFromPicker', () => {
            return editExistingPrDescription(prProvider);
        }),
    );

    // Register PR quick actions (Phase 1)
    registerPrActions(context, prProvider);

    // Filter & sort commands (Phase 5)
    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevops.filterPullRequests', async () => {
            const options: Array<{ label: string; value: PrFilter; description?: string }> = [
                { label: 'All', value: 'all', description: 'Show all pull requests' },
                { label: 'Drafts', value: 'draft', description: 'Only draft PRs' },
                { label: 'Needs my vote', value: 'needsMyVote', description: 'PRs where I haven\'t voted' },
                { label: 'Has unresolved comments', value: 'hasComments', description: 'PRs with unresolved comments' },
                { label: 'Checks failing', value: 'checksFailing', description: 'PRs with failed checks' },
            ];
            const picked = await vscode.window.showQuickPick(options, {
                placeHolder: 'Filter pull requests...',
            });
            if (picked) {
                prProvider.setFilter(picked.value);
            }
        }),
        vscode.commands.registerCommand('azureDevops.sortPullRequests', async () => {
            const options: Array<{ label: string; value: PrSort; description?: string }> = [
                { label: 'Default', value: 'default', description: 'Server order' },
                { label: 'By title', value: 'title', description: 'Alphabetical by title' },
                { label: 'By comment count', value: 'commentCount', description: 'Most comments first' },
            ];
            const picked = await vscode.window.showQuickPick(options, {
                placeHolder: 'Sort pull requests...',
            });
            if (picked) {
                prProvider.setSort(picked.value);
            }
        }),
    );

    // PR content provider for diff viewing (Phase 2)
    const prContentProvider = new PrContentProvider(secretStorage);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('azuredevops-pr', prContentProvider)
    );

    // PR comment content provider — shows full discussion threads as markdown
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(PR_COMMENT_SCHEME, new PrCommentDocProvider())
    );

    // PR comment controller — shows Azure DevOps threads on diff views
    const prCommentController = new PrCommentController(secretStorage);
    prCommentController.loadExisting();
    context.subscriptions.push(
        prCommentController,
        prCommentController.onDidAddComment(() => prChangesProvider.refresh()),
        vscode.commands.registerCommand('azureDevops.replyToComment', (reply: vscode.CommentReply) => {
            return prCommentController.replyToThread(reply);
        }),
    );

    // PR changes tree view (includes file changes + discussion threads)
    const reviewedStore = new ReviewedFilesStore(context.workspaceState);
    reviewedStore.gc();
    const prChangesProvider = new PrChangesProvider(secretStorage, reviewedStore);
    const prChangesTree = vscode.window.createTreeView('azureDevops.prChanges', {
        treeDataProvider: prChangesProvider,
        manageCheckboxStateManually: true,
    });
    context.subscriptions.push(prChangesTree);

    const switchToPr = (pr: Parameters<PrChangesProvider['selectPr']>[0], org: string): void => {
        const switchedPr = prChangesProvider.selectPr(pr, org);
        if (switchedPr) {
            prCommentController.clearAll();
        }
        prChangesTree.title = `Changes: #${pr.pullRequestId}`;
    };

    prProvider.setCommentNotificationHandlers({
        openComment: async ({ org, pr, thread }) => {
            switchToPr(pr, org);
            await prChangesProvider.openThreadById(pr, org, thread.threadId);
        },
        openInDevOps: async ({ org, pr, thread }) => {
            const project = pr.repository?.project?.name ?? '';
            const repoName = pr.repository?.name ?? '';
            const url = buildPullRequestThreadUrl(org, project, repoName, pr.pullRequestId, thread.threadId);
            await vscode.env.openExternal(vscode.Uri.parse(url));
        },
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevops.checkoutPrBranch', async (item: PullRequestItem | undefined) => {
            const currentSelection = prChangesProvider.getSelectedPrContext();
            if (!item) {
                return;
            }

            const checkedOut = await checkoutPrBranch(item);
            if (!checkedOut || !item.pr || !item.org) {
                return;
            }

            const nextSelection = buildSelectedPrContext(item.pr, item.org);
            if (!currentSelection || !sameSelectedPrContext(currentSelection, nextSelection)) {
                prChangesProvider.clear();
                prCommentController.clearAll();
                prChangesTree.title = 'PR Changes';
            }
        }),
        vscode.commands.registerCommand('azureDevops.reviewPrChanges', (item: PullRequestItem | undefined) => {
            if (item?.pr && item?.org) {
                switchToPr(item.pr, item.org);
            }
        }),
        vscode.commands.registerCommand('azureDevops.clearPrChanges', () => {
            prChangesProvider.clear();
            prCommentController.clearAll();
            prChangesTree.title = 'PR Changes';
        }),
        vscode.commands.registerCommand('azureDevops.refreshPrChanges', () => {
            prChangesProvider.refresh();
            prCommentController.refreshAll();
        }),
        prChangesTree.onDidChangeCheckboxState(e => {
            for (const [item, state] of e.items) {
                if (item instanceof PrFileItem) {
                    prChangesProvider.setReviewed(item, state === vscode.TreeItemCheckboxState.Checked);
                } else if (item instanceof PrFolderItem) {
                    const allFiles = collectFolderFiles(item);
                    for (const file of allFiles) {
                        prChangesProvider.setReviewed(file, state === vscode.TreeItemCheckboxState.Checked);
                    }
                }
            }
        }),
        vscode.commands.registerCommand('azureDevops.resetReviewedFiles', () => {
            prChangesProvider.resetCurrentPr();
        }),
        vscode.commands.registerCommand('azureDevops.clearAllReviewedFiles', () => {
            reviewedStore.clearAll();
            prChangesProvider.refresh();
        }),
        vscode.commands.registerCommand('azureDevops.openDiscussionComment', (item: PrCommentThreadItem) => {
            return prChangesProvider.openComment(item);
        }),
        vscode.commands.registerCommand('azureDevops.replyToDiscussionThread', (item: PrCommentThreadItem) => {
            return prChangesProvider.replyToDiscussionThread(item);
        }),
        vscode.commands.registerCommand('azureDevops.resolveThread', (item: PrCommentThreadItem) => {
            return prChangesProvider.changeThreadStatus(item, 'fixed').then(() => prCommentController.refreshAll());
        }),
        vscode.commands.registerCommand('azureDevops.wontFixThread', (item: PrCommentThreadItem) => {
            return prChangesProvider.changeThreadStatus(item, 'wontFix').then(() => prCommentController.refreshAll());
        }),
        vscode.commands.registerCommand('azureDevops.byDesignThread', (item: PrCommentThreadItem) => {
            return prChangesProvider.changeThreadStatus(item, 'byDesign').then(() => prCommentController.refreshAll());
        }),
        vscode.commands.registerCommand('azureDevops.closeThread', (item: PrCommentThreadItem) => {
            return prChangesProvider.changeThreadStatus(item, 'closed').then(() => prCommentController.refreshAll());
        }),
        vscode.commands.registerCommand('azureDevops.pendingThread', (item: PrCommentThreadItem) => {
            return prChangesProvider.changeThreadStatus(item, 'pending').then(() => prCommentController.refreshAll());
        }),
        vscode.commands.registerCommand('azureDevops.reactivateThread', (item: PrCommentThreadItem) => {
            return prChangesProvider.changeThreadStatus(item, 'active').then(() => prCommentController.refreshAll());
        }),
        vscode.commands.registerCommand('azureDevops.inlineResolveThread', (thread: vscode.CommentThread) => {
            return prCommentController.changeStatus(thread, 'fixed');
        }),
        vscode.commands.registerCommand('azureDevops.inlineWontFixThread', (thread: vscode.CommentThread) => {
            return prCommentController.changeStatus(thread, 'wontFix');
        }),
        vscode.commands.registerCommand('azureDevops.inlineByDesignThread', (thread: vscode.CommentThread) => {
            return prCommentController.changeStatus(thread, 'byDesign');
        }),
        vscode.commands.registerCommand('azureDevops.inlineCloseThread', (thread: vscode.CommentThread) => {
            return prCommentController.changeStatus(thread, 'closed');
        }),
        vscode.commands.registerCommand('azureDevops.inlinePendingThread', (thread: vscode.CommentThread) => {
            return prCommentController.changeStatus(thread, 'pending');
        }),
        vscode.commands.registerCommand('azureDevops.inlineReactivateThread', (thread: vscode.CommentThread) => {
            return prCommentController.changeStatus(thread, 'active');
        }),
        vscode.commands.registerCommand('azureDevops.addGeneralComment', () => {
            return prChangesProvider.addGeneralComment();
        }),
        vscode.commands.registerCommand('azureDevops.openPrFileDiff', async (fileItem: PrFileItem) => {
            const change = fileItem.change;
            const filePath = change.item.path;

            // If the PR source branch is currently checked out, use the real on-disk file
            // for the modified side so language features (Go to Definition, etc.) work natively.
            const reviewModeUri = await tryGetReviewModeUri(fileItem.sourceBranch, filePath);

            if (change.changeType === 'add') {
                const rightUri = reviewModeUri ?? buildPrFileUri(fileItem.org, fileItem.project, fileItem.repoId, fileItem.sourceCommitId, filePath, fileItem.prId, 'right');
                const leftUri = vscode.Uri.parse('azuredevops-pr://empty');
                await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${filePath} (added)`);
            } else if (change.changeType === 'delete') {
                const leftUri = buildPrFileUri(fileItem.org, fileItem.project, fileItem.repoId, fileItem.targetCommitId, filePath, fileItem.prId, 'left');
                const rightUri = vscode.Uri.parse('azuredevops-pr://empty');
                await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${filePath} (deleted)`);
            } else {
                const originalPath = change.originalPath ?? filePath;
                const leftUri = buildPrFileUri(fileItem.org, fileItem.project, fileItem.repoId, fileItem.targetCommitId, originalPath, fileItem.prId, 'left');
                const rightUri = reviewModeUri ?? buildPrFileUri(fileItem.org, fileItem.project, fileItem.repoId, fileItem.sourceCommitId, filePath, fileItem.prId, 'right');
                await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${filePath}`);
            }

            // When using a real file for the modified side (review mode), register it with the
            // comment controller so comment creation and placement work on the real document.
            if (reviewModeUri && change.changeType !== 'delete') {
                await prCommentController.registerReviewModeFile(
                    reviewModeUri, fileItem.org, fileItem.project, fileItem.repoId,
                    fileItem.prId, filePath,
                );
            }
        }),
    );

    // Register editor-title vote commands (approve/reject/wait from diff view)
    registerEditorVoteCommands(context, prProvider, (uri) => prCommentController.getReviewModeFileInfo(uri));

    // Track when a PR diff editor is active to show editor/title vote buttons.
    // The 'empty' authority is used for placeholder (empty-file) side of diffs and should be excluded.
    function updatePrDiffContext() {
        const uri = vscode.window.activeTextEditor?.document.uri;
        const isPrDiff = uri && (
            (uri.scheme === 'azuredevops-pr' && uri.authority !== 'empty') ||
            prCommentController.isReviewModeFile(uri)
        );
        vscode.commands.executeCommand('setContext', 'azureDevops.prDiffActive', !!isPrDiff);
    }
    updatePrDiffContext();
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => updatePrDiffContext()),
    );

    createStatusBarItem(context);
}

export function deactivate() { }
