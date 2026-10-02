import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Cms, GeekityConfig } from '../index.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

const PHOTO = '2026/01/photo.png';
const PHOTO_URL = `/uploads/${PHOTO}`;

/** A site with one picture uploaded, and whatever `content/_data/media.json` says. */
async function siteWithPhoto(
  media?: Record<string, unknown>,
  config: GeekityConfig = {},
): Promise<{ cms: Cms; agent: Browser; contentDir: string }> {
  const contentDir = await box.dir('geekity-alt-content-');
  const file = path.join(contentDir, 'uploads', ...PHOTO.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (media !== undefined) {
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(path.join(contentDir, '_data', 'media.json'), JSON.stringify(media), 'utf8');
  }
  const cms = await box.site({ contentDir, imageOptimization: false, ...config });
  return { cms, agent: await signedIn(cms), contentDir };
}

async function mediaScreen(agent: Browser): Promise<{ html: string; token: string }> {
  const html = await (await agent.get('/admin/media')).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the media screen carried a CSRF token');
  return { html, token };
}

async function mediaFile(contentDir: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(contentDir, '_data', 'media.json'), 'utf8'));
}

/** The Markdown the media screen offers for the photo. */
function offeredMarkdown(html: string): string | undefined {
  return /id="media-markdown-1"[^>]*value="([^"]*)"/.exec(html)?.[1];
}

/** Publish a new post with this body, and follow the redirect to the editor. */
async function publish(
  agent: Browser,
  body: string,
): Promise<{ response: Response; html: string }> {
  const editor = await (await agent.get('/admin/posts/new')).text();
  const token = csrfField(editor);
  assert.ok(token !== undefined);
  const response = await agent.post('/admin/posts/new', {
    csrf_token: token,
    title: 'With a picture',
    date: '2026-03-04T10:00:00Z',
    body,
    action: 'publish',
  });
  const location = response.headers.get('location');
  const html = location === null ? await response.text() : await (await agent.get(location)).text();
  return { response, html };
}

describe('alt text in the media library (TASK-141)', () => {
  it('stores what the admin types in content/_data/media.json and shows it back (AC #1)', async () => {
    const { agent, contentDir } = await siteWithPhoto();
    const { html, token } = await mediaScreen(agent);
    assert.match(html, /name="alt"/, 'an image row has an alt-text field');

    const response = await agent.post('/admin/media/alt', {
      csrf_token: token,
      path: PHOTO,
      alt: '  A dog asleep on a rug  ',
    });

    assert.equal(response.status, 303);
    assert.deepEqual(await mediaFile(contentDir), { [PHOTO]: { alt: 'A dog asleep on a rug' } });
    const after = (await mediaScreen(agent)).html;
    assert.match(after, /name="alt"[^>]*value="A dog asleep on a rug"/);
  });

  it('reads alt text a person wrote into the file by hand (AC #1)', async () => {
    const { agent } = await siteWithPhoto({ [PHOTO]: { alt: 'Written in an editor' } });

    const { html } = await mediaScreen(agent);

    assert.match(html, /name="alt"[^>]*value="Written in an editor"/);
  });

  it('offers the item’s alt text as the Markdown to insert, never its file name (AC #2)', async () => {
    const described = await siteWithPhoto({ [PHOTO]: { alt: 'A dog asleep on a rug' } });
    assert.equal(
      offeredMarkdown((await mediaScreen(described.agent)).html),
      `![A dog asleep on a rug](${PHOTO_URL})`,
    );

    const undescribed = await siteWithPhoto();
    assert.equal(offeredMarkdown((await mediaScreen(undescribed.agent)).html), `![](${PHOTO_URL})`);
  });

  it('marks an image decorative, which renders alt="" and publishes without a warning (AC #3)', async () => {
    const { cms, agent, contentDir } = await siteWithPhoto();
    const { token } = await mediaScreen(agent);

    await agent.post('/admin/media/alt', {
      csrf_token: token,
      path: PHOTO,
      alt: 'ignored for a decorative image',
      decorative: '1',
    });

    assert.deepEqual(await mediaFile(contentDir), { [PHOTO]: { decorative: true } });
    const { html: screen } = await mediaScreen(agent);
    assert.equal(offeredMarkdown(screen), `![](${PHOTO_URL})`);
    assert.match(screen, /name="decorative"[^>]*checked/);

    const { html } = await publish(agent, `A rule:\n\n![](${PHOTO_URL})`);
    const flashes = [...html.matchAll(/<p class="admin-flash[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map(
      ([, text]) => text,
    );
    assert.doesNotMatch(flashes.join('\n'), /alt text/i, 'nothing to warn about');

    const page = await (await cms.app.request('/2026/03/with-a-picture/')).text();
    assert.match(page, new RegExp(`<img src="${PHOTO_URL}" alt="">`));
  });

  it('forgets an item’s alt text when the file is deleted', async () => {
    const { agent, contentDir } = await siteWithPhoto({ [PHOTO]: { alt: 'Gone soon' } });
    const { token } = await mediaScreen(agent);

    await agent.post('/admin/media/delete', { csrf_token: token, path: PHOTO });

    assert.deepEqual(await mediaFile(contentDir), {});
  });
});

describe('publishing an image with no alt text (TASK-141 AC #4)', () => {
  it('publishes, and warns naming each image a reader is told nothing about', async () => {
    const { cms, agent } = await siteWithPhoto();

    const { response, html } = await publish(
      agent,
      `![](${PHOTO_URL})\n\n<img src="https://elsewhere.example/chart.svg">\n\n![A described one](https://elsewhere.example/ok.png)`,
    );

    assert.equal(response.status, 303);
    assert.equal(cms.store.getBySlug('with-a-picture')?.draft, false, 'it was published');
    assert.match(html, /admin-flash-warning/);
    assert.match(html, /photo\.png/);
    assert.match(html, /chart\.svg/);
    assert.doesNotMatch(html, /admin-flash-warning[^<]*ok\.png/, 'a described image is fine');
  });

  it('says nothing when every image is described', async () => {
    const { agent } = await siteWithPhoto();

    const { html } = await publish(agent, `![A dog asleep](${PHOTO_URL})`);

    assert.doesNotMatch(html, /admin-flash-warning/);
  });

  it('says nothing about a draft', async () => {
    const { agent } = await siteWithPhoto();
    const editor = await (await agent.get('/admin/posts/new')).text();

    const response = await agent.post('/admin/posts/new', {
      csrf_token: csrfField(editor) ?? '',
      title: 'Still working',
      body: `![](${PHOTO_URL})`,
      action: 'save-draft',
    });
    const html = await (await agent.get(response.headers.get('location') ?? '')).text();

    assert.doesNotMatch(html, /admin-flash-warning/);
  });

  it('refuses to publish when the site requires alt text, naming the image', async () => {
    const { cms, agent } = await siteWithPhoto(undefined, { requireAltText: true });

    const { response, html } = await publish(agent, `![](${PHOTO_URL})`);

    assert.equal(response.status, 400);
    assert.match(html, /photo\.png/);
    assert.equal(cms.store.getBySlug('with-a-picture'), undefined, 'nothing was written');
  });

  it('lets a draft be saved on a site that requires alt text', async () => {
    const { cms, agent } = await siteWithPhoto(undefined, { requireAltText: true });
    const editor = await (await agent.get('/admin/posts/new')).text();

    const response = await agent.post('/admin/posts/new', {
      csrf_token: csrfField(editor) ?? '',
      title: 'Still working',
      body: `![](${PHOTO_URL})`,
      action: 'save-draft',
    });

    assert.equal(response.status, 303);
    assert.equal(cms.store.getBySlug('still-working')?.draft, true);
  });
});
