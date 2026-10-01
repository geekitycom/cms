import { ADMIN_PREFIX } from '../admin/session.ts';
import { absoluteUrl, contentEtag, isNotModified } from './negotiate.ts';
import type { ConditionalHeaders } from './negotiate.ts';
import { SITEMAP_PATH } from './sitemap.ts';

/**
 * The robots file: what the site tells crawlers, and the two lines it tells
 * them whatever its settings say (TASK-148).
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

/**
 * How a site treats the crawlers that feed AI products, as one choice.
 *
 * `allow` writes nothing, so they read the `*` group like any other crawler.
 * `block-training` shuts out the crawlers that gather training data and leaves
 * the ones that fetch a page because somebody asked an assistant about it, so
 * the site can still be cited. `block-all` shuts out both.
 */
export const AI_CRAWLER_POLICIES = ['allow', 'block-training', 'block-all'] as const;

/** One of {@link AI_CRAWLER_POLICIES}. */
export type AiCrawlerPolicy = (typeof AI_CRAWLER_POLICIES)[number];

/**
 * The crawlers that gather training data, by the token each one obeys.
 *
 * From specification.website's robots-for-AI-crawlers list, with Meta's
 * training crawler beside them.
 */
export const AI_TRAINING_CRAWLERS: readonly string[] = [
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'Google-Extended',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'meta-externalagent',
];

/** The crawlers that fetch a page live, for an answer or a search result. */
export const AI_RETRIEVAL_CRAWLERS: readonly string[] = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'Claude-SearchBot',
  'Claude-User',
];

/** The signals a `Content-Signal` line may carry, in the order it lists them. */
export const CONTENT_SIGNALS = ['search', 'ai-input', 'ai-train'] as const;

/** One of {@link CONTENT_SIGNALS}. */
export type ContentSignalName = (typeof CONTENT_SIGNALS)[number];

/** What a site said about each signal. A signal it left unset is absent. */
export type ContentSignal = Partial<Record<ContentSignalName, 'yes' | 'no'>>;

/** Everything a site's settings say about its robots file. */
export interface RobotsPolicy {
  aiCrawlers: AiCrawlerPolicy;
  contentSignal: ContentSignal;
  /** The lines a site adds, as {@link robotsRuleProblem} accepts them. */
  rules: readonly string[];
}

/** A robots file as the CMS writes it with nothing set. */
export const DEFAULT_ROBOTS_POLICY: RobotsPolicy = {
  aiCrawlers: 'allow',
  contentSignal: {},
  rules: [],
};

/** The fields a line a site adds may have, as the file spells them. */
const FIELDS = ['User-agent', 'Allow', 'Disallow', 'Crawl-delay', 'Content-Signal', 'Sitemap'];

/** One `Field: value` line, field in its canonical spelling. */
interface RobotsLine {
  field: string;
  value: string;
}

/** One group: the crawlers it names and the lines under them. */
interface RobotsGroup {
  agents: string[];
  lines: RobotsLine[];
}

/** A line a site added, as a rule, as nothing (blank or a comment), or as not robots.txt. */
type ParsedLine = { kind: 'blank' } | { kind: 'line'; line: RobotsLine } | { kind: 'bad' };

function parseLine(text: string): ParsedLine {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return { kind: 'blank' };

  const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(trimmed);
  const field = FIELDS.find((name) => name.toLowerCase() === match?.[1]?.toLowerCase());
  if (match === null || field === undefined) return { kind: 'bad' };
  return { kind: 'line', line: { field, value: match[2] ?? '' } };
}

/**
 * Whether a rule would let a crawler into the admin. RFC 9309 lets the longer
 * match win, so an `Allow` for anything under the admin beats the CMS's own
 * `Disallow`.
 */
function opensAdmin(line: RobotsLine): boolean {
  return line.field === 'Allow' && line.value.startsWith(`${ADMIN_PREFIX}/`);
}

/**
 * Each line a site added, trimmed, with what is wrong with it if anything is.
 * A line may hold several, as a hand-edited `site.json` entry might.
 */
function judgeLines(lines: readonly string[]): { text: string; problem?: string }[] {
  let inGroup = false;
  return lines
    .flatMap((entry) => entry.split(/\r?\n/))
    .map((raw) => {
      const text = raw.trim();
      const parsed = parseLine(text);
      if (parsed.kind === 'blank') return { text };
      if (parsed.kind === 'bad') {
        return {
          text,
          problem: `"${text}" is not a robots.txt rule. A rule is a field such as User-agent, Allow or Disallow, a colon and a value.`,
        };
      }

      const { line } = parsed;
      if (line.field === 'User-agent') {
        if (line.value === '') {
          return { text, problem: 'A User-agent line names a crawler, or * for every one.' };
        }
        inGroup = true;
      } else if (line.field !== 'Sitemap' && !inGroup) {
        return {
          text,
          problem: `"${text}" needs a User-agent line above it to say which crawler it is for.`,
        };
      } else if (opensAdmin(line)) {
        return {
          text,
          problem: `"${text}" would let crawlers into ${ADMIN_PREFIX}/, which the site always keeps them out of.`,
        };
      }
      return { text };
    });
}

/**
 * What is wrong with the rules a site typed, or `undefined` when nothing is.
 * The first bad line is what it names: a textarea has one message.
 */
export function robotsRuleProblem(lines: readonly string[]): string | undefined {
  return judgeLines(lines).find((line) => line.problem !== undefined)?.problem;
}

/**
 * Rules as the site added them, minus any line {@link robotsRuleProblem}
 * would refuse. A hand edit of `site.json` is read through this, so a typo is
 * a line left out of the file rather than one published or a site down.
 */
export function robotsRuleLines(lines: readonly string[]): string[] {
  const kept = judgeLines(lines)
    .filter((line) => line.problem === undefined)
    .map((line) => line.text);

  // Blank lines only at the edges of the list say nothing.
  while (kept[0] === '') kept.shift();
  while (kept.at(-1) === '') kept.pop();
  return kept;
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
    const parsed = parseLine(text);
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
