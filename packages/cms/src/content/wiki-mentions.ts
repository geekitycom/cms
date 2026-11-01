import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it';

import type { Document } from './document.ts';
import { slugify } from './slug.ts';
import { aliasesOf, aliasPathsOf, aliasSlugsOf } from './wiki-aliases.ts';
import { wikiLinksIn } from './wiki-link-syntax.ts';

/** What a body has to mention, or link to, to be about one wiki page. */
export interface MentionTarget {
  /** The title and the aliases, as written. */
  readonly names: readonly string[];
  /** The page's own slug and its alias slugs: what a wiki link to it slugifies to. */
  readonly slugs: readonly string[];
  /** The page's path and its alias paths. */
  readonly paths: readonly string[];
}

/** Where a name is written in a body, and how. */
export interface Mention {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export function mentionTargetOf(
  page: Pick<Document, 'type' | 'slug' | 'title' | 'permalink' | 'extra'>,
): MentionTarget {
  return {
    names: [page.title, ...aliasesOf(page)].filter((name) => name.trim() !== ''),
    slugs: [page.slug, ...aliasSlugsOf(page)],
    paths: [page.permalink, ...aliasPathsOf(page)],
  };
}

/**
 * The first mention of the page in a body that does not already link to it,
 * or `undefined`. A mention is a name as a whole word in any case, outside
 * links, code, HTML and addresses; where names overlap the longest is taken.
 */
export function unlinkedMention(body: string, target: MentionTarget): Mention | undefined {
  if (linksTo(body, target)) return undefined;
  const pattern = namePattern(target.names);
  if (pattern === undefined) return undefined;
  const prose = blankNonProseKeepingOffsets(body);
  const match = pattern.exec(prose);
  if (match === null) return undefined;
  return { from: match.index, to: match.index + match[0].length, text: match[0] };
}

/**
 * The body with one mention wrapped as a wiki link to the page. The text keeps
 * its case. When the text would not lead to the page, or cannot be a wiki
 * link target, the link names the page's slug and keeps the text as its label.
 */
export function linkMention(body: string, mention: Mention, target: MentionTarget): string {
  const leadsHere = target.slugs.includes(slugify(mention.text)) && !mention.text.includes('#');
  const slug = target.slugs[0] ?? '';
  const link = leadsHere ? `[[${mention.text}]]` : `[[${slug}|${mention.text}]]`;
  return body.slice(0, mention.from) + link + body.slice(mention.to);
}

function linksTo(body: string, target: MentionTarget): boolean {
  if (wikiLinksIn(body).some((link) => target.slugs.includes(link.slug))) return true;
  return target.paths.some((path) => body.includes(path));
}

const NOT_IN_A_WIKI_LINK = /[[\]|\n]/;
const WORD = String.raw`\p{L}\p{M}\p{N}_`;

function namePattern(names: readonly string[]): RegExp | undefined {
  const usable = [...new Set(names.map((name) => name.trim()))]
    .filter((name) => !NOT_IN_A_WIKI_LINK.test(name))
    .sort((a, b) => b.length - a.length);
  if (usable.length === 0) return undefined;
  const alternatives = usable.map((name) => name.split(/\s+/).map(escapeRegExp).join('[ \\t]+'));
  return new RegExp(`(?<![${WORD}])(?:${alternatives.join('|')})(?![${WORD}])`, 'iu');
}

const blocks: MarkdownItInstance = new MarkdownIt({ html: true });

const BLOCKS_LEFT_OUT = new Set(['fence', 'code_block', 'html_block']);

const INLINE_LEFT_OUT = {
  linkOrImage: /!?\[[^\]\n]*\](?:\([^)\n]*\)|\[[^\]\n]*\])/g,
  referenceDefinition: /^ {0,3}\[[^\]\n]+\]:.*$/gm,
  htmlLink: /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi,
  htmlTagOrAutolink: /<[^>\n]*>/g,
  bareAddress: /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>]+/gi,
  emailOrHandle: /@?[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
} as const satisfies Record<string, RegExp>;

function blankNonProseKeepingOffsets(body: string): string {
  const masked = body.split('');
  const blank = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      if (masked[index] !== '\n') masked[index] = '\0';
    }
  };

  const lineStarts = [0];
  for (let index = body.indexOf('\n'); index !== -1; index = body.indexOf('\n', index + 1)) {
    lineStarts.push(index + 1);
  }
  for (const token of blocks.parse(body, {})) {
    if (!BLOCKS_LEFT_OUT.has(token.type) || token.map === null) continue;
    const [first, last] = token.map;
    blank(lineStarts[first] ?? body.length, lineStarts[last] ?? body.length);
  }

  for (const span of codeSpans(body)) blank(span.from, span.to);
  for (const link of wikiLinksIn(body)) blank(link.from, link.to);
  for (const pattern of [...Object.values(INLINE_LEFT_OUT), ...shortcutReferences(body)]) {
    for (const match of body.matchAll(pattern)) blank(match.index, match.index + match[0].length);
  }

  return masked.join('');
}

function codeSpans(body: string): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  const runs = [...body.matchAll(/`+/g)];
  let index = 0;
  while (index < runs.length) {
    const open = runs[index];
    if (open === undefined) break;
    const close = runs.findIndex((run, at) => at > index && run[0].length === open[0].length);
    if (close === -1) {
      index += 1;
      continue;
    }
    const end = runs[close];
    if (end !== undefined) spans.push({ from: open.index, to: end.index + end[0].length });
    index = close + 1;
  }
  return spans;
}

function shortcutReferences(body: string): RegExp[] {
  return [...body.matchAll(/^ {0,3}\[([^\]\n]+)\]:/gm)].map(
    ([, label = '']) => new RegExp(`\\[${escapeRegExp(label)}\\]`, 'gi'),
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}
