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

    it('returns changes from every Azure DevOps nextSkip page', async () => {
        const getMock = jest.fn((
            url: string,
            _options: unknown,
            callback: (res: EventEmitter & { headers?: Record<string, string>; statusCode?: number }) => void,
        ) => {
            const res = new EventEmitter() as EventEmitter & { headers?: Record<string, string>; statusCode?: number };
            res.statusCode = 200;
            res.headers = {};

            callback(res);
            if (url.includes('$skip=120')) {
                res.emit('data', JSON.stringify({ changeEntries: makeChanges(120, 10) }));
            } else {
                res.emit('data', JSON.stringify({
                    changeEntries: makeChanges(0, 120),
                    nextSkip: 120,
                }));
            }
            res.emit('end');

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

        expect(changes).toHaveLength(130);
        expect(changes.at(-1)?.item.path).toBe('/extensions/unitop/src/File129.al');
        expect(getMock).toHaveBeenCalledTimes(2);
        expect(getMock.mock.calls[1][0]).toContain('$skip=120');
    });

    it('does not refetch a terminal page whose nextSkip is zero', async () => {
        const getMock = jest.fn((
            _url: string,
            _options: unknown,
            callback: (res: EventEmitter & { headers?: Record<string, string>; statusCode?: number }) => void,
        ) => {
            const res = new EventEmitter() as EventEmitter & { headers?: Record<string, string>; statusCode?: number };
            res.statusCode = 200;
            res.headers = {};

            callback(res);
            res.emit('data', JSON.stringify(
                getMock.mock.calls.length === 1
                    ? {
                        changeEntries: [{ changeType: 'edit', item: { path: '/src/File0.ts' } }],
                        nextSkip: 0,
                    }
                    : { changeEntries: [{ changeType: 'edit', item: { path: '/src/File0.ts' } }] },
            ));
            res.emit('end');

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

        expect(changes).toHaveLength(1);
        expect(getMock).toHaveBeenCalledTimes(1);
    });
});

function makeChanges(start: number, count: number) {
    return Array.from({ length: count }, (_, index) => ({
        changeType: 'edit',
        item: { path: `/extensions/unitop/src/File${start + index}.al` },
    }));
}
