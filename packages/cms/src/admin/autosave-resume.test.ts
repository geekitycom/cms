import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { autosaveCopies, mintAutosaveId } from '../autosave/index.ts';
import type { AutosaveRecord } from '../autosave/index.ts';
import { createUser, findUser } from '../site/users.ts';
import type { Cms } from '../index.ts';
import { elementAt, fieldsOf } from './__testing__/editor-form.ts';
import { csrfField, sandbox, signedIn, signIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

const POST_FILE = 'posts/2026-01-02-hello.md';
const PAGE_FILE = 'pages/about.md';
const EDITOR = '/admin/posts/hello';
const UPDATED = '2026-05-01T12:00:00.000Z';

async function site(): Promise<{ cms: Cms; ada: Browser; contentDir: string; hash: string }> {
  const contentDir = await box.dir('geekity-resume-content-');
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await mkdir(path.join(contentDir, 'pages'), { recursive: true });
  await writeFile(
    path.join(contentDir, POST_FILE),
    `---\ntitle: Hello\ndate: '2026-01-02T10:00:00.000Z'\nupdated: '${UPDATED}'\npermalink: /2026/01/hello/\n---\n\nSaved words.\n`,
  );
  await writeFile(
    path.join(contentDir, PAGE_FILE),
    '---\ntitle: About\npermalink: /about/\n---\n\nAbout words.\n',
  );
  const cms = await box.site({ contentDir });
  const ada = await signedIn(cms);
  const hash = Object.fromEntries(fieldsOf(await (await ada.get(EDITOR)).text()))['hash'] ?? '';
  return { cms, ada, contentDir, hash };
}

function userId(cms: Cms, username = 'ada'): number {
  const user = findUser(cms.config.dataDir, username);
  assert.ok(user !== undefined);
  return user.id;
}

/** File a copy straight into the store, as an earlier autosave would have. */
function keep(cms: Cms, key: string, record: Partial<AutosaveRecord>, username = 'ada'): void {
  autosaveCopies(cms.config.dataDir).save(userId(cms, username), key, {
    type: 'post',
    hash: '',
    fields: {},
    savedAt: '2026-06-01T09:30:00.000Z',
    ...record,
  });
}

function postCopy(hash: string, fields: Record<string, string> = {}): Partial<AutosaveRecord> {
  return {
    type: 'post',
    kind: 'note',
    path: POST_FILE,
    hash,
    fields: {
      title: 'Hello again',
      body: 'Words nobody saved.',
      tags: 'one, two',
      date: '2026-01-02T10:00',
      hash,
      kind: 'note',
      type: 'post',
      autosave: POST_FILE,
      draft: '1',
      ...fields,
    },
  };
}

function banner(html: string): string | undefined {
  const at = html.indexOf('id="autosave-resume"');
  if (at === -1) return undefined;
  return elementAt(html, html.lastIndexOf('<div', at));
}

const decode = (value: string): string =>
  value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");

describe('the editor offers a copy back', () => {
  it('shows nothing when the user has no copy', async () => {
    const { ada } = await site();
    assert.equal(banner(await (await ada.get(EDITOR)).text()), undefined);
  });

  it('shows an alert with the time, Restore and Discard when a copy is newer than the file', async () => {
    const { cms, ada, hash } = await site();
    keep(cms, POST_FILE, postCopy(hash));

    const html = await (await ada.get(EDITOR)).text();
    const shown = banner(html);

    assert.ok(shown !== undefined, 'the banner is on the page');
    assert.match(shown, /role="alert"/);
    assert.match(shown, /Unsaved changes from <time datetime="2026-06-01T09:30:00.000Z">/);
    assert.doesNotMatch(shown, /changed since/);
    assert.match(shown, /<a [^>]*href="\/admin\/posts\/hello\?restore=1"[^>]*>Restore<\/a>/);
    assert.match(shown, /<form [^>]*method="post" action="\/admin\/autosave\/discard"/);
    assert.match(shown, /name="autosave" value="posts\/2026-01-02-hello.md"/);
    assert.match(shown, /name="return" value="\/admin\/posts\/hello"/);
    assert.match(shown, /<button[^>]*type="submit"[^>]*>Discard<\/button>/);
    assert.ok(
      html.indexOf('id="autosave-resume"') < html.indexOf('id="editor-form"'),
      'the banner comes before the form, outside it',
    );
  });

  it('shows nothing for a copy older than the last save of the file', async () => {
    const { cms, ada, hash } = await site();
    keep(cms, POST_FILE, { ...postCopy(hash), savedAt: '2026-04-01T00:00:00.000Z' });
    assert.equal(banner(await (await ada.get(EDITOR)).text()), undefined);
  });

  it("shows nothing for another user's copy", async () => {
    const { cms, ada, hash } = await site();
    await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'a password of her own',
    });
    keep(cms, POST_FILE, postCopy(hash), 'grace');
    assert.equal(banner(await (await ada.get(EDITOR)).text()), undefined);
  });

  it('says the post changed since when the copy was made from another version of the file', async () => {
    const { cms, ada } = await site();
    keep(cms, POST_FILE, postCopy('an-older-hash'));
    const shown = banner(await (await ada.get(EDITOR)).text());
    assert.ok(shown !== undefined);
    assert.match(shown, /This post has changed since/);
  });

  it('names the copy and the file times for the script', async () => {
    const { cms, ada, hash } = await site();
    keep(cms, POST_FILE, postCopy(hash));
    const html = await (await ada.get(EDITOR)).text();
    assert.match(html, /data-autosave-copy-saved-at="2026-06-01T09:30:00.000Z"/);
    assert.match(html, new RegExp(`data-autosave-file-time="${UPDATED}"`));
  });
});

describe('Restore', () => {
  it('fills the editor from the copy without saving, with no banner', async () => {
    const { cms, ada, contentDir, hash } = await site();
    keep(cms, POST_FILE, postCopy(hash));

    const response = await ada.get(`${EDITOR}?restore=1`);
    assert.equal(response.status, 200);
    const html = await response.text();
    const fields = Object.fromEntries(fieldsOf(html));

    assert.equal(fields['title'], 'Hello again');
    assert.equal(fields['body'], 'Words nobody saved.');
    assert.equal(fields['tags'], 'one, two');
    assert.equal(fields['draft'], '1', 'the Draft checkbox comes back ticked');
    assert.equal(fields['hash'], hash);
    assert.equal(fields['autosave'], POST_FILE);
    assert.equal(banner(html), undefined);
    const { readFile } = await import('node:fs/promises');
    assert.match(await readFile(path.join(contentDir, POST_FILE), 'utf8'), /Saved words\./);
  });

  it('brings back repeated photo fields', async () => {
    const { cms, ada, hash } = await site();
    keep(cms, POST_FILE, {
      ...postCopy(hash, {
        kind: 'photo',
        'photo-url-0': 'https://example.com/a.jpg',
        'photo-alt-0': 'A lake',
        'photo-url-1': 'https://example.com/b.jpg',
        'photo-alt-1': 'A hill',
      }),
      kind: 'photo',
    });
    const fields = Object.fromEntries(
      fieldsOf(await (await ada.get(`${EDITOR}?restore=1`)).text()),
    );
    assert.equal(fields['photo-url-0'], 'https://example.com/a.jpg');
    assert.equal(fields['photo-alt-1'], 'A hill');
    assert.equal(fields['kind'], 'photo');
  });

  it('shows the copy beside the current file, as the conflict screen does, when the file changed since', async () => {
    const { cms, ada } = await site();
    keep(cms, POST_FILE, postCopy('an-older-hash'));

    const response = await ada.get(`${EDITOR}?restore=1`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /<h1[^>]*>This post changed since your unsaved changes<\/h1>/);
    assert.match(html, /id="conflict-submitted"[^>]*>[^<]*Words nobody saved\./);
    assert.match(html, /id="conflict-current"[^>]*>[^<]*Saved words\./);
    assert.match(html, /href="\/admin\/posts\/hello\?restore=rebase"/);
    assert.match(html, /action="\/admin\/autosave\/discard"/);
    assert.doesNotMatch(html, /Keep mine and overwrite the file/);
  });

  it('opens the editor from the copy over the current file when the writer keeps theirs', async () => {
    const { cms, ada, hash } = await site();
    keep(cms, POST_FILE, postCopy('an-older-hash'));

    const fields = Object.fromEntries(
      fieldsOf(await (await ada.get(`${EDITOR}?restore=rebase`)).text()),
    );
    assert.equal(fields['body'], 'Words nobody saved.');
    assert.equal(fields['hash'], hash, 'the form carries the hash of the file as it is now');
  });

  it('opens the editor as it is when there is no copy to restore', async () => {
    const { ada } = await site();
    const fields = Object.fromEntries(
      fieldsOf(await (await ada.get(`${EDITOR}?restore=1`)).text()),
    );
    assert.equal(fields['body'], 'Saved words.');
  });
});

describe('Discard from the banner', () => {
  it('deletes the copy and returns to the editor as loaded, naming the key the script clears', async () => {
    const { cms, ada, hash } = await site();
    keep(cms, POST_FILE, postCopy(hash));
    const html = await (await ada.get(EDITOR)).text();

    const response = await ada.post('/admin/autosave/discard', {
      csrf_token: csrfField(html) ?? '',
      autosave: POST_FILE,
      return: EDITOR,
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), EDITOR);
    assert.equal(autosaveCopies(cms.config.dataDir).read(userId(cms), POST_FILE), undefined);

    const back = await (await ada.get(EDITOR)).text();
    assert.equal(banner(back), undefined);
    assert.equal(Object.fromEntries(fieldsOf(back))['body'], 'Saved words.');
    const cleared = /data-autosave-cleared="([^"]*)"/.exec(back)?.[1] ?? '';
    assert.deepEqual(JSON.parse(decode(cleared)), [POST_FILE]);
  });
});

describe('a new document', () => {
  it('offers its copy back when the editor reopens with its id', async () => {
    const { cms, ada } = await site();
    const id = mintAutosaveId();
    keep(cms, id, {
      type: 'post',
      kind: 'note',
      fields: { body: 'A note in progress.', kind: 'note', type: 'post', autosave: id },
    });

    const shown = banner(await (await ada.get(`/admin/posts/new?kind=note&autosave=${id}`)).text());
    assert.ok(shown !== undefined);
    assert.match(
      shown,
      new RegExp(`href="/admin/posts/new\\?kind=note&amp;autosave=${id}&amp;restore=1"`),
    );
  });

  it('resumes into the new editor with its kind and id, and saving it creates the post and deletes the copy', async () => {
    const { cms, ada } = await site();
    const id = mintAutosaveId();
    keep(cms, id, {
      type: 'post',
      kind: 'note',
      fields: { body: 'A note in progress.', kind: 'note', type: 'post', autosave: id },
    });

    const html = await (
      await ada.get(`/admin/posts/new?kind=note&autosave=${id}&restore=1`)
    ).text();
    const fields = Object.fromEntries(fieldsOf(html));
    assert.equal(fields['body'], 'A note in progress.');
    assert.equal(fields['kind'], 'note');
    assert.equal(fields['autosave'], id);

    const saved = await ada.post('/admin/posts/new', { ...fields, action: 'publish' });
    assert.equal(saved.status, 303);
    const created = cms.store.listAll({ type: 'post' }).find((d) => d.body.includes('in progress'));
    assert.ok(created !== undefined, 'the post was written');
    assert.equal(autosaveCopies(cms.config.dataDir).read(userId(cms), id), undefined);
  });

  it('resumes a page copy into the new page editor', async () => {
    const { cms, ada } = await site();
    const id = mintAutosaveId();
    keep(cms, id, {
      type: 'page',
      fields: { title: 'Colophon', body: 'How it is made.', type: 'page', autosave: id },
    });
    const fields = Object.fromEntries(
      fieldsOf(await (await ada.get(`/admin/pages/new?autosave=${id}&restore=1`)).text()),
    );
    assert.equal(fields['title'], 'Colophon');
    assert.equal(fields['body'], 'How it is made.');
  });
});

describe('the Unsaved filter', () => {
  async function listed(): Promise<{ cms: Cms; ada: Browser; id: string; pageId: string }> {
    const { cms, ada, hash } = await site();
    const id = mintAutosaveId();
    const pageId = mintAutosaveId();
    keep(cms, POST_FILE, { ...postCopy(hash), savedAt: '2026-06-01T09:30:00.000Z' });
    keep(cms, id, {
      type: 'post',
      kind: 'note',
      fields: {
        body: 'A note in progress that goes on for quite a while past the cut.',
        kind: 'note',
        type: 'post',
        autosave: id,
      },
      savedAt: '2026-06-02T09:30:00.000Z',
    });
    keep(cms, pageId, {
      type: 'page',
      fields: { title: 'Colophon', body: 'How.', type: 'page', autosave: pageId },
    });
    return { cms, ada, id, pageId };
  }

  it('is one of the tabs on the Posts and Pages lists', async () => {
    const { ada } = await site();
    for (const list of ['/admin/posts', '/admin/pages']) {
      const html = await (await ada.get(list)).text();
      assert.match(html, new RegExp(`href="${list}\\?status=unsaved"[^>]*>Unsaved<`));
    }
  });

  it("lists the user's post copies, new and existing, with Resume and Discard", async () => {
    const { ada, id } = await listed();
    const html = await (await ada.get('/admin/posts?status=unsaved')).text();

    assert.match(html, /aria-current="page">Unsaved</);
    assert.match(html, /Hello again/);
    assert.match(html, /A note in progress that goes on/);
    assert.doesNotMatch(html, /Colophon/, 'a page copy is on the Pages list');
    assert.match(html, /<td[^>]*>Note<\/td>/);
    assert.match(html, /<time datetime="2026-06-02T09:30:00.000Z"/);
    assert.match(html, /Edits to Hello/);
    assert.match(html, /New post/);
    assert.match(html, /href="\/admin\/posts\/hello\?restore=1"[^>]*>Resume</);
    assert.match(
      html,
      new RegExp(
        `href="/admin/posts/new\\?kind=note&amp;autosave=${id}&amp;restore=1"[^>]*>Resume<`,
      ),
    );
    assert.match(html, new RegExp(`name="autosave" value="${id}"`));
    assert.match(html, /name="return" value="\/admin\/posts\?status=unsaved"/);
    assert.ok(html.indexOf('A note in progress') < html.indexOf('Hello again'), 'newest first');
  });

  it('lists page copies on the Pages list', async () => {
    const { ada, pageId } = await listed();
    const html = await (await ada.get('/admin/pages?status=unsaved')).text();
    assert.match(html, /Colophon/);
    assert.doesNotMatch(html, /Hello again/);
    assert.match(html, new RegExp(`href="/admin/pages/new\\?autosave=${pageId}&amp;restore=1"`));
  });

  it('says so when there is nothing unsaved', async () => {
    const { ada } = await site();
    const html = await (await ada.get('/admin/posts?status=unsaved')).text();
    assert.match(html, /No unsaved changes/);
  });

  it('discards without JavaScript and comes back to the list', async () => {
    const { cms, ada, id } = await listed();
    const html = await (await ada.get('/admin/posts?status=unsaved')).text();
    const response = await ada.post('/admin/autosave/discard', {
      csrf_token: csrfField(html) ?? '',
      autosave: id,
      return: '/admin/posts?status=unsaved',
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/posts?status=unsaved');
    assert.equal(autosaveCopies(cms.config.dataDir).read(userId(cms), id), undefined);
    assert.doesNotMatch(
      await (await ada.get('/admin/posts?status=unsaved')).text(),
      /A note in progress/,
    );
  });

  it("does not list another user's copies", async () => {
    const { cms } = await listed();
    await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'a password of her own',
    });
    const grace = await signIn(cms, { username: 'grace', password: 'a password of her own' });
    const html = await (await grace.get('/admin/posts?status=unsaved')).text();
    assert.doesNotMatch(html, /Hello again|A note in progress/);
  });
});
