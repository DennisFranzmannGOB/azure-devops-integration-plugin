import * as vscode from 'vscode';
import { PullRequestItem, PullRequestTreeProvider } from '../prSidebar';
import {
    updateReviewerVote,
    completePullRequest,
    abandonPullRequest,
    addPullRequestComment,
    getPullRequestDetails,
    searchIdentitiesByDisplayName,
    updatePullRequestTitle,
} from '../api';
import { getAuthenticationRequiredMessage, getToken } from '../auth';
import { prepareCommentContentWithMentions } from '../commentMentions';
import { buildPullRequestUrl } from '../prLinks';
import { parsePrFileUri } from '../prContentProvider';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function getContext(item: PullRequestItem, provider: PullRequestTreeProvider) {
    if (!item) {
        vscode.window.showErrorMessage('This command must be run from a pull request in the sidebar.');
        return undefined;
    }
    const pr = item.pr;
    const org = item.org;
    if (!pr || !org) {
        vscode.window.showErrorMessage('No pull request data available.');
        return undefined;
    }
    const token = await getToken(provider.secretStorage);
    if (!token) {
        vscode.window.showErrorMessage(getAuthenticationRequiredMessage());
        return undefined;
    }
    const userId = provider.cachedUserId;
    const project = pr.repository?.project?.name ?? '';
    const repoId = pr.repository?.id ?? '';
    return { pr, org, token, userId, project, repoId };
}

export function registerPrActions(
    context: vscode.ExtensionContext,
    provider: PullRequestTreeProvider
) {
    // Vote commands
    const voteCommands: Array<{ command: string; vote: number; label: string }> = [
        { command: 'azureDevops.approvePr', vote: 10, label: 'Approved' },
        { command: 'azureDevops.approveWithSuggestionsPr', vote: 5, label: 'Approved with suggestions' },
        { command: 'azureDevops.waitForAuthorPr', vote: -5, label: 'Waiting for author' },
        { command: 'azureDevops.rejectPr', vote: -10, label: 'Rejected' },
        { command: 'azureDevops.resetVotePr', vote: 0, label: 'Vote reset' },
    ];

    for (const { command, vote, label } of voteCommands) {
        context.subscriptions.push(
            vscode.commands.registerCommand(command, async (item: PullRequestItem) => {
                const ctx = await getContext(item, provider);
                if (!ctx) { return; }
                if (!ctx.userId) {
                    vscode.window.showErrorMessage('User ID not available. Try refreshing.');
                    return;
                }
                try {
                    await updateReviewerVote(ctx.org, ctx.project, ctx.repoId, ctx.pr.pullRequestId, ctx.userId, vote, ctx.token);
                    vscode.window.showInformationMessage(`PR #${ctx.pr.pullRequestId}: ${label}`);
                    provider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to vote: ${getErrorMessage(error)}`);
                }
            })
        );
    }

    // Complete PR
    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevops.completePr', async (item: PullRequestItem) => {
            const ctx = await getContext(item, provider);
            if (!ctx) { return; }
            const confirm = await vscode.window.showWarningMessage(
                `Complete PR #${ctx.pr.pullRequestId} "${ctx.pr.title}"?`,
                { modal: true }, 'Complete'
            );
            if (confirm !== 'Complete') { return; }
            try {
                // Get latest PR details for lastMergeSourceCommit
                const details = await getPullRequestDetails(ctx.org, ctx.project, ctx.repoId, ctx.pr.pullRequestId, ctx.token);
                const commitId = details.lastMergeSourceCommit?.commitId;
                if (!commitId) {
                    vscode.window.showErrorMessage('Cannot complete: no merge source commit found.');
                    return;
                }
                await completePullRequest(ctx.org, ctx.project, ctx.repoId, ctx.pr.pullRequestId, commitId, ctx.token);
                vscode.window.showInformationMessage(`PR #${ctx.pr.pullRequestId} completed.`);
                provider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to complete PR: ${getErrorMessage(error)}`);
            }
        })
    );

    // Abandon PR
    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevops.abandonPr', async (item: PullRequestItem) => {
            const ctx = await getContext(item, provider);
            if (!ctx) { return; }
            const confirm = await vscode.window.showWarningMessage(
                `Abandon PR #${ctx.pr.pullRequestId} "${ctx.pr.title}"?`,
                { modal: true }, 'Abandon'
            );
            if (confirm !== 'Abandon') { return; }
            try {
                await abandonPullRequest(ctx.org, ctx.project, ctx.repoId, ctx.pr.pullRequestId, ctx.token);
                vscode.window.showInformationMessage(`PR #${ctx.pr.pullRequestId} abandoned.`);
                provider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to abandon PR: ${getErrorMessage(error)}`);
            }
        })
    );

    // Add comment
    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevops.addCommentPr', async (item: PullRequestItem) => {
            const ctx = await getContext(item, provider);
            if (!ctx) { return; }
            const comment = await vscode.window.showInputBox({
                prompt: `Add comment to PR #${ctx.pr.pullRequestId}`,
                placeHolder: 'Type your comment...',
            });
            if (!comment) { return; }
            try {
                const preparedComment = await prepareCommentContentWithMentions(
                    comment,
                    (lookupName) => searchIdentitiesByDisplayName(ctx.org, lookupName, ctx.token),
                );
                await addPullRequestComment(ctx.org, ctx.project, ctx.repoId, ctx.pr.pullRequestId, preparedComment, ctx.token);
                vscode.window.showInformationMessage('Comment added.');
                provider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to add comment: ${getErrorMessage(error)}`);
            }
        })
    );

    // Edit title
    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevops.editPrTitle', async (item: PullRequestItem) => {
            const ctx = await getContext(item, provider);
            if (!ctx) { return; }
            const newTitle = await vscode.window.showInputBox({
                prompt: `Edit title of PR #${ctx.pr.pullRequestId}`,
                value: ctx.pr.title,
            });
            if (!newTitle) { return; }
            if (newTitle === ctx.pr.title) { return; }
            try {
                await updatePullRequestTitle(ctx.org, ctx.project, ctx.repoId, ctx.pr.pullRequestId, newTitle, ctx.token);
                vscode.window.showInformationMessage(`PR #${ctx.pr.pullRequestId} title updated.`);
                provider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to update title: ${getErrorMessage(error)}`);
            }
        })
    );

    // Open in browser (explicit command)
    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevops.openPrInBrowser', async (item: PullRequestItem) => {
            const pr = item.pr;
            const org = item.org;
            if (!pr || !org) { return; }
            const project = pr.repository?.project?.name ?? '';
            const repoName = pr.repository?.name ?? '';
            const prUrl = buildPullRequestUrl(org, project, repoName, pr.pullRequestId);
            vscode.env.openExternal(vscode.Uri.parse(prUrl));
        })
    );
}

export function registerEditorVoteCommands(
    context: vscode.ExtensionContext,
    provider: PullRequestTreeProvider,
    getReviewModeFileInfo?: (uri: vscode.Uri) => { org: string; prId: number } | undefined
) {
    const editorVoteCommands: Array<{ command: string; vote: number; label: string }> = [
        { command: 'azureDevops.editorApprovePr', vote: 10, label: 'Approved' },
        { command: 'azureDevops.editorRejectPr', vote: -10, label: 'Rejected' },
        { command: 'azureDevops.editorWaitForAuthorPr', vote: -5, label: 'Waiting for author' },
    ];

    for (const { command, vote, label } of editorVoteCommands) {
        context.subscriptions.push(
            vscode.commands.registerCommand(command, async () => {
                // Resolve PR from the active editor URI
                const editor = vscode.window.activeTextEditor;
                if (!editor) { return; }

                const parsed = parsePrFileUri(editor.document.uri);
                const rmInfo = !parsed?.prId && getReviewModeFileInfo
                    ? getReviewModeFileInfo(editor.document.uri)
                    : undefined;
                const org = parsed?.org ?? rmInfo?.org;
                const prId = parsed?.prId ?? rmInfo?.prId;

                if (!org || !prId) {
                    vscode.window.showErrorMessage('No pull request found. Open a PR diff file to use this command.');
                    return;
                }

                const pr = provider.getPullRequestById(prId);
                if (!pr) {
                    vscode.window.showErrorMessage('Pull request data not available. Try refreshing the PR list.');
                    return;
                }

                const token = await getToken(provider.secretStorage);
                if (!token) {
                    vscode.window.showErrorMessage(getAuthenticationRequiredMessage());
                    return;
                }
                const userId = provider.cachedUserId;
                if (!userId) {
                    vscode.window.showErrorMessage('User ID not available. Try refreshing.');
                    return;
                }

                const project = pr.repository?.project?.name ?? '';
                const repoId = pr.repository?.id ?? '';

                try {
                    await updateReviewerVote(org, project, repoId, pr.pullRequestId, userId, vote, token);
                    vscode.window.showInformationMessage(`PR #${pr.pullRequestId}: ${label}`);
                    provider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to vote: ${getErrorMessage(error)}`);
                }
            })
        );
    }
}
