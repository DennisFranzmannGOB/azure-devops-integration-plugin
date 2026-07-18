import { EventEmitter } from 'events';

describe('pull request retrieval', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('returns pull requests from every Azure DevOps continuation page', async () => {
        const firstPullRequest = createPullRequest(101, 'First page');
        const secondPullRequest = createPullRequest(102, 'Second page');
        const getMock = jest.fn((
            url: string,
            _options: unknown,
            callback: (res: EventEmitter & { headers?: Record<string, string>; statusCode?: number }) => void,
        ) => {
            const res = new EventEmitter() as EventEmitter & { headers?: Record<string, string>; statusCode?: number };
            res.statusCode = 200;
            res.headers = {};

            let body: unknown;
            if (url.includes('/_apis/connectiondata')) {
                body = { authenticatedUser: { id: 'user-id' } };
            } else if (url.includes('/_apis/teams?')) {
                body = { value: [] };
            } else if (url.includes('searchCriteria.creatorId=user-id')) {
                if (url.includes('continuationToken=next-page')) {
                    body = { value: [secondPullRequest] };
                } else {
                    res.headers = { 'x-ms-continuationtoken': 'next-page' };
                    body = { value: [firstPullRequest] };
                }
            } else if (url.includes('searchCriteria.reviewerId=user-id')) {
                body = { value: [] };
            } else if (url.includes('/threads?') || url.includes('/policy/evaluations?') || url.includes('/workitems?')) {
                body = { value: [] };
            } else {
                throw new Error(`Unexpected URL: ${url}`);
            }

            callback(res);
            res.emit('data', JSON.stringify(body));
            res.emit('end');
            return mockRequest();
        });

        jest.doMock('https', () => ({
            get: getMock,
            request: jest.fn(),
        }));

        const { getMyPullRequests } = require('../api') as typeof import('../api');
        const result = await getMyPullRequests('org', 'token');

        expect(result.createdByMe.map((pr) => pr.pullRequestId)).toEqual([101, 102]);
    });

    it('keeps team pull requests that share an ID with a pull request in another repository', async () => {
        const createdPullRequest = createPullRequest(42, 'Created pull request', 'repo-one');
        const teamPullRequest = createPullRequest(42, 'Team pull request', 'repo-two');
        const getMock = jest.fn((
            url: string,
            _options: unknown,
            callback: (res: EventEmitter & { headers?: Record<string, string>; statusCode?: number }) => void,
        ) => {
            const res = new EventEmitter() as EventEmitter & { headers?: Record<string, string>; statusCode?: number };
            res.statusCode = 200;
            res.headers = {};

            let body: unknown;
            if (url.includes('/_apis/connectiondata')) {
                body = { authenticatedUser: { id: 'user-id' } };
            } else if (url.includes('/_apis/teams?')) {
                body = { value: [{ id: 'team-id' }] };
            } else if (url.includes('searchCriteria.creatorId=user-id')) {
                body = { value: [createdPullRequest] };
            } else if (url.includes('searchCriteria.reviewerId=user-id')) {
                body = { value: [] };
            } else if (url.includes('searchCriteria.reviewerId=team-id')) {
                body = { value: [teamPullRequest] };
            } else if (url.includes('/threads?') || url.includes('/policy/evaluations?') || url.includes('/workitems?')) {
                body = { value: [] };
            } else {
                throw new Error(`Unexpected URL: ${url}`);
            }

            callback(res);
            res.emit('data', JSON.stringify(body));
            res.emit('end');
            return mockRequest();
        });

        jest.doMock('https', () => ({
            get: getMock,
            request: jest.fn(),
        }));

        const { getMyPullRequests } = require('../api') as typeof import('../api');
        const result = await getMyPullRequests('org', 'token');

        expect(result.assignedToMyTeams.map((pr) => pr.repository.id)).toEqual(['repo-two']);
    });

    it('limits concurrent team pull request requests while returning every team result', async () => {
        let activeTeamRequests = 0;
        let maximumActiveTeamRequests = 0;
        const getMock = jest.fn((
            url: string,
            _options: unknown,
            callback: (res: EventEmitter & { headers?: Record<string, string>; statusCode?: number }) => void,
        ) => {
            const res = new EventEmitter() as EventEmitter & { headers?: Record<string, string>; statusCode?: number };
            res.statusCode = 200;
            res.headers = {};

            const complete = (body: unknown) => {
                callback(res);
                res.emit('data', JSON.stringify(body));
                res.emit('end');
            };

            if (url.includes('/_apis/connectiondata')) {
                complete({ authenticatedUser: { id: 'user-id' } });
            } else if (url.includes('/_apis/teams?')) {
                complete({ value: Array.from({ length: 5 }, (_, index) => ({ id: `team-${index + 1}` })) });
            } else if (url.includes('searchCriteria.creatorId=user-id') || url.includes('searchCriteria.reviewerId=user-id')) {
                complete({ value: [] });
            } else if (url.includes('searchCriteria.reviewerId=team-')) {
                activeTeamRequests++;
                maximumActiveTeamRequests = Math.max(maximumActiveTeamRequests, activeTeamRequests);
                const teamId = new URL(url).searchParams.get('searchCriteria.reviewerId') ?? 'unknown-team';
                setTimeout(() => {
                    activeTeamRequests--;
                    complete({ value: [createPullRequest(Number(teamId.replace('team-', '')), `PR for ${teamId}`, teamId)] });
                }, 5);
            } else if (url.includes('/threads?') || url.includes('/policy/evaluations?') || url.includes('/workitems?')) {
                complete({ value: [] });
            } else {
                throw new Error(`Unexpected URL: ${url}`);
            }

            return mockRequest();
        });

        jest.doMock('https', () => ({
            get: getMock,
            request: jest.fn(),
        }));

        const { getMyPullRequests } = require('../api') as typeof import('../api');
        const result = await getMyPullRequests('org', 'token');

        expect(result.assignedToMyTeams).toHaveLength(5);
        expect(maximumActiveTeamRequests).toBeLessThanOrEqual(4);
    });

    it('keeps successful team pull requests when another team request fails', async () => {
        const getMock = jest.fn((
            url: string,
            _options: unknown,
            callback: (res: EventEmitter & { headers?: Record<string, string>; statusCode?: number }) => void,
        ) => {
            const complete = (body: unknown) => {
                const res = new EventEmitter() as EventEmitter & { headers?: Record<string, string>; statusCode?: number };
                res.statusCode = 200;
                res.headers = {};
                callback(res);
                res.emit('data', JSON.stringify(body));
                res.emit('end');
            };

            if (url.includes('/_apis/connectiondata')) {
                complete({ authenticatedUser: { id: 'user-id' } });
            } else if (url.includes('/_apis/teams?')) {
                complete({ value: [{ id: 'team-one' }, { id: 'team-two' }] });
            } else if (url.includes('searchCriteria.creatorId=user-id') || url.includes('searchCriteria.reviewerId=user-id')) {
                complete({ value: [] });
            } else if (url.includes('searchCriteria.reviewerId=team-one')) {
                complete({ value: [createPullRequest(1, 'Available team PR', 'repo-one')] });
            } else if (url.includes('searchCriteria.reviewerId=team-two')) {
                const request = new EventEmitter();
                setTimeout(() => request.emit('error', new Error('Azure DevOps unavailable')), 0);
                return request;
            } else if (url.includes('/threads?') || url.includes('/policy/evaluations?') || url.includes('/workitems?')) {
                complete({ value: [] });
            } else {
                throw new Error(`Unexpected URL: ${url}`);
            }

            return mockRequest();
        });

        jest.doMock('https', () => ({
            get: getMock,
            request: jest.fn(),
        }));

        const { getMyPullRequests } = require('../api') as typeof import('../api');
        const result = await getMyPullRequests('org', 'token');

        expect(result.assignedToMyTeams.map((pr) => pr.title)).toEqual(['Available team PR']);
    });

    it('limits concurrent pull request enrichment while returning every pull request', async () => {
        let activeThreadRequests = 0;
        let maximumActiveThreadRequests = 0;
        const getMock = jest.fn((
            url: string,
            _options: unknown,
            callback: (res: EventEmitter & { headers?: Record<string, string>; statusCode?: number }) => void,
        ) => {
            const complete = (body: unknown) => {
                const res = new EventEmitter() as EventEmitter & { headers?: Record<string, string>; statusCode?: number };
                res.statusCode = 200;
                res.headers = {};
                callback(res);
                res.emit('data', JSON.stringify(body));
                res.emit('end');
            };

            if (url.includes('/_apis/connectiondata')) {
                complete({ authenticatedUser: { id: 'user-id' } });
            } else if (url.includes('/_apis/teams?')) {
                complete({ value: [] });
            } else if (url.includes('searchCriteria.creatorId=user-id')) {
                complete({ value: Array.from({ length: 5 }, (_, index) => createPullRequest(index + 1, `PR ${index + 1}`)) });
            } else if (url.includes('searchCriteria.reviewerId=user-id')) {
                complete({ value: [] });
            } else if (url.includes('/threads?')) {
                activeThreadRequests++;
                maximumActiveThreadRequests = Math.max(maximumActiveThreadRequests, activeThreadRequests);
                setTimeout(() => {
                    activeThreadRequests--;
                    complete({ value: [] });
                }, 5);
            } else if (url.includes('/policy/evaluations?') || url.includes('/workitems?')) {
                complete({ value: [] });
            } else {
                throw new Error(`Unexpected URL: ${url}`);
            }

            return mockRequest();
        });

        jest.doMock('https', () => ({
            get: getMock,
            request: jest.fn(),
        }));

        const { getMyPullRequests } = require('../api') as typeof import('../api');
        const result = await getMyPullRequests('org', 'token');

        expect(result.createdByMe).toHaveLength(5);
        expect(maximumActiveThreadRequests).toBeLessThanOrEqual(4);
    });

    it('fails pull request retrieval when Azure DevOps does not respond before the request timeout', async () => {
        const request = new EventEmitter() as EventEmitter & {
            destroy: jest.Mock;
            setTimeout: jest.Mock;
        };
        request.destroy = jest.fn();
        request.setTimeout = jest.fn((_milliseconds: number, listener: () => void) => listener());

        jest.doMock('https', () => ({
            get: jest.fn(() => request),
            request: jest.fn(),
        }));

        const { getMyPullRequests } = require('../api') as typeof import('../api');
        const outcome = await Promise.race([
            getMyPullRequests('org', 'token').then(
                () => 'resolved',
                (error: Error) => error.message,
            ),
            new Promise<string>((resolve) => setImmediate(() => resolve('pending'))),
        ]);

        expect(outcome).toBe('Request timed out after 15 seconds.');
    });
});

function mockRequest() {
    return {
        on: jest.fn(),
        setTimeout: jest.fn(),
    };
}

function createPullRequest(pullRequestId: number, title: string, repositoryId = 'repo-id') {
    return {
        pullRequestId,
        title,
        sourceRefName: `refs/heads/feature/${pullRequestId}`,
        createdBy: { displayName: 'Author', id: 'author-id' },
        reviewers: [],
        repository: {
            id: repositoryId,
            name: 'repo',
            project: { id: 'project-id', name: 'project' },
        },
        status: 'active',
        isDraft: false,
        url: '',
    };
}
