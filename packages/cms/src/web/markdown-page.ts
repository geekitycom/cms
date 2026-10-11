import { dump } from 'js-yaml';

/**
 * The Markdown representation of a page (TASK-346): front matter, the theme's
 * header, the page's own Markdown and the theme's footer.
 *
 * Code owns the contract and the theme owns the chrome. The front matter, the
 * body and the rewriting of the site's own links are written here; the header
 * and the footer are `partials/markdown-header.md.njk` and
 * `partials/markdown-footer.md.njk` on the theme search path.
 *
 * Navigation stays data until it is written: every link is a label and the
 * canonical URL of what it names, and the `.md` is added only by the writer,
 * so a renderer of another format can take the same data.
 */

/** One link as data: the words on it and the canonical URL it names. */
export interface MarkdownLink {
  readonly label: string;
  readonly url: string;
}

/** Who a page speaks for, as the header prints them. */
export interface MarkdownBio {
  readonly name: string;
  /** Their archive. */
  readonly url?: string | undefined;
  /** What they say about themselves. */
  readonly note?: string | undefined;
  /** Their profile links. */
  readonly links: readonly MarkdownLink[];
}

/** What the header and footer partials are given beside `site` and `menus`. */
export interface MarkdownChrome {
  /** The path the page is served at, which marks the current menu item. */
  readonly url: string;
  /** The heading the header writes, absent when the body opens with its own. */
  readonly title?: string | undefined;
  readonly home: MarkdownLink;
  readonly previous?: MarkdownLink | undefined;
  readonly next?: MarkdownLink | undefined;
  /** A post's author, linked to their archive. */
  readonly byline?: MarkdownLink | undefined;
  /** On an author archive, and on a solo author site's homepage. */
  readonly bio?: MarkdownBio | undefined;
}

/** One post of a dated list. */
export interface MarkdownEntry extends MarkdownLink {
  /** Its calendar day, `YYYY-MM-DD`. */
  readonly date?: string | undefined;
  readonly description?: string | undefined;
}

/** A canonical URL as the representation writes it: its `.md` when it has one. */
export type MarkdownUrl = (url: string) => string;

/** The relations a Markdown browser reads from front matter. */
export function navigationFrontMatter(
  chrome: MarkdownChrome,
  markdownUrl: MarkdownUrl,
): Record<string, string> {
  return {
    home: markdownUrl(chrome.home.url),
    ...(chrome.previous === undefined ? {} : { previous: markdownUrl(chrome.previous.url) }),
    ...(chrome.next === undefined ? {} : { next: markdownUrl(chrome.next.url) }),
  };
}

/** Front matter and blocks as one file; empty blocks are left out. */
export function markdownFile(
  frontMatter: Record<string, unknown>,
  blocks: readonly string[],
): string {
  const yaml = dump(frontMatter, { lineWidth: -1, noRefs: true });
  const written = blocks.map((block) => block.trim()).filter((block) => block !== '');
  return written.length === 0
    ? `---\n${yaml}---\n`
    : `---\n${yaml}---\n\n${written.join('\n\n')}\n`;
}

/**
 * Posts as a list, one `YYYY-MM-DD Title` link each, the summary after it: the
 * line a gemlog index has, with the words a model reads.
 */
export function entryList(entries: readonly MarkdownEntry[], markdownUrl: MarkdownUrl): string {
  return entries
    .map((entry) => {
      const label = [entry.date, oneLine(entry.label)]
        .filter((part) => part !== undefined)
        .join(' ');
      const link = `- [${escapeMarkdown(label)}](${markdownUrl(entry.url)})`;
      const description = oneLine(entry.description ?? '');
      return description === '' ? link : `${link}: ${description}`;
    })
    .join('\n');
}

/** Links as a list, one per line. */
export function linkList(links: readonly MarkdownLink[], markdownUrl: MarkdownUrl): string {
  return links
    .map((link) => `- [${escapeMarkdown(link.label)}](${markdownUrl(link.url)})`)
    .join('\n');
}

/**
 * Text that reads literally wherever Markdown puts it: on one line, with the
 * characters that would open emphasis, code, a link or raw HTML escaped, and a
 * line start that would open a block escaped too.
 */
export function escapeMarkdown(text: string): string {
  return oneLine(text)
    .replace(/[\\`*_[\]<>~|]/g, (character) => `\\${character}`)
    .replace(/^[#+-]/, '\\$&')
    .replace(/^(\d+)([.)])/, '$1\\$2');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
