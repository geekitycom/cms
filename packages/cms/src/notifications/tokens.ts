import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

import { readFileIfPresentSync, writeFileAtomicallySync } from '../files/atomic.ts';

/**
 * The thing that makes a link in an email work without a login.
 *
 * A notification is only worth sending if acting on it is one click. That
 * means the link itself has to carry the authority, and the two ways of doing
 * that are a random string written down somewhere and a signed claim that
 * needs nothing written down. This is the second, for one reason: a link lives
 * in an inbox for a week, and `data/geekity.db` is a cache that a site may
 * legitimately delete, rebuild or restore from a backup at any moment
 * (decision-9). A stack of rows would take every link in flight with it.
 *
 * So the token says what it is for — approve *this* comment, unsubscribe
 * *this* address — and carries an HMAC over exactly that, taken with a secret
 * in `data/notification-secret`. Nothing but the secret is needed to check
 * one, the claim cannot be edited without breaking the signature, and a token
 * signed by one site means nothing to another.
 *
 * What is *not* in the token is the right to be used twice. That is a row in
 * the cache (`spent_tokens`), and it is deliberately the half that a lost
 * database forgets: forgetting that a link was spent re-enables an action that
 * has already happened and is idempotent — approving an approved comment, or
 * deleting one that is gone — whereas forgetting the secret would break every
 * link a site had sent.
 */

/** Where the signing secret lives, under `dataDir`. */
export const NOTIFICATION_SECRET_FILE = 'notification-secret';

/** What a link is allowed to do, once its signature checks out. */
export interface NotificationClaim {
  /** Which one-click action this link performs. */
  action: string;
  /**
   * What it acts on: a comment's id for the moderation links, an email address
   * for an unsubscribe.
   */
  subject: string;
}

/** A claim on its way into a link, with how long the link should last. */
export interface NewNotificationToken extends NotificationClaim {
  /** How long it works for, in seconds. */
  lifetimeSeconds: number;
}

/** Mint a signed link token. It is the whole of what the link carries. */
export function signNotificationToken(
  dataDir: string,
  claim: NewNotificationToken,
  now: Date = new Date(),
): string {
  const expiresAt = Math.floor(now.getTime() / 1000) + claim.lifetimeSeconds;
  const payload = Buffer.from(
    JSON.stringify({ a: claim.action, s: claim.subject, x: expiresAt }),
  ).toString('base64url');

  return `${payload}.${sign(dataDir, payload)}`;
}

/**
 * What a token entitles its holder to, or `undefined` when it entitles them to
 * nothing: not a token at all, edited, signed by somebody else, or expired.
 *
 * The signature is checked before the payload is believed, so nothing here
 * ever acts on bytes a stranger chose.
 */
export function readNotificationToken(
  dataDir: string,
  token: string,
  now: Date = new Date(),
): NotificationClaim | undefined {
  const [payload, signature] = token.split('.');
  if (payload === undefined || signature === undefined || payload === '') return undefined;
  if (!matches(sign(dataDir, payload), signature)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;

  const claim = parsed as Record<string, unknown>;
  const action = claim['a'];
  const subject = claim['s'];
  const expiresAt = claim['x'];

  if (typeof action !== 'string' || action === '') return undefined;
  if (typeof subject !== 'string' || subject === '') return undefined;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return undefined;
  if (expiresAt * 1000 <= now.getTime()) return undefined;

  return { action, subject };
}

/**
 * When a token stops working, as an ISO 8601 instant, or `undefined` when it
 * never worked.
 *
 * What the spent-token row is pruned by: a ledger of links that can never be
 * used again is a ledger that can be thrown away.
 */
export function notificationTokenExpiry(dataDir: string, token: string): string | undefined {
  const [payload, signature] = token.split('.');
  if (payload === undefined || signature === undefined) return undefined;
  if (!matches(sign(dataDir, payload), signature)) return undefined;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const seconds = (parsed as Record<string, unknown>)['x'];
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return undefined;
    return new Date(seconds * 1000).toISOString();
  } catch {
    return undefined;
  }
}

/** The HMAC over one payload, base64url so the whole token is URL safe. */
function sign(dataDir: string, payload: string): string {
  return createHmac('sha256', notificationSecret(dataDir)).update(payload).digest('base64url');
}

/** Whether two signatures are the same, without saying how far they agreed. */
function matches(expected: string, given: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(given);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The site's signing secret, minted on first use.
 *
 * Beside `comment-salt` in `data/`, at the same permissions and for the same
 * reason: `content/` is published with the site and goes into git, and a
 * secret there would be a secret in a public repository. Losing it invalidates
 * every link a site has sent and costs nothing else.
 */
function notificationSecret(dataDir: string): string {
  const file = path.join(dataDir, NOTIFICATION_SECRET_FILE);
  const held = readFileIfPresentSync(file)?.trim();
  if (held !== undefined && held !== '') return held;

  const minted = randomBytes(32).toString('hex');
  writeFileAtomicallySync(file, `${minted}\n`, { mode: 0o600 });
  return minted;
}
