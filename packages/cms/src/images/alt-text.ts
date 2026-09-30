import path from 'node:path';

import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import { imagesIn } from './markup.ts';
import type { ShownImage } from './markup.ts';

/**
 * Alt text for the media library.
 *
 * It is kept in one JSON object keyed by the upload's path under
 * `content/uploads/`, beside `site.json` in `content/_data/`: it is public,
 * it cannot be derived from anything, and so it is a file (decision-9). An
 * entry is `{"alt": "A dog asleep on a rug"}` or `{"decorative": true}`; an
 * upload with no entry has no alt text yet, which is the case to fix.
 *
 * The library's text is what an image is offered with when it is inserted.
 * Once inserted, the post's own `![…](…)` is the alt text for that use, since
 * the same picture can need describing differently in two posts.
 */

/** Where the library's alt text is kept, relative to the content directory. */
export const MEDIA_FILE = '_data/media.json';

/** What the library says about how an image is read to somebody who cannot see it. */
export type AltText = { kind: 'described'; text: string } | { kind: 'decorative' };

/** Every upload's alt text, by its path under `content/uploads/`. */
export type AltTextLibrary = ReadonlyMap<string, AltText>;

const cache = new Map<string, { text: string; library: AltTextLibrary }>();

/** The library, parsed only when the file's bytes changed since the last read. */
export function readAltTexts(contentDir: string): AltTextLibrary {
  const file = mediaFile(contentDir);
  const text = readFileIfPresentSync(file);
  if (text === undefined) return new Map();

  const cached = cache.get(file);
  if (cached?.text === text) return cached.library;

  const library = parseLibrary(text);
  cache.set(file, { text, library });
  return library;
}

/**
 * Set one upload's alt text, or forget it when `alt` is `undefined`.
 *
 * Keys the form does not manage are kept, so a hand-edited entry for another
 * file survives an edit to this one.
 */
export async function writeAltText(
  contentDir: string,
  source: string,
  alt: AltText | undefined,
): Promise<void> {
  await updateFileAtomically(mediaFile(contentDir), (current) => {
    const all = current === undefined ? {} : parseObject(current);
    if (alt === undefined) delete all[source];
    else all[source] = alt.kind === 'decorative' ? { decorative: true } : { alt: alt.text };
    return `${JSON.stringify(all, null, 2)}\n`;
  });
}

/** An image in a document that tells a reader who cannot see it nothing. */
export interface UndescribedImage {
  /** The `src` as the document wrote it. */
  src: string;
  /** The last segment of its path, which is how a warning names it. */
  name: string;
}

/**
 * Every image in a document's HTML whose alt text is missing.
 *
 * An image is described when its own `alt` says something. An empty `alt` is
 * a deliberate silence only when the library marks that upload decorative;
 * anywhere else it is the silence of somebody who never got round to it. A tag
 * with no `alt` at all is always missing, because a screen reader then reads
 * out the file name.
 */
export function undescribedImages(html: string, library: AltTextLibrary): UndescribedImage[] {
  return imagesIn(html)
    .filter((image) => !described(image, library))
    .map((image) => ({ src: image.src, name: imageName(image.src) }));
}

function described(image: ShownImage, library: AltTextLibrary): boolean {
  if (image.alt === undefined) return false;
  if (image.alt.trim() !== '') return true;
  return image.source !== undefined && library.get(image.source)?.kind === 'decorative';
}

function imageName(src: string): string {
  const pathname = src.split(/[?#]/)[0] ?? src;
  const name = pathname.slice(pathname.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(name) || src;
  } catch {
    return name || src;
  }
}

function mediaFile(contentDir: string): string {
  return path.join(contentDir, ...MEDIA_FILE.split('/'));
}

/**
 * The file's entries, each checked, since a person may edit it by hand. An
 * entry that is neither shape is ignored rather than failing a page.
 */
function parseLibrary(text: string): AltTextLibrary {
  const library = new Map<string, AltText>();
  for (const [source, value] of Object.entries(parseObject(text))) {
    if (!isRecord(value)) continue;
    if (value['decorative'] === true) {
      library.set(source, { kind: 'decorative' });
    } else if (typeof value['alt'] === 'string' && value['alt'].trim() !== '') {
      library.set(source, { kind: 'described', text: value['alt'].trim() });
    }
  }
  return library;
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
