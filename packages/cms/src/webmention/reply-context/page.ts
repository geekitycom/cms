import { discoverPostType } from '../../content/post-type.ts';
import type { PictureSource } from '../cited-picture.ts';
import { fetchPublic, webUrl } from '../fetch-public.ts';
import { elementsIn, hasRel, parseHtml, textOf } from '../html.ts';
import type { HtmlElement } from '../html.ts';
import { citedEntry, citedEvent } from '../microformats.ts';
import type { CitedEntry, CitedEvent } from '../microformats.ts';
import { NAMELESS_NOTE, resolved, withoutDirectionControls } from './source.ts';
import type { Limits, Source } from './source.ts';

/**
 * The cited page itself: reading it, and what its microformats and its
 * metadata say.
 */

const IMAGE_TYPE = /^\s*image\//i;

export interface HtmlPage {
  /** Where it was read from, after any redirects. */
  readonly url: string;
  readonly root: HtmlElement;
  readonly entry: CitedEntry | undefined;
  readonly event: CitedEvent | undefined;
}

export type PageRead =
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly page: HtmlPage }
  /** A URL that is an image, read no further than its headers. */
  | { readonly ok: true; readonly page?: undefined; readonly image: string };

export async function readPage(url: string, limits: Limits): Promise<PageRead> {
  if (limits.deadline.aborted) return { ok: false, reason: 'timed out' };
  const fetched = await fetchPublic(url, {
    lookup: limits.lookup,
    signal: limits.deadline,
    maxBytes: limits.maxBytes,
    overflow: 'truncate',
    accept: 'text/html, */*;q=0.8',
    contentType: {
      pattern: /^\s*(text\/html|application\/xhtml\+xml)/i,
      name: 'an HTML page',
    },
    headersOnly: IMAGE_TYPE,
  });
  if (!fetched.ok) return { ok: false, reason: fetched.reason };
  if (fetched.read === 'headers') return { ok: true, image: fetched.url };
  const root = parseHtml(new TextDecoder().decode(fetched.body));
  const entry = fetched.truncated ? undefined : citedEntry(root, fetched.url);
  const event = fetched.truncated ? undefined : citedEvent(root, fetched.url);
  return { ok: true, page: { url: fetched.url, root, entry, event } };
}

export function entrySource(entry: CitedEntry): Source {
  const name = withoutDirectionControls(entry.name);
  const text = withoutDirectionControls(entry.text);
  const named = discoverPostType({ name, content: text }) === 'article';
  const author = entry.author;
  return {
    ...(named ? { name } : text === '' ? {} : { name: NAMELESS_NOTE }),
    ...(text === '' ? {} : { text }),
    ...(author === undefined
      ? {}
      : {
          author: { name: author.name, ...(author.url === null ? {} : { url: author.url }) },
          ...(author.photo === null ? {} : { photo: author.photo }),
        }),
    ...(entry.published === null ? {} : { published: entry.published }),
  };
}

export function eventSource(event: CitedEvent): Source {
  return {
    ...(event.name === '' ? {} : { name: event.name }),
    ...(event.text === '' ? {} : { text: event.text }),
    ...(event.start === '' ? {} : { start: event.start }),
    ...(event.location === '' ? {} : { location: event.location }),
  };
}

/** What the page's `<title>`, Open Graph and Twitter metadata say. */
export function pageSource(root: HtmlElement, base: string): Source {
  const name =
    pageTitle(metaOf(root, 'og:title')) ||
    pageTitle(metaOf(root, 'twitter:title')) ||
    pageTitle(titleOf(root));
  const text =
    metaOf(root, 'description') ||
    metaOf(root, 'og:description') ||
    metaOf(root, 'twitter:description');
  const articleAuthor = metaOf(root, 'article:author');
  const authorUrl = webUrl(articleAuthor);
  const authorName =
    (authorUrl === undefined ? articleAuthor : '') || metaOf(root, 'twitter:creator');
  const published = metaOf(root, 'article:published_time');
  const site = metaOf(root, 'og:site_name');
  const picture = pagePicture(root, base);
  return {
    ...(name === '' ? {} : { name }),
    ...(text === '' ? {} : { text }),
    ...(authorName === ''
      ? {}
      : {
          author: { name: authorName, ...(authorUrl === undefined ? {} : { url: authorUrl.href }) },
        }),
    ...(published === '' ? {} : { published }),
    ...(site === '' ? {} : { site }),
    ...(picture === undefined ? {} : { picture }),
  };
}

function pagePicture(root: HtmlElement, base: string): PictureSource | undefined {
  const image =
    metaOf(root, 'og:image') || metaOf(root, 'twitter:image') || metaOf(root, 'twitter:image:src');
  const url = resolved(image === '' ? undefined : image, base);
  if (url === undefined) return undefined;
  const video =
    metaOf(root, 'og:type').toLowerCase().startsWith('video') ||
    metaOf(root, 'twitter:card').toLowerCase() === 'player';
  return { url, kind: 'thumbnail', ...(video ? { video: true } : {}) };
}

function pageTitle(text: string): string {
  const title = withoutDirectionControls(text);
  return /^[-–—|·•:]\s/u.test(title) ? '' : title;
}

/** The page's `<title>`, or empty. */
function titleOf(root: HtmlElement): string {
  for (const element of elementsIn(root)) {
    if (element.name === 'title') return textOf(element);
  }
  return '';
}

/** The `content` of a `<meta name>` or `<meta property>`, or empty. */
function metaOf(root: HtmlElement, key: string): string {
  for (const element of elementsIn(root)) {
    if (element.name !== 'meta') continue;
    const names = [element.attributes['name'], element.attributes['property']];
    if (!names.some((name) => name?.toLowerCase() === key)) continue;
    return (element.attributes['content'] ?? '').replace(/\s+/g, ' ').trim();
  }
  return '';
}

export function canonicalLink(root: HtmlElement, base: string): string | undefined {
  for (const element of elementsIn(root)) {
    if (element.name === 'link' && hasRel(element, 'canonical')) {
      return resolved(element.attributes['href'], base);
    }
  }
  return undefined;
}

/** The copies a page lists of itself: its `u-syndication` and its `rel=syndication` links. */
export function syndicationOf(page: HtmlPage): string[] {
  const listed = [...(page.entry?.syndication ?? [])];
  for (const element of elementsIn(page.root)) {
    if ((element.name === 'a' || element.name === 'link') && hasRel(element, 'syndication')) {
      const url = resolved(element.attributes['href'], page.url);
      if (url !== undefined) listed.push(url);
    }
  }
  return listed.map((url) => webUrl(url)?.href ?? url);
}
