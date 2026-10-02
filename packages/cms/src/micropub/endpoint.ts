import type { Context, Hono, MiddlewareHandler } from 'hono';

import { POST_KIND, writeDocument } from '../admin/documents.ts';
import { readSiteSettings } from '../admin/settings.ts';

import type { PostType } from '../content/post-type.ts';
import type { ContentStore } from '../content/store.ts';
import { requireBearer } from '../indieauth/bearer.ts';
import type { BearerEnv } from '../indieauth/bearer.ts';
import { MICROPUB_MEDIA_PATH, MICROPUB_PATH, siteBaseUrl } from '../indieauth/discovery.ts';
import type { GeekityEnv } from '../env.ts';
import type { Scope } from '../indieauth/request.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import { createForm, fromForm, fromJson } from './create.ts';
import type { CreateRequest } from './create.ts';

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
 * (decision-24), and granted `scope` when one is named. Built per request
 * because the base URL is a setting.
 */
export function requireSiteToken(scope?: Scope): MiddlewareHandler<BearerEnv> {
  return async (c, next) =>
    await requireBearer({
      audience: { resource: siteBaseUrl(c), acceptsUnbound: true },
      ...(scope === undefined ? {} : { scope }),
    })(c, next);
}

/** The request body as a create, or why it is not one. */
async function createRequest(
  c: Context<BearerEnv>,
): Promise<CreateRequest | { readonly error: string }> {
  const type = c.req.header('content-type') ?? '';
  if (/^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i.test(type)) {
    return fromForm(await c.req.formData());
  }
  if (/^application\/json\b/i.test(type)) {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return { error: 'The request body is not JSON.' };
    }
    return fromJson(body);
  }
  return { error: 'A create is form-encoded, multipart or JSON.' };
}

function invalidRequest(c: Context<BearerEnv>, description: string): Response {
  c.header('cache-control', 'no-store');
  return c.json({ error: 'invalid_request', error_description: description }, 400);
}

/**
 * The Micropub endpoint: the queries a client asks before it posts (TASK-163),
 * which any live token of this site's may ask whatever its scopes, and the
 * create (TASK-164), which needs the create scope. A token bound to another
 * resource is refused either way (decision-24). Behind the maintenance gate,
 * like the IndieAuth endpoints beside it.
 */
export function mountMicropub(app: Hono<GeekityEnv>): void {
  app.post(MICROPUB_PATH, requireSiteToken('create'), async (c) => {
    const request = await createRequest(c);
    if ('error' in request) return invalidRequest(c, request.error);

    const { store, config, announce, bearer } = c.var;
    const timezone = readSiteSettings(config.contentDir).timezone;
    const created = createForm(request, bearer.user.username, timezone, store.now());
    if ('errors' in created) return invalidRequest(c, created.errors.join(' '));

    const written = await writeDocument(
      { store, config, announce, writer: bearer.user.username },
      { kind: POST_KIND, document: undefined, ...created },
    );
    if (written.outcome === 'refused') return invalidRequest(c, written.message);
    if (written.outcome === 'conflict') throw new Error('A new post has no file to conflict with.');

    c.header('cache-control', 'no-store');
    c.header('location', absoluteUrl(written.saved.permalink, siteBaseUrl(c)));
    return c.body(null, 201);
  });

  app.get(MICROPUB_PATH, requireSiteToken(), (c) => {
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
