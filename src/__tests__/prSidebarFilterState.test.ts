import * as vscode from 'vscode';
import { PullRequestTreeProvider } from '../prSidebar';

describe('PullRequestTreeProvider — filter and sort state getters', () => {
    it('getFilter() returns "all" by default', () => {
        const provider = new PullRequestTreeProvider({} as any);
        expect(provider.getFilter()).toBe('all');
    });

    it('getSort() returns "default" by default', () => {
        const provider = new PullRequestTreeProvider({} as any);
        expect(provider.getSort()).toBe('default');
    });

    it('getFilter() reflects the value passed to setFilter()', () => {
        const provider = new PullRequestTreeProvider({} as any);
        provider.setFilter('needsMyVote');
        expect(provider.getFilter()).toBe('needsMyVote');
    });

    it('getSort() reflects the value passed to setSort()', () => {
        const provider = new PullRequestTreeProvider({} as any);
        provider.setSort('commentCount');
        expect(provider.getSort()).toBe('commentCount');
    });

    it('getFilter() returns the last set value across multiple calls', () => {
        const provider = new PullRequestTreeProvider({} as any);
        provider.setFilter('draft');
        provider.setFilter('hasComments');
        expect(provider.getFilter()).toBe('hasComments');
    });
});

describe('PullRequestTreeProvider.setFilter — filterActive context key', () => {
    let executeCommandMock: jest.Mock;

    beforeEach(() => {
        executeCommandMock = vscode.commands.executeCommand as jest.Mock;
        executeCommandMock.mockReset();
        executeCommandMock.mockResolvedValue(undefined);
    });

    it('sets filterActive to false when filter is "all"', () => {
        const provider = new PullRequestTreeProvider({} as any);
        provider.setFilter('all');
        expect(executeCommandMock).toHaveBeenCalledWith('setContext', 'azureDevops.filterActive', false);
    });

    it('sets filterActive to true when filter is "draft"', () => {
        const provider = new PullRequestTreeProvider({} as any);
        provider.setFilter('draft');
        expect(executeCommandMock).toHaveBeenCalledWith('setContext', 'azureDevops.filterActive', true);
    });

    it('sets filterActive to true when filter is "needsMyVote"', () => {
        const provider = new PullRequestTreeProvider({} as any);
        provider.setFilter('needsMyVote');
        expect(executeCommandMock).toHaveBeenCalledWith('setContext', 'azureDevops.filterActive', true);
    });

    it('sets filterActive to true when filter is "hasComments"', () => {
        const provider = new PullRequestTreeProvider({} as any);
        provider.setFilter('hasComments');
        expect(executeCommandMock).toHaveBeenCalledWith('setContext', 'azureDevops.filterActive', true);
    });

    it('sets filterActive to true when filter is "checksFailing"', () => {
        const provider = new PullRequestTreeProvider({} as any);
        provider.setFilter('checksFailing');
        expect(executeCommandMock).toHaveBeenCalledWith('setContext', 'azureDevops.filterActive', true);
    });

    it('resets filterActive to false when switching back to "all"', () => {
        const provider = new PullRequestTreeProvider({} as any);
        provider.setFilter('draft');
        executeCommandMock.mockClear();
        provider.setFilter('all');
        expect(executeCommandMock).toHaveBeenCalledWith('setContext', 'azureDevops.filterActive', false);
    });
});
