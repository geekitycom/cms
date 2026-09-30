/**
 * Compressed text responses (TASK-139): brotli when the client takes it, gzip
 * otherwise, nothing for what is already compressed or too small to gain, one
 * validator across every encoding, and a switch that turns it all off.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

import { browser, csrfField, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import { sessionCookieName } from '../admin/session.ts';
import type { GeekityConfig } from '../config.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const PARAGRAPH = 'A paragraph long enough that a page of them is worth compressing. ';
const LONG_BODY = `${PARAGRAPH.repeat(40)}\n`;

function post(day: number): string {
  const dd = String(day).padStart(2, '0');
  return `---\ntitle: Post ${dd}\ndate: '2026-09-${dd}T09:00:00Z'\npermalink: /2026/09/post-${dd}/\ntags: [compression]\n---\n\n${LONG_BODY}`;
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg">${'<circle r="1"/>'.repeat(200)}</svg>\n`;
const PNG = new Uint8Array(4096).fill(7);

async function site(config: GeekityConfig = {}): Promise<Cms> {
  const contentDir = await box.dir('geekity-compression-content-');
  const dataDir = await box.dir('geekity-compression-data-');
  const files: Record<string, string | Uint8Array> = {
    'uploads/2026/09/drawing.svg': SVG,
    'uploads/2026/09/photo.png': PNG,
    'uploads/2026/09/notes.txt': 'Short.\n',
    'uploads/2026/09/long.txt': LONG_BODY,
  };
  for (let day = 1; day <= 12; day += 1) {
    files[`posts/2026-09-${String(day).padStart(2, '0')}-post.md`] = post(day);
  }
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(contentDir, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  return box.open({ contentDir, dataDir, ...config });
}

async function get(
  cms: Cms,
  url: string,
  headers: Record<string, string> = {},
): Promise<{ response: Response; bytes: Uint8Array }> {
  const response = await cms.app.request(url, { headers });
  return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
}

function decode(response: Response, bytes: Uint8Array): string {
  const encoding = response.headers.get('content-encoding');
  if (encoding === 'br') return brotliDecompressSync(bytes).toString('utf8');
  if (encoding === 'gzip') return gunzipSync(bytes).toString('utf8');
  assert.equal(encoding, null, `unexpected encoding ${String(encoding)}`);
  return Buffer.from(bytes).toString('utf8');
}

function varies(response: Response): string[] {
  return (response.headers.get('vary') ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');
}

/** Every kind of text the site answers with, and what asks for each. */
const TEXT_RESPONSES: readonly { what: string; url: string; accept?: string; type: RegExp }[] = [
  { what: 'page', url: '/2026/09/post-01/', type: /^text\/html/ },
  { what: 'markdown', url: '/2026/09/post-01/', accept: 'text/markdown', type: /^text\/markdown/ },
  {
    what: 'json',
    url: '/2026/09/post-01/',
    accept: 'application/json',
    type: /^application\/json/,
  },
  { what: 'rss', url: '/feed/', type: /xml/ },
  { what: 'atom', url: '/feed/atom/', type: /atom\+xml/ },
  { what: 'json feed', url: '/feed/json/', type: /json/ },
  { what: 'sitemap', url: '/sitemap.xml', type: /xml/ },
  { what: 'css', url: '/theme/style.css', type: /^text\/css/ },
  { what: 'js', url: '/theme/highlight.js', type: /^text\/javascript/ },
  { what: 'svg', url: '/uploads/2026/09/drawing.svg', type: /^image\/svg\+xml/ },
  { what: 'text', url: '/uploads/2026/09/long.txt', type: /^text\/plain/ },
];

describe('compression', () => {
  it('sends every kind of text as brotli when the client accepts it', async () => {
    const cms = await site();
    for (const { what, url, accept, type } of TEXT_RESPONSES) {
      const plain = await get(cms, url, accept === undefined ? {} : { accept });
      const { response, bytes } = await get(cms, url, {
        'accept-encoding': 'gzip, deflate, br',
        ...(accept === undefined ? {} : { accept }),
      });
      assert.equal(response.status, 200, what);
      assert.match(response.headers.get('content-type') ?? '', type, what);
      assert.equal(response.headers.get('content-encoding'), 'br', what);
      assert.equal(response.headers.get('content-length'), String(bytes.byteLength), what);
      assert.ok(bytes.byteLength < plain.bytes.byteLength, `${what} is smaller`);
      assert.equal(decode(response, bytes), decode(plain.response, plain.bytes), what);
      assert.ok(varies(response).includes('accept-encoding'), `${what} varies`);
    }
  });

  it('falls back to gzip, and to nothing, by what the client accepts', async () => {
    const cms = await site();
    const plain = await get(cms, '/2026/09/post-01/');

    const gzip = await get(cms, '/2026/09/post-01/', { 'accept-encoding': 'gzip, deflate' });
    assert.equal(gzip.response.headers.get('content-encoding'), 'gzip');
    assert.equal(decode(gzip.response, gzip.bytes), decode(plain.response, plain.bytes));

    const refused = await get(cms, '/2026/09/post-01/', { 'accept-encoding': 'br;q=0, gzip' });
    assert.equal(refused.response.headers.get('content-encoding'), 'gzip');

    const identity = await get(cms, '/2026/09/post-01/', { 'accept-encoding': 'identity' });
    assert.equal(identity.response.headers.get('content-encoding'), null);
    assert.ok(varies(identity.response).includes('accept-encoding'), 'identity still varies');

    assert.equal(plain.response.headers.get('content-encoding'), null);
    assert.ok(varies(plain.response).includes('accept-encoding'), 'no header still varies');
    assert.ok(varies(plain.response).includes('accept'), 'the negotiated Vary survives');
  });

  it('never recompresses images and sends small text as it is', async () => {
    const cms = await site();
    const headers = { 'accept-encoding': 'br, gzip' };

    const image = await get(cms, '/uploads/2026/09/photo.png', headers);
    assert.equal(image.response.status, 200);
    assert.equal(image.response.headers.get('content-encoding'), null);
    assert.deepEqual(image.bytes, PNG);
    assert.equal(varies(image.response).includes('accept-encoding'), false);

    const small = await get(cms, '/uploads/2026/09/notes.txt', headers);
    assert.equal(small.response.status, 200);
    assert.equal(small.response.headers.get('content-encoding'), null);
    assert.equal(decode(small.response, small.bytes), 'Short.\n');
  });

  it('keeps one validator across encodings, and answers 304 to each', async () => {
    const cms = await site();
    for (const url of ['/2026/09/post-01/', '/feed/', '/sitemap.xml', '/theme/style.css']) {
      const plain = await get(cms, url);
      const br = await get(cms, url, { 'accept-encoding': 'br' });
      const gzip = await get(cms, url, { 'accept-encoding': 'gzip' });
      const strong = plain.response.headers.get('etag');
      assert.ok(strong !== null && !strong.startsWith('W/'), `${url} plain etag is strong`);
      // The encoded bytes differ from the plain ones, so their validator is
      // weak: the same representation, not the same octets.
      assert.equal(br.response.headers.get('etag'), `W/${strong}`, `${url} br`);
      assert.equal(gzip.response.headers.get('etag'), `W/${strong}`, `${url} gzip`);

      for (const [encoding, etag] of [
        ['br', `W/${strong}`],
        ['gzip', `W/${strong}`],
        ['identity', strong],
      ] as const) {
        const again = await get(cms, url, {
          'accept-encoding': encoding,
          'if-none-match': etag,
        });
        assert.equal(again.response.status, 304, `${url} ${encoding} revalidates`);
        assert.equal(again.response.headers.get('etag'), etag, `${url} ${encoding} etag`);
        assert.ok(varies(again.response).includes('accept-encoding'), `${url} 304 varies`);
      }
    }
  });

  it('answers a HEAD with the headers of the compressed GET', async () => {
    const cms = await site();
    const get200 = await get(cms, '/2026/09/post-01/', { 'accept-encoding': 'br' });
    const head = await cms.app.request('/2026/09/post-01/', {
      method: 'HEAD',
      headers: { 'accept-encoding': 'br' },
    });
    assert.equal(head.headers.get('content-encoding'), 'br');
    assert.equal(head.headers.get('content-length'), String(get200.bytes.byteLength));
  });

  it('never compresses a page that holds a secret, so BREACH has nothing to measure', async () => {
    const cms = await site();
    const br = { 'accept-encoding': 'br, gzip' };

    // The setup form is drawn for a stranger, carries a CSRF token, and says
    // nothing about caching: the admin path alone keeps it plain.
    const setup = await cms.app.request('/admin/setup', { headers: br });
    const setupVary = setup.headers.get('vary');
    const setupHtml = await setup.text();
    assert.equal(setup.status, 200);
    assert.ok(csrfField(setupHtml) !== undefined, 'the setup form carries a CSRF token');
    assert.equal(setup.headers.get('content-encoding'), null, 'admin setup is plain');
    const plainSetup = await browser(cms).get('/admin/setup');
    assert.equal(setupVary, plainSetup.headers.get('vary'), 'admin Vary is untouched');

    const agent = await signedIn(cms);
    const cookie = `${sessionCookieName(cms.config)}=${agent.session() ?? ''}`;
    const users = await cms.app.request('/admin/users', { headers: { ...br, cookie } });
    assert.equal(users.status, 200);
    assert.ok(csrfField(await users.text()) !== undefined, 'the users screen carries a CSRF token');
    assert.equal(users.headers.get('content-encoding'), null, 'signed-in admin is plain');

    // A public page drawn for somebody signed in is private, no-store.
    const mine = await cms.app.request('/2026/09/post-01/', { headers: { ...br, cookie } });
    assert.match(mine.headers.get('cache-control') ?? '', /private/);
    assert.equal(mine.headers.get('content-encoding'), null, 'a signed-in page is plain');
    assert.equal(varies(mine).includes('accept-encoding'), false, 'and its Vary is untouched');

    // The same page for a stranger, and the editor's own script, still shrink.
    const theirs = await cms.app.request('/2026/09/post-01/', { headers: br });
    assert.equal(theirs.headers.get('content-encoding'), 'br', 'an anonymous page is compressed');
    const script = await cms.app.request('/admin/_static/editor.js', { headers: br });
    assert.equal(script.status, 200);
    assert.equal(script.headers.get('content-encoding'), 'br', 'admin static files are compressed');
  });

  it('sends everything as it is when compression is off', async () => {
    const cms = await site({ compression: false });
    for (const { what, url, accept } of TEXT_RESPONSES) {
      const { response } = await get(cms, url, {
        'accept-encoding': 'br, gzip',
        ...(accept === undefined ? {} : { accept }),
      });
      assert.equal(response.status, 200, what);
      assert.equal(response.headers.get('content-encoding'), null, what);
      assert.equal(varies(response).includes('accept-encoding'), false, `${what} varies`);
      const etag = response.headers.get('etag');
      if (etag !== null) assert.equal(etag.startsWith('W/'), false, `${what} etag`);
    }
  });
});
