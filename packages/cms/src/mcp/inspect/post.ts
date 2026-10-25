import type { Document } from '../../content/document.ts';
import { postObjectId } from '../../content/guids.ts';
import { permalinkOfObjectId } from '../../content/permalinks.ts';
import { postLabel } from '../../content/post-type.ts';
import { isFederatedDocument, isGone } from '../../content/served.ts';
import { isTrashedPath } from '../../content/store.ts';
import { postObject, postTombstone } from '../../federation/article.ts';
import {
  currentObjectId,
  naturalObjectId,
  objectIdsOf,
  readObjectIds,
} from '../../federation/object-ids.ts';
import { listUsers } from '../../site/users.ts';
import { DELIVERY_STATUSES } from '../../store/deliveries.ts';
import { nullable } from '../../util/json-schema.ts';
import { absoluteUrl } from '../../util/url.ts';
import { federationContextData } from '../../web/federation-routes.ts';
import { defineTool, isRefused, refused } from '../tools.ts';
import type { Refused, ToolSite } from '../tools.ts';
import { PAGE_INPUT, PAGE_OUTPUT, PAGE_REQUIRED, pageAt, pageFields } from './paging.ts';
import { ANY_OBJECT, DELIVERY, READ_ONLY, STATUS_COUNTS } from './schemas.ts';

export const POST_INPUT = {
  type: 'string',
  description: 'The post: its slug, its permalink, or any object id it was federated under.',
} as const;

/**
 * The post a slug, a permalink or an object id names, trashed ones included,
 * or the refusal an agent is told when none does.
 */
export function findPost(site: ToolSite, reference: string): Document | Refused {
  const url = URL.parse(reference);
  const permalink =
    url === null
      ? undefined
      : permalinkOfObjectId(`${url.origin}${url.pathname}`, site.config.baseUrl);
  const found =
    url === null
      ? site.store.getBySlug(reference)
      : (site.store.getByStoredObjectId(naturalObjectId(reference)) ??
        (permalink === undefined ? undefined : site.store.getByPermalink(permalink)));
  return found?.type === 'post' ? found : refused(`No post answers to ${reference}.`);
}

type PeerView =
  | { readonly state: 'served' | 'gone'; readonly object: object }
  | { readonly state: 'not-served'; readonly object: null };

/**
 * What a peer that dereferences the post's id is answered, by the rule the
 * ActivityStreams route serves by: a served post's object, a trashed post's
 * tombstone (with 410), or nothing (404). Built through the same dispatcher
 * context and object builders, so it cannot drift from what peers get.
 */
async function peerView(site: ToolSite, document: Document, objectId: string): Promise<PeerView> {
  const now = site.store.now();
  const served = isFederatedDocument(document, now);
  const gone = !served && isTrashedPath(document.path) && isGone(document, now);
  if ((!served && !gone) || listUsers(site.config.dataDir).length === 0) {
    return { state: 'not-served', object: null };
  }
  const context = site.federation.createContext(
    new Request(objectId, { headers: { accept: 'application/activity+json' } }),
    federationContextData(site),
  );
  const built = served ? postObject(context, document) : postTombstone(context, document);
  const object = (await built.toJsonLd({ contextLoader: context.contextLoader })) as object;
  return { state: served ? 'served' : 'gone', object };
}

export const postFederation = defineTool({
  name: 'post_federation',
  title: 'How a post federated',
  description:
    'For one post: the ActivityStreams object a peer gets when it fetches the post’s id, every activity the site sent about it with counts by status, and each recipient’s delivery outcome with the recorded error. Filter the deliveries by status or inbox.',
  scope: 'inspect',
  annotations: READ_ONLY,
  inputSchema: {
    type: 'object',
    properties: {
      post: POST_INPUT,
      status: {
        type: 'string',
        enum: DELIVERY_STATUSES,
        description: 'Only deliveries at this status.',
      },
      inbox: { type: 'string', description: 'Only deliveries to this inbox.' },
      ...PAGE_INPUT,
    },
    required: ['post'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      slug: { type: 'string' },
      title: { type: 'string' },
      permalink: { type: 'string' },
      objectId: { type: 'string', description: 'The id peers know the post by now.' },
      objectIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Every id the post was federated under, the current one last.',
      },
      announced: nullable({
        type: 'string',
        description: 'When the post was first announced (activitypub.published), or null if never.',
      }),
      peerState: {
        type: 'string',
        enum: ['served', 'gone', 'not-served'],
        description:
          'served answers peers with the object, gone with a Tombstone and 410, not-served with 404.',
      },
      object: nullable({ ...ANY_OBJECT, description: 'The JSON-LD a peer gets, as it reads now.' }),
      activities: {
        type: 'array',
        description: 'Every activity sent about the post, newest first.',
        items: {
          type: 'object',
          properties: {
            activityId: { type: 'string' },
            activityType: { type: 'string' },
            objectId: { type: 'string' },
            lastAttemptedAt: { type: 'string' },
            counts: STATUS_COUNTS,
          },
          required: ['activityId', 'activityType', 'objectId', 'lastAttemptedAt', 'counts'],
        },
      },
      ...PAGE_OUTPUT,
      deliveries: { type: 'array', description: 'Newest attempt first.', items: DELIVERY },
    },
    required: [
      'slug',
      'title',
      'permalink',
      'objectId',
      'objectIds',
      'announced',
      'peerState',
      'object',
      'activities',
      ...PAGE_REQUIRED,
      'deliveries',
    ],
  },
  run: async (args, { site }) => {
    const document = findPost(site, args.post);
    if (isRefused(document)) return document;
    const { baseUrl, contentDir } = site.config;
    const record = readObjectIds(contentDir);
    const natural = postObjectId(document, baseUrl);
    const objectIds = [...objectIdsOf(record, natural)];
    const objectId = currentObjectId(record, natural);
    const peer = await peerView(site, document, objectId);
    const activities = site.admin.listSentActivitiesAbout(objectIds).map((sent) => ({
      activityId: sent.activityId,
      activityType: sent.activityType,
      objectId: sent.objectId,
      lastAttemptedAt: sent.lastAttemptedAt,
      counts: sent.counts,
    }));
    const at = pageAt(args);
    const page = site.admin.searchDeliveries(
      {
        objectIds,
        statuses: args.status === undefined ? undefined : [args.status],
        inboxId: args.inbox,
      },
      at,
    );
    const failed = activities.reduce((sum, sent) => sum + sent.counts.failed, 0);
    return {
      ok: true,
      summary: `${document.slug} is ${peer.state} to peers as ${objectId}; ${String(activities.length)} ${activities.length === 1 ? 'activity' : 'activities'} sent, ${String(failed)} failed ${failed === 1 ? 'delivery' : 'deliveries'}.`,
      structured: {
        slug: document.slug,
        title: postLabel(document, (url) => site.replyContexts.read(url, site.siteAtRequestStart)),
        permalink: absoluteUrl(document.permalink, baseUrl),
        objectId,
        objectIds,
        announced: document.activitypub?.published ?? null,
        peerState: peer.state,
        object: peer.object,
        activities,
        ...pageFields(page, at),
        deliveries: page.items,
      },
    };
  },
});
