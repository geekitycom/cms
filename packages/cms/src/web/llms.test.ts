import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';

/**
 * `/llms.txt` (TASK-149): an index of the site for language models, in the
 * llmstxt.org shape, every entry linked to the Markdown the site already
 * serves.
 */

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const BASE = 'https://example.com';

interface SiteOptions {
  siteJson?: Record<string, unknown>;
  /** A file of the site's own at `content/llms.txt`. */
  ownFile?: string;
}

/**
 * A synced CMS with two pages, three published posts, a draft and a post
 * whose date has not come.
 */
async function site(options: SiteOptions = {}): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-llms-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-llms-data-'));
  temporaryDirs.push(contentDir, dataDir);

  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'Field Notes', tagline: 'Notes from the field.', ...options.siteJson }),
    'utf8',
  );
  await mkdir(path.join(contentDir, 'pages'), { recursive: true });
  await writeFile(
    path.join(contentDir, 'pages', 'about.md'),
    `---\ntitle: About\npermalink: /about/\ndescription: Who writes this.\n---\n\nAbout.\n`,
    'utf8',
  );
  await writeFile(
    path.join(contentDir, 'pages', 'colophon.md'),
    `---\ntitle: Colophon\npermalink: /colophon/\n---\n\nHow it is made.\n`,
    'utf8',
  );
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  const posts: [slug: string, front: string][] = [
    ['first', `title: First post\ndate: '2026-01-01T09:00:00Z'`],
    ['second', `title: Second [post]\ndate: '2026-02-01T09:00:00Z'\ndescription: "Two\n  lines."`],
    ['third', `title: Third post\ndate: '2026-03-01T09:00:00Z'`],
    ['secret', `title: Secret draft\ndate: '2026-03-02T09:00:00Z'\ndraft: true`],
    ['later', `title: From the future\ndate: '2999-01-01T09:00:00Z'`],
  ];
  for (const [slug, front] of posts) {
    await writeFile(
      path.join(contentDir, 'posts', `${slug}.md`),
      `---\n${front}\npermalink: /${slug}/\n---\n\nBody of ${slug}.\n`,
      'utf8',
    );
  }
  if (options.ownFile !== undefined) {
    await writeFile(path.join(contentDir, 'llms.txt'), options.ownFile, 'utf8');
  }

  const cms = createCms({ contentDir, dataDir, watch: false, baseUrl: BASE });
  started.push(cms);
  await cms.sync();
  return { cms, contentDir };
}

/** The served file, after checking it is served as Markdown. */
async function llms(cms: Cms): Promise<string> {
  const response = await cms.app.request('/llms.txt');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8');
  return response.text();
}

/** Every `[label](url)` link in a Markdown body, in order. */
function links(body: string): { label: string; url: string }[] {
  return [...body.matchAll(/^- \[((?:\\.|[^\]])*)\]\(([^)]+)\)/gm)].map((match) => ({
    label: match[1] ?? '',
    url: match[2] ?? '',
  }));
}

const DESCRIBEDBY = '</llms.txt>; rel="describedby"; type="text/markdown"';
const LINK_ELEMENT = /<link rel="describedby" type="text\/markdown" href="\/llms\.txt">/;

describe('what /llms.txt lists (AC #1)', () => {
  it('opens with the site title and its description', async () => {
    const { cms } = await site();
    const body = await llms(cms);
    assert.match(body, /^# Field Notes\n\n> Notes from the field\.\n/);
  });

  it('lists the pages and the recent posts, newest first, each linked to its .md URL', async () => {
    const { cms } = await site();
    const body = await llms(cms);

    const pages = body.slice(body.indexOf('## Pages'), body.indexOf('## Recent posts'));
    const posts = body.slice(body.indexOf('## Recent posts'));
    assert.deepEqual(links(pages), [
      { label: 'About', url: `${BASE}/about/index.md` },
      { label: 'Colophon', url: `${BASE}/colophon/index.md` },
    ]);
    assert.deepEqual(links(posts), [
      { label: 'Third post', url: `${BASE}/third/index.md` },
      { label: 'Second \\[post\\]', url: `${BASE}/second/index.md` },
      { label: 'First post', url: `${BASE}/first/index.md` },
    ]);
    assert.match(body, /^- \[About\]\(\S+\): Who writes this\.$/m, 'a description follows');
    assert.match(body, /^- \[Second \\\[post\\\]\]\(\S+\): Two lines\.$/m, 'on one line');
    assert.doesNotMatch(body, /Secret draft|From the future/, 'nothing unpublished');
  });

  it('links only URLs that serve that document as Markdown', async () => {
    const { cms } = await site();
    for (const { url } of links(await llms(cms))) {
      const response = await cms.app.request(new URL(url).pathname);
      assert.equal(response.status, 200, url);
      assert.match(response.headers.get('content-type') ?? '', /^text\/markdown/, url);
    }
  });

  it('lists as many recent posts as the feeds carry', async () => {
    const { cms } = await site({ siteJson: { feedSize: 2 } });
    const body = await llms(cms);
    const posts = links(body.slice(body.indexOf('## Recent posts')));
    assert.deepEqual(
      posts.map((link) => link.label),
      ['Third post', 'Second \\[post\\]'],
    );
  });

  it('links a static homepage at the front page’s own Markdown URL', async () => {
    const { cms } = await site({ siteJson: { homepage: 'about' } });
    const body = await llms(cms);
    assert.match(body, /^- \[About\]\(https:\/\/example\.com\/index\.md\)/m);
    const response = await cms.app.request('/index.md');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /About\./);
  });
});

describe('how the home page advertises it (AC #2)', () => {
  it('in a Link header and a link element on the latest-posts home page', async () => {
    const { cms } = await site();
    const response = await cms.app.request('/');
    assert.ok(response.headers.get('link')?.includes(DESCRIBEDBY), 'the Link header names it');
    assert.match(await response.text(), LINK_ELEMENT);
  });

  it('in both on a static homepage too', async () => {
    const { cms } = await site({ siteJson: { homepage: 'about' } });
    const response = await cms.app.request('/');
    assert.ok(response.headers.get('link')?.includes(DESCRIBEDBY));
    assert.match(await response.text(), LINK_ELEMENT);
  });

  it('nowhere but the home page', async () => {
    const { cms } = await site();
    const response = await cms.app.request('/third/');
    assert.equal(response.headers.get('link')?.includes('describedby'), false);
    assert.doesNotMatch(await response.text(), /rel="describedby"/);
  });
});

describe('validators (AC #3)', () => {
  it('carries an ETag, a Last-Modified and no-cache, and answers a match with a 304', async () => {
    const { cms } = await site();
    const response = await cms.app.request('/llms.txt');
    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');
    assert.ok(etag !== null);
    assert.equal(lastModified, new Date('2026-03-01T09:00:00Z').toUTCString(), 'the newest entry');
    assert.equal(response.headers.get('cache-control'), 'no-cache');

    const byEtag = await cms.app.request('/llms.txt', { headers: { 'if-none-match': etag } });
    assert.equal(byEtag.status, 304);
    assert.equal(byEtag.headers.get('etag'), etag, 'the 304 keeps its validator');
    assert.equal(await byEtag.text(), '');

    const byDate = await cms.app.request('/llms.txt', {
      headers: { 'if-modified-since': lastModified ?? '' },
    });
    assert.equal(byDate.status, 304);
  });

  it('changes its ETag when what it says changes', async () => {
    const one = await (await site()).cms.app.request('/llms.txt');
    const two = await (
      await site({ siteJson: { tagline: 'Different words.' } })
    ).cms.app.request('/llms.txt');
    assert.notEqual(one.headers.get('etag'), two.headers.get('etag'));
  });
});

describe('a site that turns it off or writes its own (AC #4)', () => {
  it('is a 404, advertised nowhere, when the setting is off', async () => {
    const { cms } = await site({ siteJson: { llmsTxt: false } });
    assert.equal((await cms.app.request('/llms.txt')).status, 404);

    const home = await cms.app.request('/');
    assert.equal(home.headers.get('link')?.includes('describedby') ?? false, false);
    assert.doesNotMatch(await home.text(), /rel="describedby"/);
  });

  it('serves content/llms.txt as it is written, validated and advertised', async () => {
    const own = '# My own index\n\n> Written by hand.\n';
    const { cms } = await site({ ownFile: own });
    assert.equal(await llms(cms), own);

    const response = await cms.app.request('/llms.txt');
    const etag = response.headers.get('etag');
    assert.ok(etag !== null);
    assert.ok(response.headers.get('last-modified') !== null, 'dated by the file');
    const again = await cms.app.request('/llms.txt', { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304);

    assert.ok((await cms.app.request('/')).headers.get('link')?.includes(DESCRIBEDBY));
  });

  it('serves nothing, not even the site’s own file, when the setting is off', async () => {
    const { cms } = await site({ siteJson: { llmsTxt: false }, ownFile: '# Mine\n' });
    assert.equal((await cms.app.request('/llms.txt')).status, 404);
  });
});

describe('the home page as Markdown (TASK-289)', () => {
  async function home(cms: Cms, accept: string): Promise<Response> {
    return cms.app.request('/', { headers: { accept } });
  }

  it('is the generated file, byte for byte', async () => {
    const { cms } = await site();

    const response = await home(cms, 'text/markdown');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.equal(await response.text(), await llms(cms));
  });

  it('is the site’s own file when it has one', async () => {
    const own = '# My own index\n\n> Written by hand.\n';
    const { cms } = await site({ ownFile: own });

    assert.equal(await (await home(cms, 'text/markdown')).text(), own);
  });

  it('is the file even with the setting off, which only takes /llms.txt away', async () => {
    const generated = await llms((await site()).cms);
    const off = (await site({ siteJson: { llmsTxt: false } })).cms;
    assert.equal(await (await home(off, 'text/markdown')).text(), generated);

    const own = '# Mine\n';
    const ownOff = (await site({ siteJson: { llmsTxt: false }, ownFile: own })).cms;
    assert.equal(await (await home(ownOff, 'text/markdown')).text(), own);
  });

  it('answers text/plain with the same body under that label', async () => {
    const { cms } = await site();

    const response = await home(cms, 'text/plain');

    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(await response.text(), await llms(cms));
  });

  it('is validated by its bytes and dated by the file', async () => {
    const { cms } = await site({ ownFile: '# Mine\n' });

    const response = await home(cms, 'text/markdown');
    const etag = response.headers.get('etag') ?? '';
    assert.match(etag, /^"[0-9a-f]{32}"$/);
    assert.ok(response.headers.get('last-modified') !== null, 'dated by the file');

    const again = await cms.app.request('/', {
      headers: { accept: 'text/markdown', 'if-none-match': etag },
    });
    assert.equal(again.status, 304);
  });

  it('is at /index.md too', async () => {
    const { cms } = await site();

    const response = await cms.app.request('/index.md');

    assert.equal(response.status, 200);
    assert.equal(await response.text(), await llms(cms));
  });
});
