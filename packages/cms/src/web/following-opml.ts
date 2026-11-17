import type { FollowedFeed } from '../following/opml.ts';
import { escapeXml, rfc822 } from './feed-xml.ts';

export const FOLLOWING_OPML_PATH = '/.well-known/following.opml';

export const FOLLOWING_OPML_TYPE = 'text/x-opml; charset=utf-8';

export function followingTitle(siteTitle: string): string {
  return `Feeds ${siteTitle} follows`;
}

/**
 * The list as OPML 2.0 with one level of outlines, because a reader may look
 * no deeper. Each feed's folder survives as its `category`.
 */
export function followingOpml(input: {
  readonly title: string;
  readonly changedAt: Date;
  readonly feeds: readonly FollowedFeed[];
}): string {
  const outlines = input.feeds.map((feed) => {
    const attributes: [string, string | undefined][] = [
      ['type', 'rss'],
      ['text', feed.text],
      ['xmlUrl', feed.xmlUrl],
      ['htmlUrl', feed.htmlUrl],
      ['description', feed.description],
      ['category', feed.category],
    ];
    const written = attributes
      .filter((pair): pair is [string, string] => pair[1] !== undefined)
      .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
      .join('');
    return `    <outline${written}/>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${escapeXml(input.title)}</title>`,
    `    <dateModified>${rfc822(input.changedAt)}</dateModified>`,
    '    <docs>http://opml.org/spec2.opml</docs>',
    '  </head>',
    '  <body>',
    ...outlines,
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}
