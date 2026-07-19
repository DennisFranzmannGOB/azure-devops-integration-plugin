import { EnrichedPullRequest } from '../api';
import { SelectedPrContext, buildSelectedPrContext } from '../prChangesProvider';
import { ReviewSession } from '../reviewSession';

function makePr(id: number, repoId = 'repo1'): EnrichedPullRequest {
    return {
        pullRequestId: id,
        title: `PR ${id}`,
        sourceRefName: `refs/heads/feature/${id}`,
        createdBy: { displayName: 'User', id: 'user1' },
        reviewers: [],
        repository: { id: repoId, name: 'repo', project: { id: 'project1', name: 'Project' } },
        status: 'active',
        isDraft: false,
        url: '',
        unresolvedCommentCount: 0,
        checksStatus: 'none',
        checks: [],
        commentThreads: [],
        workItems: [],
    };
}

class FakeChanges {
    selected?: SelectedPrContext;
    refreshCount = 0;

    selectPr(pr: EnrichedPullRequest, org: string): void {
        this.selected = buildSelectedPrContext(pr, org);
    }

    getSelectedPrContext(): SelectedPrContext | undefined {
        return this.selected;
    }

    clear(): void {
        this.selected = undefined;
    }

    refresh(): void {
        this.refreshCount++;
    }
}

class FakeComments {
    clearCount = 0;
    refreshCount = 0;
    selected?: SelectedPrContext;
    reviewMode = false;

    clearAll(): void {
        this.clearCount++;
    }

    async selectPr(pr: EnrichedPullRequest, org: string, reviewMode = false): Promise<void> {
        this.selected = buildSelectedPrContext(pr, org);
        this.reviewMode = reviewMode;
    }

    async refreshAll(): Promise<void> {
        this.refreshCount++;
    }
}

class FakeTranscripts {
    clearCount = 0;

    clear(): void {
        this.clearCount++;
    }
}

class FakeUpdates {
    selected?: SelectedPrContext;
    refreshCount = 0;

    selectPr(pr: EnrichedPullRequest, org: string): void {
        this.selected = buildSelectedPrContext(pr, org);
    }

    clear(): void {
        this.selected = undefined;
    }

    refresh(): void {
        this.refreshCount++;
    }
}

class FakeView {
    title = 'PR Changes';
    revealCount = 0;

    setTitle(title: string): void {
        this.title = title;
    }

    async reveal(): Promise<void> {
        this.revealCount++;
    }
}

function createSession() {
    const changes = new FakeChanges();
    const comments = new FakeComments();
    const transcripts = new FakeTranscripts();
    const updates = new FakeUpdates();
    const view = new FakeView();
    return {
        session: new ReviewSession(changes, comments, updates, view, transcripts),
        changes,
        comments,
        transcripts,
        updates,
        view,
    };
}

describe('ReviewSession', () => {
    it('selects a PR across review surfaces and opens the review view', async () => {
        const { session, changes, comments, updates, view } = createSession();

        await session.select(makePr(42), 'org');

        expect(changes.selected).toEqual({ org: 'org', repoId: 'repo1', prId: 42 });
        expect(comments.selected).toEqual({ org: 'org', repoId: 'repo1', prId: 42 });
        expect(updates.selected).toEqual({ org: 'org', repoId: 'repo1', prId: 42 });
        expect(view.title).toBe('Changes: #42');
        expect(view.revealCount).toBe(1);
    });

    it('replaces inline comment state when selecting a different PR', async () => {
        const { session, comments, transcripts, changes } = createSession();
        await session.select(makePr(42), 'org');

        await session.select(makePr(99), 'org');

        expect(changes.selected).toEqual({ org: 'org', repoId: 'repo1', prId: 99 });
        expect(comments.clearCount).toBe(1);
        expect(transcripts.clearCount).toBe(1);
    });

    it('keeps inline comment state when selecting the active PR again', async () => {
        const { session, comments, view } = createSession();
        await session.select(makePr(42), 'org');

        await session.select(makePr(42), 'org');

        expect(comments.clearCount).toBe(0);
        expect(view.revealCount).toBe(2);
    });

    it('switches to and opens the checked-out PR', async () => {
        const { session, changes, comments, view } = createSession();
        await session.select(makePr(42), 'org');

        await session.checkout(makePr(99), 'org');

        expect(changes.selected).toEqual({ org: 'org', repoId: 'repo1', prId: 99 });
        expect(comments.clearCount).toBe(1);
        expect(comments.reviewMode).toBe(true);
        expect(view.revealCount).toBe(2);
    });

    it('clears every review surface', () => {
        const { session, changes, comments, transcripts, updates, view } = createSession();

        session.clear();

        expect(changes.selected).toBeUndefined();
        expect(updates.selected).toBeUndefined();
        expect(comments.clearCount).toBe(1);
        expect(transcripts.clearCount).toBe(1);
        expect(view.title).toBe('PR Changes');
    });

    it('refreshes all review surfaces', async () => {
        const { session, changes, comments, updates } = createSession();

        await session.refresh();

        expect(changes.refreshCount).toBe(1);
        expect(comments.refreshCount).toBe(1);
        expect(updates.refreshCount).toBe(1);
    });

    it('adds the resolved iteration to the active PR title', async () => {
        const { session, view } = createSession();
        await session.select(makePr(42), 'org');

        session.setIteration(7);

        expect(view.title).toBe('Changes: #42 (Iteration 7)');
    });
});
