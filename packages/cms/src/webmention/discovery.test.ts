import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { discoverEndpoint } from './discovery.ts';

/** What the make-believe web answers for one URL. */
interface Page {
  /** Its status, 200 unless it says otherwise. */
  status?: number;
  /** Its headers. */
  headers?: Record<string, string>;
  /** Its body. */
  body?: string;
  /** Where it redirects to, which the stub follows as a browser would. */
  redirectTo?: string;
}

const pages = new Map<string, Page>();

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) =>
  Promise.resolve(answer(input))) as typeof fetch;

/** What the make-believe web answers, with no network anywhere near it. */
function answer(input: string | URL | Request): Response {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // Redirects are followed here rather than by the caller, because that is
  // what `fetch` does and the point of the test is what comes out the far end.
  for (let hop = 0; hop < 5; hop += 1) {
    const page = pages.get(url);
    if (page?.redirectTo === undefined) break;
    url = new URL(page.redirectTo, url).href;
  }

  const page = pages.get(url);
  if (page === undefined) return new Response('missing', { status: 404 });

  const response = new Response(page.body ?? '', {
    status: page.status ?? 200,
    headers: { 'content-type': 'text/html', ...page.headers },
  });
  // `Response.url` is empty unless the response was made by a redirect-following
  // fetch, and discovery resolves against it, so it is set here by hand.
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

after(() => {
  globalThis.fetch = original;
});

describe('discoverEndpoint', () => {
  it('takes the endpoint from a Link header', async () => {
    pages.set('https://them.example/post', {
      headers: { link: '</webmention>; rel="webmention"' },
      body: '<link rel="webmention" href="/wrong">',
    });

    assert.equal(
      await discoverEndpoint('https://them.example/post'),
      'https://them.example/webmention',
      'the header wins over the markup, as the spec orders them',
    );
  });

  it('reads a rel that names more than one relation', async () => {
    pages.set('https://them.example/many-rels', {
      headers: { link: '<https://wm.example/x>; rel="somethingelse webmention"' },
    });

    assert.equal(await discoverEndpoint('https://them.example/many-rels'), 'https://wm.example/x');
  });

  it('falls back to the first link element in document order', async () => {
    pages.set('https://them.example/in-head', {
      body: '<html><head><link rel="webmention" href="https://wm.example/head"></head><body><a rel="webmention" href="https://wm.example/body">x</a></body></html>',
    });

    assert.equal(await discoverEndpoint('https://them.example/in-head'), 'https://wm.example/head');
  });

  it('takes an anchor when it comes first', async () => {
    pages.set('https://them.example/anchor-first', {
      body: '<body><a rel="webmention" href="https://wm.example/anchor">x</a><link rel="webmention" href="https://wm.example/late"></body>',
    });

    assert.equal(
      await discoverEndpoint('https://them.example/anchor-first'),
      'https://wm.example/anchor',
    );
  });

  it('resolves a relative endpoint against the URL after the redirects', async () => {
    pages.set('https://them.example/old', { redirectTo: 'https://new.example/posts/one' });
    pages.set('https://new.example/posts/one', {
      body: '<link rel="webmention" href="../wm">',
    });

    assert.equal(await discoverEndpoint('https://them.example/old'), 'https://new.example/wm');
  });

  it('reads an empty href as the page itself, which is what the spec says', async () => {
    pages.set('https://them.example/self', { body: '<link rel="webmention" href="">' });

    assert.equal(await discoverEndpoint('https://them.example/self'), 'https://them.example/self');
  });

  it('finds nothing on a page that advertises nothing', async () => {
    pages.set('https://them.example/quiet', { body: '<p>Nothing here.</p>' });

    assert.equal(await discoverEndpoint('https://them.example/quiet'), undefined);
  });

  it('finds nothing on a page that is not there', async () => {
    assert.equal(await discoverEndpoint('https://them.example/gone'), undefined);
  });
});
