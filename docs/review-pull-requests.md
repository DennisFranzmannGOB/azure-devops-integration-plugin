# Review Pull Requests in VS Code

This reference explains how to review Azure DevOps pull requests with the `Azure DevOps Integration` extension for VS Code.

It focuses on the end-user review workflow:

- setting up the extension
- authenticating to Azure DevOps
- browsing pull requests assigned to you or created by you
- opening a pull request for review
- reviewing file diffs and discussion threads
- adding comments and mentioning other people
- changing thread status
- voting on and managing a pull request
- marking files as reviewed

It does **not** cover contributor internals, repository maintenance, or work item workflows in detail.

## Before you start

Make sure you have:

- VS Code `1.110.0` or later
- the `Azure DevOps Integration` extension installed
- access to the Azure DevOps project and repository you want to review
- the repository opened locally in VS Code

For the best review experience, assume the pull request source branch is also opened locally.

- If it is not, use **Checkout Branch** from the pull request context menu.
- After switching branches, the extension tries to auto-select the matching pull request when the **Pull Requests** view loads or refreshes.
- If no matching pull request is selected automatically, select the pull request again or use **Review Changes** to repopulate the review views.
- If the editor still looks stale after checkout, reload the VS Code window before continuing.

You can review pull requests without checking out the branch, but some editor features work better when the source branch exists on disk locally.

## Set up the extension

### Install and open a repository

1. Install **Azure DevOps Integration** from the VS Code Extensions view or Marketplace.
2. Open the repository folder in VS Code.
3. Open the **Azure DevOps** view container in the Activity Bar.

The extension tries to detect your Azure DevOps connection details from the repository remote automatically.

Supported remote formats:

- `https://dev.azure.com/{org}/{project}/_git/{repo}`
- `https://{org}.visualstudio.com/{project}/_git/{repo}`
- `git@ssh.dev.azure.com:v3/{org}/{project}/{repo}`

If auto-detection is not enough, set the `azureDevops.organization`, `azureDevops.project`, and `azureDevops.repository` settings manually.

### Authenticate

The extension supports two authentication paths.

#### Azure AD

Use Azure AD if you already sign in to Azure services with your Microsoft account.

Available commands:

- **Azure DevOps: Configure Authentication**
- **Azure DevOps: Login with Azure AD**
- **Azure DevOps: Logout from Azure AD**

With Azure AD, VS Code handles token refresh for you.

#### Personal Access Token

Use a PAT if your environment relies on token-based access.

Available commands:

- **Azure DevOps: Configure Authentication**
- **Azure DevOps: Set Personal Access Token**
- **Azure DevOps: Remove Personal Access Token**

Use a PAT that has the Azure DevOps permissions required by your review workflow. At minimum, the token must be able to read pull request data and project metadata. If you want to comment, vote, complete, or abandon pull requests, make sure the token also has the write-level access your Azure DevOps organization requires for those actions.

Your PAT is stored in VS Code's secure secret storage.

## Use the Pull Requests view

Open the **Azure DevOps** Activity Bar item to see the **Pull Requests** view.

Pull requests are grouped into:

- **Created by me**
- **Assigned to me**
- **Assigned to my teams**

Each pull request item can show:

- draft/review state through the icon
- relative age, such as `2d ago`
- the source branch as a child item
- policy/check summary, including clickable pipeline-backed checks
- linked items if they are available for the pull request

### Pull Requests view controls

Use the view title actions to manage the list:

| Action | What it does |
| --- | --- |
| **Refresh Pull Requests** | Reloads the pull request list from Azure DevOps |
| **Filter Pull Requests** | Filters by all, drafts, needs my vote, unresolved comments, or failing checks |
| **Sort Pull Requests** | Sorts by server order, title, or comment count |

### Pull request context actions

Right-click a pull request to access the most important review actions.

| Action | Purpose |
| --- | --- |
| **Review Changes** | Loads the pull request into the review views |
| **Checkout Branch** | Checks out the pull request source branch locally |
| **Open in Browser** | Opens the pull request in Azure DevOps |
| **Add Comment** | Adds a general pull request comment |
| **Edit Title** | Renames the pull request |
| **Edit Description** | Edits the pull request description in a temporary Markdown editor |
| **Approve / Approve with Suggestions / Wait for Author / Reject / Reset Vote** | Updates your reviewer vote |
| **Complete** | Completes the pull request after confirmation |
| **Abandon** | Abandons the pull request after confirmation |

## Open a pull request for review

There are three related actions, and they solve different problems:

- **Select the pull request** or use **Review Changes** to make it the active review target inside VS Code.
- **Checkout Branch** to switch your local workspace to the pull request source branch.
- **Open in Browser** to continue the review in the Azure DevOps web UI.

Recommended review entry flow:

1. Open the **Pull Requests** view.
2. Find the pull request under **Created by me**, **Assigned to me**, or **Assigned to my teams**.
3. Use **Checkout Branch** if you want the reviewed files available locally.
4. Select the pull request or use **Review Changes**. If the checked-out branch matches exactly one visible pull request, the extension may select it for you automatically.
5. Open files from **PR Changes** to inspect diffs and comments.

If you checkout a different pull request branch while another pull request is selected, the extension clears the current review state. After that, the extension tries to auto-select the matching pull request for the checked-out branch. If it cannot determine a unique match, select the pull request again manually.

## Review changed files

The **PR Changes** view is the main review surface inside VS Code.

### What the PR Changes view shows

The view can contain:

- a **General Comments** node for pull request-wide discussion
- a compact folder tree of changed files
- file-level discussion threads nested under the related file
- replies nested under each thread

Changed files are shown with different icons for adds, deletes, renames, and modifications.

### Open diffs

Select a changed file to open its diff.

Diff behavior depends on the change type:

- **Added file**: empty left side, file content on the right
- **Deleted file**: file content on the left, empty right side
- **Modified or renamed file**: both sides open in the diff editor

When the pull request source branch is checked out locally and the file exists on disk, the extension uses the real local file for the modified side of the diff when possible. This improves native editor features such as:

- Go to Definition
- hover information
- Find References

Without a local checkout, diffs still open correctly, but they use virtual documents and language tooling may be more limited.

### Open discussion from the tree

Selecting a discussion thread tries to open the related diff and reveal the commented line.

- File-backed comments open the diff when the file location is available.
- General comments open a read-only thread document.
- If a thread cannot be positioned reliably in a diff, the extension falls back to the read-only thread document.

## Add comments

You can comment at the pull request level or on a specific file.

### Add a general pull request comment

You can add a pull request-wide comment from either place:

- **Add Comment** on the pull request context menu in the **Pull Requests** view
- **Add Comment** in the title area of the **PR Changes** view

These comments appear under **General Comments** in the review tree.

### Add an inline file comment

Open a file diff and use the VS Code comment UI in the gutter on the modified side of the diff.

Important behavior:

- New inline comments are created on the **right side** of the diff.
- When you review against a checked-out branch, the extension also supports adding inline comments on the real local file that represents the modified side.

### Reply to an existing thread

You can reply in two ways:

- from the discussion thread context menu in the **PR Changes** view
- directly from the inline thread UI in the diff editor

After you post a reply, the thread refreshes in the review views.

## Mention other people in comments

The extension supports a lightweight mention format when you start a new comment or reply.

Use this exact pattern at the **start** of the comment:

`@FirstName LastName: your comment`

Example:

`@Dennis Mike: can you verify the null handling here?`

### Mention rules

- Mentions are only recognized when they appear at the **beginning** of the comment.
- The format expects **two name parts**: first name and last name.
- The display name must match an Azure DevOps user exactly after case and whitespace normalization.
- If no exact match is found, the comment is rejected.
- If multiple exact matches are found, the comment is rejected as ambiguous.
- There is no interactive autocomplete for mentions.

If the mention resolves successfully, the extension rewrites the comment into the Azure DevOps mention format before posting it.

Mention handling applies to:

- general pull request comments
- inline file comments
- replies to existing threads

## Change thread status

Discussion threads can be updated from the **PR Changes** view, and file-backed inline threads can also be updated from the diff editor.

### Available status actions

| Action | Result |
| --- | --- |
| **Resolve** | Marks the thread as fixed |
| **Pending** | Marks the thread as pending |
| **Won't Fix** | Marks the thread as won't fix |
| **By Design** | Marks the thread as by design |
| **Close** | Closes the thread |
| **Reactivate** | Returns a non-active thread to active |

### Where status changes are available

- In the **PR Changes** view, right-click a discussion thread.
- In a diff editor, use the inline thread title actions for file-backed comments.

General pull request comments do not appear as inline comment threads in the diff editor, but you can still manage their status from the **PR Changes** view.

## Vote on and manage the pull request

The extension supports both review votes and pull request management actions.

### Reviewer votes

Available vote actions:

- **Approve**
- **Approve with Suggestions**
- **Wait for Author**
- **Reject**
- **Reset Vote**

These actions are available from the pull request context menu.

When a pull request diff is active, the editor title bar also exposes quick vote actions for:

- **Approve**
- **Wait for Author**
- **Reject**

### Pull request management actions

| Action | Notes |
| --- | --- |
| **Edit Title** | Updates the pull request title immediately after confirmation |
| **Edit Description** | Opens the current description in a temporary Markdown editor and updates it when you finish |
| **Complete** | Prompts for confirmation before completion |
| **Abandon** | Prompts for confirmation before abandoning |
| **Open in Browser** | Opens the Azure DevOps pull request page |

## Work with notifications

The extension can notify you about new pull request discussion activity during background refresh.

Notification behavior depends on the `azureDevops.notificationScope` setting.

When a single new discussion event is detected, the notification includes:

- **Open Comment**
- **Open in DevOps**

`Open Comment` behaves differently based on the thread type:

- file comments open the diff and reveal the commented line when possible
- general comments open the thread in a read-only document

When multiple new discussion events arrive together, the extension shows a summary notification instead of opening one thread automatically.

## Mark files as reviewed

The **PR Changes** tree includes checkboxes so you can track your own progress through the file list.

### How reviewed state works

- Check a file to mark it as reviewed.
- Check a folder to mark all descendant files as reviewed.
- Folder checkboxes are considered checked only when all descendant files are checked.

### Reset or clear reviewed state

Use these actions when you want to start over:

| Action | What it clears |
| --- | --- |
| **Reset Reviewed Files (this PR)** | Reviewed state for the currently selected pull request |
| **Clear All Reviewed Files Data** | Reviewed state for every stored pull request |

### Hide reviewed files

Set `azureDevops.hideReviewedFiles` to `true` if you want reviewed files removed from the visible **PR Changes** tree.

### Important limitation

Reviewed-file state is stored **locally** in VS Code.

- It is tracked per pull request.
- It is not synchronized to Azure DevOps.
- It is not shared automatically with other machines or other reviewers.

This is a platform limitation rather than a bug in the extension: Azure DevOps does not expose an API that lets this extension sync your reviewed-file checkmarks with the web review experience.

### What happens when a new iteration arrives

If the pull request receives a new iteration:

- files changed in the new iteration lose their reviewed mark
- unchanged files keep their reviewed mark

This mirrors the usual expectation for incremental re-review.

## Settings relevant to pull request review

All of these settings are optional unless you need to override auto-detection.

| Setting | Default | Purpose |
| --- | --- | --- |
| `azureDevops.authMethod` | `auto` | Uses Azure AD when available, otherwise falls back to a stored PAT |
| `azureDevops.organization` | auto-detected | Azure DevOps organization name |
| `azureDevops.project` | auto-detected | Azure DevOps project name |
| `azureDevops.repository` | auto-detected | Azure DevOps repository name |
| `azureDevops.pullRequestRefreshInterval` | `60` | Auto-refresh interval in seconds, with a minimum of `30` |
| `azureDevops.notificationScope` | `all` | Controls whether notifications apply to all visible pull requests, only participating pull requests, or none |
| `azureDevops.hideReviewedFiles` | `false` | Hides files you already marked as reviewed in the **PR Changes** view |

## Practical tips and limitations

- Use **Checkout Branch** before deep code review if you want the strongest editor support on the modified side of the diff.
- After switching branches, the extension usually re-selects the matching pull request automatically when it can determine a unique match.
- If the review views are still empty, reload the window and select the pull request again or use **Review Changes**.
- If branch checkout leaves VS Code in a stale-looking state, reload the window and reopen the pull request review.
- New inline comments are created on the modified side of a diff, not the target side.
- Mention support is intentionally strict: it only handles a leading `@FirstName LastName:` pattern.
- If a comment thread cannot be opened safely in a diff, the extension opens a read-only thread document instead.

## Related documentation

- [README](../README.md) for the feature overview, setup summary, and configuration reference
- [CONTRIBUTING](../CONTRIBUTING.md) if you want to work on the extension itself