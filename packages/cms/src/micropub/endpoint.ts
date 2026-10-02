import type { Hono, MiddlewareHandler } from 'hono';

import type { PostType } from '../content/post-type.ts';
import type { ContentStore } from '../content/store.ts';
import { requireBearer } from '../indieauth/bearer.ts';
import type { BearerEnv } from '../indieauth/bearer.ts';
import { MICROPUB_MEDIA_PATH, MICROPUB_PATH, siteBaseUrl } from '../indieauth/discovery.ts';
import type { GeekityEnv } from '../env.ts';

/**
 * The name a client shows for each post type the site accepts, in the order
 * it offers them. A record, so a new {@link PostType} cannot go unoffered.
 */
const POST_TYPE_NAMES: Readonly<Record<PostType, string>> = {
  note: 'Note',
  article: 'Article',
  reply: 'Reply',
};

/** Each `q` the endpoint answers. */
const QUERY_NAMES = ['config', 'syndicate-to', 'category'] as const;

type Query = (typeof QUERY_NAMES)[number];

/** What a query is answered from. */
interface QueryContext {
  readonly baseUrl: string;
  readonly store: ContentStore;
  /** The `filter` parameter, which narrows `q=category`. */
  readonly filter: string | undefined;
}

/** How the endpoint answers each `q`. */
const QUERIES: Readonly<Record<Query, (context: QueryContext) => object>> = {
  config: ({ baseUrl }) => ({
    'media-endpoint': `${baseUrl}${MICROPUB_MEDIA_PATH}`,
    'syndicate-to': SYNDICATE_TO,
    'post-types': Object.entries(POST_TYPE_NAMES).map(([type, name]) => ({ type, name })),
    q: QUERY_NAMES,
  }),
  'syndicate-to': () => ({ 'syndicate-to': SYNDICATE_TO }),
  category: ({ store, filter }) => ({ categories: categories(store, filter) }),
};

/** The targets a client may offer: none until TASK-168 lists the site's own. */
const SYNDICATE_TO: readonly { uid: string; name: string }[] = [];

/**
 * Every tag and category on a published post, once each, alphabetically
 * whatever the case, keeping those containing `filter` when one is given.
 */
function categories(store: ContentStore, filter: string | undefined): string[] {
  const terms = new Set([
    ...store.listTags().map(({ tag }) => tag),
    ...store.listCategories().map(({ category }) => category),
  ]);
  const needle = filter?.toLowerCase() ?? '';
  return [...terms]
    .filter((term) => term.toLowerCase().includes(needle))
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function isQuery(q: string | undefined): q is Query {
  return (QUERY_NAMES as readonly (string | undefined)[]).includes(q);
}

/**
 * The bearer guard for a token bound to this site, the resource its protected
 * resource metadata names, or bound to none, as Micropub clients' tokens are
 * (decision-24). Built per request because the base URL is a setting.
 */
const requireSiteToken: MiddlewareHandler<BearerEnv> = async (c, next) =>
  await requireBearer({ audience: { resource: siteBaseUrl(c), acceptsUnbound: true } })(c, next);

/**
 * The Micropub endpoint (TASK-163): for now, the queries a client asks before
 * it posts. Any live token of this site's will do, whatever its scopes; one
 * bound to another resource will not (decision-24). Behind the maintenance
 * gate, like the IndieAuth endpoints beside it.
 */
export function mountMicropub(app: Hono<GeekityEnv>): void {
  app.get(MICROPUB_PATH, requireSiteToken, (c) => {
    c.header('cache-control', 'no-store');
    const q = c.req.query('q');
    if (!isQuery(q)) {
      const description =
        q === undefined || q === ''
          ? 'A q parameter is required.'
          : `This endpoint does not answer q=${q}.`;
      return c.json({ error: 'invalid_request', error_description: description }, 400);
    }
    return c.json(
      QUERIES[q]({ baseUrl: siteBaseUrl(c), store: c.var.store, filter: c.req.query('filter') }),
    );
  });
}
