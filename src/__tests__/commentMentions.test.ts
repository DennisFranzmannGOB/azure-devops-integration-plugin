import {
    filterExactMentionMatches,
    parseLeadingCommentMention,
    prepareCommentContentWithMentions,
} from '../commentMentions';

describe('commentMentions', () => {
    it('parses a leading colon-separated mention', () => {
        expect(parseLeadingCommentMention('@Dennis Mike: das ist ein Test')).toEqual({
            firstName: 'Dennis',
            lookupName: 'Dennis Mike',
            remainingComment: 'das ist ein Test',
        });
    });

    it('does not parse comments without the required colon separator', () => {
        expect(parseLeadingCommentMention('@Dennis Mike das ist ein Test')).toBeUndefined();
    });

    it('returns the original comment when no leading mention is present', async () => {
        await expect(
            prepareCommentContentWithMentions('Just a plain comment', async () => {
                throw new Error('should not be called');
            }),
        ).resolves.toBe('Just a plain comment');
    });

    it('rewrites a successful exact match to the Azure DevOps mention format', async () => {
        await expect(
            prepareCommentContentWithMentions('@dennis mike: das ist ein Test', async () => ([
                { id: 'user-1', displayName: 'Dennis Mike' },
                { id: 'user-2', displayName: 'Someone Else' },
            ])),
        ).resolves.toBe('@<user-1> Dennis das ist ein Test');
    });

    it('deduplicates exact matches by identity id', () => {
        expect(filterExactMentionMatches('Dennis Mike', [
            { id: 'user-1', displayName: 'Dennis Mike' },
            { id: 'user-1', displayName: 'Dennis Mike' },
            { id: 'user-2', displayName: 'Dennis Mike' },
        ])).toEqual([
            { id: 'user-1', displayName: 'Dennis Mike' },
            { id: 'user-2', displayName: 'Dennis Mike' },
        ]);
    });

    it('throws a user-friendly error when no exact match exists', async () => {
        await expect(
            prepareCommentContentWithMentions('@Dennis Mike: ping', async () => ([
                { id: 'user-2', displayName: 'Dennis M' },
            ])),
        ).rejects.toThrow('No Azure DevOps user matched "Dennis Mike". Use "@FirstName LastName: your comment".');
    });

    it('throws a user-friendly error when multiple exact matches exist', async () => {
        await expect(
            prepareCommentContentWithMentions('@Dennis Mike: ping', async () => ([
                { id: 'user-1', displayName: 'Dennis Mike' },
                { id: 'user-2', displayName: 'Dennis Mike' },
            ])),
        ).rejects.toThrow('Multiple Azure DevOps users matched "Dennis Mike". Use "@FirstName LastName: your comment".');
    });

    it('wraps search failures with mention context', async () => {
        await expect(
            prepareCommentContentWithMentions('@Dennis Mike: ping', async () => {
                throw new Error('HTTP 500');
            }),
        ).rejects.toThrow('Failed to resolve mention for "Dennis Mike": HTTP 500');
    });
});
