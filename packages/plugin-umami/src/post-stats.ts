import type { ObjectSchema, PluginTool, PostAtPath } from '@geekity/cms/plugin';

import { UmamiError } from './client.ts';
import type { UmamiClient, UmamiTotals } from './client.ts';
import { lastDays } from './period.ts';

const DEFAULT_DAYS = 30;

const REFERRERS_LISTED = 10;

const COUNTS = {
  views: { type: 'integer' },
  visitors: { type: 'integer' },
  visits: { type: 'integer' },
} as const;

const INPUT = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'The post’s permalink, such as /2026/10/hello/, or its full URL.',
    },
    days: {
      type: 'integer',
      minimum: 1,
      maximum: 365,
      description: `How many days, ending today in the site’s time zone. ${String(DEFAULT_DAYS)} when left out.`,
    },
  },
  required: ['path'],
  additionalProperties: false,
} as const satisfies ObjectSchema;

const OUTPUT = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    title: { type: 'string', description: 'The post’s title, when the path leads to one.' },
    from: { type: 'string', description: 'The first day counted, YYYY-MM-DD.' },
    to: { type: 'string', description: 'The last day counted, today, YYYY-MM-DD.' },
    ...COUNTS,
    previous: {
      type: 'object',
      description: 'The same counts for the same number of days before, when Umami has them.',
      properties: COUNTS,
      required: ['views', 'visitors', 'visits'],
    },
    referrers: {
      type: 'array',
      description: `Up to ${String(REFERRERS_LISTED)} referring hosts, most visitors first; (direct) for none.`,
      items: {
        type: 'object',
        properties: { referrer: { type: 'string' }, visitors: { type: 'integer' } },
        required: ['referrer', 'visitors'],
      },
    },
  },
  required: ['path', 'from', 'to', 'views', 'visitors', 'visits', 'referrers'],
} as const satisfies ObjectSchema;

/** One post's, or one path's, views, visitors and referrers from Umami, as an MCP tool. */
export function postStatsTool(
  client: UmamiClient,
  postsAt: (paths: readonly string[]) => Promise<readonly PostAtPath[]>,
  now: () => Date = () => new Date(),
): PluginTool<typeof INPUT, typeof OUTPUT> {
  return {
    id: 'post-stats',
    title: 'Post stats from Umami',
    description:
      'Views, visitors and visits of one post or page over the last days, from the site’s Umami analytics, beside the same span before it, with the referrers that sent its visitors.',
    scope: 'inspect',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: INPUT,
    outputSchema: OUTPUT,
    async run({ path: asked, days = DEFAULT_DAYS }, { timezone, signal }) {
      const path = pathOf(asked);
      if (path === undefined) {
        return {
          ok: false,
          message: 'path must be a path on the site, such as /2026/10/hello/, or a URL.',
        };
      }
      const period = lastDays(now(), timezone, days);
      try {
        const [stats, referrers, posts] = await Promise.all([
          client.stats(period.range, { path, signal }),
          client.metrics('referrer', period.range, { path, limit: REFERRERS_LISTED, signal }),
          postsAt([path]),
        ]);
        const title = posts[0]?.title;
        const from = period.days[0] ?? '';
        const to = period.days.at(-1) ?? '';
        const current = counts(stats.current);
        return {
          ok: true,
          summary: `${title === undefined ? path : `${title} (${path})`} had ${String(current.views)} views from ${String(current.visitors)} visitors from ${from} to ${to}.`,
          structured: {
            path,
            ...(title === undefined ? {} : { title }),
            from,
            to,
            ...current,
            ...(stats.previous === undefined ? {} : { previous: counts(stats.previous) }),
            referrers: referrers.map((entry) => ({
              referrer: entry.value === '' ? '(direct)' : entry.value,
              visitors: entry.count,
            })),
          },
        };
      } catch (error) {
        if (error instanceof UmamiError) return { ok: false, message: error.message };
        throw error;
      }
    },
  };
}

function counts(totals: UmamiTotals) {
  return { views: totals.pageviews, visitors: totals.visitors, visits: totals.visits };
}

/** The path a reader's browser sent Umami, from a path or a full URL; `undefined` for neither. */
function pathOf(asked: string): string | undefined {
  if (asked.startsWith('/')) return asked.split(/[?#]/)[0];
  const url = URL.parse(asked);
  return url?.protocol === 'http:' || url?.protocol === 'https:' ? url.pathname : undefined;
}
