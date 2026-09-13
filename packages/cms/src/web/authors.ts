import type { ProfileLink, User } from '../admin/accounts.ts';
import { feedPathUnder } from './feed-source.ts';
import type { FeedFormat } from './feed-source.ts';
import { PAGE_SEGMENT } from './taxonomy.ts';

/**
 * Where a person is on this site: their archive, their feeds, and which user
 * a post's `author` names.
 *
 * decision-14 makes every user an actor at `{baseUrl}/author/{username}/`, and
 * an actor id has to be a URL that already means something — so the author URL
 * is a page first (TASK-67) and an actor second (TASK-68). Everything that
 * builds or reads one of those URLs goes through this module, so the archive,
 * its feeds, the byline a theme prints and, later, the dispatcher Fedify
 * registers cannot disagree about where a person lives.
 *
 * The base is a constant rather than a setting, unlike the taxonomy bases: it
 * is an actor id, and an id that moved when somebody edited a settings field
 * would be a different account to every follower holding it. `author` is a
 * reserved top-level path for exactly that reason.
 */

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
 * The URL of one format of one user's feed.
 *
 * WordPress's layout, which decision-14 keeps: the feeds are children of the
 * archive, so `/author/ada/feed/` is RSS 2.0 and the other two hang beside it.
 */
export function authorFeedHref(username: string, format: FeedFormat): string {
  return feedPathUnder(authorHref(username), format);
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
export function userForAuthor(
  users: readonly User[],
  author: string | undefined,
): User | undefined {
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
export function authorNames(users: readonly User[], user: User): string[] {
  const names: string[] = [];

  for (const candidate of [user.username, user.profile?.displayName]) {
    if (candidate === undefined || candidate === '' || names.includes(candidate)) continue;
    if (userForAuthor(users, candidate)?.id === user.id) names.push(candidate);
  }

  return names;
}

/** What a theme is given as `author`, on a post and on an archive alike. */
export interface AuthorContext {
  /** Their login, when the name resolved to a user. Absent when it did not. */
  username?: string | undefined;
  /** What to print: their display name, else their username, else the raw name. */
  name: string;
  /** Their archive, when the name resolved to a user. Absent when it did not. */
  url?: string | undefined;
  /** What they say about themselves, when they have said anything. */
  bio?: string | undefined;
  /** Their picture, as the path or URL it is served at. */
  avatar?: string | undefined;
  /** What they do, when their profile says. */
  jobTitle?: string | undefined;
  /** Where they are, as they wrote it. */
  location?: string | undefined;
  /** Somewhere else they are, in the order they listed them. */
  links?: readonly ProfileLink[] | undefined;
}

/**
 * One user as a theme sees them.
 *
 * `name` is always something printable, so a byline never renders empty: a
 * user who has written no display name is called by their username, which is
 * what their archive is under anyway.
 */
export function profileContext(user: User): AuthorContext {
  const { profile } = user;

  return {
    username: user.username,
    name: profile?.displayName ?? user.username,
    url: authorHref(user.username),
    ...(profile?.bio === undefined ? {} : { bio: profile.bio }),
    ...(profile?.avatar === undefined ? {} : { avatar: profile.avatar }),
    ...(profile?.jobTitle === undefined ? {} : { jobTitle: profile.jobTitle }),
    ...(profile?.location === undefined ? {} : { location: profile.location }),
    ...(profile?.links === undefined ? {} : { links: profile.links }),
  };
}

/**
 * The profile behind the site's `author` setting, or `undefined` when it names
 * nobody this site has.
 *
 * What a theme is given as `siteAuthor` on a page that is about nobody in
 * particular (decision-16): the site's own identity, the same object a byline
 * is, so the visible h-card, the footer's `rel="me"` links and the structured
 * data all read one profile and cannot drift.
 *
 * Strict where {@link authorContext} is forgiving, and deliberately: a byline
 * prints the name a file gives whether or not anybody answers to it, because
 * somebody did write the post. A site author that resolves to nobody has
 * nothing behind it — no picture, no bio, nowhere to link — so it is absent
 * rather than a lone name, and a theme writes `{% if siteAuthor %}` once.
 */
export function siteAuthorContext(
  users: readonly User[],
  author: string | undefined,
): AuthorContext | undefined {
  const user = userForAuthor(users, author);
  return user === undefined ? undefined : profileContext(user);
}

/**
 * What a document's `author` puts on the template context, or `undefined` when
 * it names nobody at all.
 *
 * Always an object rather than sometimes a string, which is the change a theme
 * sees (TASK-67): `author.name` is what to print and `author.url` is where to
 * link, and a name resolving to no user has the first and not the second. A
 * theme therefore writes one thing — `{% if author.url %}` — instead of
 * working out whether the front matter happened to hold a login.
 */
export function authorContext(
  users: readonly User[],
  author: string | undefined,
): AuthorContext | undefined {
  const name = (author ?? '').trim();
  if (name === '') return undefined;

  const user = userForAuthor(users, name);
  return user === undefined ? { name } : profileContext(user);
}
