import type { PictureSource } from '../cited-picture.ts';
import { fetchPublic, webUrl } from '../fetch-public.ts';
import { elementsIn, hasRel } from '../html.ts';
import type { HtmlElement } from '../html.ts';
import { plainText } from './source.ts';
import type { Limits, Source } from './source.ts';

export interface Oembed {
  readonly title?: string;
  readonly author?: { readonly name: string; readonly url?: string };
  readonly picture?: PictureSource;
}

interface KnownOembedProvider {
  readonly hosts: readonly string[];
  readonly path: RegExp;
  readonly endpoint: string;
  readonly params: Readonly<Record<string, string>>;
  readonly titleSuffix?: string;
}

/**
 * YouTube, TikTok, Reddit and Giphy serve a server a generic or slow page, or
 * refuse it, while their endpoints answer (decision-19).
 */
const KNOWN_OEMBED_PROVIDERS: readonly KnownOembedProvider[] = [
  {
    hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
    path: /^\/(watch\?(.*&)?v=[\w-]+|shorts\/[\w-]+\/?(\?|$))/,
    endpoint: 'https://www.youtube.com/oembed',
    params: { format: 'json' },
  },
  {
    hosts: ['youtu.be'],
    path: /^\/[\w-]+\/?(\?|$)/,
    endpoint: 'https://www.youtube.com/oembed',
    params: { format: 'json' },
  },
  {
    hosts: ['tiktok.com', 'www.tiktok.com'],
    path: /^\/@[^/]+\/video\/\d+/,
    endpoint: 'https://www.tiktok.com/oembed',
    params: { format: 'json' },
  },
  {
    hosts: ['reddit.com', 'www.reddit.com'],
    path: /^\/r\/[^/]+\/comments\//,
    endpoint: 'https://www.reddit.com/oembed',
    params: { format: 'json' },
  },
  {
    hosts: ['giphy.com', 'www.giphy.com'],
    path: /^\/gifs\/[^/?]+/,
    endpoint: 'https://giphy.com/services/oembed',
    params: { format: 'json' },
    titleSuffix: ' - Find & Share on GIPHY',
  },
];

export interface KnownEndpoint {
  readonly endpoint: string;
  readonly titleSuffix?: string | undefined;
}

export function knownEndpoint(target: string): KnownEndpoint | undefined {
  const url = webUrl(target);
  if (url === undefined) return undefined;
  const provider = KNOWN_OEMBED_PROVIDERS.find(
    ({ hosts, path }) => hosts.includes(url.hostname) && path.test(url.pathname + url.search),
  );
  if (provider === undefined) return undefined;
  const endpoint = new URL(provider.endpoint);
  for (const [name, value] of Object.entries(provider.params)) {
    endpoint.searchParams.set(name, value);
  }
  endpoint.searchParams.set('url', target);
  return { endpoint: endpoint.href, titleSuffix: provider.titleSuffix };
}

export function withoutSuffix(
  oembed: Oembed | undefined,
  suffix: string | undefined,
): Oembed | undefined {
  if (oembed?.title === undefined || suffix === undefined || !oembed.title.endsWith(suffix)) {
    return oembed;
  }
  const title = oembed.title.slice(0, -suffix.length).trim();
  const { title: _title, ...rest } = oembed;
  return title === '' ? rest : { ...rest, title };
}

export function oembedSource(oembed: Oembed | undefined): Source | undefined {
  if (oembed === undefined) return undefined;
  return {
    ...(oembed.title === undefined ? {} : { name: oembed.title }),
    ...(oembed.author === undefined ? {} : { author: oembed.author }),
    ...(oembed.picture === undefined ? {} : { picture: oembed.picture }),
  };
}

export function oembedEndpoint(root: HtmlElement, base: string): string | undefined {
  for (const element of elementsIn(root)) {
    if (element.name !== 'link') continue;
    // Flickr writes "alternative" and SoundCloud "text/json+oembed".
    if (!hasRel(element, 'alternate') && !hasRel(element, 'alternative')) continue;
    const type = element.attributes['type']?.trim().toLowerCase();
    if (type !== 'application/json+oembed' && type !== 'text/json+oembed') continue;
    try {
      return new URL(element.attributes['href'] ?? '', base).href;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function fetchOembed(endpoint: string, limits: Limits): Promise<Oembed | undefined> {
  if (limits.deadline.aborted) return undefined;

  const fetched = await fetchPublic(endpoint, {
    lookup: limits.lookup,
    signal: limits.deadline,
    maxBytes: limits.maxBytes,
    accept: 'application/json+oembed, application/json;q=0.9',
    contentType: {
      pattern: /^\s*(application\/(json|json\+oembed)|text\/(json|javascript))\b/i,
      name: 'oEmbed JSON',
    },
  });
  if (!fetched.ok) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fetched.body));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const fields = parsed as Record<string, unknown>;

  const title = plainText(fields['title']);
  const authorName = plainText(fields['author_name']);
  const authorUrl = webUrl(plainText(fields['author_url']) ?? '');
  const type = plainText(fields['type']);
  const photo = type === 'photo' ? webUrl(plainText(fields['url']) ?? '') : undefined;
  const thumbnail = webUrl(plainText(fields['thumbnail_url']) ?? '');
  const picture: PictureSource | undefined =
    photo !== undefined
      ? { url: photo.href, kind: 'photo' }
      : thumbnail !== undefined
        ? { url: thumbnail.href, kind: 'thumbnail', ...(type === 'video' ? { video: true } : {}) }
        : undefined;
  return {
    ...(title === undefined ? {} : { title }),
    ...(picture === undefined ? {} : { picture }),
    ...(authorName === undefined
      ? {}
      : {
          author: { name: authorName, ...(authorUrl === undefined ? {} : { url: authorUrl.href }) },
        }),
  };
}
