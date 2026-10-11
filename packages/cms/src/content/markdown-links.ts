import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItInstance, StateBlock, StateInline, Token } from 'markdown-it';
import footnote from 'markdown-it-footnote';

import { schemedLinksOnly } from './markdown.ts';

/**
 * Where one link's destination is written in a Markdown source, and what it
 * names. An autolink or a bare URL has no destination of its own: its range
 * is the whole of what was written, and `bare` says the rewrite has to turn it
 * into an inline link to keep the words.
 */
interface LinkAt {
  readonly start: number;
  readonly end: number;
  readonly href: string;
  readonly bare?: string | undefined;
}

type LinkEnv = { found: LinkAt[] };

/**
 * The same parse the site renders a body with (`html`, schemed linkify,
 * footnotes), with each rule that writes a link destination wrapped to record
 * where it wrote it. markdown-it keeps no source offsets for inline tokens, so
 * the positions are taken while the rules run.
 */
const parser: MarkdownItInstance = new MarkdownIt({ html: true, linkify: true })
  .use(footnote)
  .use(schemedLinksOnly)
  .use(recordLinks);

parser.core.ruler.disable(['inline', 'linkify', 'replacements', 'smartquotes', 'text_join']);

/**
 * A Markdown body with every link destination `rewrite` answers for replaced
 * by its answer: inline links, autolinks, bare URLs and reference definitions.
 * Images, code, raw HTML and every link `rewrite` returns `undefined` for are
 * left as written.
 *
 * `rewrite` gets the href as the rendered page would carry it.
 */
export function rewriteMarkdownLinks(
  body: string,
  rewrite: (href: string) => string | undefined,
): string {
  const source = body.replace(/\r\n?/g, '\n');
  const edits: { start: number; end: number; text: string }[] = [];

  for (const link of linksIn(source)) {
    const target = rewrite(link.href);
    if (target === undefined) continue;
    const destination = /[\s()<>]/.test(target) ? `<${target}>` : target;
    const text =
      link.bare === undefined ? destination : `[${escapeLabel(link.bare)}](${destination})`;
    edits.push({ start: link.start, end: link.end, text });
  }

  return edits
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
}

function linksIn(source: string): LinkAt[] {
  const env: LinkEnv = { found: [] };
  const tokens = parser.parse(source, env);
  const blockLinks = env.found;
  const lines = lineStarts(source);
  const inline: LinkAt[] = [];
  const cursors = new Map<number, number>();

  for (const token of tokens) {
    if (token.type !== 'inline' || token.map === null) continue;
    const offsets = contentOffsets(source, lines, token.map[0], token.content, cursors);
    if (offsets === undefined) continue;

    const found: LinkAt[] = [];
    parser.inline.parse(token.content, parser, { found } satisfies LinkEnv, []);
    for (const link of found) {
      const start = toSource(offsets, link.start);
      const end = toSource(offsets, link.end);
      // Only an edit whose range spells exactly what the parse read is made.
      if (source.slice(start, end) !== token.content.slice(link.start, link.end)) continue;
      inline.push({ ...link, start, end });
    }
  }

  return [...blockLinks, ...inline];
}

/** Where each line of the source starts. */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = source.indexOf('\n'); index !== -1; index = source.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/**
 * Where each line of an inline token's content sits in the source, or
 * `undefined` when a line cannot be found. A container's prefix (`> `, a list
 * marker, indentation) is what the content has lost, so each line but the last
 * is the end of its source line; the last has lost its trailing space, and a
 * heading its closing marks, so it is looked for from the left.
 */
function contentOffsets(
  source: string,
  lines: readonly number[],
  firstLine: number,
  content: string,
  cursors: Map<number, number>,
): { at: number; offset: number }[] | undefined {
  const offsets: { at: number; offset: number }[] = [];
  const parts = content.split('\n');
  let at = 0;

  for (const [index, part] of parts.entries()) {
    const lineNumber = firstLine + index;
    const lineStart = lines[lineNumber];
    if (lineStart === undefined) return undefined;
    const lineEnd = (lines[lineNumber + 1] ?? source.length + 1) - 1;
    const line = source.slice(lineStart, lineEnd);

    let column: number;
    if (index < parts.length - 1) {
      if (!line.endsWith(part)) return undefined;
      column = line.length - part.length;
    } else {
      const trimmed = line.trimEnd();
      column = trimmed.endsWith(part)
        ? trimmed.length - part.length
        : line.indexOf(part, cursors.get(lineNumber) ?? 0);
      if (column === -1) return undefined;
      cursors.set(lineNumber, column + part.length);
    }

    offsets.push({ at, offset: lineStart + column });
    at += part.length + 1;
  }

  return offsets;
}

function toSource(offsets: readonly { at: number; offset: number }[], position: number): number {
  let line = offsets[0] ?? { at: 0, offset: 0 };
  for (const candidate of offsets) {
    if (candidate.at > position) break;
    line = candidate;
  }
  return line.offset + position - line.at;
}

function escapeLabel(text: string): string {
  return text.replace(/[\\[\]]/g, (character) => `\\${character}`);
}

type InlineRule = (state: StateInline, silent: boolean) => boolean;

function recordLinks(md: MarkdownItInstance): void {
  wrapInline(md, 'link', (state, silent, original) => {
    const start = state.pos;
    const labelEnd =
      state.src.charCodeAt(start) === 0x5b ? md.helpers.parseLinkLabel(state, start, true) : -1;
    const before = state.tokens.length;
    if (!original(state, silent)) return false;
    if (silent || labelEnd < 0 || state.src.charCodeAt(labelEnd + 1) !== 0x28) return true;

    let pos = labelEnd + 2;
    while (pos < state.posMax && /\s/.test(state.src[pos] ?? '')) pos += 1;
    const parsed = md.helpers.parseLinkDestination(state.src, pos, state.posMax);
    const href = openedAt(state, before)?.attrGet('href');
    if (parsed.ok && typeof href === 'string' && parsed.pos > pos) {
      record(state, { start: pos, end: parsed.pos, href });
    }
    return true;
  });

  wrapInline(md, 'autolink', (state, silent, original) => {
    const start = state.pos;
    const before = state.tokens.length;
    if (!original(state, silent)) return false;
    const href = openedAt(state, before)?.attrGet('href');
    if (!silent && typeof href === 'string' && openedAt(state, before)?.markup === 'autolink') {
      const written = state.src.slice(start + 1, state.pos - 1);
      record(state, { start, end: state.pos, href, bare: written });
    }
    return true;
  });

  wrapInline(md, 'linkify', (state, silent, original) => {
    const colon = state.pos;
    const protoMin = colon - Math.min(10, state.pending.length, colon);
    const before = state.tokens.length;
    if (!original(state, silent)) return false;
    let start = colon;
    while (start > protoMin && /[a-z0-9.+-]/i.test(state.src[start - 1] ?? '')) start -= 1;
    const href = openedAt(state, before)?.attrGet('href');
    if (!silent && typeof href === 'string') {
      record(state, { start, end: state.pos, href, bare: state.src.slice(start, state.pos) });
    }
    return true;
  });

  wrapReference(md);
}

/** The link a rule opened: pending text is pushed ahead of it. */
function openedAt(state: StateInline, before: number): Token | undefined {
  return state.tokens.slice(before).find((token) => token.type === 'link_open');
}

function record(state: StateInline, link: LinkAt): void {
  (state.env as LinkEnv).found.push(link);
}

function wrapInline(
  md: MarkdownItInstance,
  name: string,
  wrapped: (state: StateInline, silent: boolean, original: InlineRule) => boolean,
): void {
  const original = inlineRule(md, name);
  md.inline.ruler.at(name, (state, silent) => wrapped(state, silent, original));
}

function inlineRule(md: MarkdownItInstance, name: string): InlineRule {
  const rules = (md.inline.ruler as unknown as { __rules__: { name: string; fn: InlineRule }[] })
    .__rules__;
  const found = rules.find((rule) => rule.name === name);
  if (found === undefined) throw new Error(`markdown-it has no inline rule ${name}`);
  return found.fn;
}

type BlockRule = (
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
) => boolean;

/**
 * A reference definition leaves no token behind, so where its destination is
 * written is taken from the block rule as it succeeds. Block state offsets are
 * the source's own.
 */
function wrapReference(md: MarkdownItInstance): void {
  const rules = (md.block.ruler as unknown as { __rules__: { name: string; fn: BlockRule }[] })
    .__rules__;
  const original = rules.find((rule) => rule.name === 'reference')?.fn;
  if (original === undefined) throw new Error('markdown-it has no block rule reference');

  md.block.ruler.at('reference', (state, startLine, endLine, silent) => {
    if (!original(state, startLine, endLine, silent)) return false;
    if (silent) return true;

    const src = state.src;
    const max = state.bMarks[state.line] ?? src.length;
    let pos = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0) + 1;
    while (pos < max && src[pos] !== ']') pos += src[pos] === '\\' ? 2 : 1;
    if (src[pos + 1] !== ':') return true;
    pos += 2;
    while (pos < max && /\s/.test(src[pos] ?? '')) pos += 1;

    const parsed = md.helpers.parseLinkDestination(src, pos, max);
    if (!parsed.ok || parsed.pos <= pos) return true;
    const href = md.normalizeLink(parsed.str);
    if (md.validateLink(href)) {
      (state.env as LinkEnv).found.push({ start: pos, end: parsed.pos, href });
    }
    return true;
  });
}
