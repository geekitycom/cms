import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { messageOf } from '../util/errors.ts';
import { isNotFound } from '../util/files.ts';
import type { DocumentType } from './document.ts';
import { TRASH_DIRECTORY } from './store.ts';
import type { SyncLogger } from './sync.ts';

/** File extensions the sync treats as documents. */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

/** Directories that hold documents. Everything else in `content/` is not indexed. */
const DOCUMENT_DIRECTORIES: ReadonlyMap<string, DocumentType> = new Map([
  ['posts', 'post'],
  ['pages', 'page'],
]);

/**
 * Every document file under the content directory, or under `from` inside it,
 * content-relative and sorted. A directory that cannot be read is reported and
 * skipped rather than failing the whole walk.
 */
export async function walk(contentDir: string, logger: SyncLogger, from = ''): Promise<string[]> {
  const found: string[] = [];

  async function visit(directory: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!isNotFound(error)) logger.warn(`Could not read ${directory}: ${messageOf(error)}`);
      return;
    }

    for (const entry of entries) {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!isWalkableDirectory(entry.name)) continue;
        await visit(path.join(directory, entry.name), relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isDocumentPath(relativePath)) found.push(relativePath);
    }
  }

  await visit(path.join(contentDir, from), from);
  return found.sort();
}

/**
 * Whether the walk descends into a directory. Eleventy ignores directories
 * whose name starts with an underscore and so does the CMS, with one
 * exception: the trash still holds documents, which stay indexed so the admin
 * can restore them.
 */
export function isWalkableDirectory(name: string): boolean {
  if (name === TRASH_DIRECTORY) return true;
  if (name.startsWith('_') || name.startsWith('.')) return false;
  return name !== 'node_modules';
}

/**
 * Whether a content-relative path is a document: a Markdown file under a
 * `posts/` or `pages/` directory. Uploads, directory data files and anything
 * the CMS does not model are skipped without a word.
 */
export function isDocumentPath(relativePath: string): boolean {
  if (!MARKDOWN_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) return false;
  const segments = relativePath.split('/').slice(0, -1);
  return segments.some((segment) => DOCUMENT_DIRECTORIES.has(segment));
}
