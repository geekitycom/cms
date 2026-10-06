import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, afterEach, describe, it } from 'node:test';

import type { HostLookup } from './public-address.ts';
import { fetchReplyContext } from './reply-context.ts';
import type { FediverseLookup, FediversePost } from './reply-context.ts';

function fixture(name: string): string {
  return readFileSync(
    new URL(`../../test/fixtures/reply-context/${name}`, import.meta.url),
    'utf8',
  );
}

const AARON = 'https://aaronparecki.com/2026/09/24/20/';
const MASTODON = 'https://mastodon.social/@Gargron/117383656684365550';
const MASTODON_OBJECT = 'https://mastodon.social/users/Gargron/statuses/117383656684365550';
const ARS =
  'https://arstechnica.com/gadgets/2026/10/the-hows-and-whys-of-non-mechanical-mechanical-keyboard-switches/';
const GITHUB = 'https://github.com/fedify-dev/fedify';

const lookup: HostLookup = (hostname) =>
  hostname === 'inside.example' ? Promise.resolve(['10.0.0.5']) : Promise.resolve(['203.0.113.9']);

let pages: Record<string, string> = {};

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  const page = pages[request.url];
  return Promise.resolve(
    page === undefined
      ? new Response('missing', { status: 404 })
      : new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
  );
}) as typeof fetch;

after(() => {
  globalThis.fetch = original;
});

afterEach(() => {
  pages = {};
});

describe('the author photo of an h-entry', () => {
  it('takes the u-photo of the entry’s author h-card (aaronparecki.com)', async () => {
    pages = { [AARON]: fixture('aaronparecki-checkin.html') };

    const fetched = await fetchReplyContext(AARON, { lookup });

    assert.ok(fetched.ok);
    assert.deepEqual(fetched.context.author, {
      name: 'Aaron Parecki',
      url: 'https://aaronparecki.com/',
    });
    assert.equal(fetched.authorPhoto, 'https://aaronparecki.com/images/profile.jpg');
  });

  const ENTRY = 'https://them.example/2026/09/beans/';

  function page(author: string, cards: string): string {
    return `<!doctype html><title>Beans</title>
      <header>${cards}</header>
      <article class="h-entry">
        <h1 class="p-name">Growing beans</h1>
        ${author}
        <div class="e-content"><p>Beans climb.</p></div>
      </article>`;
  }

  it('falls back to the page’s h-card for the same author when the entry’s has no photo', async () => {
    pages = {
      [ENTRY]: page(
        '<a class="p-author h-card" href="https://them.example/">Pat Them</a>',
        `<div class="h-card"><img class="u-photo" src="/pat.jpg" alt="">
          <a class="p-name u-url" href="/" rel="me">Pat Them</a></div>`,
      ),
    };

    const fetched = await fetchReplyContext(ENTRY, { lookup });

    assert.ok(fetched.ok);
    assert.equal(fetched.authorPhoto, 'https://them.example/pat.jpg');
  });

  it('matches an author with no page by name', async () => {
    pages = {
      [ENTRY]: page(
        '<span class="p-author">Pat Them</span>',
        '<div class="h-card"><img class="u-photo" src="/pat.jpg" alt=""><span class="p-name">Pat Them</span></div>',
      ),
    };

    const fetched = await fetchReplyContext(ENTRY, { lookup });

    assert.ok(fetched.ok);
    assert.equal(fetched.authorPhoto, 'https://them.example/pat.jpg');
  });

  it('never takes somebody else’s photo from the page', async () => {
    pages = {
      [ENTRY]: page(
        '<a class="p-author h-card" href="https://them.example/">Pat Them</a>',
        `<div class="h-card"><img class="u-photo" src="/sam.jpg" alt="">
          <a class="p-name u-url" href="https://sam.example/">Sam Else</a></div>`,
      ),
    };

    const fetched = await fetchReplyContext(ENTRY, { lookup });

    assert.ok(fetched.ok);
    assert.equal(fetched.authorPhoto, undefined);
  });
});

describe('a fediverse post', () => {
  const POST: FediversePost = {
    html: '<p><a href="https://mastodon.social/tags/SilentSunday" class="mention hashtag" rel="tag">#<span>SilentSunday</span></a></p><p>Sheep &amp; rain</p>',
    author: {
      name: 'Eugen Rochko',
      url: 'https://mastodon.social/@Gargron',
      handle: 'Gargron@mastodon.social',
      photo:
        'https://files.mastodon.social/accounts/avatars/000/000/001/original/6b2384b33799a0dd.png',
    },
    published: '2026-10-04T16:47:36Z',
    image:
      'https://files.mastodon.social/media_attachments/files/117/383/653/868/951/382/original/076a61b438462f42.jpeg',
  };

  it('describes a Mastodon status from the object its page links', async () => {
    pages = { [MASTODON]: fixture('mastodon-status.html') };
    const asked: string[] = [];
    const fediverse: FediverseLookup = (url) => {
      asked.push(url);
      return Promise.resolve(POST);
    };

    const fetched = await fetchReplyContext(MASTODON, { lookup, fediverse });

    assert.deepEqual(asked, [MASTODON_OBJECT]);
    assert.deepEqual(fetched, {
      ok: true,
      context: {
        url: MASTODON,
        text: '#SilentSunday Sheep & rain',
        author: {
          name: 'Eugen Rochko',
          url: 'https://mastodon.social/@Gargron',
          handle: 'Gargron@mastodon.social',
        },
        published: '2026-10-04T16:47:36.000Z',
      },
      picture: { url: POST.image, kind: 'thumbnail' },
      authorPhoto: POST.author?.photo,
    });
  });

  it('falls back to the page when the object cannot be read', async () => {
    pages = { [MASTODON]: fixture('mastodon-status.html') };

    const fetched = await fetchReplyContext(MASTODON, {
      lookup,
      fediverse: () => Promise.resolve(undefined),
    });

    assert.ok(fetched.ok);
    assert.equal(fetched.context.name, 'Eugen Rochko (@Gargron@mastodon.social)');
    assert.deepEqual(fetched.context.author, {
      name: 'Eugen Rochko',
      url: 'https://mastodon.social/@Gargron',
    });
    assert.equal(fetched.context.published, '2026-10-04T16:47:36.000Z');
  });

  it('gives the object only what is left of the one timeout', async () => {
    pages = { [MASTODON]: fixture('mastodon-status.html') };
    let signal: AbortSignal | undefined;

    const fetched = await fetchReplyContext(MASTODON, {
      lookup,
      timeoutMs: 200,
      fediverse: (_url, given) => {
        signal = given;
        return new Promise((resolve) => {
          given.addEventListener('abort', () => {
            resolve(undefined);
          });
        });
      },
    });

    assert.ok(signal?.aborted);
    assert.ok(fetched.ok);
  });

  it('never asks about an object on a private address', async () => {
    pages = {
      'https://them.example/status/1': `<title>A status</title>
        <link rel="alternate" type="application/activity+json" href="https://inside.example/objects/1">`,
    };
    const asked: string[] = [];

    await fetchReplyContext('https://them.example/status/1', {
      lookup,
      fediverse: (url) => {
        asked.push(url);
        return Promise.resolve(POST);
      },
    });

    assert.deepEqual(asked, []);
  });

  it('names an Article by its name and keeps its words as text', async () => {
    pages = {
      'https://them.example/@pat/1': `<title>Pat</title>
        <link rel="alternate" type="application/activity+json" href="https://them.example/objects/1">`,
    };

    const fetched = await fetchReplyContext('https://them.example/@pat/1', {
      lookup,
      fediverse: () => Promise.resolve({ name: 'On beans', html: '<p>Beans climb.</p>' }),
    });

    assert.ok(fetched.ok);
    assert.equal(fetched.context.name, 'On beans');
    assert.equal(fetched.context.text, 'Beans climb.');
  });
});

describe('JSON-LD', () => {
  it('describes a news article from its JSON-LD (arstechnica.com)', async () => {
    pages = { [ARS]: fixture('arstechnica-news-article.html') };

    const fetched = await fetchReplyContext(ARS, { lookup });

    assert.deepEqual(fetched, {
      ok: true,
      context: {
        url: ARS,
        name: 'Explaining Hall-effect, TMR, and other new types of "mechanical" switches',
        text: "Ars Technica's guide to new keyboard sensing technologies.",
        author: { name: 'Scharon Harding', url: 'https://arstechnica.com/author/scharonharding/' },
        published: '2026-10-05T11:00:41.000Z',
      },
      picture: {
        url: 'https://cdn.arstechnica.net/wp-content/uploads/2026/08/Varmilo-EC-1152x648.jpg',
        kind: 'thumbnail',
      },
    });
  });

  it('reads the author’s image, a list of authors and an @graph', async () => {
    const target = 'https://news.example/2026/10/story';
    pages = {
      [target]: `<title>Story - News</title>
        <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
          {"@type":"WebPage","name":"Story - News"},
          {"@type":["BlogPosting"],"headline":"The story",
           "author":[{"@type":"Person","name":"Robin Writer","url":"https://news.example/robin",
                      "image":{"@type":"ImageObject","url":"https://news.example/robin.jpg"}},
                     {"@type":"Person","name":"Second"}],
           "image":["https://news.example/lead.jpg"],
           "datePublished":"2026-10-01T08:00:00Z"}]}</script>`,
    };

    const fetched = await fetchReplyContext(target, { lookup });

    assert.ok(fetched.ok);
    assert.equal(fetched.context.name, 'The story');
    assert.deepEqual(fetched.context.author, {
      name: 'Robin Writer',
      url: 'https://news.example/robin',
    });
    assert.equal(fetched.context.published, '2026-10-01T08:00:00.000Z');
    assert.equal(fetched.authorPhoto, 'https://news.example/robin.jpg');
    assert.deepEqual(fetched.picture, { url: 'https://news.example/lead.jpg', kind: 'thumbnail' });
  });

  it('ignores JSON-LD that does not parse or describes no article', async () => {
    const target = 'https://news.example/2026/10/broken';
    pages = {
      [target]: `<title>Plain title</title>
        <script type="application/ld+json">{"@type":"NewsArticle","headline":</script>
        <script type="application/ld+json">{"@type":"Organization","name":"Not this"}</script>`,
    };

    const fetched = await fetchReplyContext(target, { lookup });

    assert.deepEqual(fetched, { ok: true, context: { url: target, name: 'Plain title' } });
  });
});

describe('Open Graph and Twitter tags', () => {
  it('describes a page that has nothing but Open Graph (github.com)', async () => {
    pages = { [GITHUB]: fixture('github-open-graph.html') };

    const fetched = await fetchReplyContext(GITHUB, { lookup });

    assert.deepEqual(fetched, {
      ok: true,
      context: {
        url: GITHUB,
        name: 'GitHub - fedify-dev/fedify: ActivityPub server framework in TypeScript',
        text: 'ActivityPub server framework in TypeScript. Contribute to fedify-dev/fedify development by creating an account on GitHub.',
        site: 'GitHub',
      },
      picture: {
        url: 'https://repository-images.githubusercontent.com/766072261/03a63032-03aa-481e-aa31-091809a49043',
        kind: 'thumbnail',
      },
    });
  });

  it('reads the Twitter title, description and creator, and the article’s author and date', async () => {
    const target = 'https://them.example/story';
    pages = {
      [target]: `<meta name="twitter:title" content="Twitter title">
        <meta name="twitter:description" content="Twitter words.">
        <meta name="twitter:creator" content="@patthem">
        <meta property="article:published_time" content="2026-09-30T10:00:00+02:00">
        <meta property="og:site_name" content="Them">`,
    };

    const fetched = await fetchReplyContext(target, { lookup });

    assert.deepEqual(fetched, {
      ok: true,
      context: {
        url: target,
        name: 'Twitter title',
        text: 'Twitter words.',
        author: { name: '@patthem' },
        published: '2026-09-30T08:00:00.000Z',
      },
    });
  });

  it('names the author from article:author, and keeps it as their page when it is a URL', async () => {
    const named = 'https://them.example/named';
    const linked = 'https://them.example/linked';
    pages = {
      [named]: '<title>Named</title><meta property="article:author" content="Pat Them">',
      [linked]: `<title>Linked</title>
        <meta property="article:author" content="https://them.example/pat">
        <meta name="twitter:creator" content="@patthem">`,
    };

    const first = await fetchReplyContext(named, { lookup });
    const second = await fetchReplyContext(linked, { lookup });

    assert.ok(first.ok && second.ok);
    assert.deepEqual(first.context.author, { name: 'Pat Them' });
    assert.deepEqual(second.context.author, { name: '@patthem', url: 'https://them.example/pat' });
  });
});

describe('the order of the sources', () => {
  it('lets an h-entry’s author and date stand over the page’s other metadata', async () => {
    const target = 'https://them.example/2026/09/beans/';
    pages = {
      [target]: `<title>Beans</title>
        <meta property="article:author" content="Somebody Else">
        <meta property="article:published_time" content="2020-01-01T00:00:00Z">
        <script type="application/ld+json">{"@type":"Article","headline":"Other","author":{"name":"Other"}}</script>
        <article class="h-entry"><h1 class="p-name">Growing beans</h1>
          <a class="p-author h-card" href="https://them.example/">Pat Them</a>
          <time class="dt-published" datetime="2026-09-01T12:00:00Z">1 September</time>
          <div class="e-content"><p>Beans climb.</p></div></article>`,
    };

    const fetched = await fetchReplyContext(target, { lookup });

    assert.ok(fetched.ok);
    assert.equal(fetched.context.name, 'Growing beans');
    assert.deepEqual(fetched.context.author, { name: 'Pat Them', url: 'https://them.example/' });
    assert.equal(fetched.context.published, '2026-09-01T12:00:00.000Z');
  });

  it('fills a date an h-entry leaves out from the page’s metadata', async () => {
    const target = 'https://them.example/2026/09/undated/';
    pages = {
      [target]: `<meta property="article:published_time" content="2026-09-02T00:00:00Z">
        <article class="h-entry"><p class="e-content">Beans climb.</p></article>`,
    };

    const fetched = await fetchReplyContext(target, { lookup });

    assert.ok(fetched.ok);
    assert.equal(fetched.context.published, '2026-09-02T00:00:00.000Z');
    assert.equal(fetched.context.name, undefined);
  });

  it('takes no photo from a source that names a different author', async () => {
    const target = 'https://them.example/2026/09/mixed/';
    pages = {
      [target]: `<title>Mixed</title>
        <script type="application/ld+json">{"@type":"Article","author":{"name":"Robin","image":"https://them.example/robin.jpg"}}</script>
        <article class="h-entry"><p class="p-name e-content">Beans.</p>
          <a class="p-author h-card" href="https://them.example/">Pat Them</a></article>`,
    };

    const fetched = await fetchReplyContext(target, { lookup });

    assert.ok(fetched.ok);
    assert.equal(fetched.context.author?.name, 'Pat Them');
    assert.equal(fetched.authorPhoto, undefined);
  });

  it('describes a page with nothing past its title exactly as before', async () => {
    const target = 'https://them.example/plain';
    pages = { [target]: '<title>Just a title</title>' };

    assert.deepEqual(await fetchReplyContext(target, { lookup, fediverse: () => assert.fail() }), {
      ok: true,
      context: { url: target, name: 'Just a title' },
    });
  });
});
