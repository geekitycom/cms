import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { discoverEndpoint } from './discovery.ts';
import type { HostLookup } from './public-address.ts';

/** What the make-believe web answers for one URL. */
interface Page {
  /** Its status, 200 unless it says otherwise. */
  status?: number;
  /** Its headers. */
  headers?: Record<string, string>;
  /** Its body. */
  body?: string;
  /** Where it redirects to. */
  redirectTo?: string;
}

const pages = new Map<string, Page>();
const requested: string[] = [];

/** Every name resolves to a public address but the ones inside this network. */
const lookup: HostLookup = (hostname) =>
  Promise.resolve(hostname.endsWith('.internal.example') ? ['10.0.0.5'] : ['203.0.113.7']);

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) =>
  Promise.resolve(answer(input))) as typeof fetch;

/** What the make-believe web answers, with no network anywhere near it. */
function answer(input: string | URL | Request): Response {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  requested.push(url);

  const page = pages.get(url);
  if (page === undefined) return new Response('missing', { status: 404 });
  if (page.redirectTo !== undefined) {
    return new Response(null, { status: 302, headers: { location: page.redirectTo } });
  }

  return new Response(page.body ?? '', {
    status: page.status ?? 200,
    headers: { 'content-type': 'text/html', ...page.headers },
  });
}

after(() => {
  globalThis.fetch = original;
});

function discover(target: string): Promise<string | undefined> {
  return discoverEndpoint(target, lookup);
}

describe('discoverEndpoint', () => {
  it('takes the endpoint from a Link header', async () => {
    pages.set('https://them.example/post', {
      headers: { link: '</webmention>; rel="webmention"' },
      body: '<link rel="webmention" href="/wrong">',
    });

    assert.equal(
      await discover('https://them.example/post'),
      'https://them.example/webmention',
      'the header wins over the markup, as the spec orders them',
    );
  });

  it('reads a rel that names more than one relation', async () => {
    pages.set('https://them.example/many-rels', {
      headers: { link: '<https://wm.example/x>; rel="somethingelse webmention"' },
    });

    assert.equal(await discover('https://them.example/many-rels'), 'https://wm.example/x');
  });

  it('falls back to the first link element in document order', async () => {
    pages.set('https://them.example/in-head', {
      body: '<html><head><link rel="webmention" href="https://wm.example/head"></head><body><a rel="webmention" href="https://wm.example/body">x</a></body></html>',
    });

    assert.equal(await discover('https://them.example/in-head'), 'https://wm.example/head');
  });

  it('takes an anchor when it comes first', async () => {
    pages.set('https://them.example/anchor-first', {
      body: '<body><a rel="webmention" href="https://wm.example/anchor">x</a><link rel="webmention" href="https://wm.example/late"></body>',
    });

    assert.equal(await discover('https://them.example/anchor-first'), 'https://wm.example/anchor');
  });

  it('resolves a relative endpoint against the URL after the redirects', async () => {
    pages.set('https://them.example/old', { redirectTo: 'https://new.example/posts/one' });
    pages.set('https://new.example/posts/one', {
      body: '<link rel="webmention" href="../wm">',
    });

    assert.equal(await discover('https://them.example/old'), 'https://new.example/wm');
  });

  it('reads an empty href as the page itself, which is what the spec says', async () => {
    pages.set('https://them.example/self', { body: '<link rel="webmention" href="">' });

    assert.equal(await discover('https://them.example/self'), 'https://them.example/self');
  });

  it('finds nothing on a page that advertises nothing', async () => {
    pages.set('https://them.example/quiet', { body: '<p>Nothing here.</p>' });

    assert.equal(await discover('https://them.example/quiet'), undefined);
  });

  it('finds nothing on a page that is not there', async () => {
    assert.equal(await discover('https://them.example/gone'), undefined);
  });

  it('asks nothing of a target whose name resolves to a private address', async () => {
    pages.set('https://wiki.internal.example/page', {
      headers: { link: '</wm>; rel="webmention"' },
    });
    requested.length = 0;

    assert.equal(await discover('https://wiki.internal.example/page'), undefined);
    assert.deepEqual(requested, []);
  });

  it('stops at a redirect to a private address', async () => {
    pages.set('https://them.example/moved', { redirectTo: 'https://wiki.internal.example/page' });
    pages.set('https://wiki.internal.example/page', {
      headers: { link: '</wm>; rel="webmention"' },
    });
    requested.length = 0;

    assert.equal(await discover('https://them.example/moved'), undefined);
    assert.deepEqual(requested, ['https://them.example/moved']);
  });

  it('reads the Link header of a page that is not HTML', async () => {
    pages.set('https://them.example/photo.jpg', {
      headers: { 'content-type': 'image/jpeg', link: '</wm>; rel="webmention"' },
      body: 'not html',
    });

    assert.equal(await discover('https://them.example/photo.jpg'), 'https://them.example/wm');
  });
});
