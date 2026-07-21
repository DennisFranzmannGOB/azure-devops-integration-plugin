import { EventEmitter } from 'events';

describe('pull request file comments', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('creates an iteration-aware comment thread for the reviewed file change', async () => {
        let requestBody: unknown;
        const requestMock = jest.fn((
            _options: unknown,
            callback: (response: EventEmitter & { statusCode?: number }) => void,
        ) => {
            const response = new EventEmitter() as EventEmitter & { statusCode?: number };
            response.statusCode = 200;
            callback(response);
            return {
                on: jest.fn(),
                setTimeout: jest.fn(),
                write: jest.fn((body: string) => {
                    requestBody = JSON.parse(body);
                }),
                end: jest.fn(() => {
                    response.emit('data', JSON.stringify({ id: 99, comments: [{ id: 1 }] }));
                    response.emit('end');
                }),
            };
        });

        jest.doMock('https', () => ({
            get: jest.fn(),
            request: requestMock,
        }));

        const { addPullRequestFileComment } = require('../api') as typeof import('../api');
        const createFileComment = addPullRequestFileComment as unknown as (
            org: string,
            project: string,
            repoId: string,
            prId: number,
            content: string,
            threadContext: unknown,
            pullRequestThreadContext: unknown,
            token: string,
        ) => Promise<unknown>;

        await createFileComment(
            'org',
            'project',
            'repo-id',
            42,
            'Please update this line.',
            {
                filePath: '/src/app.ts',
                rightFileStart: { line: 8, offset: 1 },
                rightFileEnd: { line: 8, offset: 1 },
            },
            {
                changeTrackingId: 17,
                iterationContext: {
                    firstComparingIteration: 2,
                    secondComparingIteration: 2,
                },
            },
            'token',
        );

        expect(requestBody).toEqual({
            comments: [{ parentCommentId: 0, content: 'Please update this line.', commentType: 1 }],
            status: 1,
            threadContext: {
                filePath: '/src/app.ts',
                rightFileStart: { line: 8, offset: 1 },
                rightFileEnd: { line: 8, offset: 1 },
            },
            pullRequestThreadContext: {
                changeTrackingId: 17,
                iterationContext: {
                    firstComparingIteration: 2,
                    secondComparingIteration: 2,
                },
            },
        });
    });
});
