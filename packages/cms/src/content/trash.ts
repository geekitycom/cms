import { mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';

import { exists } from '../util/files.ts';
import type { Document } from './document.ts';
import { handleDirectory } from './handles.ts';
import { parseDocument } from './parser.ts';
import { wikiBaseOf } from './slug.ts';
import { isTrashedPath, TRASH_DIRECTORY } from './store.ts';
import type { DocumentLookup, IndexWriter } from './store.ts';
import type { DocumentChange } from './sync.ts';

/** What moving a document's file needs from the site. */
export interface MoveSite {
  readonly store: DocumentLookup & IndexWriter;
  readonly contentDir: string;
  readonly announce: (change: DocumentChange) => Promise<void>;
}

/** What {@link moveDocumentFile} did. */
export type MoveOutcome =
  | { readonly outcome: 'moved'; readonly document: Document }
  | { readonly outcome: 'refused'; readonly reason: string };

/**
 * Move a document into `content/_trash/` or back out of it, the move behind
 * the editor's trash and restore and Micropub's delete and undelete.
 *
 * The trash mirrors the content tree — `posts/2026-03-04-x.md` becomes
 * `_trash/posts/2026-03-04-x.md` — so restoring is the same move backwards and
 * needs to remember nothing. The index is corrected as soon as the file has
 * landed rather than waiting for the watcher, so the public site stops or
 * starts serving the document with this request.
 *
 * A live document may take a trashed one's URL, and its file name with it.
 * So a restore that would land on either is refused, and a trashed
 * file already at the name is kept by numbering the newcomer: the permalink in
 * the front matter, not the file name, is what the document answers at.
 */
export async function moveDocumentFile(
  site: MoveSite,
  document: Document,
  action: 'trash' | 'restore',
): Promise<MoveOutcome> {
  const { store, contentDir } = site;
  let target: string;
  if (action === 'trash') {
    target = await freeTrashPath(contentDir, document.path);
  } else {
    target = document.path
      .split('/')
      .filter((segment) => segment !== TRASH_DIRECTORY)
      .join('/');
    const holder = store.getByPermalink(document.permalink);
    if (holder !== undefined && !isTrashedPath(holder.path)) {
      return refusedMove(
        `${holder.path} now holds ${document.permalink}, so this cannot go back there. ` +
          'Change one of their permalinks first.',
      );
    }
    if (await exists(path.join(contentDir, ...target.split('/')))) {
      return refusedMove(`${target} already exists, so this cannot go back there.`);
    }
  }

  const from = path.join(contentDir, ...document.path.split('/'));
  const to = path.join(contentDir, ...target.split('/'));

  let source: string;
  try {
    source = await readFile(from, 'utf8');
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
  } catch {
    return refusedMove(`Could not move ${document.path}. Is the file still there?`);
  }

  const moved = parseDocument(source, {
    path: target,
    type: document.type,
    handles: handleDirectory(contentDir),
    wikiBase: wikiBaseOf(document),
  });
  store.remove(document.path);
  store.upsert(moved);

  // Trashing takes a post off the public site and restoring puts it back, so
  // both are visibility changes a subscriber has to hear about.
  await site.announce({
    type: 'updated',
    path: target,
    previous: document,
    next: moved,
    origin: 'admin',
  });
  return { outcome: 'moved', document: moved };
}

function refusedMove(reason: string): MoveOutcome {
  return { outcome: 'refused', reason };
}

async function freeTrashPath(contentDir: string, relative: string): Promise<string> {
  const { dir, name, ext } = path.posix.parse(`${TRASH_DIRECTORY}/${relative}`);
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${dir}/${name}${suffix === 1 ? '' : `-${String(suffix)}`}${ext}`;
    if (!(await exists(path.join(contentDir, ...candidate.split('/'))))) return candidate;
  }
}
