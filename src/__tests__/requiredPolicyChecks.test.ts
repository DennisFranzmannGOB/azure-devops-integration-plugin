import { EventEmitter } from 'events';

describe('required policy checks', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('keeps only blocking policy evaluations in the sidebar check summary', async () => {
        const pullRequest = {
            pullRequestId: 42,
            title: 'Policy summary',
            sourceRefName: 'refs/heads/feature/policy-summary',
            createdBy: { displayName: 'Author', id: 'author-id' },
            reviewers: [],
            repository: {
                id: 'repo-id',
                name: 'repo',
                project: { id: 'project-id', name: 'project' },
            },
            status: 'active',
            isDraft: false,
            url: '',
        };
        const evaluations = [
            { name: 'CI-Pipeline', status: 'rejected', isBlocking: true },
            { name: 'Work items must be linked', status: 'approved', isBlocking: true },
            { name: 'Comments must be resolved', status: 'rejected', isBlocking: true },
            { name: 'Minimum number of reviewers', status: 'rejected', isBlocking: false },
            { name: 'Required reviewers', status: 'running', isBlocking: false },
        ].map(({ name, status, isBlocking }) => ({
            status,
            configuration: {
                isBlocking,
                isEnabled: true,
                type: { displayName: name },
                settings: { displayName: name },
            },
        }));

        const getMock = jest.fn((url: string, _options: unknown, callback: (res: EventEmitter & { statusCode?: number }) => void) => {
            const res = new EventEmitter() as EventEmitter & { statusCode?: number };
            res.statusCode = 200;
            callback(res);

            let body: unknown;
            if (url.includes('/_apis/connectiondata')) {
                body = { authenticatedUser: { id: 'user-id' } };
            } else if (url.includes('/_apis/teams?')) {
                body = { value: [] };
            } else if (url.includes('/_apis/git/pullrequests?')) {
                body = { value: url.includes('creatorId') ? [pullRequest] : [] };
            } else if (url.includes('/policy/evaluations?')) {
                body = { value: evaluations };
            } else if (url.includes('/threads?')) {
                body = { value: [] };
            } else if (url.includes('/workitems?')) {
                body = { value: [] };
            } else {
                throw new Error(`Unexpected URL: ${url}`);
            }

            res.emit('data', JSON.stringify(body));
            res.emit('end');
            return { on: jest.fn() };
        });

        jest.doMock('https', () => ({
            get: getMock,
            request: jest.fn(),
        }));

        const { getMyPullRequests } = require('../api') as typeof import('../api');
        const result = await getMyPullRequests('org', 'token');
        const checks = result.createdByMe[0].checks;

        expect(checks.map((check) => check.name)).toEqual([
            'CI-Pipeline',
            'Work items must be linked',
            'Comments must be resolved',
        ]);
        expect(result.createdByMe[0].checksStatus).toBe('failed');
    });
});