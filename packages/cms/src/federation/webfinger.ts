import { accountOf, authorHref } from '../content/authors.ts';
import type { User } from '../site/users.ts';
import { absoluteUrl } from '../util/url.ts';
import { handleHref } from './paths.ts';

/** Where WebFinger lives, which is defined on the host rather than under a site. */
export const WEBFINGER_PATH = '/.well-known/webfinger';

/** `acct:{username}@{host}`, the handle a person types into a search box. */
export function acctOf(username: string, baseUrl: string): string {
  return `acct:${accountOf(username, baseUrl)}`;
}

/**
 * The user a WebFinger `resource` asks about, or `undefined` for one this site
 * answers for nobody.
 *
 * Every spelling of a person resolves, and they are the ones their actor lists
 * as aliases: the `acct:` handle, the author archive, `/@{username}` and
 * — for somebody who was published elsewhere first — the id they were
 * published under. Matching every one of them is what lets a peer that holds
 * any one URL for this person find the others, which is the whole job of
 * WebFinger, and it is how a server holding only `?author=2` discovers that
 * the account it follows is still here.
 *
 * Both sides of the comparison go through {@link canonicalResource} first, so
 * the spellings that differ only in how they were typed are one spelling by
 * the time they are matched, and no spelling needs a branch of its own.
 */
export function webFingerUser(
  users: readonly User[],
  resource: string,
  baseUrl: string,
): User | undefined {
  const wanted = canonicalResource(resource);
  if (wanted === '') return undefined;

  return users.find((user) =>
    [
      acctOf(user.username, baseUrl),
      absoluteUrl(authorHref(user.username), baseUrl),
      absoluteUrl(handleHref(user.username), baseUrl),
      ...(user.actorId === undefined ? [] : [user.actorId]),
    ].some((spelling) => canonicalResource(spelling) === wanted),
  );
}

/**
 * One resource in the spelling every equivalent one reduces to.
 *
 * A host is case-insensitive — in DNS, in RFC 3986 and in RFC 7033 — so
 * `acct:ada@EXAMPLE.COM` names the same person as `acct:ada@example.com` and
 * has to find them. A username is not: Geekity compares one case sensitively
 * (see {@link User.username}), so the case is left exactly as it was asked
 * for and `acct:Ada@example.com` stays somebody this site does not have.
 *
 * A bare `user@host` is not what RFC 7033 asks for, but it is what enough
 * clients send that refusing it would only look like a missing account, and
 * the same goes for the leading `@` of `@ada@example.com`, which is how the
 * handle is written everywhere a person reads it. Both are spelled back out
 * as the `acct:` URI they meant.
 */
function canonicalResource(resource: string): string {
  const trimmed = resource.trim();

  // A URL carries its own rules, and `URL` applies them: the scheme and the
  // host come back lower-cased, the path untouched.
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).href;
    } catch {
      return trimmed;
    }
  }

  const handle = trimmed.replace(/^acct:/i, '').replace(/^@/, '');
  const at = handle.lastIndexOf('@');
  if (at <= 0) return handle;
  return `acct:${handle.slice(0, at)}@${handle.slice(at + 1).toLowerCase()}`;
}
