import type { Context } from 'hono';

import type { Document } from '../content/document.ts';
import { postLabel } from '../content/post-type.ts';
import { isGone, isServed } from '../content/served.ts';
import type { GeekityEnv } from './env.ts';
import { readAltTexts } from '../content/alt-text.ts';
import { feedComments, spokenIn } from './conversation.ts';
import {
  commentsFeedResponse,
  COMMENTS_TITLE_PREFIX,
  feedResponse,
  feedSize,
  repliesFeedPath,
} from './feeds.ts';
import type { CommentFeedSource, FeedComment, FeedFormat, FeedSource } from './feeds.ts';
import { archiveOf } from './listing-subject.ts';
import type { ListingSubject } from './listing-subject.ts';
import { commentsFeedHref } from './paths.ts';
import { conditionalHeaders, gone, notFound } from './request.ts';
import { siteView } from './site-view.ts';

/**
 * The site's feed, or one archive's, in one format.
 *
 * A term with nothing published under it 404s exactly as its archive does: a
 * feed reader should be told the URL is wrong rather than handed an empty feed
 * it will poll forever.
 */
export function feed(
  c: Context<GeekityEnv>,
  format: FeedFormat,
  subject: ListingSubject,
): Response {
  const { renderer, config } = c.var;
  const site = renderer.site();
  const view = siteView(c);
  const archive = archiveOf(view, subject);
  const documents = archive.list({ limit: feedSize(site) });

  const source: FeedSource = {
    site,
    users: view.users(),
    documents,
    title: archive.feedTitle(site),
    href: archive.href(0),
    feedHref: archive.feedHref(format),
    baseUrl: config.baseUrl,
    // Only RSS carries the comment pointers; the other two formats have no
    // vocabulary for them, and counting for a feed that cannot say the number
    // would be a query per item for nothing.
    ...(format === 'rss'
      ? { commentCounts: c.var.conversation.counts(documents, c.var.siteAtRequestStart) }
      : {}),
    altTexts: readAltTexts(config.contentDir),
    replyContext: (target) => c.var.replyContexts.read(target, c.var.siteAtRequestStart),
  };

  return feedResponse({ format, source, conditional: conditionalHeaders(c) });
}

/**
 * A post's or page's comments, or the whole site's, as RSS 2.0.
 *
 * A document with no replies answers an empty feed rather than a 404: it
 * exists, and a reader that subscribed before anybody answered should keep
 * polling. Which documents have a feed at all is the path classifier's to say.
 */
export function comments(c: Context<GeekityEnv>, document: Document | undefined): Response {
  const { conversation, renderer, config } = c.var;
  const site = renderer.site();
  const limit = feedSize(site);

  // The same reading the page is drawn from, which is the point: a subscriber
  // to a post's comments and a reader who scrolls to the bottom of it are
  // looking at one conversation. A post's own feed hands the builder entries
  // with no post attached, and so its items name no post: there, every item
  // answers the same one.
  const found: readonly FeedComment[] = feedComments(
    document === undefined
      ? conversation.latest(limit, c.var.siteAtRequestStart)
      : spokenIn(conversation.thread(document, c.var.siteAtRequestStart)),
    {
      baseUrl: config.baseUrl,
      limit,
      cited: (url) => c.var.replyContexts.read(url, c.var.siteAtRequestStart),
      post: document,
    },
  );

  const source: CommentFeedSource = {
    site,
    comments: found,
    title:
      document === undefined
        ? `${site.title}: comments`
        : `${COMMENTS_TITLE_PREFIX}${postLabel(document, (url) => c.var.replyContexts.read(url, c.var.siteAtRequestStart))}`,
    href: document?.permalink ?? '/',
    feedHref: commentsFeedHref(document),
    baseUrl: config.baseUrl,
  };

  return commentsFeedResponse(source, conditionalHeaders(c));
}

/**
 * The feed of one item's direct replies (TASK-324): a post's or page's, or a
 * reply's, so a reader can walk a thread one level at a time through
 * `source:comments`. An item nobody answered has an empty feed; a segment
 * naming nothing a reader can see 404s.
 */
export function repliesFeed(c: Context<GeekityEnv>, segment: string): Response {
  const { conversation, renderer, config } = c.var;
  const found = conversation.repliesTo(segment, c.var.siteAtRequestStart);
  if (found === undefined) return notFound(c);

  const site = renderer.site();
  const cited = (url: string) => c.var.replyContexts.read(url, c.var.siteAtRequestStart);
  const label = postLabel(found.post, cited);
  const source: CommentFeedSource = {
    site,
    comments: feedComments(found.replies, {
      baseUrl: config.baseUrl,
      limit: feedSize(site),
      cited,
      post: found.post,
    }),
    title:
      found.reply === null
        ? `Replies to: ${label}`
        : `Replies to ${found.reply.author.name} on ${label}`,
    href: found.reply?.url ?? found.post.permalink,
    feedHref: repliesFeedPath(segment),
    baseUrl: config.baseUrl,
  };
  return commentsFeedResponse(source, conditionalHeaders(c));
}

/**
 * One native comment on a page of its own (TASK-318), answering as its post
 * would: 410 once the post is deleted, and 404 while it is not served. It is
 * never listed anywhere, so it is noindex.
 */
export function commentPage(c: Context<GeekityEnv>, id: string): Response {
  const { conversation, renderer, store } = c.var;
  const found = conversation.comment(id, c.var.siteAtRequestStart);
  if (found === undefined) return notFound(c);

  const now = store.now();
  if (isGone(found.post, now)) return gone(c);
  if (!isServed(found.post, now)) return notFound(c);
  return c.html(renderer.renderComment(found), 200, { 'x-robots-tag': 'noindex' });
}
