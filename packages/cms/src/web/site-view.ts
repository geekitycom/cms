import type { Context } from 'hono';

import { answerable, commentPolicyOf } from '../comments/policy.ts';
import { authorNames } from '../content/authors.ts';
import type { Document } from '../content/document.ts';
import { isServed } from '../content/served.ts';
import type { ContentStore } from '../content/store.ts';
import type { GeekityEnv } from './env.ts';
import { listUsers } from '../site/users.ts';
import type { User } from '../site/users.ts';
import type { TaxonomyBases } from '../content/taxonomy.ts';

/** The pages the Reading setting names, as documents the site would serve. */
export interface FrontPages {
  /** The page served at `/`, or `undefined` for the site's latest posts. */
  home: Document | undefined;
  /** The page whose permalink carries the listing, or `undefined` for none. */
  posts: Document | undefined;
}

/**
 * One user's archive: the person, and every `author` string the index should
 * match for them.
 *
 * The names are resolved once, where the users file is read, rather than
 * inside each query: `content/authors.ts` decides which stored spellings read as
 * this person (a username, and the display name a file written before
 * decision-14 carries), and the index only ever matches strings.
 */
export interface AuthorListing {
  /** Whose archive it is. */
  user: User;
  /** Every `author` value that reads as them. */
  names: readonly string[];
}

export interface SiteView {
  readonly store: ContentStore;
  readonly pages: FrontPages;
  readonly bases: TaxonomyBases;
  users(): readonly User[];
  author(username: string): AuthorListing | undefined;
  /** Whether this document's page shows its conversation, and so has a comments feed. */
  showsConversation(document: Document): boolean;
}

const views = new WeakMap<Context<GeekityEnv>, SiteView>();

export function siteView(c: Context<GeekityEnv>): SiteView {
  let view = views.get(c);
  if (view === undefined) {
    view = createSiteView(c);
    views.set(c, view);
  }
  return view;
}

function createSiteView(c: Context<GeekityEnv>): SiteView {
  const { store, renderer, config } = c.var;
  let users: readonly User[] | undefined;
  const readUsers = (): readonly User[] => (users ??= listUsers(config.dataDir));

  return {
    store,
    pages: frontPages(store, renderer.frontPageSlugs()),
    bases: renderer.taxonomyBases(),
    users: readUsers,
    author(username) {
      const all = readUsers();
      const user = all.find((candidate) => candidate.username === username);
      return user === undefined ? undefined : { user, names: authorNames(all, user) };
    },
    showsConversation: (document) =>
      answerable(document, commentPolicyOf(renderer.site()), store.now()),
  };
}

/**
 * WordPress's Reading choice, resolved for this request.
 *
 * The setting holds slugs, and a slug is only a front page while it names a
 * page the public site would serve: one drafted, trashed or deleted since it
 * was picked resolves to nothing, and a site whose homepage resolves to
 * nothing is a site showing its latest posts again. That is the whole of the
 * fallback — there is no state to repair and nothing to write — and it is why
 * the pick is kept rather than cleared: publishing the page again puts the
 * front page back.
 */
function frontPages(
  store: ContentStore,
  slugs: { homepage: string; postsPage: string },
): FrontPages {
  const home = publicPage(store, slugs.homepage);
  return {
    home,
    // Without a homepage there is no posts page: the listing is already at
    // `/`, and a second URL for it is exactly what this pair exists to avoid.
    posts: home === undefined ? undefined : publicPage(store, slugs.postsPage),
  };
}

function publicPage(store: ContentStore, slug: string): Document | undefined {
  if (slug === '') return undefined;
  const found = store.getBySlug(slug);
  if (found?.type !== 'page') return undefined;
  return isServed(found, store.now()) ? found : undefined;
}

/**
 * The path the public site serves a document at, in every representation:
 * `/` for the page that is the homepage, whose own permalink redirects there,
 * and the document's permalink otherwise.
 */
export function servedPath(document: Document, home: Document | undefined): string {
  return document.path === home?.path ? '/' : document.permalink;
}
