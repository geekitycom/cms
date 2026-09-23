import { dump } from 'js-yaml';

import { KNOWN_FRONT_MATTER_KEYS } from './document.ts';
import type { DocumentContent } from './document.ts';

const KNOWN_KEYS = new Set<string>(KNOWN_FRONT_MATTER_KEYS);

/**
 * Turn a Document back into the text of its Markdown file.
 *
 * Front matter keys are emitted in the order of
 * {@link KNOWN_FRONT_MATTER_KEYS}, followed by the unmodelled keys in the order
 * they were read, so an unchanged document always writes the same bytes and a
 * real edit produces a small diff. Keys that carry no information — an empty
 * tag list, `draft: false`, a note's empty title — are left out.
 */
export function serializeDocument(document: DocumentContent): string {
  const frontMatter = documentFrontMatter(document);
  const yaml = dump(frontMatter, { lineWidth: -1, noRefs: true });
  const body = normalizeBody(document.body);

  return body === '' ? `---\n${yaml}---\n` : `---\n${yaml}---\n\n${body}\n`;
}

/**
 * The writable half of a parsed document: what it would be written back from.
 *
 * A rewrite that means to change one thing has to carry everything else
 * through untouched, and an optional field has to come back absent rather than
 * `undefined`, or the front matter grows keys with no values. This is the one
 * place that spelling lives, so a caller that only wants to add a key — the
 * federation stamping `activitypub` into a post it has just announced — cannot
 * quietly drop another.
 */
export function documentContent(document: DocumentContent): DocumentContent {
  return {
    title: document.title,
    ...(document.date === undefined ? {} : { date: document.date }),
    ...(document.updated === undefined ? {} : { updated: document.updated }),
    permalink: document.permalink,
    tags: [...document.tags],
    categories: [...document.categories],
    draft: document.draft,
    ...(document.description === undefined ? {} : { description: document.description }),
    ...(document.author === undefined ? {} : { author: document.author }),
    ...(document.activitypub === undefined ? {} : { activitypub: { ...document.activitypub } }),
    extra: { ...document.extra },
    body: document.body,
  };
}

/**
 * Strip the whitespace a Markdown body does not need, so that files differing
 * only in blank lines at the edges are the same document.
 */
export function normalizeBody(body: string): string {
  return body.replace(/\r\n?/g, '\n').trim();
}

/**
 * The front matter block a document would be written with: the keys the CMS
 * models, in {@link KNOWN_FRONT_MATTER_KEYS} order, then the unmodelled ones.
 *
 * This is the same object {@link serializeDocument} dumps to YAML, so the JSON
 * representation of a document and the Markdown file cannot disagree about
 * what its front matter is.
 */
export function documentFrontMatter(document: DocumentContent): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  if (document.title !== '') data['title'] = document.title;

  if (document.date !== undefined) data['date'] = document.date;
  if (document.updated !== undefined) data['updated'] = document.updated;
  data['permalink'] = document.permalink;
  if (document.tags.length > 0) data['tags'] = [...document.tags];
  if (document.categories.length > 0) data['categories'] = [...document.categories];
  if (document.draft) data['draft'] = true;
  if (document.description !== undefined) data['description'] = document.description;
  if (document.author !== undefined) data['author'] = document.author;

  const activitypub = activityPubOf(document);
  if (activitypub !== undefined) data['activitypub'] = activitypub;

  for (const [key, value] of Object.entries(document.extra)) {
    if (KNOWN_KEYS.has(key)) continue;
    if (value === undefined) continue;
    data[key] = value;
  }

  return data;
}

function activityPubOf(document: DocumentContent): Record<string, unknown> | undefined {
  const block = document.activitypub;
  if (block === undefined) return undefined;

  const out: Record<string, unknown> = {};
  if (block.id !== undefined) out['id'] = block.id;
  if (block.published !== undefined) out['published'] = block.published;

  return Object.keys(out).length === 0 ? undefined : out;
}
