import type { Conversation, Placed } from '../comments/conversation.ts';
import type { CitedPageReader } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { feedGuid } from '../content/guids.ts';
import { postLabel } from '../content/post-type.ts';
import { absoluteUrl } from '../util/url.ts';
import { conversational, repliesFed, saidIn } from './conversation-threads.ts';
import { repliesFeedPath } from './feed-source.ts';
import type { FeedComment } from './feeds.ts';

export function spokenIn(conversation: Conversation): Placed[] {
  return saidIn(conversation).filter(conversational);
}

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

export function newestFirst<T extends { published: Date }>(said: readonly T[], limit: number): T[] {
  return [...said]
    .sort((left, right) => right.published.getTime() - left.published.getTime())
    .slice(0, limit);
}
