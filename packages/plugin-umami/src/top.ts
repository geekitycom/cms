import type { PluginWidget, PostAtPath } from '@geekity/cms/plugin';

import type { UmamiClient } from './client.ts';
import { lastDays } from './period.ts';
import type { UmamiSettings } from './settings.ts';

const LISTED = 10;

/**
 * Umami ranks a path by its visitors, so the widget reads this many and keeps
 * the ten with the most views.
 */
const PATHS_READ = 100;

const REFERRERS_READ = 25;

export function topPagesWidget(
  client: UmamiClient,
  postsAt: (paths: readonly string[]) => Promise<readonly PostAtPath[]>,
  now: () => Date = () => new Date(),
): PluginWidget {
  return {
    id: 'top-pages',
    title: 'Umami: top pages',
    width: 'half',
    refreshSeconds: 300,
    async load({ timezone, period, signal }) {
      if (!(await client.configured())) return [];
      const { range } = lastDays(now(), timezone, period);
      const read = (
        await client.expandedMetrics('path', range, { limit: PATHS_READ, signal })
      ).filter((entry) => entry.value !== '' && entry.pageviews > 0);
      if (read.length === 0) return [{ paragraph: ['No page views in this period.'] }];
      const posts = new Map(
        (await postsAt(read.map((entry) => entry.value))).map((post) => [post.path, post]),
      );
      const pages = new Map<string, { label: string; value: number; href?: string }>();
      for (const entry of read) {
        const post = posts.get(entry.value);
        const key = post?.permalink ?? entry.value;
        const page =
          pages.get(key) ??
          (post === undefined
            ? { label: entry.value, value: 0 }
            : { label: post.title, value: 0, href: post.editUrl });
        pages.set(key, { ...page, value: page.value + entry.pageviews });
      }
      return [
        {
          ranked: {
            caption: `Views per page over the last ${String(period)} days`,
            items: [...pages.values()]
              .toSorted((a, b) => b.value - a.value || a.label.localeCompare(b.label))
              .slice(0, LISTED),
          },
        },
      ];
    },
  };
}

export function topReferrersWidget(
  client: UmamiClient,
  settings: () => Promise<UmamiSettings>,
  now: () => Date = () => new Date(),
): PluginWidget {
  return {
    id: 'top-referrers',
    title: 'Umami: top referrers',
    width: 'half',
    refreshSeconds: 300,
    async load({ site, timezone, period, signal }) {
      if (!(await client.configured())) return [];
      const { range } = lastDays(now(), timezone, period);
      const own = new Set(
        [new URL(site.baseUrl).hostname, ...(await settings()).domains.split(',')].map(bareHost),
      );
      const top = (await client.metrics('referrer', range, { limit: REFERRERS_READ, signal }))
        .filter((entry) => entry.value !== '' && !own.has(bareHost(entry.value)))
        .slice(0, LISTED);
      if (top.length === 0) {
        return [{ paragraph: ['No visitors came from another site in this period.'] }];
      }
      return [
        {
          ranked: {
            caption: `Visitors per referring domain over the last ${String(period)} days`,
            items: top.map((entry) => ({ label: entry.value, value: entry.count })),
          },
        },
      ];
    },
  };
}

function bareHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
}
