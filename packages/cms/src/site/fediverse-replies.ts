export const FEDIVERSE_REPLY_RULES = ['show', 'known', 'hold'] as const;

export type FediverseReplyRule = (typeof FEDIVERSE_REPLY_RULES)[number];

export function isFediverseReplyRule(value: unknown): value is FediverseReplyRule {
  return (FEDIVERSE_REPLY_RULES as readonly unknown[]).includes(value);
}
