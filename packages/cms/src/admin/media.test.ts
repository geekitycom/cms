import assert from 'node:assert/strict';
import type { Dirent } from 'node:fs';
import { access, mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Cms } from '../index.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { deleteUpload, mentionsUpload, resolveUpload } from './media.ts';

const box = sandbox();
after(() => box.cleanup());

/** One file already sitting under `content/uploads` when the site boots. */
interface Dropped {
  /** Where under `content/uploads`, with `/` separators. */
  at: string;
  /** Its bytes. Defaults to the first bytes of a PNG. */
  bytes?: Uint8Array | undefined;
  /** Its modification time, which is what orders the listing. */
  modified?: Date | undefined;
}

/** One Markdown file, written the way a site's would be. */
interface Seed {
  /** Where under the content directory, with `/` separators. */
  file: string;
  title: string;
  permalink: string;
  body: string;
}

/** A site whose content directory holds these uploads and these documents. */
async function siteWith(uploads: Dropped[], documents: Seed[] = []): Promise<Cms> {
  const contentDir = await box.dir('geekity-media-content-');
  for (const upload of uploads) await drop(contentDir, upload);
  for (const document of documents) await seed(contentDir, document);
  return box.site({ contentDir });
}

/** Write one file under `content/uploads`, the way a hand copy would. */
async function drop(contentDir: string, upload: Dropped): Promise<string> {
  const file = path.join(contentDir, 'uploads', ...upload.at.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, upload.bytes ?? png());
  if (upload.modified !== undefined) await utimes(file, upload.modified, upload.modified);
  return file;
}

/** Write one Markdown document. */
async function seed(contentDir: string, document: Seed): Promise<void> {
  const file = path.join(contentDir, ...document.file.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `---\ntitle: ${document.title}\ndate: 2026-01-01T00:00:00Z\npermalink: ${document.permalink}\n---\n\n${document.body}\n`,
    'utf8',
  );
}

/** The media screen's HTML, and the CSRF token that goes with it. */
async function screen(agent: Browser): Promise<{ html: string; token: string }> {
  const html = await (await agent.get('/admin/media')).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the media screen carried a CSRF token');
  return { html, token };
}

/** Whether a path exists. */
async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** The first bytes of a PNG, which is all the signature check reads. */
function png(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

/** The first bytes of a PDF: an upload that is not a picture. */
function pdf(): Uint8Array {
  return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
}

/** Everything under `content/uploads`, as `/` separated relative paths. */
async function uploadPaths(contentDir: string): Promise<string[]> {
  const root = path.join(contentDir, 'uploads');
  let entries: Dirent[];
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch {
    // A site that has never stored anything has no uploads directory at all.
    return [];
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
    )
    .sort();
}

describe('the media screen', () => {
  it('lists every upload newest first, with its size, date and public URL (AC #1)', async () => {
    const cms = await siteWith([
      { at: '2026/01/older.png', modified: new Date('2026-01-15T09:00:00Z') },
      { at: '2026/09/newer.pdf', bytes: pdf(), modified: new Date('2026-09-01T09:00:00Z') },
    ]);
    const agent = await signedIn(cms);

    const { html } = await screen(agent);

    assert.match(html, /\/uploads\/2026\/01\/older\.png/, 'the older file is listed');
    assert.match(html, /\/uploads\/2026\/09\/newer\.pdf/, 'the newer file is listed');
    assert.ok(
      html.indexOf('2026/09/newer.pdf') < html.indexOf('2026/01/older.png'),
      'the newest file comes first',
    );

    // The size in bytes, which is what the walk knows, and the date.
    assert.match(html, />8</, 'the size is on the screen');
    assert.match(html, /2026-09-01/, 'the upload date is on the screen');
  });

  it('shows a thumbnail for a picture and its extension for anything else (AC #1)', async () => {
    const cms = await siteWith([
      { at: '2026/01/photo.png' },
      { at: '2026/01/paper.pdf', bytes: pdf() },
    ]);
    const agent = await signedIn(cms);

    const { html } = await screen(agent);

    assert.match(
      html,
      /<img class="admin-media-thumbnail" src="\/uploads\/2026\/01\/photo\.png"/,
      'the picture is shown as a thumbnail',
    );
    assert.match(html, /admin-media-icon[^>]*>PDF</, 'the PDF is shown as an extension badge');
  });

  it('is in the admin navigation (AC #1)', async () => {
    const cms = await siteWith([]);
    const agent = await signedIn(cms);

    const dashboard = await (await agent.get('/admin')).text();
    assert.match(dashboard, /<a[^>]*href="\/admin\/media"[^>]*>Media<\/a>/);

    // Its own section, with Library the child it lands on (TASK-72).
    const { html } = await screen(agent);
    assert.match(html, /<a href="\/admin\/media" aria-current="page">Library<\/a>/);
  });

  it('offers the URL and the Markdown in copyable fields (AC #2)', async () => {
    const cms = await siteWith([
      { at: '2026/01/photo.png' },
      { at: '2026/01/paper.pdf', bytes: pdf() },
    ]);
    const agent = await signedIn(cms);

    const { html } = await screen(agent);

    assert.match(
      html,
      /<input id="media-url-\d+" type="text" value="\/uploads\/2026\/01\/photo\.png" readonly \/>/,
      'the URL is a readonly field, which copies without any script',
    );
    // An image embeds and anything else links, exactly as the editor's upload
    // control pastes it.
    assert.match(html, /value="!\[photo\]\(\/uploads\/2026\/01\/photo\.png\)"/);
    assert.match(html, /value="\[paper\]\(\/uploads\/2026\/01\/paper\.pdf\)"/);
  });

  it('links each file to the documents that reference it (AC #2)', async () => {
    const cms = await siteWith(
      [{ at: '2026/01/photo.png' }, { at: '2026/01/lonely.png' }],
      [
        {
          file: 'posts/2026-01-01-illustrated.md',
          title: 'Illustrated',
          permalink: '/2026/01/illustrated/',
          body: 'Look: ![](/uploads/2026/01/photo.png)',
        },
      ],
    );
    const agent = await signedIn(cms);

    const { html } = await screen(agent);

    assert.match(
      html,
      /<a href="\/admin\/posts\/illustrated">Illustrated<\/a>/,
      'the referencing document links to its editor',
    );
    // The other file is referenced by nothing, and the screen says so rather
    // than leaving the column blank.
    assert.match(html, /admin-status">Nothing</);
  });

  it('stores a file uploaded from the screen exactly as the editor does (AC #3)', async () => {
    const contentDir = await box.dir('geekity-media-content-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    const { token } = await screen(agent);

    const response = await agent.upload('/admin/media/upload', token, {
      name: 'Me At The Beach.PNG',
      type: 'image/png',
      bytes: png(),
    });
    assert.equal(response.status, 303, 'the upload redirects back to the screen');

    const [stored, ...rest] = await uploadPaths(contentDir);
    assert.deepEqual(rest, [], 'exactly one file was written');
    assert.ok(stored !== undefined);
    assert.match(
      stored,
      /^\d{4}\/\d{2}\/me-at-the-beach\.png$/,
      'the name is slugified and filed under the year and month, as the editor files it',
    );
    assert.deepEqual(
      new Uint8Array(await readFile(path.join(contentDir, 'uploads', stored))),
      png(),
      'the bytes are the ones that were sent',
    );

    const { html } = await screen(agent);
    assert.match(html, new RegExp(`/uploads/${stored}`), 'it is in the list straight away');
  });

  it('refuses a file the editor would refuse, and says so (AC #3)', async () => {
    const contentDir = await box.dir('geekity-media-content-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    const { token } = await screen(agent);

    const response = await agent.upload('/admin/media/upload', token, {
      name: 'sneaky.png',
      type: 'image/png',
      bytes: pdf(),
    });
    assert.equal(response.status, 303);

    const { html } = await screen(agent);
    assert.match(html, /does not look like a \.png inside/, 'the refusal is on the next page');
    assert.deepEqual(await uploadPaths(contentDir), [], 'nothing was written');
  });

  it('deletes a file nothing references (AC #4)', async () => {
    const contentDir = await box.dir('geekity-media-content-');
    await drop(contentDir, { at: '2026/01/spare.png' });
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    const { token } = await screen(agent);

    const response = await agent.post('/admin/media/delete', {
      csrf_token: token,
      path: '2026/01/spare.png',
    });
    assert.equal(response.status, 303);

    assert.equal(
      await exists(path.join(contentDir, 'uploads', '2026', '01', 'spare.png')),
      false,
      'the file is gone from disk',
    );
    const { html } = await screen(agent);
    assert.match(html, /Deleted \/uploads\/2026\/01\/spare\.png/);
  });

  it('names the documents and asks first when something references it (AC #4)', async () => {
    const contentDir = await box.dir('geekity-media-content-');
    await drop(contentDir, { at: '2026/01/photo.png' });
    await seed(contentDir, {
      file: 'posts/2026-01-01-illustrated.md',
      title: 'Illustrated',
      permalink: '/2026/01/illustrated/',
      body: 'Look: ![](/uploads/2026/01/photo.png)',
    });
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    const { token } = await screen(agent);

    const asked = await agent.post('/admin/media/delete', {
      csrf_token: token,
      path: '2026/01/photo.png',
    });
    const question = await asked.text();

    assert.match(question, /Delete \/uploads\/2026\/01\/photo\.png\?/);
    assert.match(
      question,
      /<a href="\/admin\/posts\/illustrated">Illustrated<\/a>/,
      'the confirmation names the document and links to its editor',
    );
    assert.equal(
      await exists(path.join(contentDir, 'uploads', '2026', '01', 'photo.png')),
      true,
      'nothing was deleted by the first request',
    );

    const confirmed = await agent.post('/admin/media/delete', {
      csrf_token: token,
      path: '2026/01/photo.png',
      confirm: '1',
    });
    assert.equal(confirmed.status, 303);
    assert.equal(
      await exists(path.join(contentDir, 'uploads', '2026', '01', 'photo.png')),
      false,
      'the confirmed request deleted it',
    );
  });

  it('counts a reference from the trash, which can be restored (AC #4)', async () => {
    const contentDir = await box.dir('geekity-media-content-');
    await drop(contentDir, { at: '2026/01/photo.png' });
    await seed(contentDir, {
      file: '_trash/posts/2026-01-01-thrown-away.md',
      title: 'Thrown Away',
      permalink: '/2026/01/thrown-away/',
      body: 'Look: ![](/uploads/2026/01/photo.png)',
    });
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    const { token } = await screen(agent);

    const asked = await agent.post('/admin/media/delete', {
      csrf_token: token,
      path: '2026/01/photo.png',
    });
    const question = await asked.text();

    assert.match(question, /Thrown Away/);
    assert.match(question, /admin-status-trashed/, 'the confirmation says it is in the trash');
  });

  it('refuses a delete that points outside the uploads directory (AC #4)', async () => {
    const contentDir = await box.dir('geekity-media-content-');
    await seed(contentDir, {
      file: 'posts/2026-01-01-safe.md',
      title: 'Safe',
      permalink: '/2026/01/safe/',
      body: 'Body.',
    });
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    const { token } = await screen(agent);

    const response = await agent.post('/admin/media/delete', {
      csrf_token: token,
      path: '../posts/2026-01-01-safe.md',
    });
    assert.equal(response.status, 303);

    assert.equal(
      await exists(path.join(contentDir, 'posts', '2026-01-01-safe.md')),
      true,
      'the document outside uploads is untouched',
    );
    const { html } = await screen(agent);
    assert.match(html, /not a file in this site’s uploads/);
  });

  it('shows a file dropped in by hand without a restart (AC #5)', async () => {
    const contentDir = await box.dir('geekity-media-content-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const before = await screen(agent);
    assert.match(before.html, /Nothing has been uploaded yet/);

    await drop(contentDir, { at: '2026/09/by-hand.png' });

    const after = await screen(agent);
    assert.match(after.html, /\/uploads\/2026\/09\/by-hand\.png/);
  });

  it('works with JavaScript switched off (AC #6)', async () => {
    const cms = await siteWith([{ at: '2026/01/photo.png' }]);
    const agent = await signedIn(cms);

    const { html } = await screen(agent);

    // Every action is a form that posts on its own.
    assert.match(html, /<form class="admin-settings admin-media-upload" method="post"/);
    assert.match(html, /<form method="post" action="\/admin\/media\/delete">/);
    // The copy control is an enhancement: the field is there and readable, and
    // the button is hidden until copy.js reveals it.
    assert.match(html, /<button type="button" class="admin-copy-button" data-copy="[^"]+" hidden>/);
    // No inline script anywhere, so the admin's CSP stays a bare `'self'`.
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/);
  });

  it('pages a library bigger than one screenful', async () => {
    const uploads = Array.from({ length: 30 }, (_, index) => ({
      at: `2026/01/file-${String(index).padStart(2, '0')}.png`,
      modified: new Date(Date.UTC(2026, 0, 1, 0, index)),
    }));
    const cms = await siteWith(uploads);
    const agent = await signedIn(cms);

    const first = await (await agent.get('/admin/media')).text();
    assert.match(first, /Page 1 of 2/);
    assert.match(first, /file-29\.png/, 'the newest file is on the first page');
    assert.doesNotMatch(first, /file-00\.png/, 'the oldest is not');
    assert.match(first, /href="\/admin\/media\?page=2"/);

    const second = await (await agent.get('/admin/media?page=2')).text();
    assert.match(second, /Page 2 of 2/);
    assert.match(second, /file-00\.png/, 'the oldest file is on the second page');
  });
});

describe('mentionsUpload', () => {
  it('finds a URL in Markdown, in HTML and in prose', () => {
    const url = '/uploads/2026/01/photo.png';
    assert.equal(mentionsUpload(`![](${url})`, url), true);
    assert.equal(mentionsUpload(`<img src="${url}" alt="">`, url), true);
    assert.equal(mentionsUpload(`It is at ${url} if you want it.`, url), true);
  });

  it('does not mistake a longer filename for the one it is looking for', () => {
    // The whole point of the boundary: deleting `photo.png` must not be
    // blocked by, or warn about, a post that only mentions `photo-2.png`.
    assert.equal(
      mentionsUpload('![](/uploads/2026/01/photo-2.png)', '/uploads/2026/01/photo.png'),
      false,
    );
    assert.equal(
      mentionsUpload('![](/uploads/2026/01/photo.png)', '/uploads/2026/01/photo'),
      false,
    );
  });

  it('says no when the body does not mention it at all', () => {
    assert.equal(mentionsUpload('Nothing here.', '/uploads/2026/01/photo.png'), false);
  });
});

describe('deleteUpload', () => {
  it('takes the derived files with the original (the seam TASK-43 fills)', async () => {
    const contentDir = await box.dir('geekity-media-content-');
    const file = await drop(contentDir, { at: '2026/01/photo.png' });
    const removed: string[] = [];

    const deleted = await deleteUpload({
      contentDir,
      path: '2026/01/photo.png',
      removeDerived: async (upload) => {
        removed.push(upload);
        await Promise.resolve();
      },
    });

    assert.equal(deleted, true);
    assert.equal(await exists(file), false);
    assert.deepEqual(removed, ['2026/01/photo.png'], 'the hook was told which upload went');
  });

  it('reports a file that was already gone rather than throwing', async () => {
    const contentDir = await box.dir('geekity-media-content-');
    assert.equal(await deleteUpload({ contentDir, path: '2026/01/never-existed.png' }), false);
  });
});

describe('resolveUpload', () => {
  it('refuses anything that is not under content/uploads', () => {
    const contentDir = '/site/content';
    assert.equal(
      resolveUpload(contentDir, '2026/01/photo.png'),
      '/site/content/uploads/2026/01/photo.png',
    );
    assert.equal(resolveUpload(contentDir, '../posts/secret.md'), undefined);
    assert.equal(resolveUpload(contentDir, '/etc/passwd'), undefined);
    assert.equal(resolveUpload(contentDir, ''), undefined);
  });
});
