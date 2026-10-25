import { localPosts } from '../../admin/federation.ts';
import type { LocalPost } from '../../admin/federation.ts';
import { readObjectIds } from '../../federation/object-ids.ts';
import { nullable } from '../../util/json-schema.ts';
import { defineTool } from '../tools.ts';
import type { ToolSite } from '../tools.ts';
import {
  counted,
  instants,
  PAGE_INPUT,
  PAGE_OUTPUT,
  PAGE_REQUIRED,
  pageAt,
  pageFields,
  TIME_INPUT,
} from './paging.ts';
import { ANY_OBJECT, READ_ONLY } from './schemas.ts';

function postResolver(site: ToolSite): (objectId: string | null) => LocalPost | null {
  return localPosts(
    site.store,
    site.config.baseUrl,
    readObjectIds(site.config.contentDir),
    (url) => site.replyContexts.read(url, site.siteAtRequestStart),
    (url) => site.conversation.documentOf(url),
  );
}

export const inboxSearch = defineTool({
  name: 'inbox_search',
  title: 'Search the inbox log',
  description:
    'Searches the activities the site received: likes, boosts, replies, quotes, follows, undos and deletes, newest first. Narrow by type, actor, object, reply target, recipient and time. Each row names the site post it was about, or null when its id matches none, which is why a reply does not show. Set includeJson to get each activity as it arrived.',
  scope: 'inspect',
  annotations: READ_ONLY,
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'integer', minimum: 1, description: 'One row by its log id.' },
      activityId: { type: 'string', description: 'The activity’s own id.' },
      type: { type: 'string', description: 'The activity type, such as Create, Like or Undo.' },
      actor: { type: 'string', description: 'The actor id that sent it.' },
      object: { type: 'string', description: 'The object id it was about.' },
      inReplyTo: { type: 'string', description: 'The id a Create’s note replies to.' },
      recipient: { type: 'string', description: 'The username whose inbox it was sent to.' },
      ...TIME_INPUT,
      includeJson: { type: 'boolean', description: 'Return each activity’s full JSON.' },
      ...PAGE_INPUT,
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      ...PAGE_OUTPUT,
      activities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            activityId: nullable({ type: 'string' }),
            type: { type: 'string' },
            actorId: { type: 'string' },
            objectId: nullable({ type: 'string' }),
            inReplyTo: nullable({ type: 'string' }),
            recipient: nullable({ type: 'string' }),
            receivedAt: { type: 'string' },
            fetched: {
              type: 'boolean',
              description:
                'Whether the site read it from a replies collection rather than was sent it.',
            },
            post: nullable({
              type: 'object',
              description: 'The site post it was about, or that its note replies to.',
              properties: {
                slug: { type: 'string' },
                title: { type: 'string' },
                editUrl: { type: 'string' },
                inThread: {
                  type: 'boolean',
                  description:
                    'Whether it named a reply in the post’s thread rather than the post.',
                },
              },
              required: ['slug', 'title', 'editUrl', 'inThread'],
            }),
            activity: { ...ANY_OBJECT, description: 'The activity as received, with includeJson.' },
          },
          required: [
            'id',
            'activityId',
            'type',
            'actorId',
            'objectId',
            'inReplyTo',
            'recipient',
            'receivedAt',
            'fetched',
            'post',
          ],
        },
      },
    },
    required: [...PAGE_REQUIRED, 'activities'],
  },
  run: (args, { site }) => {
    const range = instants(args);
    if (!range.ok) return Promise.resolve(range);
    const at = pageAt(args);
    const page = site.admin.searchInboxActivities(
      {
        id: args.id,
        activityId: args.activityId,
        type: args.type,
        actor: args.actor,
        object: args.object,
        inReplyTo: args.inReplyTo,
        recipient: args.recipient,
        since: range.since,
        until: range.until,
      },
      at,
    );
    const post = postResolver(site);
    const activities = page.items.map((row) => ({
      id: row.id,
      activityId: row.activityId,
      type: row.activityType,
      actorId: row.actorId,
      objectId: row.objectId,
      inReplyTo: row.inReplyTo,
      recipient: row.recipient,
      receivedAt: row.receivedAt,
      fetched: row.fetched,
      post: post(row.inReplyTo ?? row.objectId),
      ...(args.includeJson === true ? { activity: JSON.parse(row.json) as object } : {}),
    }));
    return Promise.resolve({
      ok: true,
      summary: counted(
        page.total,
        'logged activity matches',
        'logged activities match',
        activities.length,
        at.offset,
      ),
      structured: { ...pageFields(page, at), activities },
    });
  },
});
