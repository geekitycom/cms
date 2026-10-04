import TurndownService from 'turndown';
import type { TurndownNode } from 'turndown';

import { htmlInlineOffset, markdownTokens } from '../content/markdown.ts';
import { normalizeBody } from '../content/writer.ts';
import { cleanPostHtml } from '../web/sanitize.ts';

/**
 * A Micropub client's content as the post body the site stores (TASK-258,
 * decision-27). The renderer passes raw HTML through, as Eleventy's does, so
 * the body is cleaned here, at the boundary, before anything is written: HTML
 * content is cleaned and converted to Markdown, and Markdown content keeps
 * its text while every piece of raw HTML in it is cleaned in place.
 */

/** Elements Markdown cannot express, written as an HTML block. */
const KEPT_BLOCKS = ['TABLE', 'FIGURE', 'DETAILS', 'DL'];

/** Elements Markdown cannot express, kept as tags around their converted content. */
const KEPT_INLINE = ['ABBR', 'INS', 'KBD', 'MARK', 'Q', 'SMALL', 'SUB', 'SUP', 'U'];

/**
 * How many times a body is cleaned and read again. A tag removed from between
 * two pieces of text can join them into a new tag, which the next round
 * cleans; real content settles in one.
 */
const ROUNDS = 4;

/** Stands for a newline inside a `<pre>` until a kept block is written out. */
const PRE_NEWLINE = '\uE000';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
});

// Turndown leaves `<` and `&` alone, so text that read `&lt;script&gt;` in
// HTML would come out as a script tag in Markdown, which renders raw HTML.
turndown.escape = (text) =>
  TurndownService.prototype.escape
    .call(turndown, text)
    .replaceAll('<', '\\<')
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&');

turndown.addRule('listItem', {
  filter: 'li',
  replacement(content, node, options) {
    const list = node.parentNode;
    let marker = `${options.bulletListMarker ?? '-'} `;
    if (list?.nodeName === 'OL') {
      const start = Number.parseInt(list.getAttribute('start') ?? '1', 10);
      marker = `${String(start + Array.from(list.children).indexOf(node))}. `;
    }
    const indented = content
      .replace(/^\n+/, '')
      .replace(/\n+$/, '\n')
      .replace(/\n/g, `\n${' '.repeat(marker.length)}`);
    return marker + indented + (node.nextSibling !== null && !indented.endsWith('\n') ? '\n' : '');
  },
});

turndown.addRule('strikethrough', {
  filter: ['del', 's'],
  replacement: (content) => `~~${content}~~`,
});

turndown.addRule('keptBlock', {
  filter: (node) => KEPT_BLOCKS.includes(node.nodeName),
  replacement: (_content, node) => `\n\n${htmlBlock(node)}\n\n`,
});

turndown.addRule('keptInline', {
  filter: (node) => KEPT_INLINE.includes(node.nodeName),
  replacement(content, node) {
    const close = `</${node.nodeName.toLowerCase()}>`;
    const shell = node.cloneNode(false);
    return shell.outerHTML.slice(0, -close.length) + content + close;
  },
});

/**
 * HTML content as the Markdown a post stores, or `undefined` when what is
 * left still has HTML the site cannot clean.
 */
export function markdownFromHtml(html: string): string | undefined {
  return cleanMarkdown(turndown.turndown(cleanPostHtml(html)));
}

/**
 * Markdown content with each raw HTML block and inline tag, as the site's
 * renderer reads them, put through the post allow-list. Text that is not HTML
 * stays as it was sent, once its edges are trimmed and its line endings made
 * `\n` as every stored body's are. `undefined` when a piece of HTML cannot be
 * found in the source to be cleaned.
 *
 * The body is normalised before it is cleaned and checked again after, so the
 * string cleaned is the string stored: trimming an indent after cleaning once
 * turned an ignored code block into a live HTML block, and a lone `\r`, which
 * markdown-it breaks a line on, once hid a block from the cleaner.
 */
export function cleanMarkdown(markdown: string): string | undefined {
  const cleaned = settled(stored(markdown));
  if (cleaned === undefined) return undefined;
  const body = stored(cleaned);
  return settled(body) === body ? body : undefined;
}

/**
 * A body as the site stores it. A NUL is also replaced as markdown-it
 * replaces it, so the cleaner reads the characters the renderer does.
 */
function stored(body: string): string {
  return normalizeBody(body).replaceAll('\0', '\uFFFD');
}

/** `source` cleaned and read again until nothing changes. */
function settled(source: string): string | undefined {
  let current = source;
  for (let round = 0; round < ROUNDS; round += 1) {
    const edits = dirtyHtml(current);
    if (edits === undefined) return undefined;
    if (edits.length === 0) return current;
    for (const { start, end, text } of edits.toSorted((a, b) => b.start - a.start)) {
      current = current.slice(0, start) + text + current.slice(end);
    }
  }
  return undefined;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** The changes that clean every piece of raw HTML in `source`. */
function dirtyHtml(source: string): Edit[] | undefined {
  const lineStarts = [0];
  for (let at = source.indexOf('\n'); at >= 0; at = source.indexOf('\n', at + 1)) {
    lineStarts.push(at + 1);
  }
  const offset = (line: number): number => lineStarts[line] ?? source.length;
  const regionOf = (map: [number, number] | null): { start: number; end: number } | undefined =>
    map === null ? undefined : { start: offset(map[0]), end: offset(map[1]) };

  const edits: Edit[] = [];
  /** The inline content already read from each block's lines, for blocks with several. */
  const readBefore = new Map<string, string>();
  /** The lines of each open block, for an inline token that has none of its own: a table cell. */
  const open: ([number, number] | null)[] = [];

  for (const token of markdownTokens(source)) {
    if (token.nesting === 1) open.push(token.map ?? open.at(-1) ?? null);
    if (token.nesting === -1) open.pop();
    if (token.type === 'html_block') {
      const region = regionOf(token.map);
      if (region === undefined) return undefined;
      const edit = cleanedBlock(source, region);
      if (edit !== undefined) edits.push(edit);
      continue;
    }
    if (token.type !== 'inline') continue;

    const map = token.map ?? open.at(-1) ?? null;
    const key = String(map);
    const before = readBefore.get(key) ?? '';
    readBefore.set(key, before + token.content);
    for (const child of token.children ?? []) {
      if (child.type !== 'html_inline') continue;
      const cleaned = cleanPostHtml(child.content);
      if (cleaned === child.content) continue;

      const region = regionOf(map);
      const at = htmlInlineOffset(child);
      if (region === undefined || at === undefined) return undefined;
      const occurrence = count(before + token.content.slice(0, at), child.content);
      const start = nth(source.slice(region.start, region.end), child.content, occurrence);
      if (start === undefined) return undefined;
      edits.push({
        start: region.start + start,
        end: region.start + start + child.content.length,
        text: cleaned,
      });
    }
  }
  return edits;
}

/**
 * The edit that cleans an HTML block's lines, or `undefined` when they are
 * already clean. A line that only held a removed tag goes, rather than
 * staying as a blank line that would end the block early; a block that is
 * removed entirely takes the blank line after it too.
 */
function cleanedBlock(source: string, region: { start: number; end: number }): Edit | undefined {
  const text = source.slice(region.start, region.end);
  const cleaned = cleanPostHtml(text);
  if (cleaned === text) return undefined;

  if (cleaned.trim() === '') {
    const nextLine = source.slice(region.end).split('\n', 1)[0] ?? '';
    const blankAfter = region.end < source.length && nextLine.trim() === '';
    return {
      start: region.start,
      end: blankAfter ? region.end + nextLine.length + 1 : region.end,
      text: '',
    };
  }
  const hadBlank = text
    .split('\n')
    .slice(0, -1)
    .some((line) => line.trim() === '');
  const lines = cleaned.split('\n');
  const last = lines.pop() ?? '';
  const kept = hadBlank ? lines : lines.filter((line) => line.trim() !== '');
  return { ...region, text: [...kept, last].join('\n') };
}

/** How many times `part` occurs in `text`, without overlaps. */
function count(text: string, part: string): number {
  let found = 0;
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + part.length)) found += 1;
  return found;
}

/** Where the `n`th (from zero) occurrence of `part` in `text` begins. */
function nth(text: string, part: string, n: number): number | undefined {
  let at = text.indexOf(part);
  for (let seen = 0; at >= 0 && seen < n; seen += 1) at = text.indexOf(part, at + part.length);
  return at >= 0 ? at : undefined;
}

/**
 * A kept element as an HTML block Markdown reads as one: each child of a
 * container on its own line, every line unindented and none blank, so nothing
 * in it becomes a code block or ends the block early. Newlines in a `<pre>`
 * are written as character references so its code keeps its indentation.
 */
function htmlBlock(element: TurndownNode): string {
  layOut(element);
  return element.outerHTML
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n')
    .replaceAll(PRE_NEWLINE, '&#10;');
}

/** Elements whose children a kept block puts on lines of their own. */
const CONTAINERS = [
  'BLOCKQUOTE',
  'DETAILS',
  'DIV',
  'DL',
  'FIGURE',
  'OL',
  'TABLE',
  'TBODY',
  'TFOOT',
  'THEAD',
  'UL',
];

function layOut(node: TurndownNode): void {
  if (node.nodeName === 'PRE') {
    protectNewlines(node);
    return;
  }
  const children = Array.from(node.childNodes);
  const document = node.ownerDocument;
  if (document !== null && CONTAINERS.includes(node.nodeName)) {
    for (const child of children) {
      if (child.nodeType === 1) node.insertBefore(document.createTextNode('\n'), child);
    }
    node.appendChild(document.createTextNode('\n'));
  }
  for (const child of children) layOut(child);
}

function protectNewlines(node: TurndownNode): void {
  if (node.nodeType === 3) node.nodeValue = (node.nodeValue ?? '').replaceAll('\n', PRE_NEWLINE);
  for (const child of Array.from(node.childNodes)) protectNewlines(child);
}
