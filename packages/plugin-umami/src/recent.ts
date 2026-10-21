import { withoutTrailingSlash } from '@geekity/cms/plugin';
import type {
  PluginBlock,
  PluginWidget,
  PostAtPath,
  PostEngagement,
  PublishedPost,
} from '@geekity/cms/plugin';

import type { UmamiClient } from './client.ts';
import { lastDays } from './period.ts';

const DAYS = 30;
const LISTED = 10;
const FIRST_WEEK_MS = 7 * 86_400_000;

const PATHS_READ = 500;

const FIRST_WEEK_READS_AT_ONCE = 4;

const NO_DATA = 'no data';

const COLUMNS = ['Post', 'Views', 'Engaged', 'Week 1'];

export interface RecentPostSources {
  publishedSince(since: string): Promise<readonly PublishedPost[]>;
  postsAt(paths: readonly string[]): Promise<readonly PostAtPath[]>;
  engagement(since: string): Promise<readonly PostEngagement[]>;
}

interface Row {
  readonly post: PublishedPost;
  readonly views: number | undefined;
  readonly engagement: number;
}

const whole = new Intl.NumberFormat('en-US');

export function recentPostsWidget(
  client: UmamiClient,
  sources: RecentPostSources,
  now: () => Date = () => new Date(),
): PluginWidget {
  const finishedFirstWeeks = new Map<string, number>();

  async function firstWeek(
    post: PublishedPost,
    directory: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const key = `${post.permalink} ${post.published}`;
    const kept = finishedFirstWeeks.get(key);
    if (kept !== undefined) return whole.format(kept);
    const start = new Date(post.published);
    const over = start.getTime() + FIRST_WEEK_MS <= now().getTime();
    const end = over ? new Date(start.getTime() + FIRST_WEEK_MS) : now();
    const views = (
      await client.stats({ start, end }, { path: `${directory}${post.permalink}`, signal })
    ).current.pageviews;
    if (!over) return `${whole.format(views)} so far`;
    finishedFirstWeeks.set(key, views);
    return whole.format(views);
  }

  return {
    id: 'recent-posts',
    title: 'Umami: recent posts',
    width: 'half',
    refreshSeconds: 1800,
    async load({ site, timezone, signal }) {
      if (!(await client.configured())) return [];
      const { range } = lastDays(now(), timezone, DAYS);
      const since = range.start.toISOString();
      const posts = await sources.publishedSince(since);
      if (posts.length === 0) {
        return [{ paragraph: [`No posts were published in the last ${String(DAYS)} days.`] }];
      }
      const [read, engaged] = await Promise.all([
        client.expandedMetrics('path', range, { limit: PATHS_READ, signal }),
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
      for (let index = 0; index < shown.length; index += FIRST_WEEK_READS_AT_ONCE) {
        const batch = shown.slice(index, index + FIRST_WEEK_READS_AT_ONCE);
        const weeks = await Promise.all(batch.map((row) => firstWeek(row.post, directory, signal)));
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
