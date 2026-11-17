import sax from 'sax';

import { normalizeWebAddress } from '../site/setting-values.ts';
import { elementsIn, hasRel, parseHtml } from '../util/html-tree.ts';
import { messageOf } from '../util/errors.ts';

export interface FollowedFeed {
  readonly text: string;
  readonly xmlUrl: string;
  readonly htmlUrl?: string;
  readonly description?: string;
  /** The folders it sat in, as OPML 2.0's `category` writes a path: `/Indieweb`, `/Software/Tools`. */
  readonly category?: string;
}

export type ParsedOpml =
  | { readonly ok: true; readonly feeds: readonly FollowedFeed[] }
  | { readonly ok: false; readonly problem: string };

export function parseOpml(xml: string): ParsedOpml {
  const parser = sax.parser(true, { trim: false, normalize: false });
  const open: string[] = [];
  const folders: (string | undefined)[] = [];
  const feeds: FollowedFeed[] = [];
  const seen = new Set<string>();
  let sawBody = false;
  let problem: string | undefined;

  parser.onerror = (error) => {
    problem ??= `not well-formed XML: ${messageOf(error).split('\n')[0] ?? ''}`;
    throw error;
  };
  parser.onopentag = (tag) => {
    const name = tag.name.toLowerCase();
    if (open.length === 0 && name !== 'opml')
      problem ??= `the root element is <${tag.name}>, not <opml>`;
    if (name === 'body' && open.length === 1 && open[0] === 'opml') sawBody = true;
    open.push(name);
    if (name !== 'outline' || !inBody(open)) return;

    const attributes = tag.attributes as Record<string, string | undefined>;
    const attribute = (key: string): string | undefined => attributes[key];
    const xmlUrl = optionalWebAddress(attribute('xmlUrl'));
    if (attribute('xmlUrl') === undefined) {
      folders.push(oneLine(attribute('text') ?? attribute('title') ?? ''));
      return;
    }
    folders.push(undefined);
    if (xmlUrl === undefined || seen.has(xmlUrl)) return;
    seen.add(xmlUrl);
    const path = folders.filter((folder) => folder !== undefined && folder !== '');
    const text = oneLine(attribute('text') ?? attribute('title') ?? '');
    const description = oneLine(attribute('description') ?? '');
    const htmlUrl = optionalWebAddress(attribute('htmlUrl'));
    feeds.push({
      text: text === '' ? xmlUrl : text,
      xmlUrl,
      ...(htmlUrl === undefined ? {} : { htmlUrl }),
      ...(description === '' ? {} : { description }),
      ...(path.length === 0 ? {} : { category: `/${path.join('/')}` }),
    });
  };
  parser.onclosetag = () => {
    if (open.pop() === 'outline' && inBody(open)) folders.pop();
  };

  try {
    parser.write(xml).close();
  } catch (thrown) {
    problem ??= messageOf(thrown);
  }
  if (problem !== undefined) return { ok: false, problem };
  if (!sawBody) return { ok: false, problem: 'the OPML has no <body>' };
  return { ok: true, feeds };
}

function inBody(open: readonly string[]): boolean {
  return open[0] === 'opml' && open[1] === 'body';
}

export function opmlAlternate(html: string, pageUrl: string): string | undefined {
  for (const element of elementsIn(parseHtml(html))) {
    if (element.name !== 'link' || !hasRel(element, 'alternate')) continue;
    if (!/^\s*text\/x-opml\s*(;|$)/i.test(element.attributes['type'] ?? '')) continue;
    const href = element.attributes['href'];
    if (href === undefined) continue;
    try {
      return optionalWebAddress(new URL(href, pageUrl).href);
    } catch {
      continue;
    }
  }
  return undefined;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function optionalWebAddress(value: string | undefined): string | undefined {
  return value === undefined ? undefined : normalizeWebAddress(value);
}
