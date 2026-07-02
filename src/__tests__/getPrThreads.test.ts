import { EventEmitter } from 'events';

describe('getPrThreads', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('uses literal $iteration and $baseIteration query parameters', async () => {
        const getMock = jest.fn((url: string, _options: unknown, callback: (res: EventEmitter & { statusCode?: number }) => void) => {
            const res = new EventEmitter() as EventEmitter & { statusCode?: number };
            res.statusCode = 200;
            callback(res);
            res.emit('data', JSON.stringify({ value: [] }));
            res.emit('end');
            return { on: jest.fn() };
        });

        jest.doMock('https', () => ({
            get: getMock,
            request: jest.fn(),
        }));

        const { getPrThreads } = require('../api') as typeof import('../api');

        await getPrThreads('my-org', 'my project', 'repo1', 42, 'token', 7, 3);

        const url = getMock.mock.calls[0][0] as string;
        expect(url).toBe(
            'https://dev.azure.com/my-org/my%20project/_apis/git/repositories/repo1/pullRequests/42/threads?api-version=7.1&$iteration=7&$baseIteration=3'
        );
        expect(url).toContain('&$iteration=7');
        expect(url).toContain('&$baseIteration=3');
        expect(url).not.toContain('%24iteration');
        expect(url).not.toContain('&iteration=7');
        expect(url).not.toContain('&baseIteration=3');
    });
});
