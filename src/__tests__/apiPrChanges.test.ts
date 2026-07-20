import { EventEmitter } from 'events';

describe('pull request iteration changes', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('returns changes from every Azure DevOps continuation page', async () => {
        const getMock = jest.fn((
            url: string,
            _options: unknown,
            callback: (res: EventEmitter & { headers?: Record<string, string>; statusCode?: number }) => void,
        ) => {
            const res = new EventEmitter() as EventEmitter & { headers?: Record<string, string>; statusCode?: number };
            res.statusCode = 200;
            res.headers = {};

            if (url.includes('continuationToken=next-page')) {
                callback(res);
                res.emit('data', JSON.stringify({
                    changeEntries: [{ changeType: 'edit', item: { path: '/extensions/unitop/Certificate Management/src/Setup/Setup.al' } }],
                }));
                res.emit('end');
            } else {
                res.headers = { 'x-ms-continuationtoken': 'next-page' };
                callback(res);
                res.emit('data', JSON.stringify({
                    changeEntries: [{ changeType: 'edit', item: { path: '/extensions/unitop/Certificate Management/src/General/General.al' } }],
                }));
                res.emit('end');
            }

            return {
                on: jest.fn(),
                setTimeout: jest.fn(),
            };
        });

        jest.doMock('https', () => ({
            get: getMock,
            request: jest.fn(),
        }));

        const { getPrChanges } = require('../api') as typeof import('../api');
        const changes = await getPrChanges('org', 'project', 'repo-id', 42, 3, 'token');

        expect(changes.map((change) => change.item.path)).toEqual([
            '/extensions/unitop/Certificate Management/src/General/General.al',
            '/extensions/unitop/Certificate Management/src/Setup/Setup.al',
        ]);
        expect(getMock).toHaveBeenCalledTimes(2);
    });
});
