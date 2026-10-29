import { authorHref, userForAuthor } from '../content/authors.ts';
import { bioHtml, bioText } from './bio.ts';
import type { ProfileLink, User } from './users.ts';
import { relText } from './navigation.ts';

/**
 * Where a person is on this site: their archive, their feeds, and which user
 * a post's `author` names.
 *
 * Every user is an actor at `{baseUrl}/author/{username}/`, and
 * an actor id has to be a URL that already means something — so the author URL
 * is a page first and an actor second. Everything that
 * builds or reads one of those URLs goes through this module, so the archive,
 * its feeds, the byline a theme prints and, later, the dispatcher Fedify
 * registers cannot disagree about where a person lives.
 *
 * The base is a constant rather than a setting, unlike the taxonomy bases: it
 * is an actor id, and an id that moved when somebody edited a settings field
 * would be a different account to every follower holding it. `author` is a
 * reserved top-level path for exactly that reason.
 */

/**
 * What to print for a stored `author`: the user's display name, else their
 * username, else the string as stored, and `undefined` when it is empty.
 *
 * The one rule every feed and byline prints by, so a post that stores `andrew`
 * is credited to Andrew Shell rather than to a login.
 */
export function authorName(users: readonly User[], author: string | undefined): string | undefined {
  const name = (author ?? '').trim();
  if (name === '') return undefined;

  const user = userForAuthor(users, name);
  return user === undefined ? name : (user.profile?.displayName ?? user.username);
}

/**
 * Who the site credits: the display name of the user `author` in `site.json`
 * names, else the site title.
 *
 * A site whose author names nobody has several authors, and the site itself
 * stands in for them in a footer or a feed.
 */
export function siteAuthorName(
  users: readonly User[],
  site: { title: string; author?: string | undefined },
): string {
  const user = userForAuthor(users, site.author);
  return user === undefined ? site.title : (user.profile?.displayName ?? user.username);
}

/** What a theme is given as `author`, on a post and on an archive alike. */
export interface AuthorContext {
  /** Their login, when the name resolved to a user. Absent when it did not. */
  username?: string | undefined;
  /** What to print: their display name, else their username, else the raw name. */
  name: string;
  /** Their archive, when the name resolved to a user. Absent when it did not. */
  url?: string | undefined;
  /** What they say about themselves, when they have said anything: Markdown, as written. */
  bio?: string | undefined;
  /** The bio as HTML, a `<p>` per paragraph, with any raw HTML in it escaped. */
  bioHtml?: string | undefined;
  /** The bio's words with the Markdown taken off. */
  bioText?: string | undefined;
  /** Their picture, as the path or URL it is served at. */
  avatar?: string | undefined;
  /** What they do, when their profile says. */
  jobTitle?: string | undefined;
  /** Where they are, as they wrote it. */
  location?: string | undefined;
  /** Somewhere else they are, in the order they listed them. */
  links?: readonly PublishedProfileLink[] | undefined;
}

/** One of a profile's links as a theme prints it. */
export interface PublishedProfileLink extends ProfileLink {
  /**
   * The whole of the link's `rel`, ready to print: `me` and whatever else was
   * typed after the URL, each said once.
   *
   * Always something, because `rel="me"` is what the Links box is for — it is
   * how Mastodon verifies a profile field pointing back at this site and how
   * IndieAuth knows the link is theirs — and it is added whether or not
   * anybody typed it. A theme prints this attribute and nothing
   * else, so a typed `me` is not a second one.
   */
  readonly rel: string;
}

/**
 * One stored profile link as the page renders it: what was typed, with
 * `rel="me"` on the front of whatever `rel` values it carries.
 */
function publishedProfileLink(link: ProfileLink): PublishedProfileLink {
  return { ...link, rel: relText(['me', link.rel ?? '']) };
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
    ...(profile?.bio === undefined
      ? {}
      : { bio: profile.bio, bioHtml: bioHtml(profile.bio), bioText: bioText(profile.bio) }),
    ...(profile?.avatar === undefined ? {} : { avatar: profile.avatar }),
    ...(profile?.jobTitle === undefined ? {} : { jobTitle: profile.jobTitle }),
    ...(profile?.location === undefined ? {} : { location: profile.location }),
    ...(profile?.links === undefined ? {} : { links: profile.links.map(publishedProfileLink) }),
  };
}

/**
 * The profile behind the site's `author` setting, or `undefined` when it names
 * nobody this site has.
 *
 * What a theme is given as `siteAuthor` on a page that is about nobody in
 * particular: the site's own identity, the same object a byline
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
 * sees: `author.name` is what to print and `author.url` is where to
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
