import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { Context } from '@fedify/fedify';
import { QuoteAuthorization } from '@fedify/vocab';

import type { User } from '../admin/accounts.ts';
import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { actorId } from './actor.ts';
import type { FederationContextData } from './federation.ts';
import { federatedUsernames, userDirectory } from './records.ts';

/**
 * Quote approvals (FEP-044f), as the files decision-9 makes the truth.
 *
 * Mastodon 4.5 shows a quote only once the quoted author's server has stamped
 * it: an `Accept` of the `QuoteRequest` whose `result` is a
 * `QuoteAuthorization`, dereferenceable by anybody who can see the post. The
 * stamp is a promise the site keeps for as long as the quote stands, so each
 * one is written to `content/_data/federation/{username}/quotes.json`, beside
 * the followers of the author who granted it, and served from there.
 */

/** One quote this site's author let somebody make of one of their posts. */
export interface QuoteAuthorizationRecord {
  /** The stamp's own name, the last segment of its URL. */
  readonly id: string;
  /** The quoting post: the stamp's `interactingObject`. */
  readonly quote: string;
  /** This site's post it quotes: the stamp's `interactionTarget`. */
  readonly post: string;
  /** The `QuoteRequest` that asked, which an `Undo` names. */
  readonly request: string;
  /** Who quoted, the only actor that may take the quote back. */
  readonly actor: string;
  /** When the site approved it. */
  readonly authorizedAt: string;
}

/** What a quote is asked for with: everything but the name the site gives it. */
export type QuoteAsked = Omit<QuoteAuthorizationRecord, 'id' | 'authorizedAt'>;

/** What a user's quote approvals file is called, inside their own directory. */
export const QUOTES_FILE = 'quotes.json';

/** The absolute path of one user's `content/_data/federation/{username}/quotes.json`. */
export function quotesFile(contentDir: string, username: string): string {
  return path.join(contentDir, ...userDirectory(username).split('/'), QUOTES_FILE);
}

/**
 * One user's quote approvals, oldest first. A missing file is none; a damaged
 * one throws naming the file, since reading it as empty would silently
 * withdraw every stamp the user ever gave.
 */
export function readQuoteAuthorizations(
  contentDir: string,
  username: string,
): QuoteAuthorizationRecord[] {
  const file = quotesFile(contentDir, username);
  const source = readFileIfPresentSync(file);
  if (source === undefined) return [];

  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed) || !parsed.every(isRecord)) {
    throw new Error(`${file} should be a list of quote approvals, one object per quote.`);
  }
  return parsed;
}

/** Every user's quote approvals, which is every quote the site vouches for. */
export function readAllQuoteAuthorizations(contentDir: string): QuoteAuthorizationRecord[] {
  return federatedUsernames(contentDir).flatMap((username) =>
    readQuoteAuthorizations(contentDir, username),
  );
}

const FIELDS = ['id', 'quote', 'post', 'request', 'actor', 'authorizedAt'] as const;

function isRecord(value: unknown): value is QuoteAuthorizationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return FIELDS.every((field) => typeof entry[field] === 'string' && entry[field] !== '');
}

/**
 * Approve one quote of one user's post, or hand back the approval it already
 * has. Keyed by the quote and the post, so a redelivered or repeated request
 * is one stamp rather than two.
 */
export async function authorizeQuote(
  contentDir: string,
  username: string,
  asked: QuoteAsked,
): Promise<QuoteAuthorizationRecord> {
  const file = quotesFile(contentDir, username);
  return await withFileLock(file, () => {
    const held = readQuoteAuthorizations(contentDir, username);
    const existing = held.find((entry) => entry.quote === asked.quote && entry.post === asked.post);
    if (existing !== undefined) return existing;

    const stored: QuoteAuthorizationRecord = {
      id: randomUUID(),
      ...asked,
      authorizedAt: new Date().toISOString(),
    };
    writeFileAtomicallySync(file, quotesJson([...held, stored]));
    return stored;
  });
}

/**
 * Withdraw every approval `taken` picks out, whichever user gave it: the quote
 * was deleted or its request undone, and a stamp for a quote that no longer
 * stands is one nobody should be shown.
 */
export async function revokeQuotes(
  contentDir: string,
  taken: (record: QuoteAuthorizationRecord) => boolean,
): Promise<void> {
  for (const username of federatedUsernames(contentDir)) {
    const file = quotesFile(contentDir, username);
    await withFileLock(file, () => {
      const held = readQuoteAuthorizations(contentDir, username);
      const kept = held.filter((record) => !taken(record));
      if (kept.length !== held.length) writeFileAtomicallySync(file, quotesJson(kept));
    });
  }
}

/** One approval as the `QuoteAuthorization` a peer dereferences. */
export function quoteAuthorization(
  context: Context<FederationContextData>,
  user: User,
  record: QuoteAuthorizationRecord,
): QuoteAuthorization {
  return new QuoteAuthorization({
    id: context.getObjectUri(QuoteAuthorization, { identifier: user.username, id: record.id }),
    attribution: actorId(context, user),
    interactingObject: new URL(record.quote),
    interactionTarget: new URL(record.post),
  });
}

function quotesJson(records: readonly QuoteAuthorizationRecord[]): string {
  return `${JSON.stringify(records, null, 2)}\n`;
}
