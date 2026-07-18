import { EnrichedPullRequest } from './api';
import {
    SelectedPrContext,
    buildSelectedPrContext,
    sameSelectedPrContext,
} from './prChangesProvider';

export interface ReviewChangesAdapter {
    selectPr(pr: EnrichedPullRequest, org: string): void;
    getSelectedPrContext(): SelectedPrContext | undefined;
    clear(): void;
    refresh(): void;
}

export interface ReviewCommentsAdapter {
    clearAll(): void;
    refreshAll(): Promise<void>;
}

export interface ReviewUpdatesAdapter {
    selectPr(pr: EnrichedPullRequest, org: string): void;
    clear(): void;
    refresh(): void;
}

export interface ReviewSessionView {
    setTitle(title: string): void;
    reveal(): Promise<void>;
}

export class ReviewSession {
    constructor(
        private readonly changes: ReviewChangesAdapter,
        private readonly comments: ReviewCommentsAdapter,
        private readonly updates: ReviewUpdatesAdapter,
        private readonly view: ReviewSessionView,
    ) { }

    async select(pr: EnrichedPullRequest, org: string): Promise<void> {
        const next = buildSelectedPrContext(pr, org);
        const current = this.changes.getSelectedPrContext();
        if (current && !sameSelectedPrContext(current, next)) {
            this.comments.clearAll();
        }

        this.changes.selectPr(pr, org);
        this.updates.selectPr(pr, org);
        this.view.setTitle(`Changes: #${pr.pullRequestId}`);
        await this.view.reveal();
    }

    async checkout(pr: EnrichedPullRequest, org: string): Promise<void> {
        await this.select(pr, org);
    }

    clear(): void {
        this.changes.clear();
        this.comments.clearAll();
        this.updates.clear();
        this.view.setTitle('PR Changes');
    }

    async refresh(): Promise<void> {
        this.changes.refresh();
        this.updates.refresh();
        await this.comments.refreshAll();
    }

    setIteration(iterationId: number | undefined): void {
        const current = this.changes.getSelectedPrContext();
        if (!current) {
            this.view.setTitle('PR Changes');
            return;
        }

        this.view.setTitle(
            iterationId
                ? `Changes: #${current.prId} (Iteration ${iterationId})`
                : `Changes: #${current.prId}`,
        );
    }
}
