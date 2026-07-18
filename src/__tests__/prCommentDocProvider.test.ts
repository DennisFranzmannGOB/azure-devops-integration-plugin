import { PrCommentDocProvider, buildCommentDocUri, PR_COMMENT_SCHEME } from '../prCommentDocProvider';
import { Uri } from 'vscode';

describe('PrCommentDocProvider', () => {
    let provider: PrCommentDocProvider;

    beforeEach(() => {
        provider = new PrCommentDocProvider();
    });

    it('returns empty string for an unknown PR-scoped thread', () => {
        const uri = buildCommentDocUri('org', 'repo', 42, 999);
        expect(provider.provideTextDocumentContent(uri)).toBe('');
    });

    it('returns stored content for a known PR-scoped thread', () => {
        const markdown = '**Author**\n\nHello, this is my comment.';
        provider.setCommentContent('org', 'repo', 42, 7, markdown);

        const uri = buildCommentDocUri('org', 'repo', 42, 7);
        expect(provider.provideTextDocumentContent(uri)).toBe(markdown);
    });

    it('returns empty string when URI path does not match expected pattern', () => {
        const uri = Uri.parse(`${PR_COMMENT_SCHEME}://thread/bad-path.md`);
        expect(provider.provideTextDocumentContent(uri)).toBe('');
    });

    it('overwrites content for the same PR-scoped thread and notifies open documents', () => {
        const uri = buildCommentDocUri('org', 'repo', 42, 7);
        const changes: unknown[] = [];
        provider.onDidChange((changedUri) => changes.push(changedUri));

        provider.setCommentContent('org', 'repo', 42, 7, 'first');
        provider.setCommentContent('org', 'repo', 42, 7, 'second');

        expect(provider.provideTextDocumentContent(uri)).toBe('second');
        expect(changes).toEqual([uri, uri]);
    });

    it('does not reuse a numeric thread id from another PR', () => {
        provider.setCommentContent('org', 'repo', 42, 7, 'PR 42 discussion');
        provider.setCommentContent('org', 'repo', 99, 7, 'PR 99 discussion');

        expect(provider.provideTextDocumentContent(buildCommentDocUri('org', 'repo', 42, 7))).toBe('PR 42 discussion');
        expect(provider.provideTextDocumentContent(buildCommentDocUri('org', 'repo', 99, 7))).toBe('PR 99 discussion');
    });

    it('clears all transcript content for a review-session switch', () => {
        const uri = buildCommentDocUri('org', 'repo', 42, 7);
        provider.setCommentContent('org', 'repo', 42, 7, 'Discussion');
        const contentAtChange: string[] = [];
        provider.onDidChange((changedUri) => {
            contentAtChange.push(provider.provideTextDocumentContent(changedUri));
        });

        provider.clear();

        expect(provider.provideTextDocumentContent(uri)).toBe('');
        expect(contentAtChange).toEqual(['']);
    });
});

describe('buildCommentDocUri', () => {
    it('produces a URI with PR identity and thread identity', () => {
        const uri = buildCommentDocUri('example org', 'repo-123', 42, 123);
        expect(uri.scheme).toBe(PR_COMMENT_SCHEME);
        expect(uri.path).toContain('example%20org');
        expect(uri.path).toContain('repo-123');
        expect(uri.path).toContain('42');
        expect(uri.path).toContain('Thread-123.md');
    });
});
