import { COMMENT_KINDS, COMMENT_STATUSES } from '../../store/comments.ts';
import { WEBMENTION_SEND_STATUSES } from '../../store/webmentions.ts';
import { nullable } from '../../util/json-schema.ts';
import { defineTool } from '../tools.ts';
import {
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
import { findPost, POST_INPUT } from './post.ts';
import { READ_ONLY } from './schemas.ts';

const STATUSES = { sent: WEBMENTION_SEND_STATUSES, received: COMMENT_STATUSES } as const;

export const webmentions = defineTool({
  name: 'webmentions',
  title: 'Webmentions of a post',
  description:
    'For one post, newest first: the webmentions it sent to the pages it links to, with each endpoint, outcome and error; or the webmentions it received, with their moderation status.',
  scope: 'inspect',
  annotations: READ_ONLY,
  inputSchema: {
    type: 'object',
    properties: {
      post: POST_INPUT,
      direction: { type: 'string', enum: ['sent', 'received'] },
      status: {
        type: 'string',
        description: `Only this status: ${WEBMENTION_SEND_STATUSES.join(', ')} for sent; ${COMMENT_STATUSES.join(', ')} for received.`,
      },
      ...TIME_INPUT,
      ...PAGE_INPUT,
    },
    required: ['post', 'direction'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      ...PAGE_OUTPUT,
      sent: {
        type: 'array',
        description: 'With direction sent.',
        items: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            target: { type: 'string' },
            endpoint: nullable({
              type: 'string',
              description: 'null when the target advertised none.',
            }),
            status: { type: 'string', enum: WEBMENTION_SEND_STATUSES },
            error: nullable({ type: 'string' }),
            attemptedAt: { type: 'string' },
          },
          required: ['source', 'target', 'endpoint', 'status', 'error', 'attemptedAt'],
        },
      },
      received: {
        type: 'array',
        description: 'With direction received.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            source: nullable({ type: 'string', description: 'The page that mentioned the post.' }),
            kind: { type: 'string', enum: COMMENT_KINDS },
            status: { type: 'string', enum: COMMENT_STATUSES },
            authorName: { type: 'string' },
            authorUrl: nullable({ type: 'string' }),
            submitted: { type: 'string' },
          },
          required: ['id', 'source', 'kind', 'status', 'authorName', 'authorUrl', 'submitted'],
        },
      },
    },
    required: [...PAGE_REQUIRED],
  },
  run: (args, { site }) => {
    const range = instants(args);
    if (!range.ok) return Promise.resolve(range);
    const allowed: readonly string[] = STATUSES[args.direction];
    if (args.status !== undefined && !allowed.includes(args.status)) {
      return Promise.resolve({
        ok: false,
        message: `status must be one of ${allowed.join(', ')} for ${args.direction} webmentions.`,
      });
    }
    const document = findPost(site, args.post);
    if (document === undefined) {
      return Promise.resolve({ ok: false, message: `No post answers to ${args.post}.` });
    }
    const at = pageAt(args);
    const wanted = (status: string, time: string) =>
      (args.status === undefined || status === args.status) && within(time, range);

    if (args.direction === 'sent') {
      const page = pageOfList(
        site.admin
          .listSentWebmentions(document.slug)
          .filter((sent) => wanted(sent.status, sent.attemptedAt))
          .toSorted((a, b) => b.attemptedAt.localeCompare(a.attemptedAt))
          .map(({ source, target, endpoint, status, error, attemptedAt }) => ({
            source,
            target,
            endpoint,
            status,
            error,
            attemptedAt,
          })),
        at,
      );
      const failed = page.items.filter((sent) => sent.status === 'failed').length;
      return Promise.resolve({
        ok: true,
        summary: `${document.slug} sent ${String(page.total)} matching ${page.total === 1 ? 'webmention' : 'webmentions'}; ${String(failed)} failed on this page.`,
        structured: { ...pageFields(page, at), sent: page.items },
      });
    }

    const page = pageOfList(
      site.admin
        .listCommentsFor(document.slug)
        .filter((comment) => comment.source === 'webmention')
        .filter((comment) => wanted(comment.status, comment.submitted))
        .toSorted((a, b) => b.submitted.localeCompare(a.submitted))
        .map((comment) => ({
          id: comment.id,
          source: comment.url,
          kind: comment.kind,
          status: comment.status,
          authorName: comment.author.name,
          authorUrl: comment.author.url,
          submitted: comment.submitted,
        })),
      at,
    );
    return Promise.resolve({
      ok: true,
      summary: `${document.slug} received ${String(page.total)} matching ${page.total === 1 ? 'webmention' : 'webmentions'}.`,
      structured: { ...pageFields(page, at), received: page.items },
    });
  },
});
