import * as vscode from 'vscode';

const STORAGE_KEY = 'azureDevops.reviewedFiles';
const MAX_ENTRIES = 50;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

interface PrReviewEntry {
    iterationId: number;
    files: string[];   // reviewed file paths
    updatedAt: number; // Date.now()
}

type ReviewedFilesData = Record<string, PrReviewEntry>; // key = prId (string)

export class ReviewedFilesStore {
    constructor(private readonly memento: vscode.Memento) { }

    // --- GC ---

    gc(): void {
        const data = this.read();
        const now = Date.now();

        // Drop entries older than MAX_AGE_MS
        const keys = Object.keys(data).filter(k => (now - (data[k].updatedAt ?? 0)) <= MAX_AGE_MS);

        // Cap to MAX_ENTRIES by age (oldest first)
        const trimmed = keys
            .sort((a, b) => (data[b].updatedAt ?? 0) - (data[a].updatedAt ?? 0))
            .slice(0, MAX_ENTRIES);

        const next: ReviewedFilesData = {};
        for (const k of trimmed) { next[k] = data[k]; }
        this.write(next);
    }

    // --- Iteration management ---

    /** Returns the stored iteration id for a PR, or undefined if no marks exist yet. */
    getStoredIterationId(prId: number): number | undefined {
        return this.read()[String(prId)]?.iterationId;
    }

    /**
     * Called when a new iteration is detected. Removes marks only for the files
     * that changed between iterations (same as ADO web portal behaviour), then
     * updates the stored iteration id.
     */
    advanceIteration(prId: number, newIterationId: number, changedPaths: string[]): void {
        const data = this.read();
        const key = String(prId);
        const existing = data[key];

        if (!existing) {
            // No marks yet — just note the new iteration id so we can detect
            // the next delta; nothing to remove.
            data[key] = { iterationId: newIterationId, files: [], updatedAt: Date.now() };
        } else {
            const changed = new Set(changedPaths);
            existing.files = existing.files.filter(f => !changed.has(f));
            existing.iterationId = newIterationId;
            existing.updatedAt = Date.now();
        }
        this.write(data);
    }

    // --- Query ---

    isReviewed(prId: number, filePath: string): boolean {
        const entry = this.read()[String(prId)];
        return entry?.files.includes(filePath) ?? false;
    }

    getReviewedFiles(prId: number): ReadonlySet<string> {
        const entry = this.read()[String(prId)];
        return new Set(entry?.files ?? []);
    }

    // --- Mutations ---

    setReviewed(prId: number, iterationId: number, filePath: string, reviewed: boolean): void {
        const data = this.read();
        const key = String(prId);
        const existing = data[key];

        if (!existing || existing.iterationId !== iterationId) {
            // Fresh entry (first mark, or iteration mismatch — shouldn't happen after ensureIteration but guard anyway)
            data[key] = { iterationId, files: reviewed ? [filePath] : [], updatedAt: Date.now() };
        } else {
            const files = existing.files.filter(f => f !== filePath);
            if (reviewed) { files.push(filePath); }
            existing.files = files;
            existing.updatedAt = Date.now();
        }
        this.write(data);
    }

    resetPr(prId: number): void {
        const data = this.read();
        delete data[String(prId)];
        this.write(data);
    }

    clearAll(): void {
        this.write({});
    }

    // --- Internal ---

    private read(): ReviewedFilesData {
        return this.memento.get<ReviewedFilesData>(STORAGE_KEY, {});
    }

    private write(data: ReviewedFilesData): void {
        this.memento.update(STORAGE_KEY, data);
    }
}
