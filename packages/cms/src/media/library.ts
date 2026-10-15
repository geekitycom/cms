import type { Dirent } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { UPLOAD_MEDIA_TYPES } from '../files/upload-types.ts';
import type { UploadKind } from '../files/upload-types.ts';
import { UPLOAD_ASSET_PREFIX, UPLOAD_DIRECTORY } from '../content/uploads.ts';
import { readAltTexts, writeAltText } from '../content/alt-text.ts';
import { HALF_WRITTEN_STRIP_SUFFIX } from '../content/metadata/sweep.ts';
import type { AltText } from '../content/alt-text.ts';
import { CITED_PICTURE_DIRECTORY } from '../webmention/cited-picture.ts';
import { uploadMarkdown } from './uploads.ts';

/** One file under `content/uploads/`, as the screen shows it. */
export interface MediaFile {
  /**
   * Where it is under `content/uploads/`, with `/` separators — `2026/09/a.png`.
   * This is the file's identity: it is what the delete form carries, and what
   * a variant directory would mirror.
   */
  path: string;
  /** The public URL the site serves it at. */
  url: string;
  /** The last segment of {@link MediaFile.path}. */
  name: string;
  /** Its extension, lower case, with the dot. Empty when it has none. */
  extension: string;
  /** How big it is, in bytes. */
  bytes: number;
  /** When it last changed, as an ISO 8601 instant, which is what sorts the list. */
  modified: string;
  /**
   * What it is for, from its extension: an image row shows a thumbnail and an
   * alt-text field, and an audio or video file can be a post's enclosure.
   * Unset for a file whose extension the CMS does not know.
   */
  kind: UploadKind | undefined;
  /** What the library says an image is, from `content/_data/media.json`. Unset when nothing has been said. */
  alt: AltText | undefined;
  /** The Markdown for it: an embed with its alt text for an image, a link for anything else. */
  markdown: string;
}

/**
 * Every file under `content/uploads/`, newest first.
 *
 * Recursive, because uploads land under `{yyyy}/{mm}/`, and a site that has
 * been copying files in by hand may have any shape at all under there. The
 * order is by modification time rather than by the dated path: the path is
 * only a hint about when a file arrived, and a file dropped in by hand may
 * have no dated path to read.
 *
 * A directory that does not exist yet is an empty library rather than an
 * error — a site that has never uploaded anything has no `uploads/`.
 */
export async function listUploads(contentDir: string): Promise<MediaFile[]> {
  const root = path.join(contentDir, UPLOAD_DIRECTORY);

  let entries: Dirent[];
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const library = readAltTexts(contentDir);
  const found: MediaFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Hidden files are the operating system's business, not the site's:
    // .DS_Store is not something anybody uploaded or wants to link to.
    if (entry.name.startsWith('.')) continue;
    if (entry.name.endsWith(HALF_WRITTEN_STRIP_SUFFIX)) continue;

    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative.startsWith(`${CITED_PICTURE_DIRECTORY}/`)) continue;

    let stats;
    try {
      stats = await stat(file);
    } catch {
      // It went away between the walk and the stat. Nothing to show.
      continue;
    }

    found.push(describeUpload(relative, stats.size, stats.mtime, library.get(relative)));
  }

  // Newest first, and by path when two files share a timestamp, so a page of
  // files copied in together has a stable order rather than the readdir one.
  found.sort((left, right) =>
    left.modified === right.modified
      ? right.path.localeCompare(left.path)
      : right.modified.localeCompare(left.modified),
  );
  return found;
}

/** One upload as the screen shows it, from what a directory walk knows. */
export function describeUpload(
  relative: string,
  bytes: number,
  modified: Date,
  alt?: AltText,
): MediaFile {
  const name = relative.slice(relative.lastIndexOf('/') + 1);
  const extension = path.extname(name).toLowerCase();
  const kind = UPLOAD_MEDIA_TYPES.get(extension)?.kind;
  const image = kind === 'image';
  const url = `${UPLOAD_ASSET_PREFIX}${relative}`;

  return {
    path: relative,
    url,
    name,
    extension,
    bytes,
    modified: modified.toISOString(),
    kind,
    alt: image ? alt : undefined,
    // The same Markdown the editor's upload control pastes, from the same
    // function, so a file linked from the media screen and the same file
    // linked from the editor are written identically.
    markdown: uploadMarkdown({
      url,
      label: name.slice(0, name.length - extension.length),
      image,
      alt,
    }),
  };
}

/**
 * Whether a body points at an upload URL.
 *
 * A substring search with one guard on the end of it: `/uploads/a.png` must not
 * count as a mention of `/uploads/a.pn`, and `/uploads/logo.png` must not count
 * as a mention of `/uploads/logo`. Anything that could still be part of the
 * same filename disqualifies the match; a quote, a bracket, a space or the end
 * of the body ends it.
 *
 * Deliberately blind to whether the mention is Markdown, HTML or prose. All
 * three break when the file goes, and a warning that only understood
 * `![](…)` would be a warning that missed most of them.
 */
export function mentionsUpload(body: string, url: string): boolean {
  for (let at = body.indexOf(url); at !== -1; at = body.indexOf(url, at + 1)) {
    const next = body[at + url.length];
    if (next === undefined || !FILENAME_CHARACTER.test(next)) return true;
  }
  return false;
}

/** Characters that could still be part of the filename a match landed in. */
const FILENAME_CHARACTER = /[A-Za-z0-9._~-]/;

/** What {@link deleteUpload} needs to take a file away. */
export interface DeleteUploadOptions {
  /** The site's content directory. */
  contentDir: string;
  /** The file, as a path under `content/uploads/` with `/` separators. */
  path: string;
  /**
   * Take the file's derived files with it.
   *
   * The original under `content/uploads/` is the only source of truth
   * (decision-10); the image variants beside it are derived, and derived state
   * that outlives what it was derived from is rubbish nobody will ever clean
   * up. The hook is passed the same content-relative path, is awaited before
   * the delete reports success, and is expected to be forgiving: a file with
   * no variants at all is the normal case.
   */
  removeDerived?: RemoveDerived | undefined;
}

/** Takes an upload's derived files away with it. See {@link DeleteUploadOptions.removeDerived}. */
export type RemoveDerived = (uploadPath: string) => Promise<void>;

/**
 * Delete one upload, and whatever was derived from it.
 *
 * Returns `false` when there was no such file, which is what a second click on
 * a Delete button on a stale page is, rather than throwing: the end state the
 * admin asked for is the end state they have.
 */
export async function deleteUpload(options: DeleteUploadOptions): Promise<boolean> {
  const file = resolveUpload(options.contentDir, options.path);
  if (file === undefined) return false;

  try {
    await unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }

  // After the original, so a hook that throws leaves a file with stale
  // variants rather than variants with no file: the first is repairable by
  // regenerating, the second is orphaned bytes.
  await options.removeDerived?.(options.path);
  if (readAltTexts(options.contentDir).has(options.path)) {
    await writeAltText(options.contentDir, options.path, undefined);
  }
  return true;
}

/**
 * A submitted path as an absolute file under `content/uploads/`, or
 * `undefined` when it is not one.
 *
 * The path arrives in a form, so it is an attacker's string as much as an
 * admin's. Containment is checked after resolution rather than by inspecting
 * the string, so `..`, an encoded one, or an absolute path cannot slip past —
 * the same rule {@link findAsset} applies to a request for a file.
 */
export function resolveUpload(contentDir: string, relative: string): string | undefined {
  if (relative === '' || relative.includes('\0')) return undefined;

  const root = path.resolve(contentDir, UPLOAD_DIRECTORY);
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) return undefined;
  return file;
}
