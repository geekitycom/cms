import assert from 'node:assert/strict';
import { after, afterEach, describe, it } from 'node:test';

import type { HostLookup } from '../util/public-address.ts';
import { fetchReplyContext } from './reply-context.ts';
import { feedHolding } from './reply-context/feed.ts';

/**
 * The feed a cited post is in, for `source:inReplyTo`'s `feedUrl` and
 * `feedTitle`. The shapes are rss.chat's: each person has a feed of their
 * own, and every post page advertises the site-wide feed, whose items name
 * the person's feed in an RSS 2.0 `<source>`.
 */

const TARGET = 'https://chat.example/?id=798';
const SITE_FEED = 'https://chat.example/users/rss.xml';
const DAVE_FEED = 'https://chat.example/users/dave/rss.xml';

function rss(channelTitle: string | undefined, items: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:source="https://source.scripting.com/">',
    '<channel>',
    ...(channelTitle === undefined ? [] : [`<title>${channelTitle}</title>`]),
    '<link>https://chat.example/</link>',
    ...items,
    '</channel>',
    '</rss>',
  ].join('\n');
}

const SITE_WIDE = rss('chat.example: all posts', [
  `<item><guid>https://chat.example/?id=799</guid>
    <source url="https://chat.example/users/ann/rss.xml">Ann</source></item>`,
  `<item><description>&lt;p&gt;Hello &amp;nbsp;world&lt;/p&gt;</description>
    <guid>${TARGET}</guid>
    <source url="${DAVE_FEED}">Dave Winer</source></item>`,
]);

describe('feedHolding', () => {
  it('credits the feed an item names in its <source>', () => {
    assert.deepEqual(feedHolding(SITE_WIDE, SITE_FEED, new Set([TARGET])), {
      url: DAVE_FEED,
      title: 'Dave Winer',
    });
  });

  it('credits the feed itself, by its channel title, when the item names no source', () => {
    const xml = rss('Dave &amp; Co', [`<item><link>${TARGET}</link></item>`]);
    assert.deepEqual(feedHolding(xml, DAVE_FEED, new Set([TARGET])), {
      url: DAVE_FEED,
      title: 'Dave & Co',
    });
  });

  it('leaves the title out of a feed that has none', () => {
    const xml = rss(undefined, [`<item><guid isPermaLink="true">${TARGET}</guid></item>`]);
    assert.deepEqual(feedHolding(xml, DAVE_FEED, new Set([TARGET])), { url: DAVE_FEED });
  });

  it('is nothing when no item is the post', () => {
    const xml = rss('Dave', ['<item><guid>https://chat.example/?id=1</guid></item>']);
    assert.equal(feedHolding(xml, DAVE_FEED, new Set([TARGET])), undefined);
  });

  it('does not take the channel’s own link for an item', () => {
    const xml = rss('Dave', []);
    assert.equal(feedHolding(xml, DAVE_FEED, new Set(['https://chat.example/'])), undefined);
  });

  it('still finds an item before the point a feed is cut off', () => {
    const xml = rss('chat.example: all posts', [
      `<item><guid>${TARGET}</guid><source url="${DAVE_FEED}">Dave Winer</source></item>`,
      '<item><guid>https://chat.example/?id=797</guid><description>Cut off he',
    ]);
    const cut = xml.slice(0, xml.indexOf('Cut off he') + 'Cut off he'.length);
    assert.deepEqual(feedHolding(cut, SITE_FEED, new Set([TARGET])), {
      url: DAVE_FEED,
      title: 'Dave Winer',
    });
  });

  it('reads CDATA, and matches a URL however it is spelled', () => {
    const xml = rss('<![CDATA[Dave’s feed]]>', [
      '<item><link><![CDATA[HTTPS://Chat.Example/?id=798]]></link></item>',
    ]);
    assert.deepEqual(feedHolding(xml, DAVE_FEED, new Set([TARGET])), {
      url: DAVE_FEED,
      title: 'Dave’s feed',
    });
  });
});

const ADDRESSES: Record<string, string[]> = {
  'chat.example': ['203.0.113.30'],
  'inside.example': ['10.0.0.5'],
};

const lookup: HostLookup = (hostname) => {
  const found = ADDRESSES[hostname];
  return found === undefined
    ? Promise.reject(new Error(`getaddrinfo ENOTFOUND ${hostname}`))
    : Promise.resolve(found);
};

const requested: string[] = [];
let web: Record<string, Response | undefined> = {};

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  requested.push(request.url);
  return Promise.resolve(web[request.url] ?? new Response('missing', { status: 404 }));
}) as typeof fetch;

after(() => {
  globalThis.fetch = original;
});

afterEach(() => {
  requested.length = 0;
  web = {};
});

function page(head: string): Response {
  return new Response(
    `<!doctype html><html><head><title>A chat post</title>${head}</head>
      <body><article class="h-entry"><p class="p-name e-content">Hello there.</p>
      <a class="p-author h-card" href="https://chat.example/users/dave/">Dave Winer</a></article></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

function feed(body: string, type = 'text/xml'): Response {
  return new Response(body, { headers: { 'content-type': type } });
}

async function feedOf(target: string): Promise<unknown> {
  const fetched = await fetchReplyContext(target, { lookup });
  assert.ok(fetched.ok, 'the page is read');
  return fetched.context.feed;
}

describe('fetchReplyContext and the feed a post is in', () => {
  it('follows the page’s RSS link to the feed its item credits', async () => {
    web = {
      [TARGET]: page(`<link rel="alternate" type="application/rss+xml" href="/users/rss.xml">`),
      [SITE_FEED]: feed(SITE_WIDE),
    };
    assert.deepEqual(await feedOf(TARGET), { url: DAVE_FEED, title: 'Dave Winer' });
  });

  it('finds no feed on a page that advertises none, and asks for nothing more', async () => {
    web = { [TARGET]: page('') };
    assert.equal(await feedOf(TARGET), undefined);
    assert.deepEqual(requested, [TARGET]);
  });

  it('takes only an RSS link, not Atom or JSON Feed', async () => {
    web = {
      [TARGET]: page(
        `<link rel="alternate" type="application/atom+xml" href="${SITE_FEED}">` +
          `<link rel="alternate" type="application/feed+json" href="${SITE_FEED}">`,
      ),
      [SITE_FEED]: feed(SITE_WIDE),
    };
    assert.equal(await feedOf(TARGET), undefined);
    assert.deepEqual(requested, [TARGET]);
  });

  it('finds no feed when the advertised one does not hold the post', async () => {
    web = {
      [TARGET]: page(`<link rel="alternate" type="application/rss+xml" href="${SITE_FEED}">`),
      [SITE_FEED]: feed(
        rss('Somebody else', ['<item><guid>https://chat.example/?id=1</guid></item>']),
      ),
    };
    assert.equal(await feedOf(TARGET), undefined);
  });

  it('never fetches a feed on a private host', async () => {
    const inside = 'https://inside.example/rss.xml';
    web = {
      [TARGET]: page(`<link rel="alternate" type="application/rss+xml" href="${inside}">`),
      [inside]: feed(SITE_WIDE),
    };
    assert.equal(await feedOf(TARGET), undefined);
    assert.equal(requested.includes(inside), false);
  });

  it('keeps the rest of the context when the feed cannot be read', async () => {
    web = {
      [TARGET]: page(`<link rel="alternate" type="application/rss+xml" href="${SITE_FEED}">`),
      [SITE_FEED]: feed('<html>not a feed</html>', 'text/html'),
    };
    const fetched = await fetchReplyContext(TARGET, { lookup });
    assert.ok(fetched.ok);
    assert.equal(fetched.context.feed, undefined);
    assert.equal(fetched.context.author?.name, 'Dave Winer');
  });
});
