import type { Conversation, HeldAt, Placed } from '../comments/conversation.ts';
import type { CitedPageReader } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { feedGuid } from '../content/guids.ts';
import { postLabel } from '../content/post-type.ts';
import { isListed } from '../content/served.ts';
import { absoluteUrl } from '../util/url.ts';
import type { AnsweredFeed } from '../webmention/reply-context.ts';
import { conversational, repliesFed, saidIn } from './conversation-threads.ts';
import { COMMENTS_TITLE_PREFIX, feedPathUnder, repliesFeedPath } from './feed-source.ts';
import type { FeedComment } from './feeds.ts';
import { commentsFeedHref } from './paths.ts';

/** How a site's own feeds are named and where they are. */
export interface SiteFeeds {
  readonly title: string;
  readonly baseUrl: string;
  readonly cited: CitedPageReader;
}

/** The site's RSS feed, for a listed post; a page or an unlisted post is in none. */
export function postFeed(post: Document, feeds: SiteFeeds): AnsweredFeed | undefined {
  if (post.type !== 'post' || !isListed(post)) return undefined;
  return { url: absoluteUrl(feedPathUnder('/', 'rss'), feeds.baseUrl), title: feeds.title };
}

/** The feed of every reply in a post's conversation. */
export function commentsFeed(post: Document, feeds: SiteFeeds): AnsweredFeed {
  return {
    url: absoluteUrl(commentsFeedHref(post), feeds.baseUrl),
    title: `${COMMENTS_TITLE_PREFIX}${postLabel(post, feeds.cited)}`,
  };
}

/** The feed of this site that carries something it holds. */
export function heldFeed(held: HeldAt, feeds: SiteFeeds): AnsweredFeed | undefined {
  return held.kind === 'document' ? postFeed(held.post, feeds) : commentsFeed(held.post, feeds);
}

export function spokenIn(conversation: Conversation): Placed[] {
  return saidIn(conversation).filter(conversational);
}

export function feedComments(
  said: readonly (Placed & {
    post?: Document | undefined;
    replyingTo?: string | null | undefined;
  })[],
  options: SiteFeeds & { limit: number; post?: Document | undefined },
): FeedComment[] {
  const { baseUrl } = options;
  return newestFirst(said, options.limit).map((entry) => {
    const thread = entry.post ?? options.post;
    const answered =
      entry.parent !== null
        ? inReplyToOf(
            entry.parent.guid,
            absoluteUrl(entry.parent.url ?? '/', baseUrl),
            thread === undefined ? undefined : commentsFeed(thread, options),
          )
        : thread === undefined
          ? undefined
          : inReplyToOf(
              feedGuid(thread, baseUrl),
              absoluteUrl(thread.permalink, baseUrl),
              postFeed(thread, options),
            );
    const replies = repliesFed(entry.replies);
    return {
      id: entry.guid,
      url: absoluteUrl(entry.url ?? '/', baseUrl),
      author: entry.author.name,
      published: entry.published,
      html: entry.content,
      ...(answered === undefined ? {} : { inReplyTo: answered }),
      ...(replies.length === 0
        ? {}
        : {
            replies: {
              count: replies.length,
              feed: absoluteUrl(repliesFeedPath(entry.key), baseUrl),
            },
          }),
      ...(entry.author.feed === null
        ? {}
        : { authorFeed: absoluteUrl(entry.author.feed, baseUrl) }),
      ...(entry.post === undefined
        ? {}
        : {
            post: { title: postLabel(entry.post, options.cited), permalink: entry.post.permalink },
          }),
      ...(entry.replyingTo === undefined || entry.replyingTo === null
        ? {}
        : { replyingTo: entry.replyingTo }),
    };
  });
}

function inReplyToOf(
  id: string,
  page: string,
  feed: AnsweredFeed | undefined,
): NonNullable<FeedComment['inReplyTo']> {
  return {
    id,
    isPermaLink: id === page,
    ...(feed === undefined ? {} : { feed }),
  };
}

export function newestFirst<T extends { published: Date }>(said: readonly T[], limit: number): T[] {
  return [...said]
    .sort((left, right) => right.published.getTime() - left.published.getTime())
    .slice(0, limit);
}
