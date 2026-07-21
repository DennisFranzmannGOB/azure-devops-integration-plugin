import { execFile } from 'child_process';
import { getRepositoryRoot } from '../git';

jest.mock('child_process', () => ({
    execFile: jest.fn(),
}));

const execFileMock = execFile as unknown as jest.Mock;

describe('Git command execution', () => {
    beforeEach(() => {
        execFileMock.mockReset();
    });

    it('stops a repository lookup that remains unresponsive for five seconds', async () => {
        execFileMock.mockImplementation((
            _file: string,
            _args: string[],
            options: { timeout?: number },
            callback: (error: Error, stdout: string) => void,
        ) => {
            expect(options.timeout).toBe(5_000);
            callback(new Error('Git command timed out'), '');
        });

        await expect(getRepositoryRoot('C:\\workspace')).resolves.toBeUndefined();
    });
});
