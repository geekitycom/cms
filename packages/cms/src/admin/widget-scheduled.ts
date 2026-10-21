import { postLabel } from '../content/post-type.ts';
import { documentEditorPath, POST_SCREENS } from './documents.ts';
import { formatShortTime } from './formatting.ts';
import type { CoreWidget } from './widgets.ts';

/** How many scheduled posts the widget lists. */
export const SCHEDULED_POSTS = 5;

/**
 * The next posts waiting for their date, soonest first, whatever the
 * dashboard's period, each with the time it goes out in the site's time zone.
 * The card shows only when one is waiting.
 */
export const SCHEDULED_WIDGET: CoreWidget = {
  id: 'scheduled-posts',
  title: 'Scheduled posts',
  width: 'full',
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
