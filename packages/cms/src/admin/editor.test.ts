/**
 * The three things TASK-13 adds to the editor: the preview, the upload
 * endpoint and the progressive enhancement that hangs CodeMirror on the
 * textarea.
 *
 * Everything here is tested through `app.request`, the same seam the rest of
 * the admin's tests use, because that is where the browser meets the CMS. The
 * preview's assertions are about the theme's own markup and the Markdown
 * pipeline's own output, so they fail if the preview ever grows a renderer of
 * its own.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser, setUserProfile } from './accounts.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

/** A signed-in admin over an empty site. */
async function admin(config = {}): Promise<{ cms: Cms; agent: Browser; token: string }> {
  const cms = await box.site(config);
  const agent = await signedIn(cms);
  const token = csrfField(await (await agent.get('/admin/posts/new')).text());
  assert.ok(token !== undefined, 'the editor carried a CSRF token');
  return { cms, agent, token };
}

describe('the preview endpoint', () => {
  it('renders the unsaved body through the theme post layout and the site Markdown pipeline', async () => {
    const { agent, token } = await admin();

    const response = await agent.post('/admin/preview', {
      csrf_token: token,
      type: 'post',
      title: 'Six tables',
      body: '## A heading\n\nSome *emphasis*, and a note.[^1]\n\n[^1]: The note.\n',
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);

    const html = await response.text();
    // The theme's post layout, not a preview-only one.
    assert.match(html, /<article class="post h-entry">/);
    assert.match(html, /<h1 class="post-title p-name">Six tables<\/h1>/);
    // markdown-it with the CMS's plugins: heading anchors and footnotes.
    assert.match(html, /<h2 id="a-heading">A heading<\/h2>/);
    assert.match(html, /<em>emphasis<\/em>/);
    assert.match(html, /class="footnotes"/);
  });

  it('renders a page through the page layout instead', async () => {
    const { agent } = await admin();
    const token = csrfField(await (await agent.get('/admin/pages/new')).text());
    assert.ok(token !== undefined);

    const html = await (
      await agent.post('/admin/preview', {
        csrf_token: token,
        type: 'page',
        title: 'Colophon',
        body: 'What this is built with.\n',
      })
    ).text();

    assert.match(html, /<article class="page h-entry">/);
    assert.match(html, /<h1 class="page-title p-name">Colophon<\/h1>/);
  });

  it('previews a body with no title without falling over', async () => {
    const { agent, token } = await admin();

    const response = await agent.post('/admin/preview', {
      csrf_token: token,
      type: 'post',
      title: '',
      body: 'Just a body.\n',
    });

    assert.equal(response.status, 200);
    assert.match(await response.text(), /Just a body\./);
  });

  it('escapes a title rather than letting it into the markup', async () => {
    const { agent, token } = await admin();

    const html = await (
      await agent.post('/admin/preview', {
        csrf_token: token,
        type: 'post',
        title: '<script>alert(1)</script>',
        body: 'Body.\n',
      })
    ).text();

    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;/);
  });

  it('refuses a preview that carries no CSRF token', async () => {
    const { agent } = await admin();

    const response = await agent.post('/admin/preview', { type: 'post', body: 'Body.' });

    assert.equal(response.status, 403);
  });

  it('writes nothing to the content directory', async () => {
    const { cms, agent, token } = await admin();

    await agent.post('/admin/preview', {
      csrf_token: token,
      type: 'post',
      title: 'Not a post',
      body: 'Body.',
    });

    assert.deepEqual(await readdir(cms.config.contentDir), []);
    assert.equal(cms.store.counts().posts, 0);
  });
});

describe('the upload endpoint', () => {
  it('files an image under the year and month and answers with its Markdown', async () => {
    const { cms, agent, token } = await admin();

    const response = await agent.upload('/admin/uploads', token, {
      name: 'My Holiday Photo.PNG',
      type: 'image/png',
      bytes: png(),
    });

    assert.equal(response.status, 201);
    const body = (await response.json()) as { url: string; markdown: string };

    const now = new Date();
    const month = `${String(now.getUTCFullYear())}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    assert.equal(body.url, `/uploads/${month}/my-holiday-photo.png`);
    assert.equal(body.markdown, `![My Holiday Photo](/uploads/${month}/my-holiday-photo.png)`);

    const file = path.join(
      cms.config.contentDir,
      'uploads',
      ...month.split('/'),
      'my-holiday-photo.png',
    );
    assert.deepEqual(new Uint8Array(await readFile(file)), png());
  });

  it('serves the uploaded file at the URL it returned', async () => {
    const { cms, agent, token } = await admin();

    const body = (await (
      await agent.upload('/admin/uploads', token, {
        name: 'photo.png',
        type: 'image/png',
        bytes: png(),
      })
    ).json()) as { url: string };

    const served = await cms.app.request(body.url);

    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await served.arrayBuffer()), png());
  });

  it('links rather than embeds something that is not an image', async () => {
    const { agent, token } = await admin();

    const body = (await (
      await agent.upload('/admin/uploads', token, {
        name: 'The Notes.txt',
        type: 'text/plain',
        bytes: new Uint8Array([0x68, 0x69, 0x0a]),
      })
    ).json()) as { url: string; markdown: string };

    assert.match(body.url, /\/uploads\/\d{4}\/\d{2}\/the-notes\.txt$/);
    assert.equal(body.markdown, `[The Notes](${body.url})`);
  });

  it('never overwrites: a second file of the same name is suffixed', async () => {
    const { agent, token } = await admin();

    const first = (await (
      await agent.upload('/admin/uploads', token, {
        name: 'photo.png',
        type: 'image/png',
        bytes: png(),
      })
    ).json()) as { url: string };
    const second = (await (
      await agent.upload('/admin/uploads', token, {
        name: 'photo.png',
        type: 'image/png',
        bytes: png(),
      })
    ).json()) as { url: string };

    assert.match(first.url, /\/photo\.png$/);
    assert.match(second.url, /\/photo-2\.png$/);
  });

  it('refuses a file over the configured limit with a 413 and writes nothing', async () => {
    const { cms, agent, token } = await admin({ uploadMaxBytes: 64 });

    const oversized = new Uint8Array(256);
    oversized.set(png());

    const response = await agent.upload('/admin/uploads', token, {
      name: 'huge.png',
      type: 'image/png',
      bytes: oversized,
    });

    assert.equal(response.status, 413);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /64 bytes/);
    assert.deepEqual(await readdir(cms.config.contentDir), []);
  });

  it('refuses an extension that is not on the allowlist with a 415', async () => {
    const { cms, agent, token } = await admin();

    const response = await agent.upload('/admin/uploads', token, {
      name: 'payload.exe',
      type: 'application/octet-stream',
      bytes: new Uint8Array([0x4d, 0x5a]),
    });

    assert.equal(response.status, 415);
    assert.match(((await response.json()) as { error: string }).error, /\.exe/);
    assert.deepEqual(await readdir(cms.config.contentDir), []);
  });

  it('refuses an extension the site took off its own allowlist', async () => {
    const { agent, token } = await admin({ uploadTypes: ['.txt'] });

    const response = await agent.upload('/admin/uploads', token, {
      name: 'photo.png',
      type: 'image/png',
      bytes: png(),
    });

    assert.equal(response.status, 415);
  });

  it('refuses a file whose declared media type contradicts its extension', async () => {
    const { agent, token } = await admin();

    const response = await agent.upload('/admin/uploads', token, {
      name: 'photo.png',
      type: 'application/x-msdownload',
      bytes: png(),
    });

    assert.equal(response.status, 415);
  });

  it('refuses a file whose bytes are not the format its name claims', async () => {
    const { agent, token } = await admin();

    const response = await agent.upload('/admin/uploads', token, {
      name: 'payload.png',
      type: 'image/png',
      bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]),
    });

    assert.equal(response.status, 415);
    assert.match(((await response.json()) as { error: string }).error, /PNG|png/);
  });

  it('refuses an upload that carries no CSRF token', async () => {
    const { agent } = await admin();

    const response = await agent.upload('/admin/uploads', '', {
      name: 'photo.png',
      type: 'image/png',
      bytes: png(),
    });

    assert.equal(response.status, 403);
  });

  it('refuses a request with no file at all', async () => {
    const { agent, token } = await admin();

    const response = await agent.post('/admin/uploads', { csrf_token: token });

    assert.equal(response.status, 400);
  });

  it('cannot be talked out of content/uploads by a name full of slashes', async () => {
    const { cms, agent, token } = await admin();

    const body = (await (
      await agent.upload('/admin/uploads', token, {
        name: '../../../escaped.png',
        type: 'image/png',
        bytes: png(),
      })
    ).json()) as { url: string };

    assert.match(body.url, /^\/uploads\/\d{4}\/\d{2}\/escaped\.png$/);
    assert.deepEqual(await readdir(cms.config.contentDir), ['uploads']);
  });
});

describe('the editor page', () => {
  it('still carries a plain textarea, so it works with no JavaScript', async () => {
    const { agent } = await admin();

    const html = await (await agent.get('/admin/posts/new')).text();

    assert.match(html, /<textarea id="editor-body" name="body"/);
  });

  it('offers a preview that works as a plain form submission', async () => {
    const { agent } = await admin();

    const html = await (await agent.get('/admin/posts/new')).text();

    assert.match(html, /formaction="\/admin\/preview"/);
    assert.match(html, /formtarget="_blank"/);
  });

  it('loads the editor bundle as a module, and tells it where to post', async () => {
    const { agent } = await admin();

    const html = await (await agent.get('/admin/posts/new')).text();

    assert.match(html, /<script\b[^>]*\btype="module"[^>]*\bsrc="\/admin\/_static\/editor\.js"/s);
    assert.match(html, /<script\b[^>]*\bsrc="\/admin\/_static\/slug\.js"/);
    assert.match(html, /data-preview-url="\/admin\/preview"/);
    assert.match(html, /data-upload-url="\/admin\/uploads"/);
    assert.match(html, /data-kind="post"/);
  });
});

describe('who a post says wrote it (TASK-67 AC #2)', () => {
  it('offers the users, with the signed-in one chosen, on a new post', async () => {
    const { cms, agent } = await admin();
    await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'a password of hers',
    });

    const html = await (await agent.get('/admin/posts/new')).text();

    assert.match(html, /<select id="editor-author" name="author"/);
    assert.match(html, /<option value="ada"\s+selected>/);
    assert.match(html, /<option value="grace">/);
  });

  it('writes the chosen user’s login into the file', async () => {
    const { cms, agent, token } = await admin();
    await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'a password of hers',
    });

    const saved = await agent.post('/admin/posts/new', {
      csrf_token: token,
      title: 'Hers',
      date: '2026-09-02 09:00',
      author: 'grace',
      body: 'Body.',
      action: 'publish',
    });
    assert.equal(saved.status, 303);

    const document = cms.store.getBySlug('hers');
    assert.equal(document?.author, 'grace');
  });

  it('keeps what the file said when the form names nobody this site has', async () => {
    const { cms, agent, token } = await admin();

    await agent.post('/admin/posts/new', {
      csrf_token: token,
      title: 'Mine',
      date: '2026-09-02 09:00',
      body: 'Body.',
      action: 'publish',
    });
    const first = cms.store.getBySlug('mine');
    assert.equal(first?.author, 'ada', 'a new post is the signed-in user’s');

    const edit = await agent.get('/admin/posts/mine');
    const editToken = csrfField(await edit.text());
    await agent.post('/admin/posts/mine', {
      csrf_token: editToken ?? '',
      title: 'Mine',
      date: '2026-09-02 09:00',
      author: 'somebody-who-left',
      body: 'Body.',
      hash: first?.hash ?? '',
      action: 'update',
    });

    assert.equal(
      cms.store.getBySlug('mine')?.author,
      'ada',
      'a name the form invented changes nothing',
    );
  });

  it('offers a display name from before decision-14 as the user it reads as', async () => {
    const { cms, agent } = await admin();
    await setUserProfile({
      dataDir: cms.config.dataDir,
      userId: 1,
      profile: { displayName: 'Ada Lovelace' },
    });
    await mkdir(path.join(cms.config.contentDir, 'posts'), { recursive: true });
    await writeFile(
      path.join(cms.config.contentDir, 'posts', '2026-09-02-older.md'),
      "---\ntitle: Older\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/older/\nauthor: Ada Lovelace\n---\n\nBody.\n",
      'utf8',
    );
    await cms.sync();

    const html = await (await agent.get('/admin/posts/older')).text();

    assert.match(html, /<option value="ada"\s+selected>/);
  });
});

/** The eight bytes every PNG starts with, and nothing else. Enough to sniff. */
function png(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}
