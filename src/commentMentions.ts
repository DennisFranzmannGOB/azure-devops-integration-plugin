import type { IdentitySearchResult } from './api';

export interface ParsedCommentMention {
    firstName: string;
    lookupName: string;
    remainingComment: string;
}

export type IdentitySearcher = (lookupName: string) => Promise<IdentitySearchResult[]>;

const MENTION_INSTRUCTIONS = 'Use "@FirstName LastName: your comment".';

export function normalizeMentionValue(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function parseLeadingCommentMention(content: string): ParsedCommentMention | undefined {
    const match = content.match(/^\s*@([^\s:]+)\s+([^\s:]+)\s*:\s*([\s\S]*)$/);
    if (!match) {
        return undefined;
    }

    const [, firstName, lastName, remainingComment] = match;
    return {
        firstName,
        lookupName: `${firstName} ${lastName}`,
        remainingComment,
    };
}

export function filterExactMentionMatches(
    lookupName: string,
    identities: IdentitySearchResult[],
): IdentitySearchResult[] {
    const normalizedLookupName = normalizeMentionValue(lookupName);
    const exactMatches = identities.filter(
        (identity) => normalizeMentionValue(identity.displayName) === normalizedLookupName,
    );

    return [...new Map(exactMatches.map((identity) => [identity.id, identity])).values()];
}

function getResolvedFirstName(identity: IdentitySearchResult, fallbackFirstName: string): string {
    const displayNameParts = identity.displayName.trim().split(/\s+/).filter(Boolean);
    return displayNameParts[0] ?? fallbackFirstName;
}

export async function prepareCommentContentWithMentions(
    content: string,
    searchIdentities: IdentitySearcher,
): Promise<string> {
    const mention = parseLeadingCommentMention(content);
    if (!mention) {
        return content;
    }

    let identities: IdentitySearchResult[];
    try {
        identities = await searchIdentities(mention.lookupName);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to resolve mention for "${mention.lookupName}": ${message}`);
    }

    const matches = filterExactMentionMatches(mention.lookupName, identities);
    if (matches.length === 0) {
        throw new Error(`No Azure DevOps user matched "${mention.lookupName}". ${MENTION_INSTRUCTIONS}`);
    }
    if (matches.length > 1) {
        throw new Error(`Multiple Azure DevOps users matched "${mention.lookupName}". ${MENTION_INSTRUCTIONS}`);
    }

    const firstName = getResolvedFirstName(matches[0], mention.firstName);
    return mention.remainingComment.length > 0
        ? `@<${matches[0].id}> ${firstName} ${mention.remainingComment}`
        : `@<${matches[0].id}> ${firstName}`;
}
