/**
 * What a single setting's value may be, and how a typed one is put into the
 * shape the file keeps: the guards and normalisers a site.json read, a form
 * save and a form check share, so the file and the screen cannot mean
 * different things by the same text.
 */
import { clientIdentifier } from '../indieauth/client-id.ts';
import { MAIL_PROVIDERS } from '../mail/provider.ts';
import type { MailProviderName } from '../mail/provider.ts';
import { isCreativeCommonsKey } from '../web/license.ts';
import { AI_CRAWLER_POLICIES } from '../web/robots.ts';
import type { AiCrawlerPolicy } from '../web/robots.ts';
import type { ContentSignalChoice, LicenseChoice } from './settings.ts';

/**
 * What a language tag may look like: BCP 47's shape rather than its registry —
 * a two or three letter primary subtag followed by dash-separated subtags of
 * letters and digits.
 *
 * Checking the shape and not the registry is deliberate. The value ends up in
 * `<html lang>`, an RSS `<language>` and an Atom `xml:lang`, where a
 * well-formed tag a reader has never heard of is harmless and a malformed one
 * is not; refusing a valid tag because this CMS shipped before it was
 * registered would be worse than accepting one nobody uses.
 */
export const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,4}$/;

/**
 * What an email address has to look like before the settings screen will keep
 * it: something, an `@`, and a dotted host.
 *
 * Deliberately loose. The grammar in RFC 5321 allows addresses nobody has ever
 * typed, and the only test that settles whether an address works is sending to
 * it — which is what the Send test email button is for. This catches the
 * typo where a whole field was pasted into the wrong box.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function isContentSignalChoice(value: unknown): value is ContentSignalChoice {
  return value === '' || value === 'yes' || value === 'no';
}

/** Whether a value is a count of polls the Syndication module allows: a whole number from 1. */
export function isPollCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isAiCrawlerPolicy(value: unknown): value is AiCrawlerPolicy {
  return (AI_CRAWLER_POLICIES as readonly unknown[]).includes(value);
}

export function isMailProvider(value: unknown): value is MailProviderName {
  return (MAIL_PROVIDERS as readonly unknown[]).includes(value);
}

export function isLicenseChoice(value: string): value is LicenseChoice {
  return value === '' || value === 'custom' || isCreativeCommonsKey(value);
}

/** Whether a value is a whole number of days, zero included. */
export function isWholeDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** The entries that are client_ids, each once. */
export function clientsWithoutPkceOf(entries: readonly unknown[]): string[] {
  const valid = entries.filter(
    (entry): entry is string => typeof entry === 'string' && clientIdentifier(entry) !== undefined,
  );
  return [...new Set(valid)];
}

/**
 * A base URL, normalised the way `resolveConfig` normalises the configured
 * one, or `undefined` when it is not an absolute http(s) URL.
 */
export function normalizeBaseUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;

  const pathname = parsed.pathname.endsWith('/') ? parsed.pathname.slice(0, -1) : parsed.pathname;
  return parsed.origin + pathname;
}

/**
 * The non-empty lines of a textarea, trimmed.
 *
 * Blank lines are not an error: somebody pasting a list leaves them, and a
 * blank line asks for nothing.
 */
export function relayLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * A relay textarea as the list of inboxes it names: normalised, in the order
 * they were given, with repeats dropped.
 *
 * Exported because the same parsing turns a stored setting, a submitted form
 * and a `site.json` array into the one list; a second spelling of it would let
 * the file and the database disagree about what a site subscribes to.
 */
export function relayList(value: string): string[] {
  const relays: string[] = [];
  for (const line of relayLines(value)) {
    const inbox = normalizeRelayInbox(line);
    if (inbox !== undefined && !relays.includes(inbox)) relays.push(inbox);
  }
  return relays;
}

/**
 * A relay inbox URL, or `undefined` when it is not an absolute http(s) one.
 *
 * Unlike {@link normalizeBaseUrl} this keeps the whole URL bar a trailing
 * slash: a relay inbox is a path — `/user/_____relay_____/inbox` — rather than
 * an origin, and some relays hang one off a query string.
 */
export function normalizeRelayInbox(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;

  const href = parsed.href;
  return href.endsWith('/') && parsed.pathname !== '/' ? href.slice(0, -1) : href;
}

/** A security contact textarea as its URIs, in order, repeats dropped. */
export function securityContactList(value: string): string[] {
  const contacts: string[] = [];
  for (const line of relayLines(value)) {
    const contact = normalizeSecurityContact(line);
    if (contact !== undefined && !contacts.includes(contact)) contacts.push(contact);
  }
  return contacts;
}

/** A phone number as a `tel:` URI writes it: digits and visual separators. */
const TEL_PATTERN = /^tel:\+?[0-9][0-9().-]*$/i;

/**
 * One security contact as the URI security.txt carries, or `undefined`.
 *
 * A bare address is taken as the `mailto:` it means, since that is what
 * somebody filling in a settings form types.
 */
export function normalizeSecurityContact(value: string): string | undefined {
  const trimmed = value.trim();
  const address = trimmed.toLowerCase().startsWith('mailto:') ? trimmed.slice(7) : trimmed;
  if (EMAIL_PATTERN.test(address)) return `mailto:${address}`;
  if (TEL_PATTERN.test(trimmed)) return `tel:${trimmed.slice(4)}`;
  return httpsUrl(trimmed);
}

/** A security policy URL, or `undefined` when it is not an https one. */
export function normalizeSecurityPolicy(value: string): string | undefined {
  return httpsUrl(value.trim());
}

function httpsUrl(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  return parsed.protocol === 'https:' ? parsed.href : undefined;
}

/**
 * A comma-separated list of language tags, joined the way RFC 9116's example
 * writes them, or `undefined` when one of them is not a tag. Empty is a value.
 */
export function normalizeLanguageList(value: string): string | undefined {
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
  return tags.every((tag) => LANGUAGE_TAG_PATTERN.test(tag)) ? tags.join(', ') : undefined;
}

/** Whether `Intl` knows the zone. An empty name is not a zone. */
export function isValidTimezone(value: string): boolean {
  const zone = value.trim();
  if (zone === '') return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
