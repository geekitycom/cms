import sax from 'sax';

import { elementsIn, hasRel } from '../../util/html-tree.ts';
import { fetchPublic, webUrl } from '../fetch-public.ts';
import { canonicalLink } from './page.ts';
import type { HtmlPage } from './page.ts';
import { resolved, withoutDirectionControls } from './source.ts';
import type { Limits } from './source.ts';

/**
 * The RSS feed a cited post is published in, which `source:inReplyTo` names
 * in its `feedUrl` and `feedTitle` so a reader can follow the other side of a
 * conversation.
 */
export interface AnsweredFeed {
  readonly url: string;
  /** Left out when the feed has no title. */
  readonly title?: string;
}

const RSS_TYPE = /^\s*application\/rss\+xml\s*(;|$)/i;

/**
 * The feed a page's post is in: the RSS feed the page advertises, when an item
 * there is the post. An item that names the feed it came from in an RSS 2.0
 * `<source>` is credited to that feed instead, which is how a site-wide feed
 * such as rss.chat's points at each author's own.
 */
export async function answeredFeed(
  page: HtmlPage,
  target: string,
  limits: Limits,
): Promise<AnsweredFeed | undefined> {
  const href = advertisedFeed(page);
  if (href === undefined || limits.deadline.aborted) return undefined;
  const fetched = await fetchPublic(href, {
    lookup: limits.lookup,
    signal: limits.deadline,
    maxBytes: limits.maxBytes,
    overflow: 'truncate',
    accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.9',
    contentType: { pattern: /xml/i, name: 'an RSS feed' },
  });
  if (!fetched.ok) return undefined;
  const names = new Set(
    [target, page.url, canonicalLink(page.root, page.url)].filter(
      (url): url is string => url !== undefined,
    ),
  );
  return feedHolding(new TextDecoder().decode(fetched.body), fetched.url, names);
}

function advertisedFeed(page: HtmlPage): string | undefined {
  for (const element of elementsIn(page.root)) {
    if (element.name !== 'link' || !hasRel(element, 'alternate')) continue;
    if (!RSS_TYPE.test(element.attributes['type'] ?? '')) continue;
    const href = resolved(element.attributes['href'], page.url);
    if (href !== undefined) return href;
  }
  return undefined;
}

/**
 * Which feed an RSS document credits with the item whose `guid` or `link` is
 * one of `names`, or `undefined` when no item is. Reads what it can of a feed
 * that is cut short or not quite well-formed.
 */
export function feedHolding(
  xml: string,
  feedUrl: string,
  names: ReadonlySet<string>,
): AnsweredFeed | undefined {
  const wanted = new Set([...names].map(normalized));
  const parser = sax.parser(true, { trim: false, normalize: false });
  const path: string[] = [];
  let channelTitle = '';
  let text = '';
  let item: { names: string[]; source?: string; sourceTitle: string } | undefined;
  let found: AnsweredFeed | undefined;

  parser.onopentag = (tag) => {
    path.push(tag.name);
    text = '';
    if (tag.name === 'item' && path.at(-2) === 'channel') item = { names: [], sourceTitle: '' };
    const url = tag.attributes['url'];
    if (item !== undefined && tag.name === 'source' && typeof url === 'string') {
      item.source = url;
    }
  };
  parser.onclosetag = (name) => {
    const parent = path.at(-2);
    if (name === 'title' && parent === 'channel') channelTitle = text;
    if (item !== undefined && parent === 'item') {
      if (name === 'guid' || name === 'link') item.names.push(normalized(text.trim()));
      if (name === 'source') item.sourceTitle = text;
    }
    if (name === 'item' && item !== undefined) {
      if (found === undefined && item.names.some((named) => wanted.has(named))) {
        found = credited(item, feedUrl, channelTitle);
      }
      item = undefined;
    }
    path.pop();
    text = '';
  };
  const append = (chunk: string): void => {
    text += chunk;
  };
  parser.ontext = append;
  parser.oncdata = append;
  parser.onerror = () => {
    parser.error = null as unknown as Error;
    parser.resume();
  };

  parser.write(xml).close();
  return found;
}

function credited(
  item: { source?: string; sourceTitle: string },
  feedUrl: string,
  channelTitle: string,
): AnsweredFeed | undefined {
  const source = item.source === undefined ? undefined : resolved(item.source, feedUrl);
  const url = source ?? webUrl(feedUrl)?.href;
  if (url === undefined) return undefined;
  const title = withoutDirectionControls(source === undefined ? channelTitle : item.sourceTitle);
  return { url, ...(title === '' ? {} : { title }) };
}

function normalized(url: string): string {
  return webUrl(url)?.href ?? url;
}
