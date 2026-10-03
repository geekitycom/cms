import type { Context, Hono, MiddlewareHandler } from 'hono';

import { listUsers } from '../admin/accounts.ts';
import type { User } from '../admin/accounts.ts';
import { moveDocumentFile, POST_KIND, writeDocument } from '../admin/documents.ts';
import type { EditorForm } from '../admin/documents.ts';
import { deleteUpload } from '../admin/media.ts';
import {
  largestUploadLimit,
  refusedUpload,
  storeUpload,
  tooLargeMessage,
  UPLOAD_ENVELOPE_BYTES,
} from '../admin/uploads.ts';
import { readSiteSettings } from '../admin/settings.ts';

import type { Document } from '../content/document.ts';
import { keptProperties } from '../content/kept-properties.ts';
import type { KeptProperties } from '../content/kept-properties.ts';
import { postLocations } from '../content/locations.ts';
import type { PostLocations } from '../content/locations.ts';
import type { PermalinkFile } from '../content/permalink-file.ts';
import type { PostType } from '../content/post-type.ts';
import { isTrashedPath } from '../content/store.ts';
import type { ContentStore } from '../content/store.ts';
import { VISIBILITIES } from '../content/visibility.ts';
import { logMicropubRequest } from '../indieauth/activity-log.ts';
import { insufficientScope, requireBearer } from '../indieauth/bearer.ts';
import type { BearerEnv, Scopes } from '../indieauth/bearer.ts';
import { MICROPUB_MEDIA_PATH, MICROPUB_PATH, siteBaseUrl } from '../indieauth/discovery.ts';
import type { GeekityEnv } from '../env.ts';
import type { Scope } from '../indieauth/request.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import type { ResolvedConfig } from '../config.ts';
import { removeImageVariants } from '../images/variants.ts';
import { UPLOAD_ASSET_PREFIX } from '../web/assets.ts';
import { userForAuthor } from '../web/authors.ts';
import { syndicationTargetsReader } from '../webmention/syndication.ts';
import type { SyndicationTarget } from '../webmention/syndication.ts';
import { createForm, fromForm, fromJson } from './create.ts';
import type { CreatedForm, CreateRequest, Property } from './create.ts';
import { parseChanges, sourceProperties, updateForm } from './update.ts';
import type { Change } from './update.ts';

const ANY_TYPE: readonly Property[] = [
  'content',
  'summary',
  'category',
  'location',
  'published',
  'post-status',
  'visibility',
  'mp-slug',
  'mp-syndicate-to',
];

/** A note has no name: a name its text does not open with makes it an article. */
const NAMED: readonly Property[] = ['name', ...ANY_TYPE];

/**
 * Each post type the site accepts, in the order a client offers them: the
 * name it shows, the properties it offers, and those Post Type Discovery
 * needs to call a post that type. Another type's own property is not offered,
 * since it would make the post that type instead. A record, so a new
 * {@link PostType} cannot go unoffered.
 */
const POST_TYPES: Readonly<
  Record<
    PostType,
    {
      readonly name: string;
      readonly properties: readonly Property[];
      readonly required: readonly Property[];
    }
  >
> = {
  note: { name: 'Note', properties: ANY_TYPE, required: ['content'] },
  article: { name: 'Article', properties: NAMED, required: ['name', 'content'] },
  reply: { name: 'Reply', properties: ['in-reply-to', ...NAMED], required: ['in-reply-to'] },
  photo: { name: 'Photo', properties: ['photo', ...NAMED], required: ['photo'] },
  like: { name: 'Like', properties: ['like-of', ...NAMED], required: ['like-of'] },
  repost: { name: 'Repost', properties: ['repost-of', ...NAMED], required: ['repost-of'] },
  bookmark: {
    name: 'Bookmark',
    properties: ['bookmark-of', ...NAMED],
    required: ['bookmark-of'],
  },
  read: {
    name: 'Read',
    properties: ['read-of', 'read-status', ...NAMED],
    required: ['read-of', 'read-status'],
  },
};

/** Each `q` the endpoint answers. */
const QUERY_NAMES = ['config', 'syndicate-to', 'category', 'source'] as const;

type Query = (typeof QUERY_NAMES)[number];

/** What a query is answered from. */
interface QueryContext {
  readonly baseUrl: string;
  readonly store: ContentStore;
  /** The syndication targets the site declares (TASK-155). */
  readonly targets: readonly SyndicationTarget[];
  readonly locations: PostLocations;
  readonly kept: PermalinkFile<KeptProperties>;
  /** The `filter` parameter, which narrows `q=category`. */
  readonly filter: string | undefined;
  /** The `properties[]` parameters, which narrow `q=source`. */
  readonly properties: readonly string[];
  /** The post the `url` parameter names, which `q=source` reads. */
  readonly post: () => Document | Refusal;
}

/**
 * How the endpoint answers each `q`, or the {@link Refusal} it answers
 * instead.
 */
const QUERIES: Readonly<Record<Query, (context: QueryContext) => object>> = {
  config: ({ baseUrl, targets }) => ({
    'media-endpoint': `${baseUrl}${MICROPUB_MEDIA_PATH}`,
    'syndicate-to': offered(targets),
    'post-types': Object.entries(POST_TYPES).map(([type, { name, properties, required }]) => ({
      type,
      name,
      properties,
      'required-properties': required,
    })),
    visibility: VISIBILITIES,
    q: QUERY_NAMES,
  }),
  'syndicate-to': ({ targets }) => ({ 'syndicate-to': offered(targets) }),
  category: ({ store, filter }) => ({ categories: categories(store, filter) }),
  source: ({ baseUrl, targets, locations, kept, properties, post }) => {
    const document = post();
    if (document instanceof Refusal) return document;
    const all = sourceProperties(document, { baseUrl, targets, locations, kept });
    // Asked for by name, the answer is the properties alone, as the spec has it.
    if (properties.length === 0) return { type: ['h-entry'], properties: all };
    return {
      properties: Object.fromEntries(
        Object.entries(all).filter(([name]) => properties.includes(name)),
      ),
    };
  },
};

/** An error answer: Micropub's `error` code and what went wrong. */
class Refusal {
  constructor(
    readonly status: 400 | 403 | 409,
    readonly error: string,
    readonly description: string,
  ) {}

  answer(c: Context<BearerEnv>): Response {
    c.header('cache-control', 'no-store');
    return c.json({ error: this.error, error_description: this.description }, this.status);
  }
}

function invalid(description: string): Refusal {
  return new Refusal(400, 'invalid_request', description);
}

/**
 * The post `url` names, when it is one of this site's posts, trashed ones
 * included so they can be undeleted, and `user` may change it. A post its
 * front matter attributes to another user is theirs; one attributed to nobody
 * the site knows is anybody's, as it is in the editor.
 */
function postAt(
  url: string | undefined,
  site: { store: ContentStore; baseUrl: string; users: readonly User[]; user: User },
): Document | Refusal {
  if (url === undefined || url === '') return invalid('A url is required.');
  const root = absoluteUrl('/', site.baseUrl);
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    return invalid(`${url} is not a URL.`);
  }
  const document = address.href.startsWith(root)
    ? site.store.getByPermalink(`/${address.pathname.slice(new URL(root).pathname.length)}`)
    : undefined;
  if (document?.type !== 'post') return invalid(`${url} is not a post on this site.`);
  const author = userForAuthor(site.users, document.author);
  if (author !== undefined && author.id !== site.user.id) {
    return new Refusal(403, 'forbidden', `${url} is not your post.`);
  }
  return document;
}

/** The site's targets as a client offers them: a target's id is its uid (decision-26). */
function offered(targets: readonly SyndicationTarget[]): { uid: string; name: string }[] {
  return targets.map(({ id, name }) => ({ uid: id, name }));
}

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

/** Micropub's error table (section 3.8) answers insufficient_scope with 401. */
const MICROPUB_INSUFFICIENT_SCOPE_STATUS = 401;

/**
 * The bearer guard for a token bound to this site, the resource its protected
 * resource metadata names, or bound to none, as Micropub clients' tokens are
 * (decision-24), and granted any one of `scopes` when they are named. Built per
 * request because the base URL is a setting.
 */
export function requireSiteToken(scopes?: Scopes): MiddlewareHandler<BearerEnv> {
  return async (c, next) => {
    const declared = Number(c.req.header('content-length') ?? '');
    const limit = largestUploadLimit(c.var.config);
    if (Number.isFinite(declared) && declared > limit + UPLOAD_ENVELOPE_BYTES) {
      c.header('cache-control', 'no-store');
      return c.json({ error: 'invalid_request', error_description: tooLargeMessage(limit) }, 400);
    }
    return await requireBearer({
      audience: { resource: siteBaseUrl(c), acceptsUnbound: true },
      ...(scopes === undefined ? {} : { scopes }),
      insufficientScopeStatus: MICROPUB_INSUFFICIENT_SCOPE_STATUS,
    })(c, next);
  };
}

/** What a POST asks for, by its `action`; a body without one is a create. */
type MicropubPost =
  | { readonly action: 'create'; readonly request: CreateRequest }
  | {
      readonly action: 'update';
      readonly url: string | undefined;
      readonly changes: readonly Change[];
    }
  | { readonly action: 'delete' | 'undelete'; readonly url: string | undefined };

type Action = MicropubPost['action'];

/** The scope each action needs. */
const ACTION_SCOPES: Readonly<Record<Action, Scope>> = {
  create: 'create',
  update: 'update',
  delete: 'delete',
  undelete: 'delete',
};

function isAction(action: unknown): action is Action {
  return typeof action === 'string' && Object.hasOwn(ACTION_SCOPES, action);
}

/**
 * The request body as a {@link MicropubPost}, or why it is not one. A form
 * carries a create, a delete or an undelete; an update is JSON only, as the
 * spec has it.
 */
async function micropubPost(c: Context<BearerEnv>): Promise<MicropubPost | Refusal> {
  const type = c.req.header('content-type') ?? '';
  if (/^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i.test(type)) {
    const form = await c.req.formData();
    const action = form.get('action');
    if (action === null) return { action: 'create', request: fromForm(form) };
    if (action === 'update') return invalid('An update is sent as JSON.');
    if (action !== 'delete' && action !== 'undelete') return unsupported(action);
    const url = form.get('url');
    return { action, url: typeof url === 'string' ? url : undefined };
  }
  if (/^application\/json\b/i.test(type)) {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return invalid('The request body is not JSON.');
    }
    const fields =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const { action, url } = fields;
    if (action === undefined) {
      const request = fromJson(body);
      return 'error' in request ? invalid(request.error) : { action: 'create', request };
    }
    if (!isAction(action) || action === 'create') return unsupported(action);
    const named = typeof url === 'string' ? url : undefined;
    if (action !== 'update') return { action, url: named };
    const changes = parseChanges(fields);
    return 'error' in changes ? invalid(changes.error) : { action, url: named, changes };
  }
  return invalid('A request is form-encoded, multipart or JSON.');
}

function unsupported(action: unknown): Refusal {
  return invalid(`This endpoint does not support action=${JSON.stringify(action)}.`);
}

/**
 * The create's form with each photo file stored in the media library, the way
 * the media endpoint stores one, and the addresses stored. Nothing is kept
 * when a file is refused.
 */
async function storePhotos(
  created: CreatedForm,
  config: ResolvedConfig,
): Promise<{ form: EditorForm; stored: string[] } | { error: string }> {
  const stored: string[] = [];
  const photos = [...created.form.photos];
  for (const { row, file } of created.uploads) {
    const upload = await storeUpload(file, config, { imagesOnly: true });
    if (refusedUpload(upload)) {
      await removeUploads(stored, config);
      return { error: `photo: ${upload.error}` };
    }
    stored.push(upload.url);
    photos[row] = { url: upload.url, alt: photos[row]?.alt ?? '' };
  }
  return { form: { ...created.form, photos }, stored };
}

/** Take uploads stored for a create that was then refused back out, variants and all. */
async function removeUploads(urls: readonly string[], config: ResolvedConfig): Promise<void> {
  for (const url of urls) {
    await deleteUpload({
      contentDir: config.contentDir,
      path: url.slice(UPLOAD_ASSET_PREFIX.length),
      removeDerived: async (source) => {
        await removeImageVariants(config, source);
      },
    });
  }
}

/** Each action, once its scope has been checked. */
const ACTIONS: {
  readonly [A in Action]: (
    c: Context<BearerEnv>,
    post: Extract<MicropubPost, { action: A }>,
  ) => Promise<Response>;
} = {
  create: async (c, { request }) => {
    const { store, config, announce, bearer, replyContexts } = c.var;
    const timezone = readSiteSettings(config.contentDir).timezone;
    const created = createForm(request, {
      author: bearer.user.username,
      timezone,
      now: store.now(),
      baseUrl: siteBaseUrl(c),
      targets: syndicationTargetsReader(config.contentDir)(),
    });
    if ('errors' in created) return invalid(created.errors.join(' ')).answer(c);

    const photos = await storePhotos(created, config);
    if ('error' in photos) return invalid(photos.error).answer(c);

    const written = await writeDocument(
      {
        store,
        config,
        announce,
        writer: bearer.user.username,
        citedContext: (target) => replyContexts.describe(target),
      },
      {
        kind: POST_KIND,
        document: undefined,
        ...created,
        form: withoutClientReadSummary(photos.form),
      },
    );
    if (written.outcome === 'refused') {
      await removeUploads(photos.stored, config);
      return invalid(written.message).answer(c);
    }
    if (written.outcome === 'conflict') throw new Error('A new post has no file to conflict with.');

    c.header('cache-control', 'no-store');
    c.header('location', absoluteUrl(written.saved.permalink, siteBaseUrl(c)));
    return c.body(null, 201);
  },

  // Through the editor's write path with the hash the post was read with, so
  // it is stamped updated, federates an Update and sends webmentions as an
  // editor save does, and an editor holding the older hash sees a conflict.
  update: async (c, { url, changes }) => {
    const document = postFor(c, url);
    if (document instanceof Refusal) return document.answer(c);
    const { store, config, announce, bearer, replyContexts } = c.var;
    const updated = updateForm(document, changes, {
      timezone: readSiteSettings(config.contentDir).timezone,
      now: store.now(),
      baseUrl: siteBaseUrl(c),
      targets: syndicationTargetsReader(config.contentDir)(),
      locations: postLocations(config.dataDir),
      kept: keptProperties(config.dataDir),
    });
    if ('errors' in updated) return invalid(updated.errors.join(' ')).answer(c);

    const written = await writeDocument(
      {
        store,
        config,
        announce,
        writer: bearer.user.username,
        citedContext: (target) => replyContexts.describe(target),
      },
      { kind: POST_KIND, document, ...updated, form: withoutClientReadSummary(updated.form) },
    );
    if (written.outcome === 'refused') return invalid(written.message).answer(c);
    if (written.outcome === 'conflict') {
      return new Refusal(409, 'conflict', `${url ?? ''} changed on disk; read it again.`).answer(c);
    }

    c.header('cache-control', 'no-store');
    if (written.saved.permalink === document.permalink) return c.body(null, 204);
    c.header('location', absoluteUrl(written.saved.permalink, siteBaseUrl(c)));
    return c.body(null, 201);
  },

  delete: async (c, { url }) => await moved(c, url, 'trash'),
  undelete: async (c, { url }) => await moved(c, url, 'restore'),
};

function postFor(c: Context<BearerEnv>, url: string | undefined): Document | Refusal {
  const { store, config, bearer } = c.var;
  return postAt(url, {
    store,
    baseUrl: siteBaseUrl(c),
    users: listUsers(config.dataDir),
    user: bearer.user,
  });
}

/**
 * Delete and undelete: the editor's move into the trash and back out, so the
 * post leaves and rejoins the site, its feeds and search, and federates a
 * Delete, as it does from the editor. A post already where it was asked to go
 * is left there.
 */
async function moved(
  c: Context<BearerEnv>,
  url: string | undefined,
  action: 'trash' | 'restore',
): Promise<Response> {
  const document = postFor(c, url);
  if (document instanceof Refusal) return document.answer(c);
  c.header('cache-control', 'no-store');
  if (isTrashedPath(document.path) === (action === 'trash')) return c.body(null, 204);
  const { store, config, announce } = c.var;
  const done = await moveDocumentFile(
    { store, contentDir: config.contentDir, announce },
    document,
    action,
  );
  if (done === undefined) return invalid(`Could not move ${document.path}.`).answer(c);
  return c.body(null, 204);
}

/**
 * The Micropub endpoint: the queries a client asks before it posts (TASK-163)
 * and `q=source` (TASK-167), which any live token of this site's may ask
 * whatever its scopes, and the create (TASK-164), update, delete and undelete
 * (TASK-167), each needing its own scope. A token bound to another resource
 * is refused either way (decision-24). Behind the maintenance gate, like the
 * IndieAuth endpoints beside it.
 */
export function mountMicropub(app: Hono<GeekityEnv>): void {
  app.post(MICROPUB_PATH, logMicropubRequest, requireSiteToken(), async (c) => {
    const post = await micropubPost(c);
    if (post instanceof Refusal) return post.answer(c);
    const scope = ACTION_SCOPES[post.action];
    if (!c.var.bearer.token.scopes.includes(scope)) {
      return insufficientScope(c, [scope], MICROPUB_INSUFFICIENT_SCOPE_STATUS);
    }
    const handle = ACTIONS[post.action] as (
      c: Context<BearerEnv>,
      post: MicropubPost,
    ) => Promise<Response>;
    return await handle(c, post);
  });

  app.get(MICROPUB_PATH, logMicropubRequest, requireSiteToken(), (c) => {
    const q = c.req.query('q');
    if (!isQuery(q)) {
      const description =
        q === undefined || q === ''
          ? 'A q parameter is required.'
          : `This endpoint does not answer q=${q}.`;
      return invalid(description).answer(c);
    }
    const answer = QUERIES[q]({
      baseUrl: siteBaseUrl(c),
      store: c.var.store,
      targets: syndicationTargetsReader(c.var.config.contentDir)(),
      locations: postLocations(c.var.config.dataDir),
      kept: keptProperties(c.var.config.dataDir),
      filter: c.req.query('filter'),
      properties: c.req.queries('properties[]') ?? c.req.queries('properties') ?? [],
      post: () => postFor(c, c.req.query('url')),
    });
    if (answer instanceof Refusal) return answer.answer(c);
    c.header('cache-control', 'no-store');
    return c.json(answer);
  });
}

function withoutClientReadSummary(form: EditorForm): EditorForm {
  return form.readStatus === '' ? form : { ...form, description: '' };
}
