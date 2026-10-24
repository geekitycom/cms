import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import {
  AI_RETRIEVAL_CRAWLERS,
  AI_TRAINING_CRAWLERS,
  CONTENT_SIGNALS,
  DEFAULT_ROBOTS_POLICY,
  parseRobotsLine,
  robotsRuleLines,
} from '../site/robots.ts';
import type { AiCrawlerPolicy, ContentSignal, RobotsLine, RobotsPolicy } from '../site/robots.ts';
import { absoluteUrl } from '../util/url.ts';
import { contentEtag, isNotModified } from './negotiate.ts';
import type { ConditionalHeaders } from './negotiate.ts';
import { SITEMAP_PATH } from './sitemap.ts';

/**
 * The robots file: what the site tells crawlers, and the two lines it tells
 * them whatever its settings say.
 *
 * The file is a list of groups, each one or more `User-agent` lines and the
 * rules under them, and RFC 9309 gives a crawler exactly one group: the one
 * that names it most specifically, or `*` when none does. So the admin rule
 * cannot live in the `*` group alone. A crawler a site gives a group of its
 * own, or one the AI-crawler policy names, never reads `*`, and would find the
 * admin open. Every group the file carries gets the admin rule instead, and
 * the Content-Signal line, for the same reason.
 */

/** The robots file's URL. Fixed by the standard; nothing else is looked at. */
export const ROBOTS_PATH = '/robots.txt';

/** What a robots file is served as. */
export const ROBOTS_CONTENT_TYPE = 'text/plain; charset=utf-8';

/** One group: the crawlers it names and the lines under them. */
interface RobotsGroup {
  agents: string[];
  lines: RobotsLine[];
}

/**
 * A site's lines as groups, and the `Sitemap` lines it added. Comments are not
 * kept: the file is rebuilt from groups, and a comment has nowhere to sit in
 * one.
 */
function siteGroups(lines: readonly string[]): { groups: RobotsGroup[]; sitemaps: string[] } {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | undefined;

  for (const text of robotsRuleLines(lines)) {
    const parsed = parseRobotsLine(text);
    if (parsed.kind !== 'line') continue;
    const { line } = parsed;

    if (line.field === 'Sitemap') sitemaps.push(line.value);
    else if (line.field === 'User-agent') {
      // Consecutive User-agent lines share the group under them.
      if (current === undefined || current.lines.length > 0) {
        current = { agents: [], lines: [] };
        groups.push(current);
      }
      current.agents.push(line.value);
    } else current?.lines.push(line);
  }
  return { groups, sitemaps };
}

/** The groups the AI-crawler policy writes. */
function policyGroups(policy: AiCrawlerPolicy): RobotsGroup[] {
  const blocked =
    policy === 'allow'
      ? []
      : policy === 'block-training'
        ? AI_TRAINING_CRAWLERS
        : [...AI_TRAINING_CRAWLERS, ...AI_RETRIEVAL_CRAWLERS];
  return blocked.map((agent) => ({ agents: [agent], lines: [{ field: 'Disallow', value: '/' }] }));
}

/** The `Content-Signal` value for what a site set, or `undefined` for nothing. */
export function contentSignalValue(signal: ContentSignal): string | undefined {
  const set = CONTENT_SIGNALS.flatMap((name) => {
    const value = signal[name];
    return value === undefined ? [] : [`${name}=${value}`];
  });
  return set.length === 0 ? undefined : set.join(', ');
}

/**
 * A group with what every group carries: the admin rule ahead of its own
 * lines, and the site's Content-Signal after them. A group that already shuts
 * out everything needs neither, and a group with a signal of its own keeps it.
 */
function withSiteRules(group: RobotsGroup, signal: string | undefined): RobotsGroup {
  const disallows = (value: string): boolean =>
    group.lines.some((line) => line.field === 'Disallow' && line.value === value);
  if (disallows('/')) return group;

  const hasSignal = group.lines.some((line) => line.field === 'Content-Signal');
  return {
    agents: group.agents,
    lines: [
      ...(disallows(`${ADMIN_PREFIX}/`) ? [] : [{ field: 'Disallow', value: `${ADMIN_PREFIX}/` }]),
      ...group.lines,
      ...(signal === undefined || hasSignal ? [] : [{ field: 'Content-Signal', value: signal }]),
    ],
  };
}

/**
 * The robots file: everything public is crawlable but the admin, then the
 * AI-crawler policy's groups, then the groups a site added, then the sitemap,
 * named absolutely because that is the only spelling the standard allows for
 * a `Sitemap:` line.
 *
 * Nothing else is disallowed. The ActivityPub routes under `/ap/` are left
 * open deliberately: an actor and an object are documents meant to be
 * fetched, they carry the same content as the pages that link to them, and a
 * crawler that follows one gets JSON it will ignore. Hiding them would only
 * make the fediverse's own view of the site depend on a file written for
 * search engines.
 */
export function robotsTxt(baseUrl: string, policy: RobotsPolicy = DEFAULT_ROBOTS_POLICY): string {
  const signal = contentSignalValue(policy.contentSignal);
  const added = siteGroups(policy.rules);
  const groups = [
    { agents: ['*'], lines: [] },
    ...policyGroups(policy.aiCrawlers),
    ...added.groups,
  ].map((group) => withSiteRules(group, signal));

  const blocks = groups.map((group) =>
    [
      ...group.agents.map((agent) => `User-agent: ${agent}`),
      ...group.lines.map((line) => `${line.field}: ${line.value}`),
    ].join('\n'),
  );
  const sitemaps = [absoluteUrl(SITEMAP_PATH, baseUrl), ...added.sitemaps].map(
    (url) => `Sitemap: ${url}`,
  );

  return [...blocks, sitemaps.join('\n'), ''].join('\n\n').replace(/\n+$/, '\n');
}

/**
 * The robots file as an HTTP response.
 *
 * It has a validator but no `Last-Modified`: nothing dates it. Its body is a
 * function of the origin and the settings alone, so the ETag moves when either
 * does and never otherwise, which is exactly what a crawler's `If-None-Match`
 * should be told.
 */
export function robotsResponse(
  baseUrl: string,
  conditional?: ConditionalHeaders,
  policy?: RobotsPolicy,
): Response {
  const body = robotsTxt(baseUrl, policy);
  const etag = contentEtag('robots', body);
  const headers = new Headers({ etag, 'cache-control': 'no-cache' });

  if (isNotModified(conditional, etag, undefined)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', ROBOTS_CONTENT_TYPE);
  return new Response(body, { headers });
}
