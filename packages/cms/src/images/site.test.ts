import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';
import type { Sharp } from 'sharp';

import { csrfField, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import type { Cms, GeekityConfig } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

/** A plain rectangle, as the bytes of a file of that format. */
function rectangle(width: number, height: number): Sharp {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } },
  });
}

/** A site, a signed-in browser and the CSRF token the forms carry. */
async function siteWithAdmin(
  config: GeekityConfig = {},
): Promise<{ cms: Cms; agent: Browser; token: string; contentDir: string }> {
  const contentDir = await box.dir('geekity-image-content-');
  const cms = await box.site({ contentDir, ...config });
  const agent = await signedIn(cms);
  const token = csrfField(await (await agent.get('/admin/media')).text());
  assert.ok(token !== undefined, 'the media screen carried a CSRF token');
  return { cms, agent, token, contentDir };
}

/** Upload one file through the editor's endpoint and answer its public URL. */
async function uploaded(
  agent: Browser,
  token: string,
  name: string,
  bytes: Buffer,
  type: string,
): Promise<string> {
  const response = await agent.upload('/admin/uploads', token, {
    name,
    type,
    bytes: new Uint8Array(bytes),
  });
  const body = (await response.json()) as { url?: string; error?: string };
  assert.equal(response.status, 201, body.error ?? 'upload was not created');
  assert.ok(body.url !== undefined);
  return body.url;
}

/** Write one post that embeds a URL, and put it in the index. */
async function postEmbedding(cms: Cms, contentDir: string, url: string): Promise<string> {
  const file = path.join(contentDir, 'posts', 'a-photo.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `---\ntitle: A photo\ndate: 2026-01-01T00:00:00Z\npermalink: /a-photo/\n---\n\n![A photo](${url})\n`,
    'utf8',
  );
  await cms.sync();
  return '/a-photo/';
}

/** The body of a GET, asserted to have arrived. */
async function fetched(cms: Cms, url: string): Promise<string> {
  const response = await cms.app.request(url);
  assert.equal(response.status, 200, `${url} answered ${String(response.status)}`);
  return response.text();
}

describe('image optimization end to end', () => {
  it('derives variants on upload and offers them in the page', async () => {
    const { cms, agent, token, contentDir } = await siteWithAdmin();
    const url = await uploaded(
      agent,
      token,
      'Photo.png',
      await rectangle(1000, 500).png().toBuffer(),
      'image/png',
    );
    const permalink = await postEmbedding(cms, contentDir, url);

    const html = await fetched(cms, permalink);

    assert.match(html, /<picture>/);
    assert.match(html, /<source type="image\/webp" srcset="[^"]*320\.webp\?v=[0-9a-f]{12} 320w/);
    assert.match(html, /<img src="\/uploads\/[^"]*\.png"/);
    assert.match(html, /width="1000" height="500" fetchpriority="high" decoding="async"/);
    assert.match(html, /alt="A photo"/);

    // Every URL the page offers is one the site actually serves.
    for (const [, href] of html.matchAll(/(\/uploads\/_\/[^\s",]+)/g)) {
      const response = await cms.app.request(href ?? '');
      assert.equal(response.status, 200, `${String(href)} answered ${String(response.status)}`);
    }

    const derived = await cms.app.request(`/uploads/_/${url.slice('/uploads/'.length)}/320.webp`);
    assert.equal(derived.headers.get('content-type'), 'image/webp');
    assert.equal((await sharp(Buffer.from(await derived.arrayBuffer())).metadata()).width, 320);
  });

  it('keeps the plain image in the feed, the JSON and the Markdown', async () => {
    const { cms, agent, token, contentDir } = await siteWithAdmin();
    const url = await uploaded(
      agent,
      token,
      'Photo.png',
      await rectangle(1000, 500).png().toBuffer(),
      'image/png',
    );
    const permalink = await postEmbedding(cms, contentDir, url);

    const feed = await fetched(cms, '/feed/');
    assert.match(feed, /<!\[CDATA\[<p><img src="\/uploads\/2[^"]*\.png" alt="A photo">/);
    assert.doesNotMatch(feed, /picture|srcset/);

    const json = await (
      await cms.app.request(permalink, { headers: { accept: 'application/json' } })
    ).json();
    assert.match((json as { html: string }).html, /<img src="\/uploads\/2/);
    assert.doesNotMatch((json as { html: string }).html, /<picture>/);

    const markdown = await (
      await cms.app.request(permalink, { headers: { accept: 'text/markdown' } })
    ).text();
    assert.match(markdown, /!\[A photo\]\(\/uploads\/2/);

    // A remote instance cannot resolve this site's derived files, so the
    // Article it fetches carries the original and nothing else (decision-10).
    const article = await (
      await cms.app.request(permalink, {
        headers: { accept: 'application/activity+json' },
      })
    ).json();
    const content = (article as { content: string }).content;
    assert.match(content, /<img src="\/uploads\/2/);
    assert.doesNotMatch(content, /<picture>|srcset/);
  });

  it('rebuilds a derived directory that has been deleted, and the page still renders', async () => {
    const { cms, agent, token, contentDir } = await siteWithAdmin();
    const url = await uploaded(
      agent,
      token,
      'Photo.png',
      await rectangle(1000, 500).png().toBuffer(),
      'image/png',
    );
    const permalink = await postEmbedding(cms, contentDir, url);
    const variant = `/uploads/_/${url.slice('/uploads/'.length)}/320.webp`;
    assert.equal((await cms.app.request(variant)).status, 200);

    await rm(path.join(cms.config.dataDir, 'images'), { recursive: true, force: true });

    const html = await fetched(cms, permalink);
    assert.match(html, /<picture>/);
    assert.equal((await cms.app.request(variant)).status, 200);
  });

  it('stores a GIF exactly as it arrived and derives nothing from it', async () => {
    const { cms, agent, token } = await siteWithAdmin();
    const bytes = await rectangle(400, 200).gif().toBuffer();

    const url = await uploaded(agent, token, 'Loop.gif', bytes, 'image/gif');

    const stored = await readFile(
      path.join(cms.config.contentDir, 'uploads', ...url.slice('/uploads/'.length).split('/')),
    );
    assert.deepEqual(new Uint8Array(stored), new Uint8Array(bytes));
    await assert.rejects(() =>
      readFile(
        path.join(cms.config.dataDir, 'images', url.slice('/uploads/'.length), 'image.json'),
      ),
    );
  });

  it('serves the plain image and derives nothing when optimization is off', async () => {
    const { cms, agent, token, contentDir } = await siteWithAdmin({ imageOptimization: false });
    const url = await uploaded(
      agent,
      token,
      'Photo.png',
      await rectangle(1000, 500).png().toBuffer(),
      'image/png',
    );
    const permalink = await postEmbedding(cms, contentDir, url);

    const html = await fetched(cms, permalink);

    assert.doesNotMatch(html, /<picture>/);
    assert.match(html, /<img src="\/uploads\/2[^"]*\.png" alt="A photo">/);
    assert.equal(
      (await cms.app.request(`/uploads/_/${url.slice('/uploads/'.length)}/320.webp`)).status,
      404,
    );
  });

  it('offers AVIF when the site asks for it, and never by default', async () => {
    const { cms, agent, token, contentDir } = await siteWithAdmin({
      imageFormats: ['avif', 'webp'],
      imageWidths: [320],
    });
    const url = await uploaded(
      agent,
      token,
      'Photo.png',
      await rectangle(1000, 500).png().toBuffer(),
      'image/png',
    );
    const permalink = await postEmbedding(cms, contentDir, url);

    const html = await fetched(cms, permalink);

    assert.match(html, /<source type="image\/avif"/);
    assert.match(html, /<source type="image\/webp"/);
    assert.equal(
      (await cms.app.request(`/uploads/_/${url.slice('/uploads/'.length)}/320.avif`)).status,
      200,
    );
  });

  it('takes the derived files away when the media screen deletes the upload', async () => {
    const { cms, agent, token } = await siteWithAdmin();
    const url = await uploaded(
      agent,
      token,
      'Photo.png',
      await rectangle(1000, 500).png().toBuffer(),
      'image/png',
    );
    const relative = url.slice('/uploads/'.length);
    const sidecar = path.join(cms.config.dataDir, 'images', relative, 'image.json');
    await readFile(sidecar);

    const screen = await (await agent.get('/admin/media')).text();
    const fresh = csrfField(screen);
    assert.ok(fresh !== undefined);
    const response = await agent.post('/admin/media/delete', {
      csrf_token: fresh,
      path: relative,
    });
    assert.equal(response.status, 303);

    await assert.rejects(() => readFile(sidecar));
  });
});

/** Every derived-file URL a page offers, in document order. */
function variantHrefs(html: string): string[] {
  return [...html.matchAll(/(\/uploads\/_\/[^\s",]+)/g)].map((match) => match[1] ?? '');
}

/** Delete one upload through the media screen, past the "a post uses it" confirmation. */
async function deleteUpload(agent: Browser, relative: string): Promise<void> {
  const fresh = csrfField(await (await agent.get('/admin/media')).text());
  assert.ok(fresh !== undefined);
  const response = await agent.post('/admin/media/delete', {
    csrf_token: fresh,
    path: relative,
    confirm: '1',
  });
  assert.equal(response.status, 303);
}

describe('closing a site while its images derive', () => {
  it('waits for the variants a render started before close returns', async () => {
    const contentDir = await box.dir('geekity-image-content-');
    const dataDir = await box.dir('geekity-image-data-');
    const own = sandbox();
    const cms = await own.open({ contentDir, dataDir });
    const upload = path.join(contentDir, 'uploads', '2026', '01', 'photo.png');
    await mkdir(path.dirname(upload), { recursive: true });
    await writeFile(upload, await rectangle(4000, 3000).png().toBuffer());
    const permalink = await postEmbedding(cms, contentDir, '/uploads/2026/01/photo.png');

    const html = await fetched(cms, permalink);
    assert.doesNotMatch(html, /<picture>/, 'the variants were already there before the render');
    await own.cleanup();

    const record = path.join(dataDir, 'images', '2026', '01', 'photo.png', 'image.json');
    assert.ok(existsSync(record), 'close returned before the variants were recorded');
  });
});

describe('variant URLs name the bytes they were derived from', () => {
  it('gives a reupload under a freed name new variant URLs', async () => {
    const { cms, agent, token, contentDir } = await siteWithAdmin();
    const url = await uploaded(
      agent,
      token,
      'Photo.png',
      await rectangle(1000, 500).png().toBuffer(),
      'image/png',
    );
    const permalink = await postEmbedding(cms, contentDir, url);
    const before = variantHrefs(await fetched(cms, permalink));
    assert.ok(before.length > 0, 'the page offers variants');

    await deleteUpload(agent, url.slice('/uploads/'.length));
    const again = await uploaded(
      agent,
      token,
      'Photo.png',
      await sharp({
        create: { width: 1000, height: 500, channels: 3, background: { r: 200, g: 30, b: 30 } },
      })
        .png()
        .toBuffer(),
      'image/png',
    );
    assert.equal(again, url, 'the freed name was reused');
    await cms.sync();

    const after = variantHrefs(await fetched(cms, permalink));
    assert.equal(after.length, before.length);
    for (const href of after) {
      assert.ok(!before.includes(href), `${href} was offered for the old bytes too`);
    }
  });

  it('caches a URL naming the current bytes for a year and any other for a day', async () => {
    const { cms, agent, token, contentDir } = await siteWithAdmin();
    const url = await uploaded(
      agent,
      token,
      'Photo.png',
      await rectangle(1000, 500).png().toBuffer(),
      'image/png',
    );
    const permalink = await postEmbedding(cms, contentDir, url);
    const hrefs = variantHrefs(await fetched(cms, permalink));
    assert.ok(hrefs.length > 0);

    for (const href of hrefs) {
      assert.match(href, /\?v=[0-9a-f]{12}$/);
      const response = await cms.app.request(href);
      assert.equal(response.status, 200, `${href} answered ${String(response.status)}`);
      assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    }

    const plain = `/uploads/_/${url.slice('/uploads/'.length)}/320.webp`;
    for (const legacy of [plain, `${plain}?v=000000000000`]) {
      const response = await cms.app.request(legacy);
      assert.equal(response.status, 200, `${legacy} no longer resolves`);
      assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
    }
  });
});

/** Write one post from its front matter and body, without syncing. */
async function writePost(
  contentDir: string,
  slug: string,
  front: string,
  body: string,
): Promise<void> {
  const file = path.join(contentDir, 'posts', `${slug}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\n${front}\npermalink: /${slug}/\n---\n\n${body}\n`, 'utf8');
}

/** Every `<img>` in a page that shows an upload, in document order. */
function uploadImages(html: string): string[] {
  return html.match(/<img src="\/uploads\/[^>]*>/g) ?? [];
}

/** A site with one uploaded photograph, and the URL it was given. */
async function siteWithPhoto(): Promise<{ cms: Cms; contentDir: string; url: string }> {
  const { cms, agent, token, contentDir } = await siteWithAdmin();
  const url = await uploaded(
    agent,
    token,
    'Photo.png',
    await rectangle(1000, 500).png().toBuffer(),
    'image/png',
  );
  return { cms, contentDir, url };
}

function assertLead(tag: string | undefined): void {
  assert.ok(tag !== undefined, 'the page has a lead image');
  assert.doesNotMatch(tag, /loading=/);
  assert.match(tag, /fetchpriority="high"/);
  assert.match(tag, /decoding="async"/);
}

function assertLazy(tag: string | undefined): void {
  assert.ok(tag !== undefined, 'the page has a later image');
  assert.match(tag, /loading="lazy"/);
  assert.doesNotMatch(tag, /fetchpriority/);
  assert.match(tag, /decoding="async"/);
}

describe('image loading priority end to end', () => {
  it('fetches the only image of a post at once, at high priority', async () => {
    const { cms, contentDir, url } = await siteWithPhoto();
    await writePost(contentDir, 'one', 'title: One\ndate: 2026-01-01T00:00:00Z', `![Only](${url})`);
    await cms.sync();

    const tags = uploadImages(await fetched(cms, '/one/'));

    assert.equal(tags.length, 1);
    assertLead(tags[0]);
  });

  it('fetches only the first of several images in a post at once', async () => {
    const { cms, contentDir, url } = await siteWithPhoto();
    await writePost(
      contentDir,
      'several',
      'title: Several\ndate: 2026-01-01T00:00:00Z',
      [`![One](${url})`, `![Two](${url})`, `![Three](${url})`].join('\n\n'),
    );
    await cms.sync();

    const tags = uploadImages(await fetched(cms, '/several/'));

    assert.equal(tags.length, 3);
    assertLead(tags[0]);
    assertLazy(tags[1]);
    assertLazy(tags[2]);
  });

  it('fetches only the first entry of a listing at once', async () => {
    const { cms, contentDir, url } = await siteWithPhoto();
    // Notes, because a listing prints a note whole and a titled post as its summary.
    for (const [slug, day] of [
      ['newest', '03'],
      ['middle', '02'],
      ['oldest', '01'],
    ] as const) {
      await writePost(
        contentDir,
        slug,
        `date: 2026-01-${day}T00:00:00Z`,
        `![First of ${slug}](${url})\n\n![Second of ${slug}](${url})`,
      );
    }
    await cms.sync();

    const tags = uploadImages(await fetched(cms, '/'));

    assert.equal(tags.length, 6);
    assert.match(tags[0] ?? '', /alt="First of newest"/);
    assertLead(tags[0]);
    for (const tag of tags.slice(1)) assertLazy(tag);
  });

  it('gives the lead to a posts page whose own body has an image', async () => {
    const { cms, contentDir, url } = await siteWithPhoto();
    await mkdir(path.join(contentDir, 'pages'), { recursive: true });
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, 'pages', 'welcome.md'),
      '---\ntitle: Welcome\npermalink: /welcome/\n---\n\nHello.\n',
      'utf8',
    );
    await writeFile(
      path.join(contentDir, 'pages', 'news.md'),
      `---\ntitle: News\npermalink: /news/\n---\n\n![Banner](${url})\n`,
      'utf8',
    );
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ homepage: 'welcome', postsPage: 'news' }),
      'utf8',
    );
    await writePost(contentDir, 'note', 'date: 2026-01-01T00:00:00Z', `![In a note](${url})`);
    await cms.sync();

    const tags = uploadImages(await fetched(cms, '/news/'));

    assert.equal(tags.length, 2);
    assert.match(tags[0] ?? '', /alt="Banner"/);
    assertLead(tags[0]);
    assertLazy(tags[1]);
  });

  it('gives the lead to the first recent post under a front page with no image', async () => {
    const { cms, contentDir, url } = await siteWithPhoto();
    await mkdir(path.join(contentDir, 'pages'), { recursive: true });
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, 'pages', 'welcome.md'),
      '---\ntitle: Welcome\npermalink: /welcome/\n---\n\nHello.\n',
      'utf8',
    );
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ homepage: 'welcome' }),
      'utf8',
    );
    await writePost(contentDir, 'newer', 'date: 2026-01-02T00:00:00Z', `![Newer](${url})`);
    await writePost(contentDir, 'older', 'date: 2026-01-01T00:00:00Z', `![Older](${url})`);
    await cms.sync();

    const tags = uploadImages(await fetched(cms, '/'));

    assert.equal(tags.length, 2);
    assert.match(tags[0] ?? '', /alt="Newer"/);
    assertLead(tags[0]);
    assertLazy(tags[1]);
  });
});
