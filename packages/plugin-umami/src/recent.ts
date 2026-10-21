import { withoutTrailingSlash } from '@geekity/cms/plugin';
import type {
  PluginBlock,
  PluginWidget,
  PostAtPath,
  PostEngagement,
  PublishedPost,
} from '@geekity/cms/plugin';

import type { UmamiClient } from './client.ts';
import { dayIn, daysEnding, rangeOf } from './period.ts';

const DAYS = 30;
const LISTED = 10;
const FIRST_WEEK_MS = 7 * 86_400_000;

/** Enough paths that a post of the last 30 days is among them. */
const PATHS_READ = 500;

/** First-week reads at once, so the card loads within the dashboard's limit. */
const AT_ONCE = 4;

const NO_DATA = 'no data';

const COLUMNS = ['Post', 'Views', 'Engaged', 'Week 1'];

/** What the widget reads from the core: the posts, the post at a path, and engagement. */
export interface RecentPostSources {
  publishedSince(since: string): Promise<readonly PublishedPost[]>;
  postsAt(paths: readonly string[]): Promise<readonly PostAtPath[]>;
  engagement(since: string): Promise<readonly PostEngagement[]>;
}

interface Row {
  readonly post: PublishedPost;
  /** Views since it was published; `undefined` when Umami recorded none. */
  readonly views: number | undefined;
  readonly engagement: number;
}

const whole = new Intl.NumberFormat('en-US');

/**
 * The posts published in the last 30 days with their views and engagement
 * since, listed once most read first and once most engaged first, and each
 * one's views over its first 7 days. A post Umami recorded no view of shows
 * no data rather than zero.
 */
export function recentPostsWidget(
  client: UmamiClient,
  sources: RecentPostSources,
  now: () => Date = () => new Date(),
): PluginWidget {
  /** First weeks that are over, which no longer change, by permalink and date. */
  const firstWeeks = new Map<string, number>();

  async function firstWeek(post: PublishedPost, directory: string): Promise<string> {
    const key = `${post.permalink} ${post.published}`;
    const kept = firstWeeks.get(key);
    if (kept !== undefined) return whole.format(kept);
    const start = new Date(post.published);
    const over = start.getTime() + FIRST_WEEK_MS <= now().getTime();
    const end = over ? new Date(start.getTime() + FIRST_WEEK_MS) : now();
    const views = (await client.stats({ start, end }, { path: `${directory}${post.permalink}` }))
      .current.pageviews;
    if (!over) return `${whole.format(views)} so far`;
    firstWeeks.set(key, views);
    return whole.format(views);
  }

  return {
    id: 'recent-posts',
    title: 'Umami: recent posts',
    width: 'full',
    refreshSeconds: 1800,
    async load({ site, timezone }) {
      if (!(await client.configured())) return [];
      const range = rangeOf(daysEnding(dayIn(now(), timezone), DAYS), timezone);
      const since = range.start.toISOString();
      const posts = await sources.publishedSince(since);
      if (posts.length === 0) {
        return [{ paragraph: [`No posts were published in the last ${String(DAYS)} days.`] }];
      }
      const [read, engaged] = await Promise.all([
        client.expandedMetrics('path', range, { limit: PATHS_READ }),
        sources.engagement(since),
      ]);
      const viewed = read.filter((entry) => entry.value !== '' && entry.pageviews > 0);
      const views = new Map<string, number>();
      const counts = new Map(viewed.map((entry) => [entry.value, entry.pageviews]));
      for (const found of await sources.postsAt(viewed.map((entry) => entry.value))) {
        views.set(
          found.permalink,
          (views.get(found.permalink) ?? 0) + (counts.get(found.path) ?? 0),
        );
      }
      const totals = new Map(engaged.map((entry) => [entry.path, entry.total]));
      const rows: Row[] = posts.map((post) => ({
        post,
        views: views.get(post.permalink),
        engagement: totals.get(post.permalink) ?? 0,
      }));

      const byTitle = (a: Row, b: Row) => a.post.title.localeCompare(b.post.title);
      const mostRead = rows
        .toSorted((a, b) => (b.views ?? -1) - (a.views ?? -1) || byTitle(a, b))
        .slice(0, LISTED);
      const mostEngaged = rows
        .toSorted(
          (a, b) =>
            b.engagement - a.engagement || (b.views ?? -1) - (a.views ?? -1) || byTitle(a, b),
        )
        .slice(0, LISTED);

      const directory = withoutTrailingSlash(new URL(site.baseUrl).pathname);
      const shown = [...new Set([...mostRead, ...mostEngaged])].filter(
        (row) => row.views !== undefined,
      );
      const first = new Map<PublishedPost, string>();
      for (let index = 0; index < shown.length; index += AT_ONCE) {
        const batch = shown.slice(index, index + AT_ONCE);
        const weeks = await Promise.all(batch.map((row) => firstWeek(row.post, directory)));
        batch.forEach((row, at) => first.set(row.post, weeks[at] ?? NO_DATA));
      }

      const table = (heading: string, listed: readonly Row[]): PluginBlock[] => [
        { paragraph: [heading] },
        {
          table: {
            caption: `Posts published in the last ${String(DAYS)} days, ${heading.toLowerCase()} first`,
            columns: COLUMNS,
            rows: listed.map((row) => [
              { text: row.post.title, href: row.post.editUrl },
              row.views === undefined ? NO_DATA : whole.format(row.views),
              whole.format(row.engagement),
              first.get(row.post) ?? NO_DATA,
            ]),
          },
        },
      ];
      return [...table('Most read', mostRead), ...table('Most engaged', mostEngaged)];
    },
  };
}
