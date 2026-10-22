import { dump } from 'js-yaml';

import type { AuthorContext } from '../site/authors.ts';
import type { MarkdownCommentThread } from './markdown-conversation.ts';

/**
 * The Markdown representation of a page: front matter, the theme's header, the
 * page's own Markdown and the theme's footer.
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
  readonly links: readonly MarkdownLink[];
}

/** One feed a page advertises: its title, its URL, and which format it is in. */
export interface MarkdownFeed extends MarkdownLink {
  /** `RSS`, `Atom` or `JSON Feed`. */
  readonly format: string;
  /** Its media type, as the HTML head's `<link type>` says it. */
  readonly type: string;
}

/** What the header and footer partials are given beside `site` and `menus`. */
export interface MarkdownChrome {
  /** The path the page is served at, which marks the current menu item. */
  readonly url: string;
  readonly type: 'post' | 'page' | 'listing' | 'comment' | 'status';
  /** The heading the header writes, absent when the body opens with its own. */
  readonly title?: string | undefined;
  readonly previous?: MarkdownLink | undefined;
  readonly next?: MarkdownLink | undefined;
  /** A post's author, linked to their archive. */
  readonly byline?: MarkdownLink | undefined;
  /** On an author archive, and on a solo author site's homepage. */
  readonly bio?: MarkdownBio | undefined;
  /** The feeds the HTML head advertises, in its order. */
  readonly feeds: readonly MarkdownFeed[];
  /** On a comment's own page: the comment and its place in the thread. */
  readonly thread?: MarkdownCommentThread | undefined;
}

/**
 * What a post answers or cites, as its HTML citation line names it: a reply's
 * target, an RSVP's event, or what it likes, reposts or bookmarks.
 */
export interface MarkdownCite {
  /** `In reply to`, an RSVP's phrase such as `Going to`, `Liked`, `Reposted` or `Bookmarked`. */
  readonly verb: string;
  /** The page cited: the original when the target is a silo copy of one. */
  readonly url: string;
  /** Its title, or what the HTML calls it without one, such as `a page on example.com`. */
  readonly name: string;
  /** Who wrote it, absent when the name already ends with them. */
  readonly author?: string | undefined;
  /** The site it is on, when it names no author. */
  readonly site?: string | undefined;
  /** An event's start, the instant to print, and the zone to print it in when it is not the site's. */
  readonly startDate?: Date | undefined;
  readonly startZone?: string | undefined;
  /** When it was published, on a target that is no event. */
  readonly published?: Date | undefined;
  /** Where an event takes place. */
  readonly location?: string | undefined;
  /** The silo copy the post also answers, when `url` is the original. */
  readonly copy?: string | undefined;
}

/** One post of a dated list. */
export interface MarkdownEntry extends MarkdownLink {
  /** Its calendar day, `YYYY-MM-DD`. */
  readonly date?: string | undefined;
  readonly description?: string | undefined;
}

/** One month of an archive page's Markdown: its heading and its posts, newest first. */
export interface MarkdownArchiveMonth {
  readonly month: string;
  readonly posts: readonly MarkdownEntry[];
}

/** A canonical URL as the representation writes it: its `.md` when it has one. */
export type MarkdownUrl = (url: string) => string;

/** Where every page's Markdown says home is. */
export const HOME_LINK: MarkdownLink = { label: 'Home', url: '/' };

/** The relations a Markdown browser reads from front matter. */
export function navigationFrontMatter(
  chrome: MarkdownChrome,
  markdownUrl: MarkdownUrl,
): Record<string, string> {
  return {
    home: markdownUrl(HOME_LINK.url),
    ...(chrome.previous === undefined ? {} : { previous: markdownUrl(chrome.previous.url) }),
    ...(chrome.next === undefined ? {} : { next: markdownUrl(chrome.next.url) }),
  };
}

export function bioOf(person: AuthorContext | undefined): MarkdownBio | undefined {
  if (person === undefined) return undefined;
  return {
    name: person.name,
    url: person.url,
    note: person.bio,
    links: (person.links ?? []).map((link) => ({ label: link.label, url: link.href })),
  };
}

/**
 * Front matter with `author` as the person's display name and their username
 * kept beside it, so a reader sees the name and a program can still find the
 * account.
 */
export function namedAuthor(
  frontMatter: Record<string, unknown>,
  writer: AuthorContext | undefined,
): Record<string, unknown> {
  if (writer?.username === undefined) return frontMatter;
  const { name, username } = writer;
  return Object.fromEntries(
    Object.entries(frontMatter).flatMap(([key, value]) =>
      key === 'author'
        ? [
            ['author', name],
            ['author_username', username],
          ]
        : [[key, value]],
    ),
  );
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
      const label = [entry.date, entry.label].filter((part) => part !== undefined).join(' ');
      const link = `- [${escapeMarkdown(label)}](${markdownUrl(entry.url)})`;
      const description = oneLine(entry.description ?? '');
      return description === '' ? link : `${link}: ${description}`;
    })
    .join('\n');
}

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
  return escapeInline(oneLine(text))
    .replace(/^[#+-]/, '\\$&')
    .replace(/^(\d+)([.)])/, '$1\\$2');
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Text with the characters that would open emphasis, code, a link or raw HTML escaped. */
export function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>~|]/g, (character) => `\\${character}`);
}
