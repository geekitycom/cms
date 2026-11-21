/**
 * Which fediverse replies show on a page as they arrive, and which wait in the
 * moderation queue.
 *
 * - `show`: every reply shows at once.
 * - `known`: a reply from a follower, from an account with a reply approved
 *   already, or from an account with a reply already shown on a page, shows
 *   at once; anybody else's waits.
 * - `hold`: every reply waits.
 *
 * The rule is applied when a reply arrives, so a reply already on a page stays
 * where it is whatever the rule becomes.
 */
export const FEDIVERSE_REPLY_RULES = ['show', 'known', 'hold'] as const;

export type FediverseReplyRule = (typeof FEDIVERSE_REPLY_RULES)[number];

export function isFediverseReplyRule(value: unknown): value is FediverseReplyRule {
  return (FEDIVERSE_REPLY_RULES as readonly unknown[]).includes(value);
}
