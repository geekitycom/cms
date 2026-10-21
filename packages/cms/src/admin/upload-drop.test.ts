/**
 * Uploading where a file is asked for (TASK-439): the image-only refusal on
 * the upload endpoint, and the upload control every target page renders for
 * static/upload-drop.js to reveal.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import matter from 'gray-matter';

import { findUser } from '../site/users.ts';
import { csrfField, FIRST_ADMIN, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function admin(): Promise<{ cms: Cms; agent: Browser; token: string }> {
  const cms = await box.site();
  const agent = await signedIn(cms);
  const token = csrfField(await (await agent.get('/admin/posts/new?kind=note')).text());
  assert.ok(token !== undefined, 'the editor carried a CSRF token');
  return { cms, agent, token };
}

function control(html: string, kind: string, target: string): string {
  const tag = new RegExp(
    `<div\\b[^>]*data-upload-drop="${kind}"[^>]*data-upload-target="${target}"[^>]*>`,
  ).exec(html)?.[0];
  assert.ok(tag !== undefined, `a ${kind} upload control fills #${target}`);
  assert.match(tag, /\shidden>$/, `the control for #${target} waits for the script`);
  assert.match(tag, /data-upload-url="\/admin\/uploads"/);
  assert.match(html, new RegExp(`\\bid="${target}"`), `#${target} is on the page`);
  assert.match(html, /<script defer src="\/admin\/_static\/upload-drop\.js\?v=[^"]+"><\/script>/);
  return tag;
}

describe('uploading only an image (TASK-439 AC #5)', () => {
  it('refuses a file that is not an image when the target asks for images', async () => {
    const { cms, agent, token } = await admin();

    const response = await agent.upload(
      '/admin/uploads',
      token,
      { name: 'notes.txt', type: 'text/plain', bytes: new TextEncoder().encode('hello') },
      'file',
      { images: '1' },
    );

    assert.equal(response.status, 415);
    assert.match(((await response.json()) as { error: string }).error, /image/i);
    assert.deepEqual(await readdir(cms.config.contentDir), []);
  });

  it('stores an image the same target sends', async () => {
    const { agent, token } = await admin();

    const response = await agent.upload(
      '/admin/uploads',
      token,
      { name: 'cover.png', type: 'image/png', bytes: PNG },
      'file',
      { images: '1' },
    );

    assert.equal(response.status, 201);
    assert.match(((await response.json()) as { url: string }).url, /\/cover\.png$/);
  });
});

describe('the upload controls each target renders (TASK-439 AC #7)', () => {
  it('puts the photo grid on the page with an upload control even with no images', async () => {
    const { agent } = await admin();
    const html = await (await agent.get('/admin/posts/new?kind=photo')).text();

    const tag = control(html, 'photos', 'editor-photo-picks');
    assert.match(tag, /data-upload-images/);
    assert.match(tag, /data-upload-name="photo-url-"/);
    assert.match(html, /<template data-upload-tile="editor-photo-picks">/);
    assert.match(html, /The media library has no images yet\./);
    assert.match(
      html,
      /<div hidden data-upload-reveal><button type="submit" class="btn btn-soft btn-sm" name="switch-kind"/,
      'adding ticked photos waits for a tick',
    );
  });

  it('gives the review picture an image upload that shows its preview', async () => {
    const { agent } = await admin();
    const html = await (await agent.get('/admin/posts/new?kind=review')).text();

    const tag = control(html, 'field', 'editor-item-photo');
    assert.match(tag, /data-upload-images/);
    assert.match(tag, /data-upload-preview="editor-item-photo-preview"/);
  });

  it('gives an episode’s recording, transcript and other versions an upload each', async () => {
    const { agent } = await admin();
    const html = await (await agent.get('/admin/posts/new?kind=episode')).text();

    assert.doesNotMatch(control(html, 'select', 'editor-enclosure-url'), /data-upload-images/);
    control(html, 'field', 'editor-enclosure-transcript');
    control(html, 'field', 'editor-alternate-url-0');
    assert.doesNotMatch(html, /Upload the file to the media library first/);
  });

  it('gives the site icon an image upload', async () => {
    const { agent } = await admin();
    const html = await (await agent.get('/admin/settings')).text();

    assert.match(control(html, 'field', 'settings-icon'), /data-upload-images/);
  });

  it('gives a user’s avatar an image upload', async () => {
    const { cms, agent } = await admin();
    const id = findUser(cms.config.dataDir, FIRST_ADMIN.username)?.id ?? 0;
    const html = await (await agent.get(`/admin/users/${String(id)}`)).text();

    assert.match(control(html, 'field', 'profile-avatar'), /data-upload-images/);
  });

  it('lets the media library take files dropped on the page', async () => {
    const { agent } = await admin();
    const html = await (await agent.get('/admin/media')).text();

    assert.match(control(html, 'library', 'main'), /data-upload-drop="library"/);
    assert.match(html, /<input id="main-upload" type="file"[^>]*multiple data-upload-input/);
  });
});

describe('a photo ticked after an upload (TASK-439 AC #1)', () => {
  it('saves a pick numbered past every other row', async () => {
    const { cms, agent, token } = await admin();
    const upload = (await (
      await agent.upload('/admin/uploads', token, {
        name: 'harbor.png',
        type: 'image/png',
        bytes: PNG,
      })
    ).json()) as { url: string };

    const response = await agent.post('/admin/posts/new?kind=photo', {
      csrf_token: token,
      action: 'publish',
      kind: 'photo',
      slug: 'harbor',
      date: '2026-10-02 09:00',
      body: 'At the harbor.',
      'photo-url-0': '',
      'photo-alt-0': '',
      'photo-url-7': upload.url,
    });
    assert.equal(response.status, 303);

    const posts = path.join(cms.config.contentDir, 'posts');
    const [file] = await readdir(posts);
    assert.ok(file !== undefined, 'the post was written');
    const { data } = matter(await readFile(path.join(posts, file), 'utf8'));
    assert.deepEqual(data['photo'], [{ url: upload.url }]);
  });
});
