import type { Conversation, Placed } from '../comments/conversation.ts';
import type { CitedPageReader } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { feedGuid } from '../content/guids.ts';
import { postLabel } from '../content/post-type.ts';
import { absoluteUrl } from '../util/url.ts';
import { conversational, repliesFed, saidIn } from './conversation-threads.ts';
import { repliesFeedPath } from './feed-source.ts';
import type { FeedComment } from './feeds.ts';

/** What a post's comments feed carries, at every depth and in no order. */
export function spokenIn(conversation: Conversation): Placed[] {
  return saidIn(conversation).filter(conversational);
}

/**
 * Interactions as a comments feed carries them: newest first, at most `limit`,
 * and every link absolute.
 *
 * The one place an interaction becomes a feed item, so the post's feed and the
 * site's cannot disagree about what a comment's `guid` or `link` is. The HTML
 * is handed over as it stands and sanitised by the feed itself, at the last
 * moment before it becomes bytes this site publishes.
 */
export function feedComments(
  said: readonly (Placed & {
    post?: Document | undefined;
    replyingTo?: string | null | undefined;
  })[],
  options: { baseUrl: string; limit: number; cited: CitedPageReader; post?: Document | undefined },
): FeedComment[] {
  const { baseUrl } = options;
  return newestFirst(said, options.limit).map((entry) => {
    const thread = entry.post ?? options.post;
    const answered =
      entry.parent === null
        ? thread === undefined
          ? undefined
          : feedGuid(thread, baseUrl)
        : entry.parent.guid;
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

/** The newest `limit` of a mixed list, which is the order every feed shows. */
export function newestFirst<T extends { published: Date }>(said: readonly T[], limit: number): T[] {
  return [...said]
    .sort((left, right) => right.published.getTime() - left.published.getTime())
    .slice(0, limit);
}
