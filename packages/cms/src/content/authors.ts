import { PAGE_SEGMENT } from './taxonomy.ts';

export interface AuthorUser {
  readonly id: number;
  readonly username: string;
  readonly profile?: { readonly displayName?: string | undefined } | undefined;
}

/**
 * The user a document's `author` names, or `undefined` when it names nobody.
 *
 * Two rules, in this order, and the order is the whole of it. A username is
 * what doc-2 says the key holds, and it is matched exactly, as a login is. A
 * display name is what files written before decision-14 hold — the demo's own
 * posts say `Andrew Shell` — and one that exactly one user answers to reads as
 * that user, so an existing site's posts get their bylines and their archives
 * without anybody rewriting a file. Exactly one: two people called the same
 * thing is not an attribution, and guessing between them would put somebody
 * else's post on somebody's archive.
 *
 * The username rule winning means a file saying `ada` is Ada's post even if
 * somebody else has typed `ada` into their display name, which is the safe way
 * round: a login is unique and a display name is anything at all.
 *
 * The mapping is read rather than written. A file keeps whatever it says until
 * the editor next saves it, and the editor writes a username.
 */
export function userForAuthor<U extends AuthorUser>(
  users: readonly U[],
  author: string | undefined,
): U | undefined {
  const wanted = (author ?? '').trim();
  if (wanted === '') return undefined;

  const byUsername = users.find((user) => user.username === wanted);
  if (byUsername !== undefined) return byUsername;

  const named = users.filter((user) => user.profile?.displayName === wanted);
  return named.length === 1 ? named[0] : undefined;
}

/**
 * Every stored `author` string that reads as this user, for the query behind
 * their archive.
 *
 * The inverse of {@link userForAuthor}, and computed by asking it rather than
 * by restating its rules: a candidate counts only when it resolves back to
 * this user, so a display name another user's username has taken, and one two
 * users share, are both left out without this function having to know why.
 */
export function authorNames(users: readonly AuthorUser[], user: AuthorUser): string[] {
  const names: string[] = [];

  for (const candidate of [user.username, user.profile?.displayName]) {
    if (candidate === undefined || candidate === '' || names.includes(candidate)) continue;
    if (userForAuthor(users, candidate)?.id === user.id) names.push(candidate);
  }

  return names;
}

/** The first URL segment every author archive, feed and actor lives under. */
export const AUTHOR_BASE = 'author';

/** Where the shared inbox goes (decision-14), and so the second reserved path. */
export const INBOX_BASE = 'inbox';

/** One author archive, and which page of it. */
export interface AuthorRequest {
  /** The username the URL named. Not yet known to be a user. */
  username: string;
  /** Zero-based index of the page. */
  pageNumber: number;
}

/**
 * The URL of a page of one user's archive, by zero-based index.
 *
 * The one place the shape is spelled, so the routes, the pager, the canonical
 * redirect, the byline a theme prints and the actor id all agree. The first
 * page is the archive root itself, exactly as `/page/1/` collapses onto `/`.
 */
export function authorHref(username: string, index = 0): string {
  const root = `/${AUTHOR_BASE}/${encodeURIComponent(username)}/`;
  return index === 0 ? root : `${root}${PAGE_SEGMENT}/${String(index + 1)}/`;
}

/**
 * A path as the author archive it names, or `undefined` when it names none.
 *
 * The inverse of {@link authorHref}, and deliberately ignorant of whether the
 * username is a user: the caller looks that up and 404s. Only the slashed form
 * parses; the bare `/author/ada` is handled by the canonical redirect, like
 * every other missing trailing slash on the site — which is also where a
 * browser that followed an actor id without its slash lands, because Fedify
 * 404s that form and falls through (doc-8).
 *
 * `page/1/` parses to the first page, which lives at the archive root, so the
 * caller can collapse it the way `/page/1/` collapses onto `/`.
 */
export function parseAuthorPath(pathname: string): AuthorRequest | undefined {
  if (!pathname.endsWith('/')) return undefined;

  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments[0] !== AUTHOR_BASE) return undefined;

  const username = segments[1];
  if (username === undefined || username === '') return undefined;

  if (segments.length === 2) return { username, pageNumber: 0 };
  if (segments.length !== 4 || segments[2] !== PAGE_SEGMENT) return undefined;

  const requested = segments[3] ?? '';
  if (!/^[0-9]+$/.test(requested) || Number(requested) < 1) return undefined;
  return { username, pageNumber: Number(requested) - 1 };
}

/**
 * `{username}@{host}`: the account WebFinger answers for (decision-14).
 *
 * WebFinger's `acct:` subject, the handle the admin shows and the
 * `fediverse:creator` a page names (TASK-202) are each this with a prefix, so
 * a page cannot credit an account the site does not answer for.
 */
export function accountOf(username: string, baseUrl: string): string {
  return `${username}@${new URL(baseUrl === '' ? 'http://localhost' : baseUrl).host}`;
}
