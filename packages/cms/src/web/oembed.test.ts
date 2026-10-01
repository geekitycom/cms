/**
 * The oEmbed provider (TASK-205): `/_geekity/oembed?url=…`, which WordPress,
 * Discourse and the rest ask to turn a pasted post URL into a card, and the
 * `<link rel="alternate" type="application/json+oembed">` on every post and
 * page that tells them where it is. Asserted over HTTP against the packaged
 * theme, the way a consumer meets it.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import { createUser, setUserProfile } from '../admin/accounts.ts';
import { sandbox } from '../admin/__testing__/harness.ts';
import { generateImageVariants } from '../images/variants.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { child, parseXml } from './__testing__/xml.ts';

const box = sandbox();
after(() => box.cleanup());

const NOW = '2026-09-20T12:00:00Z';
const HERO = '/uploads/2026/09/hero.png';

const CONTENT: Record<string, string> = {
  'posts/hello.md': [
    '---',
    'title: Fish & <b>chips</b> "to go"',
    "date: '2026-09-02T09:00:00Z'",
    'permalink: /2026/09/hello/',
    'author: ada',
    "description: <script>alert('x')</script> & more",
    '---',
    '',
    'Body.',
    '',
  ].join('\n'),
  'posts/photo.md':
    "---\ntitle: A photo\ndate: '2026-09-03T09:00:00Z'\npermalink: /2026/09/photo/\nimage: /uploads/2026/09/hero.png\n---\n\nLook at it.\n",
  'posts/note.md':
    "---\ntitle: ''\ndate: '2026-09-04T09:00:00Z'\npermalink: /2026/09/note/\n---\n\nJust a short thought about embeds.\n",
  'posts/draft.md':
    "---\ntitle: Secret\ndate: '2026-09-05T09:00:00Z'\npermalink: /2026/09/secret/\ndraft: true\n---\n\nNot yet.\n",
  'posts/later.md':
    "---\ntitle: Tomorrow\ndate: '2026-12-01T09:00:00Z'\npermalink: /2026/12/later/\n---\n\nNot yet either.\n",
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout us.\n',
  'pages/home.md': '---\ntitle: Welcome\npermalink: /welcome/\n---\n\nHello there.\n',
  'pages/blog.md': '---\ntitle: Blog\npermalink: /blog/\n---\n\nThe posts.\n',
};

interface Embed {
  [field: string]: unknown;
}

/** A site with the posts above, Ada as a user, and `site.json` saying `settings`. */
async function site(
  settings: Record<string, unknown> = {},
  config: GeekityConfig = {},
): Promise<Cms> {
  const contentDir = await box.dir('geekity-oembed-content-');
  const dataDir = await box.dir('geekity-oembed-data-');

  const files = {
    ...CONTENT,
    '_data/site.json': JSON.stringify({ title: 'Words & Things', author: 'ada', ...settings }),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }

  const user = await createUser({ dataDir, username: 'ada', password: 'a password of hers' });
  await setUserProfile({ dataDir, userId: user.id, profile: { displayName: 'Ada Lovelace' } });

  return box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://blog.example',
    now: () => new Date(NOW),
    ...config,
  });
}

/** Write an image of one size to an upload path, and derive its variants. */
async function upload(cms: Cms, at: string, width: number, height: number): Promise<void> {
  const file = path.join(cms.config.contentDir, ...at.slice(1).split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    await sharp({ create: { width, height, channels: 3, background: { r: 40, g: 80, b: 120 } } })
      .png()
      .toBuffer(),
  );
  await generateImageVariants(cms.config, at.slice('/uploads/'.length));
}

function endpoint(url: string, extra: Record<string, string> = {}): string {
  return `/_geekity/oembed?${new URLSearchParams({ url, ...extra }).toString()}`;
}

/** The JSON embed for `url`, after checking it is served as one. */
async function embed(cms: Cms, url: string, extra: Record<string, string> = {}): Promise<Embed> {
  const response = await cms.app.request(endpoint(url, extra));
  assert.equal(response.status, 200, url);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  return (await response.json()) as Embed;
}

/** The oEmbed discovery links in the head of the page at `pathname`. */
async function discoveryLinks(cms: Cms, pathname: string): Promise<Record<string, string>> {
  const html = await (await cms.app.request(pathname)).text();
  const head = html.slice(0, html.indexOf('</head>'));
  const links: Record<string, string> = {};
  for (const match of head.matchAll(
    /<link rel="alternate" type="((?:application\/json|text\/xml)\+oembed)" href="([^"]*)"/g,
  )) {
    links[match[1] ?? ''] = (match[2] ?? '').replaceAll('&amp;', '&');
  }
  return links;
}

describe('the discovery link (TASK-205 AC #1)', () => {
  it('is on each post and page, and names that page to the endpoint', async () => {
    const cms = await site();
    for (const pathname of ['/2026/09/hello/', '/2026/09/note/', '/about/']) {
      const links = await discoveryLinks(cms, pathname);
      const json = links['application/json+oembed'];
      assert.ok(json !== undefined, `${pathname} links no JSON oEmbed`);
      const href = new URL(json);
      assert.equal(href.origin, 'https://blog.example');
      assert.equal(href.pathname, '/_geekity/oembed');
      assert.equal(href.searchParams.get('url'), `https://blog.example${pathname}`);
      assert.equal(href.searchParams.get('format'), 'json');

      const fetched = await cms.app.request(`${href.pathname}${href.search}`);
      assert.equal(fetched.status, 200, `${pathname}: the advertised endpoint does not answer`);

      const xml = links['text/xml+oembed'];
      assert.ok(xml !== undefined, `${pathname} links no XML oEmbed`);
      assert.equal(new URL(xml).searchParams.get('format'), 'xml');
    }
  });

  it('is not on a listing, the search page or the 404', async () => {
    const cms = await site();
    for (const pathname of ['/', '/page/2/', '/search/?q=fish', '/no-such-page/']) {
      assert.deepEqual(await discoveryLinks(cms, pathname), {}, pathname);
    }
  });

  it('carries the base path of a site served from a subdirectory', async () => {
    const cms = await site({}, { baseUrl: 'https://example.com/blog' });
    const json = (await discoveryLinks(cms, '/2026/09/hello/'))['application/json+oembed'];
    assert.ok(json !== undefined);
    const href = new URL(json);
    assert.equal(href.pathname, '/blog/_geekity/oembed');
    assert.equal(href.searchParams.get('url'), 'https://example.com/blog/2026/09/hello/');
  });
});

describe('the endpoint (TASK-205 AC #2)', () => {
  it('answers a post as a rich embed with its title, author and provider', async () => {
    const cms = await site();
    const answer = await embed(cms, 'https://blog.example/2026/09/hello/');

    assert.equal(answer['version'], '1.0');
    assert.equal(answer['type'], 'rich');
    assert.equal(answer['title'], 'Fish & <b>chips</b> "to go"');
    assert.equal(answer['author_name'], 'Ada Lovelace');
    assert.equal(answer['author_url'], 'https://blog.example/author/ada/');
    assert.equal(answer['provider_name'], 'Words & Things');
    assert.equal(answer['provider_url'], 'https://blog.example/');
    assert.equal(typeof answer['html'], 'string');
    assert.equal(answer['width'], 600);
    assert.ok(typeof answer['height'] === 'number' && answer['height'] > 0);
    assert.equal(answer['thumbnail_url'], undefined, 'a post with no image has no thumbnail');
  });

  it('gives a page the site author, and a note its first words for a title', async () => {
    const cms = await site();
    const about = await embed(cms, 'https://blog.example/about/');
    assert.equal(about['title'], 'About');
    assert.equal(about['author_name'], 'Ada Lovelace');

    const note = await embed(cms, 'https://blog.example/2026/09/note/');
    assert.equal(note['title'], 'Just a short thought about embeds.');
  });

  it('gives a post with an image its thumbnail, with the size the spec requires', async () => {
    const cms = await site();
    await upload(cms, HERO, 1600, 900);
    const answer = await embed(cms, 'https://blog.example/2026/09/photo/');

    assert.equal(answer['thumbnail_url'], `https://blog.example${HERO}`);
    assert.equal(answer['thumbnail_width'], 1600);
    assert.equal(answer['thumbnail_height'], 900);
    const thumbnail = await cms.app.request(HERO);
    assert.equal(thumbnail.status, 200, 'the thumbnail is served');
  });

  it('honours maxwidth and maxheight, dropping a thumbnail that would break them', async () => {
    const cms = await site();
    await upload(cms, HERO, 1600, 900);
    const answer = await embed(cms, 'https://blog.example/2026/09/photo/', {
      maxwidth: '400',
      maxheight: '200',
    });

    assert.ok(Number(answer['width']) <= 400, `width ${String(answer['width'])}`);
    assert.ok(Number(answer['height']) <= 200, `height ${String(answer['height'])}`);
    assert.equal(answer['thumbnail_url'], undefined);
    assert.equal(answer['thumbnail_width'], undefined);
  });

  it('answers the same embed as XML when asked', async () => {
    const cms = await site();
    const response = await cms.app.request(
      endpoint('https://blog.example/2026/09/hello/', { format: 'xml' }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/xml; charset=utf-8');
    const root = parseXml(await response.text());
    assert.equal(root.name, 'oembed');
    assert.equal(child(root, 'type').text, 'rich');
    assert.equal(child(root, 'title').text, 'Fish & <b>chips</b> "to go"');
    assert.equal(child(root, 'provider_name').text, 'Words & Things');
    assert.ok(child(root, 'html').text.startsWith('<blockquote'));
  });

  it('refuses a format it does not serve with 501', async () => {
    const cms = await site();
    const response = await cms.app.request(
      endpoint('https://blog.example/2026/09/hello/', { format: 'yaml' }),
    );
    assert.equal(response.status, 501);
  });

  it('answers a repeat request with 304', async () => {
    const cms = await site();
    const at = endpoint('https://blog.example/2026/09/hello/');
    const etag = (await cms.app.request(at)).headers.get('etag');
    assert.ok(etag !== null, 'the embed carries no validator');
    const again = await cms.app.request(at, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304);
  });
});

describe('the card (TASK-205 AC #3)', () => {
  it('is a static blockquote with no script, linking back, everything escaped', async () => {
    const cms = await site();
    const html = String((await embed(cms, 'https://blog.example/2026/09/hello/'))['html']);

    assert.match(html, /^<blockquote[^>]*>[\s\S]*<\/blockquote>$/);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<b>/, 'the title went out as markup');
    assert.doesNotMatch(html, /\son\w+=/i, 'an event handler');
    assert.ok(html.includes('Fish &amp; &lt;b&gt;chips&lt;/b&gt; &quot;to go&quot;'), html);
    assert.ok(html.includes('&lt;script&gt;'), 'the excerpt is shown, escaped');
    assert.ok(html.includes('href="https://blog.example/2026/09/hello/"'), 'no link back');
    assert.ok(html.includes('Ada Lovelace'), 'no author');
    assert.ok(html.includes('href="https://blog.example/author/ada/"'), 'no author link');
    assert.ok(html.includes('datetime="2026-09-02T09:00:00.000Z"'), 'no date');
    assert.ok(html.includes('Words &amp; Things'), 'no site name');
  });
});

describe('what may be embedded (TASK-205 AC #4)', () => {
  it('answers 404 for anything that is not a published post or page', async () => {
    const cms = await site();
    for (const url of [
      'https://blog.example/no-such-post/',
      'https://blog.example/2026/09/secret/',
      'https://blog.example/2026/12/later/',
      'https://elsewhere.example/2026/09/hello/',
      'https://blog.example/2026/09/hello/?p=1',
      'https://blog.example/tag/words/',
      'not a url',
      '',
    ]) {
      const response = await cms.app.request(endpoint(url));
      assert.equal(response.status, 404, url);
      const body = await response.text();
      assert.ok(!body.includes('Secret') && !body.includes('Tomorrow'), url);
    }
    assert.equal((await cms.app.request('/_geekity/oembed')).status, 404, 'no url at all');
  });

  it('never advertises a draft', async () => {
    const cms = await site();
    const links = await discoveryLinks(cms, '/2026/09/secret/');
    assert.deepEqual(links, {});
  });

  it('resolves a URL under the base path, and nothing outside it', async () => {
    const cms = await site({}, { baseUrl: 'https://example.com/blog' });
    const answer = await embed(cms, 'https://example.com/blog/2026/09/hello/');
    assert.equal(answer['provider_url'], 'https://example.com/blog/');
    assert.equal(answer['author_url'], 'https://example.com/blog/author/ada/');
    assert.ok(String(answer['html']).includes('href="https://example.com/blog/2026/09/hello/"'));

    const outside = await cms.app.request(endpoint('https://example.com/2026/09/hello/'));
    assert.equal(outside.status, 404);
  });

  it('embeds a static homepage at / and not the posts page that is a listing', async () => {
    const cms = await site({ homepage: 'welcome', postsPage: 'blog' });
    const home = await embed(cms, 'https://blog.example/');
    assert.equal(home['title'], 'Welcome');
    assert.ok(String(home['html']).includes('href="https://blog.example/"'));

    assert.equal((await cms.app.request(endpoint('https://blog.example/blog/'))).status, 404);
  });
});
