import { decodeEntities } from '../util/html.ts';
import { UPLOAD_ASSET_PREFIX, VARIANT_ASSET_PREFIX } from './uploads.ts';

/**
 * Every `<img>` tag, with its attribute text. Void elements have no closing
 * half. A quoted value is taken whole, since a `>` inside one does not end
 * the tag.
 */
export const IMG_TAG = /<img\s((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/gi;

/** One attribute of a tag: its name, and its value however it was quoted. */
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** One `<img>` in a fragment of HTML, as far as alt text is concerned. */
export interface ShownImage {
  /** The `src` as written. */
  src: string;
  /** The upload it points at, relative to `content/uploads/`, when it points at one. */
  source: string | undefined;
  /** The `alt` attribute, or `undefined` when the tag has none at all. */
  alt: string | undefined;
}

/** Every `<img>` in a fragment that has a `src`, in the order they appear. */
export function imagesIn(html: string): ShownImage[] {
  const found: ShownImage[] = [];
  for (const match of html.matchAll(IMG_TAG)) {
    const attributes = parseAttributes(match[1] ?? '');
    const src = attributes.get('src');
    if (src === undefined || src === '') continue;
    found.push({ src, source: uploadPath(src), alt: attributes.get('alt') });
  }
  return found;
}

/**
 * The upload a `src` points at, relative to `content/uploads/`, or
 * `undefined` when it points somewhere else.
 *
 * A derived file is somewhere else on purpose: the rewrite must not be able to
 * feed on its own output, whether that is a page rendered twice or an author
 * who pasted a variant URL by hand.
 */
export function uploadPath(src: string): string | undefined {
  if (src.startsWith(VARIANT_ASSET_PREFIX)) return undefined;
  if (!src.startsWith(UPLOAD_ASSET_PREFIX)) return undefined;

  const relative = src.slice(UPLOAD_ASSET_PREFIX.length);
  if (relative === '' || relative.includes('..')) return undefined;

  // A URL is what is in the attribute and a path is what is on disk, so the
  // percent-encoding markdown-it applied has to come off before the lookup.
  try {
    return relative.split('/').map(decodeURIComponent).join('/');
  } catch {
    return undefined;
  }
}

/** A tag's attributes by lower-cased name, with entities left as written. */
export function parseAttributes(attributes: string): Map<string, string> {
  const parsed = new Map<string, string>();

  for (const match of attributes.matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? '').toLowerCase();
    if (name === '' || parsed.has(name)) continue;
    parsed.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }

  return parsed;
}
