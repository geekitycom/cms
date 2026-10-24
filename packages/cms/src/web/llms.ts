import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { escapeLinkText } from '../content/markdown-links.ts';
import { absoluteUrl } from '../util/url.ts';
import { oneLine } from './markdown-page.ts';
import type { MarkdownUrl } from './markdown-page.ts';
import { contentEtag, isNotModified } from './negotiate.ts';
import type { ConditionalHeaders } from './negotiate.ts';

/**
 * `/llms.txt`: the site described for a language model, in the
 * llmstxt.org shape. A heading with the site's title, its tagline as a quote,
 * then the site's navigation and every page and every post the site lists as
 * lists of links, each to the Markdown the site already serves for what it
 * names, which is what a model wants to read. One file however large the site:
 * the format has no pagination.
 *
 * A fixed route at the root for the reason `robots.txt` is one: it is the only
 * place a tool looks, and no permalink may take it.
 */

/** The file's URL. */
export const LLMS_TXT_PATH = '/llms.txt';

/** Where in the content directory a site puts a file of its own instead. */
export const OWN_LLMS_TXT_FILE = 'llms.txt';

/**
 * The `Link` header value the home page advertises the file with. The
 * `describedby` relation is the one the agent-readiness spec names for it.
 */
export const LLMS_TXT_LINK = `<${LLMS_TXT_PATH}>; rel="describedby"; type="text/markdown"`;

const LLMS_TXT_CONTENT_TYPE = 'text/markdown; charset=utf-8';

/** One document the file lists. */
export interface LlmsEntry {
  title: string;
  /**
   * The canonical URL of what it names; the writer links its Markdown. A
   * navigation entry may name another site.
   */
  href: string;
  description?: string | undefined;
  /** A post's calendar day, `YYYY-MM-DD`, written ahead of its description. */
  date?: string | undefined;
  /** When it last changed, for the file's `Last-Modified`. */
  lastModified?: Date | undefined;
}

/** What a generated file says. */
export interface LlmsIndex {
  title: string;
  /** The site's tagline, or empty for none. */
  description: string;
  capsule?: string | undefined;
  /** The site's menus, every item once. */
  navigation: readonly LlmsEntry[];
  pages: readonly LlmsEntry[];
  /** Every listed post, newest first. */
  posts: readonly LlmsEntry[];
}

/** The file as it is served: its bytes, and when what it describes changed. */
export interface LlmsTxtFile {
  body: string;
  lastModified: Date | undefined;
}

/** The index as llms.txt Markdown, every link absolute. */
export function llmsTxt(index: LlmsIndex, baseUrl: string, markdownUrl: MarkdownUrl): string {
  const description = oneLine(index.description);
  const link = (href: string): string => absoluteUrl(markdownUrl(href), baseUrl);
  return markdownFile([
    `# ${oneLine(index.title)}`,
    ...(description === '' ? [] : [`> ${description}`]),
    ...(index.capsule === undefined
      ? []
      : [`This site is also a Gemini capsule at <${index.capsule}>.`]),
    ...section('Navigation', index.navigation, link),
    ...section('Pages', index.pages, link),
    ...section('Posts', index.posts, link),
  ]);
}

/** A generated file, dated by the newest entry in it. */
export function generatedLlmsTxt(
  index: LlmsIndex,
  baseUrl: string,
  markdownUrl: MarkdownUrl,
): LlmsTxtFile {
  let lastModified: Date | undefined;
  for (const entry of [...index.pages, ...index.posts]) {
    if (entry.lastModified === undefined) continue;
    if (lastModified === undefined || entry.lastModified > lastModified) {
      lastModified = entry.lastModified;
    }
  }
  return { body: llmsTxt(index, baseUrl, markdownUrl), lastModified };
}

/**
 * The site's own `content/llms.txt`, served as written in place of the
 * generated one, or `undefined` when it has none.
 */
export function ownLlmsTxt(contentDir: string): LlmsTxtFile | undefined {
  const file = path.join(contentDir, OWN_LLMS_TXT_FILE);
  try {
    const { mtime } = statSync(file);
    return { body: readFileSync(file, 'utf8'), lastModified: mtime };
  } catch {
    return undefined;
  }
}

/**
 * The file as a response, or a 304 to a client that already holds it. The
 * validators are on the 304 too, as the sitemap's are.
 */
export function llmsTxtResponse(
  file: LlmsTxtFile,
  conditional: ConditionalHeaders | undefined,
): Response {
  const etag = contentEtag('llms', file.body);
  const headers = new Headers({ etag, 'cache-control': 'no-cache' });
  if (file.lastModified !== undefined) {
    headers.set('last-modified', file.lastModified.toUTCString());
  }

  if (isNotModified(conditional, etag, file.lastModified)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', LLMS_TXT_CONTENT_TYPE);
  return new Response(file.body, { headers });
}

function markdownFile(blocks: readonly string[]): string {
  return `${blocks.join('\n\n')}\n`;
}

function section(
  heading: string,
  entries: readonly LlmsEntry[],
  link: (href: string) => string,
): string[] {
  return entries.length === 0
    ? []
    : [`## ${heading}`, entries.map((entry) => entryLine(entry, link)).join('\n')];
}

function entryLine(entry: LlmsEntry, link: (href: string) => string): string {
  const notes = [entry.date, oneLine(entry.description ?? '')]
    .filter((note) => note !== undefined && note !== '')
    .join('. ');
  const line = `- [${escapeLinkText(oneLine(entry.title))}](${link(entry.href)})`;
  return notes === '' ? line : `${line}: ${notes}`;
}
