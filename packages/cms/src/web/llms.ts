import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { absoluteUrl, contentEtag, isNotModified } from './negotiate.ts';
import type { ConditionalHeaders } from './negotiate.ts';

/**
 * `/llms.txt` (TASK-149): the site described for a language model, in the
 * llmstxt.org shape. A heading with the site's title, its tagline as a quote,
 * then its pages and its recent posts as lists of links, each to the Markdown
 * the site already serves for that document, which is what a model wants to
 * read.
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
  /** The site-relative URL of the document's Markdown. */
  href: string;
  description?: string | undefined;
  /** When it last changed, for the file's `Last-Modified`. */
  lastModified?: Date | undefined;
}

/** What a generated file says. */
export interface LlmsIndex {
  title: string;
  /** The site's tagline, or empty for none. */
  description: string;
  pages: readonly LlmsEntry[];
  /** Newest first. */
  posts: readonly LlmsEntry[];
}

/** The file as it is served: its bytes, and when what it describes changed. */
export interface LlmsTxtFile {
  body: string;
  lastModified: Date | undefined;
}

/**
 * One page of a listing as Markdown (TASK-289): what a listing is, in the
 * shape `/llms.txt` already taught a model to read.
 */
export interface LlmsListing {
  /** The heading the listing's HTML carries. */
  title: string;
  /** The posts on this page, newest first. */
  posts: readonly LlmsEntry[];
  /** The site-relative URL of the newer page's Markdown, when there is one. */
  newer?: string | undefined;
  /** The site-relative URL of the older page's Markdown, when there is one. */
  older?: string | undefined;
}

/** The index as llms.txt Markdown, every link absolute. */
export function llmsTxt(index: LlmsIndex, baseUrl: string): string {
  const description = oneLine(index.description);
  return markdownFile([
    `# ${oneLine(index.title)}`,
    ...(description === '' ? [] : [`> ${description}`]),
    ...section('Pages', index.pages, baseUrl),
    ...section('Recent posts', index.posts, baseUrl),
  ]);
}

/** A listing page as llms.txt-shaped Markdown, every link absolute. */
export function llmsListingTxt(listing: LlmsListing, baseUrl: string): string {
  const pager: LlmsEntry[] = [
    ...(listing.newer === undefined ? [] : [{ title: 'Newer posts', href: listing.newer }]),
    ...(listing.older === undefined ? [] : [{ title: 'Older posts', href: listing.older }]),
  ];
  return markdownFile([
    `# ${oneLine(listing.title)}`,
    ...section('Posts', listing.posts, baseUrl),
    ...section('More posts', pager, baseUrl),
  ]);
}

/** A generated file, dated by the newest entry in it. */
export function generatedLlmsTxt(index: LlmsIndex, baseUrl: string): LlmsTxtFile {
  let lastModified: Date | undefined;
  for (const entry of [...index.pages, ...index.posts]) {
    if (entry.lastModified === undefined) continue;
    if (lastModified === undefined || entry.lastModified > lastModified) {
      lastModified = entry.lastModified;
    }
  }
  return { body: llmsTxt(index, baseUrl), lastModified };
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

function section(heading: string, entries: readonly LlmsEntry[], baseUrl: string): string[] {
  return entries.length === 0
    ? []
    : [`## ${heading}`, entries.map((entry) => entryLine(entry, baseUrl)).join('\n')];
}

function entryLine(entry: LlmsEntry, baseUrl: string): string {
  const description = oneLine(entry.description ?? '');
  const link = `- [${escapeLinkText(oneLine(entry.title))}](${absoluteUrl(entry.href, baseUrl)})`;
  return description === '' ? link : `${link}: ${description}`;
}

/** A list item is one line, so a folded description is unfolded. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function escapeLinkText(text: string): string {
  return text.replace(/[\\[\]]/g, (character) => `\\${character}`);
}
