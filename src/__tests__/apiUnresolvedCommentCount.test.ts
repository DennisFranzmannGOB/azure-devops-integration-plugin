import { EventEmitter } from 'events';

describe('unresolved comment count', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('counts pending threads as unresolved alongside active threads', async () => {
        const pullRequest = createPullRequest(101, 'Has pending thread');
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
                body = { value: [pullRequest] };
            } else if (url.includes('searchCriteria.reviewerId=user-id')) {
                body = { value: [] };
            } else if (url.includes('/threads?')) {
                body = {
                    value: [
                        {
                            id: 1,
                            status: 'active',
                            isDeleted: false,
                            comments: [{ id: 1, commentType: 'text', isDeleted: false, author: { id: 'author-id' } }],
                        },
                        {
                            id: 2,
                            status: 'pending',
                            isDeleted: false,
                            comments: [{ id: 2, commentType: 'text', isDeleted: false, author: { id: 'author-id' } }],
                        },
                        {
                            id: 3,
                            status: 'closed',
                            isDeleted: false,
                            comments: [{ id: 3, commentType: 'text', isDeleted: false, author: { id: 'author-id' } }],
                        },
                    ],
                };
            } else if (url.includes('/policy/evaluations?') || url.includes('/workitems?')) {
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

        expect(result.createdByMe[0].unresolvedCommentCount).toBe(2);
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
