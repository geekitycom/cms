import type { ConvertOptions } from './index.ts';
import { drawTable } from './table.ts';
import { count, find, type Node } from './tree.ts';

export type Options = Required<ConvertOptions>;

interface State {
  readonly options: Options;
  /** `=>` lines that follow the top-level block being rendered. */
  pending: string[];
  /** `=>` lines that follow the whole document, in at-end mode. */
  readonly atEnd: string[];
  /** The number of the last link marked `[n]`. */
  linkNumber: number;
}

/**
 * Where rendered inline content sits, which decides what a line break and a
 * standalone `=>` line can do there.
 *
 * - `flow`: a paragraph or list item, which may break into several lines and
 *   hold `=>` lines between them.
 * - `quote`: a blockquote, which may break into several lines, but whose
 *   lines all start `>`, so `=>` lines wait for the end of the block.
 * - `line`: a heading or table cell, which is one line.
 */
type Flow = 'flow' | 'quote' | 'line';

const BREAK = Symbol('break');
/**
 * A `=>` line, with the text it leaves behind where it cannot stand on its
 * own and has to wait for the end of the block.
 */
interface Standalone {
  readonly line: string;
  readonly text: string;
}
/** A `=>` line that follows the block, in paragraph and copy modes. */
interface After {
  readonly after: string;
}
type Piece = string | typeof BREAK | Standalone | After;

/** How much text besides its link a list item may have and still be a link. */
const NOTE_LIMIT = 60;

const LINKS = new Set(['link', 'image']);

export function renderDocument(nodes: readonly Node[], options: Options): string {
  const state: State = { options, pending: [], atEnd: [], linkNumber: 0 };
  const blocks: string[][] = [];
  for (const node of nodes) {
    blocks.push(loneLink(node, state) ?? renderBlock(node, state, 'flow'));
    blocks.push(state.pending);
    state.pending = [];
  }
  blocks.push(state.atEnd);
  return joinBlocks(blocks)
    .map((line) => `${line}\n`)
    .join('');
}

function joinBlocks(blocks: readonly (readonly string[])[]): string[] {
  return blocks
    .filter((lines) => lines.length > 0)
    .flatMap((lines, i) => (i === 0 ? lines : ['', ...lines]));
}

function renderBlock(node: Node, state: State, flow: Exclude<Flow, 'line'>): string[] {
  const { options } = state;
  switch (node.type) {
    case 'paragraph':
      return layout(renderInline(inlineOf(node), state), flow, state);
    case 'heading': {
      const level = Math.min(Number(node.token.tag.slice(1)), 3);
      return [`${'#'.repeat(level)} ${renderLine(inlineOf(node), state)}`];
    }
    case 'bullet_list':
    case 'ordered_list':
      return linkList(node, state) ?? renderList(node, 0, state, flow);
    case 'blockquote':
      return joinBlocks(node.children.map((child) => renderBlock(child, state, 'quote'))).map(
        (line) => (line === '' ? '>' : `> ${line}`),
      );
    case 'fence':
    case 'code_block': {
      const language = node.token.info.trim().split(/\s+/)[0] ?? '';
      return preformatted(
        language || options.codeTag,
        node.token.content.replace(/\n$/, '').split('\n'),
        flow,
      );
    }
    case 'table':
      return preformatted(
        options.tableTag,
        drawTable(node, (cell) => renderLine(cell, state)),
        flow,
      );
    case 'hr':
      return ['---'];
    case 'html_block':
      return options.stripHtml ? [] : node.token.content.trimEnd().split('\n');
    case 'footnote_block':
      return joinBlocks(node.children.map((child) => renderFootnote(child, state, flow)));
    default:
      return [];
  }
}

function preformatted(alt: string, lines: readonly string[], flow: Flow): string[] {
  return flow === 'flow' ? ['```' + alt, ...lines, '```'] : [...lines];
}

function renderFootnote(node: Node, state: State, flow: Exclude<Flow, 'line'>): string[] {
  const [first = '', ...rest] = joinBlocks(
    node.children.map((child) => renderBlock(child, state, flow)),
  );
  return [`${footnoteMark(node)}: ${first}`, ...rest];
}

function footnoteMark(node: Node): string {
  return `[^${Number(node.token.meta?.id ?? 0) + 1}]`;
}

function renderList(
  list: Node,
  depth: number,
  state: State,
  flow: Exclude<Flow, 'line'>,
): string[] {
  const { indent } = state.options;
  let number = Number(list.token.attrGet('start') ?? 1);
  const lines: string[] = [];
  for (const item of list.children) {
    const marker = `${indent.repeat(depth)}${list.type === 'ordered_list' ? `${number++}.` : '*'} `;
    const continued = indent.repeat(depth + 1);
    if (state.options.checklist) drawCheckbox(item);
    let marked = false;
    for (const child of item.children) {
      if (child.type === 'bullet_list' || child.type === 'ordered_list') {
        lines.push(...renderList(child, depth + 1, state, flow));
        continue;
      }
      for (const line of renderBlock(child, state, flow)) {
        if (line.startsWith('=>') || child.type !== 'paragraph') lines.push(line);
        else if (marked) lines.push(continued + line);
        else {
          lines.push(marker + line);
          marked = true;
        }
      }
    }
    if (item.children.length === 0) lines.push(marker.trimEnd());
  }
  return lines;
}

function drawCheckbox(item: Node): void {
  const paragraph = item.children[0];
  const text = paragraph?.type === 'paragraph' ? inlineOf(paragraph)[0] : undefined;
  if (text?.type !== 'text') return;
  text.token.content = text.token.content.replace(/^\[([ xX])\]\s+/, (_, mark: string) =>
    mark === ' ' ? '☐ ' : '☑ ',
  );
}

/**
 * The `=>` lines of a list whose every item is one link, optionally with a
 * date or a short note, such as an archive or a menu; undefined for any other
 * list, or when links are off.
 */
function linkList(list: Node, state: State): string[] | undefined {
  if (state.options.links === 'off') return undefined;
  const textOnly: State = { ...state, options: { ...state.options, links: 'off' } };
  const lines: string[] = [];
  for (const item of list.children) {
    const [paragraph, ...rest] = item.children;
    if (paragraph?.type !== 'paragraph' || rest.length > 0) return undefined;
    const inline = inlineOf(paragraph);
    const link = find(inline, 'link');
    if (link === undefined || count(inline, LINKS) !== 1) return undefined;
    const note = renderLine(
      inline.filter((node) => node !== link),
      textOnly,
    );
    if (note.length > NOTE_LIMIT) return undefined;
    const href = hrefOf(link, state);
    lines.push(`=> ${href} ${renderLine(inline, textOnly) || href}`);
  }
  return lines;
}

/** The `=>` line of a top-level paragraph that is one link and nothing else, such as a byline. */
function loneLink(block: Node, state: State): string[] | undefined {
  if (block.type !== 'paragraph' || state.options.links === 'off') return undefined;
  const inline = inlineOf(block).filter(
    (node) => node.type !== 'text' || node.token.content.trim() !== '',
  );
  const [link] = inline;
  if (inline.length !== 1 || link?.type !== 'link' || count(inline, LINKS) !== 1) return undefined;
  const textOnly: State = { ...state, options: { ...state.options, links: 'off' } };
  const href = hrefOf(link, state);
  return [`=> ${href} ${renderLine(link.children, textOnly) || href}`];
}

function inlineOf(block: Node): readonly Node[] {
  return find(block.children, 'inline')?.children ?? [];
}

function hrefOf(link: Node, state: State): string {
  return state.options.rewriteLink(
    String(link.token.attrGet(link.type === 'image' ? 'src' : 'href') ?? ''),
  );
}

function renderLine(nodes: readonly Node[], state: State): string {
  return layout(renderInline(nodes, state), 'line', state).join(' ');
}

function layout(pieces: readonly Piece[], flow: Flow, state: State): string[] {
  const lines: string[] = [];
  let current = '';
  const endLine = () => {
    const line = current.trim().replace(/ {2,}/g, ' ');
    if (line !== '') lines.push(line);
    current = '';
  };
  for (const piece of pieces) {
    if (typeof piece === 'string') current += piece;
    else if (piece === BREAK) {
      if (flow === 'line') current += ' ';
      else endLine();
    } else if ('after' in piece) state.pending.push(piece.after);
    else if (flow === 'flow') {
      endLine();
      lines.push(piece.line);
    } else {
      current += piece.text;
      state.pending.push(piece.line);
    }
  }
  endLine();
  return lines;
}

function textOf(pieces: readonly Piece[]): string {
  return pieces
    .map((piece) => (typeof piece === 'string' ? piece : piece === BREAK ? ' ' : ''))
    .join('')
    .trim();
}

function renderInline(nodes: readonly Node[], state: State): Piece[] {
  return nodes.flatMap((node) => renderInlineNode(node, state));
}

function renderInlineNode(node: Node, state: State): Piece[] {
  const { options } = state;
  const { token } = node;
  switch (node.type) {
    case 'text':
      return [token.content];
    case 'softbreak':
      return [options.links === 'newline' ? BREAK : ' '];
    case 'hardbreak':
      return [BREAK];
    case 'code_inline':
      return [options.plain ? token.content : token.markup + token.content + token.markup];
    case 'em':
    case 'strong':
    case 's': {
      const content = renderInline(node.children, state);
      return options.plain ? content : [token.markup, ...content, token.markup];
    }
    case 'html_inline':
      return options.plain || options.stripHtml ? [] : [token.content];
    case 'image':
      return [{ line: imageLine(node, state), text: '' }];
    case 'link':
      return renderLink(node, state);
    case 'footnote_ref':
      return [footnoteMark(node)];
    default:
      return [token.content];
  }
}

function imageLine(image: Node, state: State): string {
  const label = [textOf(renderInline(image.children, state)), state.options.imageTag].filter(
    Boolean,
  );
  return ['=>', hrefOf(image, state), ...label].join(' ');
}

function renderLink(link: Node, state: State): Piece[] {
  const { links } = state.options;
  const href = hrefOf(link, state);
  const content = renderInline(link.children, state);
  if (links === 'off') return content;

  const images = link.children.filter((child) => child.type === 'image');
  if (images.length > 0 && textOf(content) === '') {
    const alt = textOf(renderInline(images[0]!.children, state));
    return [...content, { line: `=> ${href} ${alt || href}`, text: '' }];
  }

  const label = textOf(content) || href;
  switch (links) {
    case 'newline':
      return [{ line: `=> ${href} ${label}`, text: textOf(content) }];
    case 'copy':
      return [...content, { after: `=> ${href} ${label}` }];
    case 'paragraph':
    case 'at-end': {
      const number = ++state.linkNumber;
      const line = `=> ${href} ${number}: ${href}`;
      if (links === 'at-end') {
        state.atEnd.push(line);
        return [...content, `[${number}]`];
      }
      return [...content, `[${number}]`, { after: line }];
    }
  }
}
