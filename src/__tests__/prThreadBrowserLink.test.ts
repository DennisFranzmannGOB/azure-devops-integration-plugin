import { PrCommentThreadItem } from '../prChangesProvider';
import { PrThread } from '../api';
import { buildPullRequestThreadUrl } from '../prLinks';

function makeThread(overrides: Partial<PrThread> = {}): PrThread {
    return {
        id: 99,
        status: 'active',
        isDeleted: false,
        comments: [
            {
                id: 1,
                parentCommentId: 0,
                content: 'A comment',
                author: { displayName: 'Alice', id: 'a1' },
                publishedDate: '2024-01-01T00:00:00Z',
                commentType: 'text',
                isDeleted: false,
            },
        ],
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// PrCommentThreadItem — repoName field
// ─────────────────────────────────────────────────────────────────────────────

describe('PrCommentThreadItem — repoName field', () => {
    it('stores repoName passed to the constructor', () => {
        const thread = makeThread();
        const item = new PrCommentThreadItem(
            thread, 'myOrg', 'myProject', 'repo-id-123', 42, 'srcC', 'tgtC', 'my-repo-name'
        );
        expect(item.repoName).toBe('my-repo-name');
    });

    it('defaults repoName to empty string when not provided', () => {
        const thread = makeThread();
        const item = new PrCommentThreadItem(
            thread, 'org', 'proj', 'repoId', 1, 'src', 'tgt'
        );
        expect(item.repoName).toBe('');
    });

    it('exposes the thread id via thread.id', () => {
        const thread = makeThread({ id: 77 });
        const item = new PrCommentThreadItem(
            thread, 'org', 'proj', 'repoId', 5, 'src', 'tgt', 'repo'
        );
        expect(item.thread.id).toBe(77);
    });

    it('stores org, project, and prId correctly', () => {
        const item = new PrCommentThreadItem(
            makeThread(), 'contoso', 'MyProject', 'repoId', 163, 'src', 'tgt', 'integration-repo'
        );
        expect(item.org).toBe('contoso');
        expect(item.project).toBe('MyProject');
        expect(item.prId).toBe(163);
        expect(item.repoName).toBe('integration-repo');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildPullRequestThreadUrl — URL construction for browser link
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPullRequestThreadUrl', () => {
    it('constructs a URL that includes the discussionId query param', () => {
        const url = buildPullRequestThreadUrl('contoso', 'MyProject', 'my-repo', 163, 99);
        expect(url).toContain('discussionId=99');
        expect(url).toContain('pullrequest/163');
        expect(url).toContain('contoso');
        expect(url).toContain('MyProject');
        expect(url).toContain('my-repo');
    });

    it('falls back to base PR URL when threadId is undefined', () => {
        const url = buildPullRequestThreadUrl('contoso', 'Proj', 'repo', 5, undefined);
        expect(url).not.toContain('discussionId');
        expect(url).toContain('pullrequest/5');
    });

    it('falls back to base PR URL when threadId is 0', () => {
        const url = buildPullRequestThreadUrl('org', 'proj', 'repo', 1, 0);
        expect(url).not.toContain('discussionId');
    });

    it('URL-encodes the org and project names', () => {
        const url = buildPullRequestThreadUrl('my org', 'my project', 'repo', 1, 10);
        expect(url).toContain('my%20org');
        expect(url).toContain('my%20project');
    });
});
