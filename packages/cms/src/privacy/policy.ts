/**
 * How long this site keeps the personal data its readers hand it (TASK-135).
 *
 * Three periods, each in whole days counted from the moment the data arrived,
 * and `0` for keeping it for as long as the site stands. They are settings in
 * `content/_data/site.json` rather than config: how long a site keeps what
 * people give it is the owner's decision, made on the Discussion screen, and a
 * public file is the right place for a policy a privacy notice will quote.
 */

/*
 * A site that never chose a period keeps everything: a `site.json` without the
 * keys reads as `0`, so upgrading the package never deletes anything. The
 * periods below are what `geekity init` writes for a new site and what the
 * Discussion screen recommends to an existing one.
 */

/** Days a commenter's email is kept: long enough for a reply to reach them. */
export const RECOMMENDED_COMMENT_EMAIL_RETENTION_DAYS = 180;

/** Days an address hash is kept: long enough to spot a run of spam. */
export const RECOMMENDED_ADDRESS_HASH_RETENTION_DAYS = 30;

/** Days a contact message is kept: a year of correspondence. */
export const RECOMMENDED_CONTACT_MESSAGE_RETENTION_DAYS = 365;

/** The three periods. Zero keeps that data forever. */
export interface RetentionPolicy {
  /** Days a comment keeps its author's email, and with it their reply subscription. */
  readonly commentEmailDays: number;
  /** Days a comment or a contact message keeps the hash of the address it came from. */
  readonly addressHashDays: number;
  /** Days a contact message is kept at all. */
  readonly contactMessageDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether data that arrived at `at` has outlived a period of `days`.
 *
 * A date that will not parse has no age, so it is never past anything: a hand
 * edit that lost a timestamp should not be what deletes somebody's message.
 */
export function outlived(at: string, days: number, now: Date): boolean {
  if (days <= 0) return false;
  const arrived = Date.parse(at);
  if (Number.isNaN(arrived)) return false;
  return now.getTime() - arrived > days * DAY_MS;
}
