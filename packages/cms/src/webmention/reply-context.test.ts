import assert from 'node:assert/strict';
import { after, afterEach, describe, it } from 'node:test';

import { isPrivateHost, publicHost } from './public-address.ts';
import type { HostLookup } from './public-address.ts';
import { fetchReplyContext, readReplyContext } from './reply-context.ts';

const TARGET = 'https://them.example/2026/09/their-post/';

/** What each host in the make-believe web resolves to. */
const ADDRESSES: Record<string, string[]> = {
  'them.example': ['203.0.113.10'],
  'plain.example': ['203.0.113.11'],
  'inside.example': ['10.0.0.5'],
  'sneaky.example': ['203.0.113.12', '127.0.0.1'],
};

const lookup: HostLookup = (hostname) => {
  const found = ADDRESSES[hostname];
  return found === undefined
    ? Promise.reject(new Error(`getaddrinfo ENOTFOUND ${hostname}`))
    : Promise.resolve(found);
};

/** Every URL the stubbed web was asked for. */
const requested: string[] = [];
let answer: (request: Request) => Response | Promise<Response> = () =>
  new Response('missing', { status: 404 });

const original = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  requested.push(request.url);
  return answer(request);
}) as typeof fetch;

after(() => {
  globalThis.fetch = original;
});

afterEach(() => {
  requested.length = 0;
  answer = () => new Response('missing', { status: 404 });
});

function html(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

const H_ENTRY = `<!doctype html>
<html><head><title>Their site</title></head>
<body>
  <article class="h-entry">
    <h1 class="p-name">Growing tomatoes</h1>
    <a class="p-author h-card" href="https://them.example/">Pat Them</a>
    <time class="dt-published" datetime="2026-09-01T12:00:00Z">1 September</time>
    <div class="e-content"><p>Tomatoes want sun, water and patience.</p></div>
  </article>
</body></html>`;

describe('readReplyContext', () => {
  it('reads an h-entry’s name, author and published date', () => {
    assert.deepEqual(readReplyContext(H_ENTRY, TARGET), {
      url: TARGET,
      name: 'Growing tomatoes',
      text: 'Tomatoes want sun, water and patience.',
      author: { name: 'Pat Them', url: 'https://them.example/' },
      published: '2026-09-01T12:00:00.000Z',
    });
  });

  it('gives a note no name, only its words, since its name is its text', () => {
    const note = `<div class="h-entry"><p class="e-content p-name">Just a quick thought.</p></div>`;

    assert.deepEqual(readReplyContext(note, TARGET), {
      url: TARGET,
      text: 'Just a quick thought.',
    });
  });

  it('implies no name for an entry that has other text properties, as mf2 says', () => {
    const wiki = `<div class="mw-body h-entry">
      <h1>reply-context</h1>
      <nav>Tools Actions History</nav>
      <div class="p-summary">A reply context is the display of what a reply is in reply to.</div>
      <div class="e-content">A reply context is the display of what a reply is in reply to. More.</div>
    </div>`;

    assert.deepEqual(readReplyContext(wiki, TARGET), {
      url: TARGET,
      text: 'A reply context is the display of what a reply is in reply to. More.',
    });
  });

  it('cuts a long text to a short excerpt', () => {
    const words = Array.from({ length: 200 }, (_, at) => `word${String(at)}`).join(' ');
    const context = readReplyContext(
      `<div class="h-entry"><div class="e-content">${words}</div></div>`,
      TARGET,
    );

    assert.ok(context !== undefined);
    assert.ok((context.text ?? '').length < 400, 'the excerpt is short');
    assert.match(context.text ?? '', /^word0 word1 .* …$/);
  });

  it('falls back to the page title and description when there is no h-entry', () => {
    const page = `<html><head>
      <title>A plain page</title>
      <meta name="description" content="What the page is about.">
    </head><body><p>Hello.</p></body></html>`;

    assert.deepEqual(readReplyContext(page, TARGET), {
      url: TARGET,
      name: 'A plain page',
      text: 'What the page is about.',
    });
  });

  it('reads the Open Graph title and description when the plain ones are missing', () => {
    const page = `<html><head>
      <meta property="og:title" content="Shared title">
      <meta property="og:description" content="Shared words.">
    </head></html>`;

    assert.deepEqual(readReplyContext(page, TARGET), {
      url: TARGET,
      name: 'Shared title',
      text: 'Shared words.',
    });
  });

  it('has nothing to say about a page with no entry, title or description', () => {
    assert.equal(readReplyContext('<p>just words</p>', TARGET), undefined);
  });

  it('keeps markup from the target as text rather than as markup', () => {
    const hostile = `<div class="h-entry">
      <h1 class="p-name">&lt;script&gt;alert(1)&lt;/script&gt;</h1>
      <div class="e-content"><p>Hi <img src=x onerror="alert(2)"></p></div>
    </div>`;
    const context = readReplyContext(hostile, TARGET);

    assert.equal(context?.name, '<script>alert(1)</script>');
    assert.doesNotMatch(context?.text ?? '', /onerror/);
  });
});

describe('fetchReplyContext', () => {
  it('fetches and reads a target that publishes an h-entry', async () => {
    answer = () => html(H_ENTRY);

    const fetched = await fetchReplyContext(TARGET, { lookup });

    assert.deepEqual(fetched, {
      ok: true,
      context: readReplyContext(H_ENTRY, TARGET),
    });
    assert.deepEqual(requested, [TARGET]);
  });

  it('reads a page’s metadata when it has no h-entry', async () => {
    answer = () => html('<title>Just a page</title><meta name="description" content="About it.">');

    const fetched = await fetchReplyContext('https://plain.example/page', { lookup });

    assert.deepEqual(fetched, {
      ok: true,
      context: { url: 'https://plain.example/page', name: 'Just a page', text: 'About it.' },
    });
  });

  it('gives up on a target it cannot reach', async () => {
    answer = () => Promise.reject(new TypeError('fetch failed'));

    const fetched = await fetchReplyContext(TARGET, { lookup });

    assert.deepEqual(fetched, { ok: false, reason: 'fetch failed' });
  });

  it('gives up on a host that does not resolve, without fetching', async () => {
    const fetched = await fetchReplyContext('https://nowhere.example/', { lookup });

    assert.equal(fetched.ok, false);
    assert.deepEqual(requested, []);
  });

  it('gives up on a target that answers an error', async () => {
    answer = () => new Response('gone', { status: 410 });

    assert.deepEqual(await fetchReplyContext(TARGET, { lookup }), {
      ok: false,
      reason: 'answered 410',
    });
  });

  it('gives up on a target that is too slow', async () => {
    answer = (request) =>
      new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(request.signal.reason as Error);
        });
      });

    const started = Date.now();
    const fetched = await fetchReplyContext(TARGET, { lookup, timeoutMs: 50 });

    assert.equal(fetched.ok, false);
    assert.ok(Date.now() - started < 2_000, 'it did not wait on the target');
  });

  it('gives up on a target that is too big, rather than reading part of it', async () => {
    answer = () => html(`<title>Big</title>${'x'.repeat(5_000)}`);

    assert.deepEqual(await fetchReplyContext(TARGET, { lookup, maxBytes: 1_000 }), {
      ok: false,
      reason: 'larger than 1000 bytes',
    });
  });

  it('gives up on a target that is not a web page', async () => {
    answer = () =>
      new Response('{"title":"json"}', { headers: { 'content-type': 'application/json' } });

    assert.deepEqual(await fetchReplyContext(TARGET, { lookup }), {
      ok: false,
      reason: 'not an HTML page',
    });
  });

  it('gives up on a page it can read nothing from', async () => {
    answer = () => html('<p>nothing to name</p>');

    assert.deepEqual(await fetchReplyContext(TARGET, { lookup }), {
      ok: false,
      reason: 'nothing to show',
    });
  });

  it('refuses anything but http and https', async () => {
    const fetched = await fetchReplyContext('ftp://them.example/file', { lookup });

    assert.deepEqual(fetched, { ok: false, reason: 'not an http or https URL' });
    assert.deepEqual(requested, []);
  });

  it('refuses a private address written out, without fetching', async () => {
    for (const target of [
      'http://127.0.0.1/',
      'http://localhost:3000/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
    ]) {
      assert.deepEqual(await fetchReplyContext(target, { lookup }), {
        ok: false,
        reason: 'not a public address',
      });
    }
    assert.deepEqual(requested, []);
  });

  it('refuses a name that resolves to a private address, without fetching', async () => {
    for (const target of ['https://inside.example/', 'https://sneaky.example/']) {
      assert.deepEqual(await fetchReplyContext(target, { lookup }), {
        ok: false,
        reason: 'not a public address',
      });
    }
    assert.deepEqual(requested, []);
  });

  it('refuses a redirect to a private address, and does not follow it', async () => {
    answer = (request) =>
      request.url === TARGET
        ? new Response(null, { status: 302, headers: { location: 'http://10.1.2.3/admin' } })
        : html(H_ENTRY);

    assert.deepEqual(await fetchReplyContext(TARGET, { lookup }), {
      ok: false,
      reason: 'not a public address',
    });
    assert.deepEqual(requested, [TARGET]);
  });

  it('follows a redirect to a public page and reads it', async () => {
    const moved = 'https://plain.example/new-home';
    answer = (request) =>
      request.url === TARGET
        ? new Response(null, { status: 301, headers: { location: moved } })
        : html('<title>New home</title>');

    const fetched = await fetchReplyContext(TARGET, { lookup });

    assert.deepEqual(fetched, { ok: true, context: { url: TARGET, name: 'New home' } });
    assert.deepEqual(requested, [TARGET, moved]);
  });
});

describe('the address guard', () => {
  it('knows the spellings of this network', () => {
    for (const host of [
      'localhost',
      'foo.localhost',
      'printer.local',
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.0.1',
      '169.254.1.1',
      '100.64.0.1',
      '0.0.0.0',
      '[::1]',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      assert.equal(isPrivateHost(host), true, host);
    }
    for (const host of ['them.example', '203.0.113.10', '8.8.8.8', '2001:db8::1']) {
      assert.equal(isPrivateHost(host), false, host);
    }
  });

  it('is public only when every address a name resolves to is', async () => {
    assert.equal(await publicHost('them.example', lookup), true);
    assert.equal(await publicHost('inside.example', lookup), false);
    assert.equal(await publicHost('sneaky.example', lookup), false);
    assert.equal(await publicHost('nowhere.example', lookup), false);
  });
});
