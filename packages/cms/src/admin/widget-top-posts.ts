import { toUtcInstant } from '../content/time.ts';
import { readObjectIds } from '../federation/object-ids.ts';
import type { PostEngagement } from '../plugin.ts';
import { postEngagement } from './engagement.ts';
import { daysEndingToday } from './widgets.ts';
import type { CoreWidget } from './widgets.ts';

export const TOP_POSTS = 5;

const KINDS = [
  ['likes', 'like', 'likes'],
  ['boosts', 'boost', 'boosts'],
  ['replies', 'reply', 'replies'],
  ['webmentions', 'webmention', 'webmentions'],
  ['comments', 'comment', 'comments'],
] as const;

function breakdown(post: PostEngagement): string {
  return KINDS.filter(([kind]) => post[kind] > 0)
    .map(([kind, one, many]) => `${String(post[kind])} ${post[kind] === 1 ? one : many}`)
    .join(', ');
}

export const TOP_POSTS_WIDGET: CoreWidget = {
  id: 'top-posts',
  title: 'Top posts',
  width: 'full',
  refreshSeconds: 300,
  load(vars, period) {
    const since = toUtcInstant(
      daysEndingToday(vars, period)[0] ?? '',
      vars.siteAtRequestStart.timezone,
    );
    if (since === undefined) throw new Error('The period does not start on a date.');

    const posts = postEngagement(
      {
        store: vars.store,
        admin: vars.admin,
        baseUrl: vars.config.baseUrl,
        objectIds: readObjectIds(vars.config.contentDir),
        cited: (url) => vars.replyContexts.read(url, vars.siteAtRequestStart),
        threadOf: (url) => vars.conversation.documentOf(url),
      },
      since,
    ).slice(0, TOP_POSTS);

    if (posts.length === 0) {
      return [
        { paragraph: ['No likes, boosts, replies, webmentions or comments in this period.'] },
      ];
    }
    return [
      {
        table: {
          caption: `The posts with the most engagement over ${String(period)} days`,
          columns: ['Post', 'Total', 'Breakdown'],
          rows: posts.map((post) => [
            { text: post.title, href: post.editUrl },
            String(post.total),
            breakdown(post),
          ]),
        },
      },
    ];
  },
};
