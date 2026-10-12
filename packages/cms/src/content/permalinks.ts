import type { Document } from './document.ts';
import { postObjectId } from './guids.ts';
import { hiddenReason, isGone, isServed } from './served.ts';
import type { DocumentLookup, IndexClock } from './store.ts';
import { withoutTrailingSlash } from '../util/url.ts';

/** The deleted document a public URL used to serve, or `undefined`. */
export function goneDocumentAt(
  store: DocumentLookup & IndexClock,
  permalink: string,
): Document | undefined {
  const document = store.getByPermalink(permalink);
  return document !== undefined && isGone(document, store.now()) ? document : undefined;
}

/**
 * The document a public URL resolves to, or `undefined`.
 *
 * This is the single lookup the public site does: every representation of a
 * document — the theme's HTML, the Markdown file, the JSON object — is the
 * same document found the same way, so they cannot disagree about what exists.
 */
export function publicDocumentAt(
  store: DocumentLookup & IndexClock,
  permalink: string,
): Document | undefined {
  const document = store.getByPermalink(permalink);
  if (document === undefined || !isServed(document, store.now())) return undefined;
  return document;
}

export function previewDocumentAt(
  store: DocumentLookup & IndexClock,
  permalink: string,
): Document | undefined {
  const document = store.getByPermalink(permalink);
  if (document === undefined) return undefined;
  const reason = hiddenReason(document, store.now());
  return reason === undefined || reason.kind === 'trashed' ? undefined : document;
}

/**
 * The ActivityStreams id of a document, or `undefined` when it has none.
 *
 * Only a published post federates (doc-4), so only a published post has an id
 * to advertise. This is what the theme's `<link rel="alternate">` points at,
 * what every feed keys the post by (decision-12) and what the permalink
 * answers an ActivityStreams request with: the page, the feed item and the
 * object all agree about the post's name in the fediverse, because after
 * decision-13 they are the same URL.
 */
export function activityStreamsId(
  document: Document,
  baseUrl: string,
  now: Date,
): string | undefined {
  if (document.type !== 'post' || !isServed(document, now)) return undefined;
  return postObjectId(document, baseUrl);
}

/**
 * The permalink an object id names, when it is one this site would have
 * minted: the path, with the base URL's own directory taken off it.
 *
 * An id from another host belongs to no post here however it is spelled, and
 * neither does one carrying a query string — a permalink has none, so an id
 * like `?p=813` is a stored one and is looked up as one instead.
 */
export function permalinkOfObjectId(objectId: string, baseUrl: string): string | undefined {
  let url: URL;
  let base: URL;
  try {
    url = new URL(objectId);
    base = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== base.origin || url.search !== '') return undefined;

  const directory = withoutTrailingSlash(base.pathname);
  if (directory !== '' && !url.pathname.startsWith(`${directory}/`)) return undefined;

  const pathname = url.pathname.slice(directory.length);
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}
