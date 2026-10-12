import { ADMIN_PREFIX } from './admin-paths.ts';

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
  'meta-webindexer',
  'meta-externalfetcher',
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
export interface RobotsLine {
  field: string;
  value: string;
}

/** A line a site added, as a rule, as nothing (blank or a comment), or as not robots.txt. */
export type ParsedLine = { kind: 'blank' } | { kind: 'line'; line: RobotsLine } | { kind: 'bad' };

export function parseRobotsLine(text: string): ParsedLine {
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
      const parsed = parseRobotsLine(text);
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
