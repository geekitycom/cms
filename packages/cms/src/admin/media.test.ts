import assert from 'node:assert/strict';
import type { Dirent } from 'node:fs';
import { access, mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Cms } from '../index.ts';
import { deleteUpload, mentionsUpload, resolveUpload } from '../media/library.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import { statuses } from './__testing__/statuses.ts';
import type { Browser } from './__testing__/harness.ts';

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

/** One file's details screen, opened from the unfiltered library. */
async function details(agent: Browser, upload: string, query = ''): Promise<string> {
  const response = await agent.get(
    `/admin/media/file?path=${encodeURIComponent(upload)}${query === '' ? '' : `&${query}`}`,
  );
  assert.equal(response.status, 200, `the details screen for ${upload} answered`);
  return response.text();
}

/** The file names on a library page, in the order its tiles show them. */
function tileNames(html: string): string[] {
  return [
    ...html.matchAll(/data-media-tile>[\s\S]*?<span class="block truncate[^"]*">([^<]+)<\/span>/g),
  ].map((match) => match[1] ?? '');
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
  it('shows every upload as a tile, newest first, linked to its details (AC #1)', async () => {
    const cms = await siteWith([
      { at: '2026/01/older.png', modified: new Date('2026-01-15T09:00:00Z') },
      { at: '2026/09/newer.pdf', bytes: pdf(), modified: new Date('2026-09-01T09:00:00Z') },
    ]);
    const agent = await signedIn(cms);

    const { html } = await screen(agent);

    assert.deepEqual(tileNames(html), ['newer.pdf', 'older.png']);
    assert.match(html, /href="\/admin\/media\/file\?path=2026%2F09%2Fnewer\.pdf"/);
  });

  it('gives the size, date, path and public URL on the details screen (TASK-429)', async () => {
    const cms = await siteWith([
      { at: '2026/09/newer.pdf', bytes: pdf(), modified: new Date('2026-09-01T09:00:00Z') },
    ]);
    const agent = await signedIn(cms);

    const html = await details(agent, '2026/09/newer.pdf');

    assert.match(html, /<h1[^>]*>newer\.pdf<\/h1>/);
    assert.match(html, />8 bytes</, 'the size is on the screen');
    assert.match(html, /2026-09-01/, 'the upload date is on the screen');
    assert.match(html, /<code class="break-all">2026\/09\/newer\.pdf<\/code>/);
    assert.match(html, /href="\/uploads\/2026\/09\/newer\.pdf"/);
  });

  it('sends a path that is not in the library back to it, and says so (TASK-429)', async () => {
    const cms = await siteWith([]);
    const agent = await signedIn(cms);

    const response = await agent.get('/admin/media/file?path=../posts/x.md&kind=image');

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/media?kind=image');
    assert.match((await screen(agent)).html, /not a file in this site’s uploads/);
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
      /<img\b[^>]*src="\/uploads\/2026\/01\/photo\.png"/,
      'the picture is shown as a thumbnail',
    );
    assert.match(html, /aria-hidden="true">PDF</, 'the PDF is shown as an extension badge');
  });

  it('is in the admin navigation (AC #1)', async () => {
    const cms = await siteWith([]);
    const agent = await signedIn(cms);

    const dashboard = await (await agent.get('/admin')).text();
    assert.match(dashboard, /<a[^>]*href="\/admin\/media"[^>]*>Media<\/a>/);

    // Its own section, with Library the child it lands on (TASK-72).
    const { html } = await screen(agent);
    assert.match(html, /<a\b[^>]*href="\/admin\/media" aria-current="page">Library<\/a>/);
  });

  it('offers the URL and the Markdown in copyable fields (AC #2)', async () => {
    const cms = await siteWith([
      { at: '2026/01/photo.png' },
      { at: '2026/01/paper.pdf', bytes: pdf() },
    ]);
    const agent = await signedIn(cms);

    const photo = await details(agent, '2026/01/photo.png');

    assert.match(
      photo,
      /<input id="media-url" type="text" value="\/uploads\/2026\/01\/photo\.png" readonly\b/,
      'the URL is a readonly field, which copies without any script',
    );
    // An image embeds and anything else links, exactly as the editor's upload
    // control pastes it. An image the library has no alt text for embeds with
    // none rather than with its file name (TASK-141).
    assert.match(photo, /value="!\[\]\(\/uploads\/2026\/01\/photo\.png\)"/);
    assert.match(
      await details(agent, '2026/01/paper.pdf'),
      /value="\[paper\]\(\/uploads\/2026\/01\/paper\.pdf\)"/,
    );
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

    assert.match(
      await details(agent, '2026/01/photo.png'),
      /<a\b[^>]*href="\/admin\/posts\/illustrated">Illustrated<\/a>/,
      'the referencing document links to its editor',
    );
    // The other file is referenced by nothing, and the screen says so rather
    // than leaving the section blank.
    assert.match(await details(agent, '2026/01/lonely.png'), /Nothing links to it\./);
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
      /<a\b[^>]*href="\/admin\/posts\/illustrated">Illustrated<\/a>/,
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

  it('refuses rather than deletes a referenced file the library does not list', async () => {
    const contentDir = await box.dir('geekity-media-content-');
    const file = await drop(contentDir, { at: '2026/09/kept.png.geekity-strip' });
    await seed(contentDir, {
      file: 'posts/2026-01-01-odd.md',
      title: 'Odd',
      permalink: '/2026/01/odd/',
      body: 'See /uploads/2026/09/kept.png.geekity-strip here.',
    });
    const agent = await signedIn(await box.site({ contentDir }));
    const { token } = await screen(agent);

    const response = await agent.post('/admin/media/delete', {
      csrf_token: token,
      path: '2026/09/kept.png.geekity-strip',
    });

    assert.equal(response.status, 303);
    assert.equal(await exists(file), true, 'nothing was deleted without being asked');
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
    assert.ok(statuses(question).includes('Trash'), 'the confirmation says it is in the trash');
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

  it('does not list a temporary file a cut-off metadata sweep left behind', async () => {
    const cms = await siteWith([
      { at: '2026/09/kept.png' },
      { at: '2026/09/kept.png.geekity-strip' },
    ]);
    const agent = await signedIn(cms);

    const { html } = await screen(agent);

    assert.match(html, /\/uploads\/2026\/09\/kept\.png/);
    assert.doesNotMatch(html, /geekity-strip/);
  });

  it('works with JavaScript switched off (AC #6)', async () => {
    const cms = await siteWith([{ at: '2026/01/photo.png' }]);
    const agent = await signedIn(cms);

    const { html } = await screen(agent);
    const file = await details(agent, '2026/01/photo.png');

    // Every action is a form that posts on its own, and a tile is a link.
    assert.match(
      html,
      /<form\b[^>]*method="post" action="\/admin\/media\/upload" enctype="multipart\/form-data">/,
    );
    assert.match(html, /<details class="dropdown">\s*<summary[^>]*>Upload<\/summary>/);
    assert.match(html, /<a\b[^>]*href="\/admin\/media\/file\?path=[^"]+" data-media-tile>/);
    assert.match(file, /<form\b[^>]*method="post" action="\/admin\/media\/delete">/);
    assert.match(file, /<form\b[^>]*method="post" action="\/admin\/media\/alt">/);
    // The copy control is an enhancement: the field is there and readable, and
    // the button is hidden until copy.js reveals it.
    assert.match(file, /<button type="button" class="[^"]*" data-copy="[^"]+" hidden>/);
    // No inline script anywhere, so the admin's CSP stays a bare `'self'`.
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/);
    assert.doesNotMatch(file, /<script(?![^>]*\ssrc=)/);
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

describe('the media library filters (TASK-429)', () => {
  /** A described photo used by a post, an undescribed one nothing uses, a PDF and an MP3. */
  async function mixedSite(): Promise<Browser> {
    const contentDir = await box.dir('geekity-media-content-');
    await drop(contentDir, {
      at: '2026/01/harbor.png',
      modified: new Date('2026-01-04T00:00:00Z'),
    });
    await drop(contentDir, { at: '2026/01/desk.png', modified: new Date('2026-01-03T00:00:00Z') });
    await drop(contentDir, {
      at: '2026/01/slides.pdf',
      bytes: pdf(),
      modified: new Date('2026-01-02T00:00:00Z'),
    });
    await drop(contentDir, {
      at: '2026/01/episode.mp3',
      bytes: new Uint8Array(4096),
      modified: new Date('2026-01-01T00:00:00Z'),
    });
    await seed(contentDir, {
      file: 'posts/2026-01-01-harbor.md',
      title: 'Harbor',
      permalink: '/2026/01/harbor/',
      body: '![](/uploads/2026/01/harbor.png)',
    });
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    const { token } = await screen(agent);
    await agent.post('/admin/media/alt', {
      csrf_token: token,
      path: '2026/01/harbor.png',
      alt: 'Boats in the harbor at sunrise',
    });
    return agent;
  }

  async function library(agent: Browser, query: string): Promise<string> {
    return (await agent.get(`/admin/media?${query}`)).text();
  }

  it('badges an image without alt text and a file nothing uses', async () => {
    const agent = await mixedSite();

    const { html } = await screen(agent);
    const tile = (name: string): string =>
      new RegExp(
        `data-media-tile>((?:(?!data-media-tile)[\\s\\S])*?)>${name.replace('.', '\\.')}<`,
      ).exec(html)?.[1] ?? '';

    assert.match(tile('desk.png'), /No alt text/);
    assert.match(tile('desk.png'), /Unused/);
    assert.doesNotMatch(tile('harbor.png'), /No alt text|Unused/);
    assert.doesNotMatch(tile('slides.pdf'), /No alt text/, 'only an image needs alt text');
  });

  it('picks a kind from tabs that carry their counts', async () => {
    const agent = await mixedSite();

    const { html } = await screen(agent);
    assert.match(html, /aria-current="page">All \(4\)</);
    assert.match(html, /href="\/admin\/media\?kind=image">Images \(2\)</);
    assert.match(html, /href="\/admin\/media\?kind=audio">Audio \(1\)</);
    assert.match(html, /href="\/admin\/media\?kind=document">Documents \(1\)</);

    assert.deepEqual(tileNames(await library(agent, 'kind=image')), ['harbor.png', 'desk.png']);
  });

  it('filters by needing alt text, by being unused and by name or alt text', async () => {
    const agent = await mixedSite();

    assert.deepEqual(tileNames(await library(agent, 'alt=missing')), ['desk.png']);
    assert.deepEqual(tileNames(await library(agent, 'unused=1')), [
      'desk.png',
      'slides.pdf',
      'episode.mp3',
    ]);
    assert.deepEqual(tileNames(await library(agent, 'q=SUNRISE')), ['harbor.png']);
    assert.deepEqual(tileNames(await library(agent, 'q=slides')), ['slides.pdf']);

    const none = await library(agent, 'q=nothing-like-this');
    assert.match(none, /Nothing matches\./);
    assert.match(none, /0 of 4 files/);
  });

  it('counts the tabs within the other filters', async () => {
    const agent = await mixedSite();

    const html = await library(agent, 'unused=1');

    assert.match(html, /href="\/admin\/media\?kind=image&amp;unused=1">Images \(1\)</);
    assert.match(html, /href="\/admin\/media\?unused=1" aria-current="page">All \(3\)</);
  });

  it('sorts by oldest, largest and name', async () => {
    const agent = await mixedSite();

    assert.deepEqual(tileNames(await library(agent, 'sort=oldest')), [
      'episode.mp3',
      'slides.pdf',
      'desk.png',
      'harbor.png',
    ]);
    assert.equal(tileNames(await library(agent, 'sort=largest'))[0], 'episode.mp3');
    assert.deepEqual(tileNames(await library(agent, 'sort=name')), [
      'desk.png',
      'episode.mp3',
      'harbor.png',
      'slides.pdf',
    ]);
  });

  it('ignores a kind or a sort it does not know', async () => {
    const agent = await mixedSite();

    const html = await library(agent, 'kind=spreadsheet&sort=sideways');

    assert.deepEqual(tileNames(html), ['harbor.png', 'desk.png', 'slides.pdf', 'episode.mp3']);
  });

  it('keeps the filters on the page links', async () => {
    const uploads = Array.from({ length: 30 }, (_, index) => ({
      at: `2026/01/file-${String(index).padStart(2, '0')}.png`,
      modified: new Date(Date.UTC(2026, 0, 1, 0, index)),
    }));
    const agent = await signedIn(await siteWith(uploads));

    const first = await library(agent, 'kind=image&sort=oldest');

    assert.match(first, /href="\/admin\/media\?kind=image&amp;sort=oldest&amp;page=2"/);
    assert.equal(tileNames(first)[0], 'file-00.png');
  });
});

describe('the media details screen (TASK-429)', () => {
  async function threeFiles(): Promise<Cms> {
    return siteWith([
      { at: '2026/01/a.png', modified: new Date('2026-01-03T00:00:00Z') },
      { at: '2026/01/b.pdf', bytes: pdf(), modified: new Date('2026-01-02T00:00:00Z') },
      { at: '2026/01/c.png', modified: new Date('2026-01-01T00:00:00Z') },
    ]);
  }

  it('steps to the previous and next file in the view it came from', async () => {
    const agent = await signedIn(await threeFiles());

    const all = await details(agent, '2026/01/b.pdf');
    assert.match(all, /rel="prev" href="\/admin\/media\/file\?path=2026%2F01%2Fa\.png"/);
    assert.match(all, /rel="next" href="\/admin\/media\/file\?path=2026%2F01%2Fc\.png"/);
    assert.match(all, />2 of 3</);

    const images = await details(agent, '2026/01/a.png', 'kind=image');
    assert.match(images, /aria-disabled="true">Previous</);
    assert.match(
      images,
      /rel="next" href="\/admin\/media\/file\?path=2026%2F01%2Fc\.png&amp;kind=image"/,
      'the PDF is skipped, and the view goes with the link',
    );
    assert.match(images, /href="\/admin\/media\?kind=image" data-media-library>/);
  });

  it('keeps a file its view no longer matches, so describing one does not strand it', async () => {
    const agent = await signedIn(await threeFiles());
    const { token } = await screen(agent);

    const saved = await agent.post('/admin/media/alt', {
      csrf_token: token,
      path: '2026/01/a.png',
      alt: 'A described picture',
      from: 'alt=missing',
    });

    assert.equal(saved.status, 303);
    assert.equal(
      saved.headers.get('location'),
      '/admin/media/file?path=2026%2F01%2Fa.png&alt=missing',
    );
    const html = await details(agent, '2026/01/a.png', 'alt=missing');
    assert.match(html, /Saved the alt text for 2026\/01\/a\.png/);
    assert.match(html, />A described picture<\/textarea>/);
    assert.match(
      html,
      /rel="next" href="\/admin\/media\/file\?path=2026%2F01%2Fc\.png&amp;alt=missing"/,
    );
  });

  it('asks before deleting on the details screen, and returns to the view after', async () => {
    const contentDir = await box.dir('geekity-media-content-');
    await drop(contentDir, { at: '2026/01/photo.png' });
    await seed(contentDir, {
      file: 'posts/2026-01-01-illustrated.md',
      title: 'Illustrated',
      permalink: '/2026/01/illustrated/',
      body: '![](/uploads/2026/01/photo.png)',
    });
    const agent = await signedIn(await box.site({ contentDir }));
    const { token } = await screen(agent);

    const asked = await (
      await agent.post('/admin/media/delete', {
        csrf_token: token,
        path: '2026/01/photo.png',
        from: 'kind=image',
      })
    ).text();
    assert.match(asked, /<h1[^>]*>photo\.png<\/h1>/, 'the question is on the details screen');
    assert.match(asked, /Delete \/uploads\/2026\/01\/photo\.png\?/);
    assert.match(asked, /name="from" value="kind=image"/);

    const confirmed = await agent.post('/admin/media/delete', {
      csrf_token: token,
      path: '2026/01/photo.png',
      from: 'kind=image',
      confirm: '1',
    });
    assert.equal(confirmed.headers.get('location'), '/admin/media?kind=image');
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
