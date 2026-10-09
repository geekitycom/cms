import TurndownService from 'turndown';
import type { TurndownNode } from 'turndown';

export interface ConvertedBody {
  readonly markdown: string;
  /** The URL an ActivityPub plugin reply block answered. */
  readonly inReplyTo?: string | undefined;
}

export function convertBody(content: string): ConvertedBody {
  let html = content.replace(/\r\n?/g, '\n');

  let inReplyTo: string | undefined;
  html = html.replace(
    /<!--\s+wp:activitypub\/reply\s+(\{[\s\S]*?\})\s+\/-->/g,
    (_block, attributes: string) => {
      inReplyTo ??= stringAttribute(attributes, 'url');
      return '';
    },
  );
  html = html.replace(
    /<!--\s+wp:embed\s+(\{[\s\S]*?\})\s+-->[\s\S]*?<!--\s+\/wp:embed\s+-->/g,
    (block, attributes: string) => {
      const url = stringAttribute(attributes, 'url');
      return url !== undefined && videoPageUrl(url) !== undefined
        ? `<iframe src="${escapeAttribute(url)}"></iframe>`
        : block;
    },
  );

  const blocks = /<!--\s+\/?wp:/.test(html);
  html = html.replace(/<!--\s+\/?wp:[\s\S]*?-->/g, '');
  html = html.replace(/<!--more(?:\s[^>]*)?-->/g, `\n\n<p>${MORE}</p>\n\n`);
  if (!blocks) html = wpautop(html);

  const markdown = tidy(turndown.turndown(html));
  return { markdown, ...(inReplyTo === undefined ? {} : { inReplyTo }) };
}

function tidy(markdown: string): string {
  const lines: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.split('\n')) {
    const marker = /^(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      if (marker !== undefined && marker.startsWith(fence)) fence = undefined;
      lines.push(line);
      continue;
    }
    if (marker !== undefined) fence = marker;
    if (line.trim() === '' && (lines.at(-1) ?? '') === '') continue;
    lines.push(line === MORE ? '<!--more-->' : line.trim() === '' ? '' : line);
  }
  return lines.join('\n').trim();
}

const MORE = '';

function stringAttribute(json: string, name: string): string | undefined {
  try {
    const value = (JSON.parse(json) as Record<string, unknown>)[name];
    return typeof value === 'string' && value !== '' ? value : undefined;
  } catch {
    return undefined;
  }
}

function escapeAttribute(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

const YOUTUBE_PAGES = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
const VIMEO_PAGES = ['vimeo.com', 'www.vimeo.com'];

export function videoPageUrl(source: string): string | undefined {
  const href = source.startsWith('//') ? `https:${source}` : source;
  if (!URL.canParse(href)) return undefined;
  const url = new URL(href);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;

  if (url.hostname.endsWith('youtube.com') || url.hostname.endsWith('youtube-nocookie.com')) {
    const embedded = /^\/embed\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
    if (embedded !== undefined) {
      const start = url.searchParams.get('start') ?? url.searchParams.get('t');
      return `https://www.youtube.com/watch?v=${embedded}${start === null ? '' : `&t=${start}`}`;
    }
  }
  if (url.hostname === 'player.vimeo.com') {
    const id = /^\/video\/(\d+)\/?$/.exec(url.pathname)?.[1];
    if (id === undefined) return undefined;
    const hash = url.searchParams.get('h');
    return `https://vimeo.com/${id}${hash !== null && /^[\da-f]+$/.test(hash) ? `/${hash}` : ''}`;
  }
  return YOUTUBE_PAGES.includes(url.hostname) || VIMEO_PAGES.includes(url.hostname)
    ? url.href
    : undefined;
}

const ALL_BLOCKS =
  '(?:table|thead|tfoot|caption|col|colgroup|tbody|tr|td|th|div|dl|dd|dt|ul|ol|li|pre|form|map|area|blockquote|address|style|p|h[1-6]|hr|fieldset|legend|section|article|aside|hgroup|header|footer|nav|figure|figcaption|details|menu|summary)';

/**
 * WordPress's `wpautop`, which turns a classic post's blank lines into
 * paragraphs and its single line breaks into `<br />` when the post is shown.
 * A block post carries its own `<p>` and is shown without it.
 */
export function wpautop(input: string): string {
  if (input.trim() === '') return '';
  const pres: string[] = [];
  let text = `${input}\n`.replace(/<pre[\s\S]*?<\/pre>/g, (pre) => {
    pres.push(pre);
    return `<pre wp-pre-tag-${String(pres.length - 1)}></pre>`;
  });

  text = text
    .replace(/<br\s*\/?>\s*<br\s*\/?>/g, '\n\n')
    .replace(new RegExp(`(<${ALL_BLOCKS}[\\s/>])`, 'g'), '\n\n$1')
    .replace(new RegExp(`(</${ALL_BLOCKS}>)`, 'g'), '$1\n\n')
    .replace(/(<hr\s*?\/?>)/g, '$1\n\n')
    .replace(/<[^>]*>/g, (tag) => tag.replaceAll('\n', ' <!-- wpnl --> '))
    .replace(/\s*(<figcaption[^>]*>)/g, '$1')
    .replace(/<\/figcaption>\s*/g, '</figcaption>')
    .replace(/\n\n+/g, '\n\n');

  text = text
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph !== '')
    .map((paragraph) => `<p>${paragraph.replace(/^\n+|\n+$/g, '')}</p>\n`)
    .join('');

  text = text
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<p>([^<]+)<\/(div|address|form)>/g, '<p>$1</p></$2>')
    .replace(new RegExp(`<p>\\s*(</?${ALL_BLOCKS}[^>]*>)\\s*</p>`, 'g'), '$1')
    .replace(/<p>(<li.+?)<\/p>/g, '$1')
    .replace(/<p><blockquote([^>]*)>/gi, '<blockquote$1><p>')
    .replaceAll('</blockquote></p>', '</p></blockquote>')
    .replace(new RegExp(`<p>\\s*(</?${ALL_BLOCKS}[^>]*>)`, 'g'), '$1')
    .replace(new RegExp(`(</?${ALL_BLOCKS}[^>]*>)\\s*</p>`, 'g'), '$1')
    .replace(/<(script|style|svg|math)[\s\S]*?<\/\1>/g, (element) =>
      element.replaceAll('\n', '<WPPreserveNewline />'),
    )
    .replace(/<br>|<br\/>/g, '<br />')
    .replace(/(?<!<br \/>)\s*\n/g, '<br />\n')
    .replaceAll('<WPPreserveNewline />', '\n')
    .replace(new RegExp(`(</?${ALL_BLOCKS}[^>]*>)\\s*<br />`, 'g'), '$1')
    .replace(/<br \/>(\s*<\/?(?:p|li|div|dl|dd|dt|th|pre|td|ul|ol)[^>]*>)/g, '$1')
    .replace(/\n<\/p>$/, '</p>')
    .replace(
      /<pre wp-pre-tag-(\d+)><\/pre>/g,
      (_placeholder, index: string) => pres[Number(index)] ?? '',
    );

  return text.replace(/ ?<!-- wpnl --> ?/g, '\n');
}

const TABLE_PARTS = ['CAPTION', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR'];

const BLOCK_ELEMENTS = [
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'AUDIO',
  'BLOCKQUOTE',
  'DETAILS',
  'DIV',
  'DL',
  'EMBED',
  'FIELDSET',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'IFRAME',
  'LI',
  'MAIN',
  'NAV',
  'OBJECT',
  'OL',
  'P',
  'PRE',
  'SCRIPT',
  'SECTION',
  'STYLE',
  'SVG',
  'TABLE',
  'UL',
  'VIDEO',
  ...TABLE_PARTS,
];

const NO_MARKDOWN_FORM = [
  'AUDIO',
  'DETAILS',
  'DL',
  'EMBED',
  'FORM',
  'IFRAME',
  'OBJECT',
  'SCRIPT',
  'STYLE',
  'SVG',
  'VIDEO',
];

const KEPT_INLINE = ['ABBR', 'CITE', 'INS', 'KBD', 'MARK', 'Q', 'SMALL', 'SUB', 'SUP', 'U'];

const MICROFORMAT_CLASS = /(?:^|\s)(?:h|p|u|dt|e)-[a-z]/;

function hasStyleOrMicroformats(node: TurndownNode): boolean {
  if (node.nodeType !== 1) return false;
  return (
    node.getAttribute('style') !== null || MICROFORMAT_CLASS.test(node.getAttribute('class') ?? '')
  );
}

function keptAsBlock(node: TurndownNode): boolean {
  if (NO_MARKDOWN_FORM.includes(node.nodeName)) return true;
  if (node.nodeName === 'FIGURE') return contains(node, 'figcaption');
  if (node.nodeName === 'TABLE') return !fitsPipeTable(node);
  if (TABLE_PARTS.includes(node.nodeName)) return false;
  return BLOCK_ELEMENTS.includes(node.nodeName) && hasStyleOrMicroformats(node);
}

function fitsPipeTable(table: TurndownNode): boolean {
  const rows = Array.from(table.querySelectorAll('tr'));
  const first = rows[0];
  if (first === undefined || contains(table, 'caption, table table')) return false;
  const width = first.children.length;
  if (width === 0 || Array.from(first.children).some((cell) => cell.nodeName !== 'TH'))
    return false;
  if (rows.some((row) => row.children.length !== width)) return false;
  return Array.from(table.querySelectorAll('th, td')).every(
    (cell) =>
      cell.getAttribute('colspan') === null &&
      cell.getAttribute('rowspan') === null &&
      !contains(cell, 'p, div, ul, ol, pre, blockquote, table, br, h1, h2, h3, h4, h5, h6'),
  );
}

function contains(node: TurndownNode, selectors: string): boolean {
  return (node.querySelector(selectors) ?? undefined) !== undefined;
}

function inSimpleTable(node: TurndownNode): boolean {
  const table = node.closest('table') ?? undefined;
  return table !== undefined && fitsPipeTable(table);
}

const PRE_NEWLINE = '';

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
  'TR',
  'UL',
];

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

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
});

const URL_IN_TEXT = /(https?:\/\/[^\s<>"]+)/;

// Turndown leaves `<` and `&` alone, so text that read `&lt;script&gt;` in
// HTML would come out as a script tag in Markdown, which renders raw HTML.
turndown.escape = (text) =>
  text
    .split(URL_IN_TEXT)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : TurndownService.prototype.escape
            .call(turndown, part)
            .replaceAll('<', '\\<')
            .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&'),
    )
    .join('');

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

turndown.addRule('preformatted', {
  filter: (node) => node.nodeName === 'PRE' && node.firstChild?.nodeName !== 'CODE',
  replacement: (_content, node) =>
    `\n\n\`\`\`\n${(node.textContent ?? '').replace(/\n$/, '')}\n\`\`\`\n\n`,
});

turndown.addRule('pipeTable', {
  filter: (node) => node.nodeName === 'TABLE' && fitsPipeTable(node),
  replacement: (content) => `\n\n${content.trim()}\n\n`,
});

turndown.addRule('pipeTableSection', {
  filter: (node) => ['THEAD', 'TBODY', 'TFOOT'].includes(node.nodeName) && inSimpleTable(node),
  replacement: (content) => content,
});

turndown.addRule('pipeTableRow', {
  filter: (node) => node.nodeName === 'TR' && inSimpleTable(node),
  replacement(content, node) {
    const header = node.closest('table')?.querySelector('tr') === node;
    const separator = header ? `\n${'| --- '.repeat(node.children.length)}|` : '';
    return `${content}|${separator}\n`;
  },
});

turndown.addRule('pipeTableCell', {
  filter: (node) => ['TH', 'TD'].includes(node.nodeName) && inSimpleTable(node),
  replacement: (content) =>
    `| ${content
      .trim()
      .replace(/\s*\n\s*/g, ' ')
      .replaceAll('|', '\\|')} `,
});

turndown.addRule('keptBlock', {
  filter: keptAsBlock,
  replacement: (_content, node) => `\n\n${htmlBlock(node)}\n\n`,
});

turndown.addRule('keptInline', {
  filter: (node) =>
    KEPT_INLINE.includes(node.nodeName) ||
    (!BLOCK_ELEMENTS.includes(node.nodeName) && hasStyleOrMicroformats(node)),
  replacement(content, node) {
    const close = `</${node.nodeName.toLowerCase()}>`;
    const shell = node.cloneNode(false);
    return shell.outerHTML.slice(0, -close.length) + content + close;
  },
});

turndown.addRule('video', {
  filter: (node) =>
    node.nodeName === 'IFRAME' && videoPageUrl(node.getAttribute('src') ?? '') !== undefined,
  replacement: (_content, node) => `\n\n${videoPageUrl(node.getAttribute('src') ?? '') ?? ''}\n\n`,
});

turndown.addRule('editorBookmark', {
  filter: (node) => node.nodeName === 'SPAN' && node.getAttribute('data-mce-type') === 'bookmark',
  replacement: () => '',
});
