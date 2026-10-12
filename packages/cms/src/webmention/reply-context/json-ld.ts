import { isRecord } from '../../util/guards.ts';
import { elementsIn } from '../../util/html-tree.ts';
import type { HtmlElement } from '../../util/html-tree.ts';
import { plainText, resolved } from './source.ts';
import type { Source } from './source.ts';

const POSTING_TYPE = /(Article|^BlogPosting|^SocialMediaPosting|^DiscussionForumPosting)$/;

export function jsonLdSource(root: HtmlElement, base: string): Source | undefined {
  const node = jsonLdNodes(root).find((candidate) =>
    [candidate['@type']].flat().some((type) => typeof type === 'string' && POSTING_TYPE.test(type)),
  );
  if (node === undefined) return undefined;

  const first: unknown = [node['author']].flat()[0];
  const author = isRecord(first) ? first : {};
  const authorName = plainText(typeof first === 'string' ? first : author['name']);
  const authorUrl = resolved(plainText(author['url']), base);
  const photo = resolved(imageUrl(author['image']), base);
  const picture = resolved(imageUrl(node['image']), base);
  const name = plainText(node['headline']);
  const published = plainText(node['datePublished']);
  return {
    ...(name === undefined ? {} : { name }),
    ...(authorName === undefined
      ? {}
      : {
          author: { name: authorName, ...(authorUrl === undefined ? {} : { url: authorUrl }) },
          ...(photo === undefined ? {} : { photo }),
        }),
    ...(published === undefined ? {} : { published }),
    ...(picture === undefined ? {} : { picture: { url: picture, kind: 'thumbnail' } }),
  };
}

const EVENT_TYPE = /Event$/;

export function jsonLdEventSource(root: HtmlElement): Source | undefined {
  const node = jsonLdNodes(root).find((candidate) =>
    [candidate['@type']].flat().some((type) => typeof type === 'string' && EVENT_TYPE.test(type)),
  );
  if (node === undefined) return undefined;

  const name = plainText(node['name']);
  const text = plainText(node['description']);
  const start = plainText(node['startDate']);
  const place: unknown = [node['location']].flat()[0];
  const location =
    typeof place === 'string'
      ? plainText(place)
      : isRecord(place)
        ? plainText(place['name'])
        : undefined;
  return {
    ...(name === undefined ? {} : { name }),
    ...(text === undefined ? {} : { text }),
    ...(start === undefined ? {} : { start }),
    ...(location === undefined ? {} : { location }),
  };
}

function jsonLdNodes(root: HtmlElement): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (const element of elementsIn(root)) {
    if (element.data === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(element.data);
    } catch {
      continue;
    }
    for (const value of [parsed].flat()) {
      if (!isRecord(value)) continue;
      nodes.push(value, ...[value['@graph']].flat().filter(isRecord));
    }
  }
  return nodes;
}

function imageUrl(value: unknown): string | undefined {
  const image = [value].flat()[0];
  if (typeof image === 'string') return plainText(image);
  if (!isRecord(image)) return undefined;
  return plainText(image['url']) ?? plainText(image['contentUrl']);
}
