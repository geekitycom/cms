import type { User } from '../admin/accounts.ts';
import type { SiteSettings } from '../admin/settings.ts';
import { parseAuthorPath, userForAuthor } from '../web/authors.ts';

/** What resolving a me URL needs to know about the site. */
export interface IdentitySite {
  /** The site's base URL, which every identity URL is under. */
  baseUrl: string;
  users: readonly User[];
  settings: Pick<SiteSettings, 'author' | 'soloAuthor'>;
}

/**
 * The one user a me URL names, or `undefined` when it names nobody
 * (decision-23).
 *
 * `/author/{username}/` names that user. The root names the user the author
 * setting names, and only on a solo author site (TASK-180); on a multi-author
 * site it is nobody's. Anything else names nobody, a query or a fragment
 * included.
 *
 * A URL that differs from the site's only in http or https, a `www.` prefix
 * on either side, the case of its scheme and host, or a missing trailing slash
 * is the same URL: those are the spellings a person types and a client's
 * redirects pass through, and the me handed back is always the canonical one.
 */
export function userForMe(me: string, site: IdentitySite): User | undefined {
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

  // The author setting may hold a display name, which the homepage's bio reads
  // the same way; an author path holds a username, matched exactly.
  if (local === '/') {
    return site.settings.soloAuthor ? userForAuthor(site.users, site.settings.author) : undefined;
  }
  const author = parseAuthorPath(local);
  if (author?.pageNumber !== 0) return undefined;
  return site.users.find((user) => user.username === author.username);
}

function withoutWww(hostname: string): string {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

function withSlash(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}
