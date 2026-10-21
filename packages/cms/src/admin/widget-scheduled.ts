import { postLabel } from '../content/post-type.ts';
import { documentEditorPath, POST_SCREENS } from './documents.ts';
import { formatShortTime } from './formatting.ts';
import type { CoreWidget } from './widgets.ts';

export const SCHEDULED_POSTS = 5;

export const SCHEDULED_WIDGET: CoreWidget = {
  id: 'scheduled-posts',
  title: 'Scheduled posts',
  width: 'half',
  refreshSeconds: 60,
  load(vars) {
    const posts = vars.store.listScheduledPosts(SCHEDULED_POSTS);
    if (posts.length === 0) return [];
    const timezone = vars.siteAtRequestStart.timezone;
    const cited = (url: string) => vars.replyContexts.read(url, vars.siteAtRequestStart);
    return [
      {
        table: {
          caption: 'The next posts to publish',
          columns: ['Post', 'Publishes'],
          rows: posts.map((post) => [
            { text: postLabel(post, cited), href: documentEditorPath(POST_SCREENS, post) },
            formatShortTime(post.date ?? '', timezone),
          ]),
        },
      },
    ];
  },
};
