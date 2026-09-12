import assert from 'node:assert/strict';
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
    assert.match(html, /<source type="image\/webp" srcset="[^"]*320\.webp 320w/);
    assert.match(html, /<img src="\/uploads\/[^"]*\.png"/);
    assert.match(html, /width="1000" height="500" loading="lazy"/);
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
      await cms.app.request('/ap/posts/a-photo', {
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
