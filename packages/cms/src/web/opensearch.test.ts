/**
 * The OpenSearch description (TASK-204): `/opensearch.xml`, which a browser
 * reads to offer the site's own search from its address bar, and the
 * `<link rel="search">` in every page's head that points at it. Asserted over
 * HTTP against the packaged theme, the way a browser meets it.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { child, childrenNamed, parseXml } from './__testing__/xml.ts';
import type { XmlElement } from './__testing__/xml.ts';

const box = sandbox();
after(() => box.cleanup());

const AVATAR = '/uploads/2026/09/avatar.png';
const OPENSEARCH_NS = 'http://a9.com/-/spec/opensearch/1.1/';

interface Site {
  cms: Cms;
  contentDir: string;
}

/** A site with `site.json` saying `settings`, one post, one page and these uploads. */
async function site(
  settings: Record<string, unknown>,
  uploads: Record<string, Buffer> = {},
  config: GeekityConfig = {},
): Promise<Site> {
  const contentDir = await box.dir('geekity-opensearch-content-');
  const dataDir = await box.dir('geekity-opensearch-data-');

  const files: Record<string, Buffer | string> = {
    '_data/site.json': JSON.stringify(settings),
    'posts/hello.md':
      "---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/hello/\ntags: [words]\n---\n\nBody.\n",
    'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout.\n',
  };
  for (const [at, contents] of Object.entries(uploads)) files[at.slice(1)] = contents;

  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }

  return { cms: await box.open({ contentDir, dataDir, ...config }), contentDir };
}

async function png(size: number): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 179, g: 57, b: 0 } },
  })
    .png()
    .toBuffer();
}

/** The description document, parsed, after checking how it is served. */
async function description(cms: Cms): Promise<XmlElement> {
  const response = await cms.app.request('/opensearch.xml');
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'application/opensearchdescription+xml; charset=utf-8',
  );
  const root = parseXml(await response.text());
  assert.equal(root.name, 'OpenSearchDescription');
  assert.equal(root.attributes['xmlns'], OPENSEARCH_NS);
  return root;
}

/** The `type="text/html"` search URL template. */
function htmlTemplate(root: XmlElement): string | undefined {
  return childrenNamed(root, 'Url').find((url) => url.attributes['type'] === 'text/html')
    ?.attributes['template'];
}

/** The `<link rel="search">` tags in the head of the page at `pathname`. */
async function searchLinks(cms: Cms, pathname: string): Promise<string[]> {
  const html = await (await cms.app.request(pathname)).text();
  const head = html.slice(0, html.indexOf('</head>'));
  return [...head.matchAll(/<link rel="search"[^>]*>/g)].map((match) => match[0]);
}

describe('/opensearch.xml (TASK-204 AC #1)', () => {
  it('names the site, describes it, shows its favicon and searches /search/', async () => {
    const { cms } = await site(
      { title: 'Words', tagline: 'Notes & essays', avatar: AVATAR },
      { [AVATAR]: await png(240) },
      { baseUrl: 'https://blog.example' },
    );
    const root = await description(cms);

    assert.equal(child(root, 'ShortName').text, 'Words');
    assert.equal(child(root, 'Description').text, 'Notes & essays');
    assert.equal(child(root, 'InputEncoding').text, 'UTF-8');

    const image = child(root, 'Image');
    assert.equal(image.text, 'https://blog.example/favicon.ico');
    assert.deepEqual(
      { width: image.attributes['width'], height: image.attributes['height'] },
      { width: '16', height: '16' },
    );
    assert.equal(image.attributes['type'], 'image/x-icon');
    assert.equal((await cms.app.request('/favicon.ico')).status, 200, 'the Image is served');

    assert.equal(htmlTemplate(root), 'https://blog.example/search/?q={searchTerms}');
    const self = childrenNamed(root, 'Url').find((url) => url.attributes['rel'] === 'self');
    assert.equal(self?.attributes['template'], 'https://blog.example/opensearch.xml');
  });

  it('runs a search at the template it publishes', async () => {
    const { cms } = await site({ title: 'Words' }, {}, { baseUrl: 'https://blog.example' });
    const template = htmlTemplate(await description(cms)) ?? '';
    const response = await cms.app.request(
      new URL(template.replace('{searchTerms}', 'hello')).pathname + '?q=hello',
    );
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('/2026/09/hello/'), 'the post is found');
  });

  it('cuts a long title to the 16 characters ShortName allows', async () => {
    const { cms } = await site({ title: 'A Site of Many Many Words' });
    const shortName = child(await description(cms), 'ShortName').text;
    assert.ok(shortName.length <= 16, `"${shortName}" is longer than 16`);
    assert.equal(shortName, 'A Site of Many M');
  });

  it('describes a site with no tagline by its title, and shows no Image without an icon', async () => {
    const { cms } = await site({ title: 'Words' });
    const root = await description(cms);
    assert.equal(child(root, 'Description').text, 'Words');
    assert.deepEqual(childrenNamed(root, 'Image'), []);
  });

  it('answers a repeat request with 304', async () => {
    const { cms } = await site({ title: 'Words' });
    const etag = (await cms.app.request('/opensearch.xml')).headers.get('etag');
    assert.ok(etag !== null, 'the document carries no validator');
    const again = await cms.app.request('/opensearch.xml', { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304);
  });
});

describe('the search link (TASK-204 AC #2)', () => {
  it('is in the head of every kind of public page', async () => {
    const { cms } = await site({ title: 'Words' });
    for (const pathname of [
      '/',
      '/2026/09/hello/',
      '/about/',
      '/tag/words/',
      '/search/?q=hello',
      '/no-such-page/',
    ]) {
      assert.deepEqual(
        await searchLinks(cms, pathname),
        [
          '<link rel="search" type="application/opensearchdescription+xml" title="Words" href="/opensearch.xml">',
        ],
        pathname,
      );
    }
  });
});

describe('settings and the base path (TASK-204 AC #3)', () => {
  it('follows a changed title and tagline on the next request, without a restart', async () => {
    const { cms, contentDir } = await site({ title: 'Words', tagline: 'Before' });
    assert.equal(child(await description(cms), 'ShortName').text, 'Words');

    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ title: 'Other', tagline: 'After' }),
    );
    const root = await description(cms);
    assert.equal(child(root, 'ShortName').text, 'Other');
    assert.equal(child(root, 'Description').text, 'After');
    assert.deepEqual(await searchLinks(cms, '/'), [
      '<link rel="search" type="application/opensearchdescription+xml" title="Other" href="/opensearch.xml">',
    ]);
  });

  it('carries the base path of a site served from a subdirectory', async () => {
    const { cms } = await site(
      { title: 'Words', avatar: AVATAR },
      {},
      { baseUrl: 'https://example.com/blog' },
    );
    const root = await description(cms);
    assert.equal(htmlTemplate(root), 'https://example.com/blog/search/?q={searchTerms}');
    assert.equal(child(root, 'Image').text, 'https://example.com/blog/favicon.ico');
    const self = childrenNamed(root, 'Url').find((url) => url.attributes['rel'] === 'self');
    assert.equal(self?.attributes['template'], 'https://example.com/blog/opensearch.xml');
    assert.deepEqual(await searchLinks(cms, '/'), [
      '<link rel="search" type="application/opensearchdescription+xml" title="Words" href="/blog/opensearch.xml">',
    ]);
  });
});
