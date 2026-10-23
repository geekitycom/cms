import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import sharp from 'sharp';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { RECHECK_MS } from '../maintenance.ts';
import { readGeminiCertificate } from './certificate.ts';
import { freePort, gemini, refuses } from './__testing__/client.ts';

const box = sandbox();
after(() => box.cleanup());

const NOW = Date.parse('2026-09-28T12:00:00Z');
let clock = NOW;

const POST = [
  '---',
  'title: Post one',
  "date: '2026-09-01T09:00:00Z'",
  'permalink: /2026/09/one/',
  'redirect_from:',
  '  - /old-one/',
  '---',
  '',
  'See [about](https://example.com/about/), [elsewhere](https://elsewhere.example/) and ![a photo](/uploads/2026/09/photo.png).',
  '',
].join('\n');

const FILES: Record<string, string> = {
  'posts/2026-09-01-one.md': POST,
  'pages/about.md':
    '---\ntitle: About\npermalink: /about/\n---\n\nWho writes this, about fields.\n',
  '_trash/posts/2026-09-04-gone.md':
    "---\ntitle: Gone\ndate: '2026-09-04T09:00:00Z'\npermalink: /2026/09/gone/\n---\n\nDeleted.\n",
  '_data/redirects.json': JSON.stringify([{ from: '/elsewhere/', to: '/about/', status: 302 }]),
};

async function site(
  settings: Record<string, unknown> = { gemini: true },
  config: GeekityConfig = {},
): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await box.dir('geekity-capsule-content-');
  const dataDir = await box.dir('geekity-capsule-data-');
  for (const [relative, contents] of Object.entries({
    ...FILES,
    '_data/site.json': JSON.stringify({ title: 'Field Notes', ...settings }),
  })) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const photo = path.join(contentDir, 'uploads', '2026', '09', 'photo.png');
  await mkdir(path.dirname(photo), { recursive: true });
  await writeFile(
    photo,
    await sharp({
      create: { width: 640, height: 320, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer(),
  );
  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://example.com',
    port: 0,
    geminiPort: 0,
    now: () => new Date(clock),
    ...config,
  });
  cms.app.get('/broken/*', () => {
    throw new Error('the store fell over');
  });
  return { cms, contentDir };
}

let cms: Cms;
let httpPort: number;
let geminiPort: number;
const logged: string[] = [];

before(async () => {
  ({ cms } = await site(
    { gemini: true },
    { accessLog: true, accessLogWriter: (line) => logged.push(line) },
  ));
  const served = await cms.serve();
  httpPort = served.port;
  assert.ok(served.geminiPort !== undefined, 'serve() started Gemini');
  geminiPort = served.geminiPort;
});

async function overHttp(pathname: string): Promise<Response> {
  return await fetch(`http://127.0.0.1:${String(httpPort)}${pathname}`, { redirect: 'manual' });
}

describe('turning the listener on and off (AC #1)', () => {
  it('serves the site certificate while Gemini is on', async () => {
    const answer = await gemini(geminiPort, '/');
    const certificate = await readGeminiCertificate(cms.config, 'example.com');
    assert.ok(certificate.ok);
    assert.equal(answer.fingerprint256, certificate.certificate.fingerprint256);
  });

  it('starts nothing while Gemini is off, and starts and stops with the setting', async (t) => {
    const port = await freePort();
    const { cms: off } = await site({}, { geminiPort: port });
    const served = await off.serve();
    assert.equal(served.geminiPort, undefined);
    assert.ok(await refuses(port));

    await off.settings.set('site', new Map([['gemini', true]]), 'admin');
    assert.equal((await gemini(port, '/')).status, 20, 'turning it on started the listener');

    t.mock.method(console, 'warn', () => undefined);
    await off.settings.set('site', new Map([['gemini', false]]), 'admin');
    assert.ok(await refuses(port), 'turning it off stopped it');

    await off.settings.set('site', new Map([['gemini', true]]), 'admin');
    assert.equal((await gemini(port, '/')).status, 20);
    await off.close();
    assert.ok(await refuses(port), 'close() closed it');
  });
});

describe('pages (AC #4)', () => {
  it('answers 20 text/gemini with the body HTTP serves at index.gmi', async () => {
    for (const [request, http] of [
      ['/', '/index.gmi'],
      ['', '/index.gmi'],
      ['/2026/09/one/', '/2026/09/one/index.gmi'],
      ['/2026/09/one/index.gmi', '/2026/09/one/index.gmi'],
      ['/about/', '/about/index.gmi'],
    ] as const) {
      const answer = await gemini(geminiPort, request);
      assert.equal(answer.status, 20, request);
      assert.equal(answer.meta, 'text/gemini; charset=utf-8', request);
      assert.equal(answer.body.toString(), await (await overHttp(http)).text(), request);
    }
  });

  it('links the site’s own pages root-relative and leaves the web’s alone', async () => {
    const body = (await gemini(geminiPort, '/2026/09/one/')).body.toString();
    const links = body
      .split('\n')
      .filter((line) => line.startsWith('=>'))
      .map((line) => line.split(' ')[1] ?? '');
    assert.ok(links.includes('/about/index.gmi'), links.join('\n'));
    assert.ok(links.includes('https://elsewhere.example/'), links.join('\n'));
    for (const link of links) {
      assert.ok(
        link.startsWith('/') || !link.includes('example.com/') || link.includes('elsewhere'),
        `${link} leaves the capsule for the site's web pages`,
      );
    }
    for (const link of links.filter((each) => each.startsWith('/'))) {
      const answer = await gemini(geminiPort, link);
      assert.equal(answer.status, 20, `${link} is served over Gemini`);
    }
  });
});

describe('statuses (AC #5)', () => {
  it('maps a permanent redirect to 31 and a temporary one to 30, within the capsule', async () => {
    assert.deepEqual(
      { ...(await gemini(geminiPort, '/old-one/')), body: undefined, fingerprint256: '' },
      {
        status: 31,
        meta: '/2026/09/one/index.gmi',
        body: undefined,
        closedCleanly: true,
        fingerprint256: '',
      },
    );
    const short = await gemini(geminiPort, '/about');
    assert.equal(short.status, 31);
    assert.equal(short.meta, '/about/');
    const temporary = await gemini(geminiPort, '/elsewhere/');
    assert.equal(temporary.status, 30);
    assert.equal(temporary.meta, '/about/');
  });

  it('maps 404 to 51, 410 to 52 and a server error to 40, with no body', async (t) => {
    t.mock.method(console, 'error', () => undefined);
    for (const [request, status] of [
      ['/nothing/', 51],
      ['/2026/09/gone/', 52],
      ['/broken/', 40],
    ] as const) {
      const answer = await gemini(geminiPort, request);
      assert.equal(answer.status, status, request);
      assert.equal(answer.body.length, 0, request);
    }
  });

  it('maps maintenance to 41 with its back-by time', async () => {
    const { cms: away } = await site();
    const { geminiPort: port } = await away.serve();
    assert.ok(port !== undefined);
    await away.settings.set(
      'maintenance',
      new Map<string, unknown>([
        ['on', true],
        ['until', '2026-09-28T15:00:00.000Z'],
      ]),
      'cli',
    );
    clock += RECHECK_MS + 1;
    const answer = await gemini(port, '/2026/09/one/');
    assert.equal(answer.status, 41);
    assert.match(answer.meta, /2026-09-28T15:00:00\.000Z/);
  });
});

describe('search (AC #6)', () => {
  it('asks for a query with 10 and answers the query sent back', async () => {
    for (const request of ['/search/', '/search/index.gmi']) {
      const asked = await gemini(geminiPort, request);
      assert.equal(asked.status, 10, request);
      assert.notEqual(asked.meta, '');
    }
    const answer = await gemini(geminiPort, '/search/?about%20fields');
    assert.equal(answer.status, 20);
    assert.equal(
      answer.body.toString(),
      await (await overHttp('/search/index.gmi?q=about%20fields')).text(),
    );
    assert.match(answer.body.toString(), /^=> \/about\/index\.gmi/m);
  });
});

describe('uploads (AC #7)', () => {
  it('serves an upload and an image variant with 20 and their media type', async () => {
    const original = await gemini(geminiPort, '/uploads/2026/09/photo.png');
    assert.equal(original.status, 20);
    assert.equal(original.meta, 'image/png');
    assert.deepEqual(
      original.body,
      Buffer.from(await (await overHttp('/uploads/2026/09/photo.png')).arrayBuffer()),
    );

    const variant = await gemini(geminiPort, '/uploads/_/2026/09/photo.png/320.webp');
    assert.equal(variant.status, 20);
    assert.equal(variant.meta, 'image/webp');
    assert.equal((await sharp(variant.body).metadata()).width, 320);
  });
});

describe('the access log (AC #8)', () => {
  it('records each Gemini request once, and not as the HTTP request it made', async () => {
    logged.length = 0;
    await gemini(geminiPort, '/about/');
    assert.deepEqual(
      logged.map((line) => line.replace(/ \d+\.\dms/, '')),
      ['GEMINI /about/ 20'],
    );
  });
});
