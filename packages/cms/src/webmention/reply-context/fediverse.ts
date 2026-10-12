import { webUrl } from '../fetch-public.ts';
import { elementsIn, hasRel, parseHtml, textOf } from '../html.ts';
import type { HtmlElement } from '../html.ts';
import { publicHost } from '../public-address.ts';
import type { HtmlPage } from './page.ts';
import { NAMELESS_NOTE, resolved } from './source.ts';
import type { Limits, Source } from './source.ts';

/**
 * A fediverse post as a citation shows it, read from the ActivityPub object a
 * cited page links. `html` is its content, markup and all.
 */
export interface FediversePost {
  readonly name?: string;
  readonly html?: string;
  readonly author?: {
    readonly name: string;
    readonly url?: string;
    readonly handle?: string;
    readonly photo?: string;
  };
  readonly published?: string;
  /** Its first image attachment. */
  readonly image?: string;
  /** Its `url`: the page it is shown at, which a bridged post points at its original with. */
  readonly url?: string;
}

/**
 * Read the ActivityPub object at a URL, or `undefined` when it is none. The
 * signal aborts at the cited page's one deadline.
 */
export type FediverseLookup = (
  url: string,
  signal: AbortSignal,
) => Promise<FediversePost | undefined>;

export async function fediversePostOf(
  page: HtmlPage,
  lookupPost: FediverseLookup | undefined,
  limits: Limits,
): Promise<FediversePost | undefined> {
  if (page.entry !== undefined || lookupPost === undefined) return undefined;
  return await fetchFediversePost(activityLink(page.root, page.url), lookupPost, limits);
}

export function fediverseSource(post: FediversePost): Source {
  const text = textOf(parseHtml(spaceOutBreaks(post.html ?? '')));
  const { photo, ...author } = post.author ?? { name: '' };
  const image = webUrl(post.image ?? '');
  return {
    ...(post.name !== undefined && post.name !== ''
      ? { name: post.name }
      : text === ''
        ? {}
        : { name: NAMELESS_NOTE }),
    ...(text === '' ? {} : { text }),
    ...(author.name === '' ? {} : { author, ...(photo === undefined ? {} : { photo }) }),
    ...(post.published === undefined ? {} : { published: post.published }),
    ...(image === undefined ? {} : { picture: { url: image.href, kind: 'thumbnail' } }),
  };
}

function spaceOutBreaks(html: string): string {
  return html.replace(/<\/p>|<br\s*\/?>/gi, '$& ');
}

function activityLink(root: HtmlElement, base: string): string | undefined {
  for (const element of elementsIn(root)) {
    if (element.name !== 'link' || !hasRel(element, 'alternate')) continue;
    const type = (element.attributes['type'] ?? '').replace(/\s+/g, '').toLowerCase();
    if (
      type !== 'application/activity+json' &&
      type !== 'application/ld+json;profile="https://www.w3.org/ns/activitystreams"'
    ) {
      continue;
    }
    const url = resolved(element.attributes['href'], base);
    if (url !== undefined) return url;
  }
  return undefined;
}

async function fetchFediversePost(
  url: string | undefined,
  lookupPost: FediverseLookup,
  limits: Limits,
): Promise<FediversePost | undefined> {
  if (url === undefined) return undefined;
  if (!(await publicHost(new URL(url).hostname, limits.lookup))) return undefined;
  if (limits.deadline.aborted) return undefined;

  const signal = limits.deadline;
  const aborted = new Promise<undefined>((resolve) => {
    signal.addEventListener('abort', () => {
      resolve(undefined);
    });
  });
  return await Promise.race([lookupPost(url, signal).catch(() => undefined), aborted]);
}
