import { relayRow } from '../../admin/federation.ts';
import { readQuoteAuthorizations } from '../../federation/quotes.ts';
import { federatedUsernames } from '../../federation/records.ts';
import { DELIVERY_STATUSES } from '../../store/deliveries.ts';
import { RELAY_STATES } from '../../store/relays.ts';
import { nullable } from '../../util/json-schema.ts';
import { defineTool } from '../tools.ts';
import {
  counted,
  instants,
  PAGE_INPUT,
  PAGE_OUTPUT,
  PAGE_REQUIRED,
  pageAt,
  pageFields,
  pageOfList,
  TIME_INPUT,
  within,
} from './paging.ts';
import { READ_ONLY } from './schemas.ts';

export const followers = defineTool({
  name: 'followers',
  title: 'Followers',
  description:
    'Lists the actors who follow the site’s users, newest follow first, with the inbox and shared inbox each delivery goes to. Narrow by the user followed, the follower’s actor id and when they followed.',
  scope: 'inspect',
  annotations: READ_ONLY,
  inputSchema: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Only followers of this user.' },
      actor: { type: 'string', description: 'Only this follower’s actor id.' },
      ...TIME_INPUT,
      ...PAGE_INPUT,
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      ...PAGE_OUTPUT,
      followers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'The user followed.' },
            actorId: { type: 'string' },
            inboxId: { type: 'string' },
            sharedInboxId: nullable({ type: 'string' }),
            handle: nullable({ type: 'string' }),
            name: nullable({ type: 'string' }),
            iconUrl: nullable({ type: 'string' }),
            url: nullable({ type: 'string' }),
            followedAt: { type: 'string' },
          },
          required: [
            'username',
            'actorId',
            'inboxId',
            'sharedInboxId',
            'handle',
            'name',
            'iconUrl',
            'url',
            'followedAt',
          ],
        },
      },
    },
    required: [...PAGE_REQUIRED, 'followers'],
  },
  run: (args, { site }) => {
    const range = instants(args);
    if (!range.ok) return Promise.resolve(range);
    const at = pageAt(args);
    const page = pageOfList(
      site.admin
        .listFollowers(args.username)
        .filter(
          (follower) =>
            (args.actor === undefined || follower.actorId === args.actor) &&
            within(follower.followedAt, range),
        ),
      at,
    );
    return Promise.resolve({
      ok: true,
      summary: counted(
        page.total,
        'follower matches',
        'followers match',
        page.items.length,
        at.offset,
      ),
      structured: { ...pageFields(page, at), followers: page.items },
    });
  },
});

export const relays = defineTool({
  name: 'relays',
  title: 'Relays',
  description:
    'Lists the relays the site subscribes to, oldest first: whether each accepted, why one refused, and the last activity delivered to it with its outcome.',
  scope: 'inspect',
  annotations: READ_ONLY,
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', enum: RELAY_STATES, description: 'Only relays in this state.' },
      ...PAGE_INPUT,
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      ...PAGE_OUTPUT,
      relays: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            inboxId: { type: 'string' },
            state: { type: 'string', enum: RELAY_STATES },
            stateLabel: { type: 'string' },
            actorId: nullable({ type: 'string' }),
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
            reason: nullable({
              type: 'string',
              description: 'Why it refused, or why the follow failed.',
            }),
            lastDelivery: nullable({
              type: 'object',
              properties: {
                activityId: { type: 'string' },
                activityType: { type: 'string' },
                status: { type: 'string', enum: DELIVERY_STATUSES },
                error: nullable({ type: 'string' }),
                attemptedAt: { type: 'string' },
              },
              required: ['activityId', 'activityType', 'status', 'error', 'attemptedAt'],
            }),
            retriable: { type: 'boolean', description: 'Whether its follow can be sent again.' },
          },
          required: [
            'inboxId',
            'state',
            'stateLabel',
            'actorId',
            'createdAt',
            'updatedAt',
            'reason',
            'lastDelivery',
            'retriable',
          ],
        },
      },
    },
    required: [...PAGE_REQUIRED, 'relays'],
  },
  run: (args, { site }) => {
    const { admin } = site;
    const at = pageAt(args);
    const page = pageOfList(
      admin
        .listRelays()
        .filter((relay) => args.state === undefined || relay.state === args.state)
        .map((relay) => relayRow(relay, admin.lastDeliveryToInbox(relay.inboxId))),
      at,
    );
    return Promise.resolve({
      ok: true,
      summary: counted(page.total, 'relay matches', 'relays match', page.items.length, at.offset),
      structured: { ...pageFields(page, at), relays: page.items },
    });
  },
});

export const quoteApprovals = defineTool({
  name: 'quote_approvals',
  title: 'Quote approvals',
  description:
    'Lists the quotes of the site’s posts that the site approved, newest first, from each user’s quotes.json: the quoting post, the post it quotes, who asked, and the request it answered.',
  scope: 'inspect',
  annotations: READ_ONLY,
  inputSchema: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Only approvals by this user.' },
      post: { type: 'string', description: 'Only quotes of this post’s object id.' },
      actor: { type: 'string', description: 'Only quotes by this actor id.' },
      ...TIME_INPUT,
      ...PAGE_INPUT,
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      ...PAGE_OUTPUT,
      approvals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'The user whose post was quoted.' },
            id: { type: 'string' },
            quote: { type: 'string', description: 'The quoting post.' },
            post: { type: 'string', description: 'The site’s post it quotes.' },
            request: { type: 'string', description: 'The QuoteRequest that asked.' },
            actor: { type: 'string', description: 'Who quoted.' },
            authorizedAt: { type: 'string' },
          },
          required: ['username', 'id', 'quote', 'post', 'request', 'actor', 'authorizedAt'],
        },
      },
    },
    required: [...PAGE_REQUIRED, 'approvals'],
  },
  run: (args, { site }) => {
    const range = instants(args);
    if (!range.ok) return Promise.resolve(range);
    const { contentDir } = site.config;
    const usernames = federatedUsernames(contentDir).filter(
      (username) => args.username === undefined || username === args.username,
    );
    const at = pageAt(args);
    const page = pageOfList(
      usernames
        .flatMap((username) =>
          readQuoteAuthorizations(contentDir, username).map((record) => ({ username, ...record })),
        )
        .filter(
          (record) =>
            (args.post === undefined || record.post === args.post) &&
            (args.actor === undefined || record.actor === args.actor) &&
            within(record.authorizedAt, range),
        )
        .toSorted((a, b) => b.authorizedAt.localeCompare(a.authorizedAt)),
      at,
    );
    return Promise.resolve({
      ok: true,
      summary: counted(
        page.total,
        'approval matches',
        'approvals match',
        page.items.length,
        at.offset,
      ),
      structured: { ...pageFields(page, at), approvals: page.items },
    });
  },
});
