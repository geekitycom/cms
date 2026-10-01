import type { User } from '../admin/accounts.ts';
import type { SiteSettings } from '../admin/settings.ts';
import { authorHref, parseAuthorPath, userForAuthor } from '../web/authors.ts';

/** What resolving a me URL needs to know about the site. */
export interface IdentitySite {
  /** The site's base URL, which every identity URL is under. */
  baseUrl: string;
  users: readonly User[];
  settings: Pick<SiteSettings, 'author'>;
}

/**
 * The one user a me URL names, or `undefined` when it names nobody
 * (decision-23).
 *
 * `/author/{username}/` names that user. The root names the user the author
 * setting names, which makes it a solo author site (TASK-192); on a site with
 * several authors it is nobody's. Anything else names nobody, a query or a fragment
 * included.
 *
 * A URL that differs from the site's only in http or https, a `www.` prefix
 * on either side, the case of its scheme and host, or a missing trailing slash
 * is the same URL: those are the spellings a person types and a client's
 * redirects pass through, and the me handed back is always the canonical one.
 */
export function userForMe(me: string, site: IdentitySite): User | undefined {
  return identityNamed(me, site)?.user;
}

/**
 * The me a sign-in hands back for `user`, who has just approved it
 * (decision-23).
 *
 * The URL the person typed when it names them, spelled canonically: the root
 * for the solo author who typed it, their author URL otherwise. A typed URL
 * that names somebody else, or nobody, is ignored, and the answer is the
 * signed-in user's own author URL: a person can only ever sign in as
 * themselves.
 */
export function meForSignIn(typed: string | undefined, user: User, site: IdentitySite): string {
  const named = typed === undefined ? undefined : identityNamed(typed, site);
  const base = site.baseUrl.replace(/\/$/, '');
  if (named?.user.id === user.id && named.root) return `${base}/`;
  return `${base}${authorHref(user.username)}`;
}

/** The user a me URL names, and whether it named them by the site root. */
function identityNamed(me: string, site: IdentitySite): { user: User; root: boolean } | undefined {
  const typed = URL.parse(me);
  const base = URL.parse(site.baseUrl);
  if (typed === null || base === null) return undefined;
  if (typed.protocol !== 'https:' && typed.protocol !== 'http:') return undefined;
  if (typed.username !== '' || typed.password !== '') return undefined;
  if (typed.search !== '' || typed.hash !== '' || me.includes('#') || me.includes('?')) {
    return undefined;
  }
  if (withoutWww(typed.hostname) !== withoutWww(base.hostname)) return undefined;
  if (typed.port !== base.port) return undefined;

  const root = withSlash(base.pathname);
  const pathname = withSlash(typed.pathname);
  if (!pathname.startsWith(root)) return undefined;
  const local = `/${pathname.slice(root.length)}`;

  // The author setting holds a username, or in a file written before the
  // Site author select a display name, which the homepage's bio reads the same
  // way; an author path holds a username, matched exactly.
  if (local === '/') {
    const author = userForAuthor(site.users, site.settings.author);
    return author === undefined ? undefined : { user: author, root: true };
  }
  const author = parseAuthorPath(local);
  if (author?.pageNumber !== 0) return undefined;
  const user = site.users.find((candidate) => candidate.username === author.username);
  return user === undefined ? undefined : { user, root: false };
}

function withoutWww(hostname: string): string {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

function withSlash(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}
