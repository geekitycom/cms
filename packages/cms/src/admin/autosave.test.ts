import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { autosaveCopies, mintAutosaveId } from '../autosave/index.ts';
import type { AutosaveRecord } from '../autosave/index.ts';
import { createUser, findUser } from '../site/users.ts';
import { sessionCookieName } from '../web/session.ts';
import type { Cms } from '../index.ts';
import { fieldsOf } from './__testing__/editor-form.ts';
import { csrfField, sandbox, signedIn, signIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

const POST_FILE = 'posts/2026-01-02-hello.md';
const PAGE_FILE = 'pages/about.md';
const GRACE = { username: 'grace', password: 'a password of her own' };

async function site(): Promise<{ cms: Cms; ada: Browser; contentDir: string }> {
  const contentDir = await box.dir('geekity-autosave-content-');
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await mkdir(path.join(contentDir, 'pages'), { recursive: true });
  await writeFile(
    path.join(contentDir, POST_FILE),
    "---\ntitle: Hello\ndate: '2026-01-02T10:00:00.000Z'\npermalink: /2026/01/hello/\n---\n\nSaved words.\n",
  );
  await writeFile(
    path.join(contentDir, PAGE_FILE),
    '---\ntitle: About\npermalink: /about/\n---\n\nAbout words.\n',
  );
  const cms = await box.site({ contentDir });
  const ada = await signedIn(cms);
  return { cms, ada, contentDir };
}

function userId(cms: Cms, username: string): number {
  const user = findUser(cms.config.dataDir, username);
  assert.ok(user !== undefined);
  return user.id;
}

/** The editor's fields as the browser would post them, with some replaced. */
async function editorFields(
  agent: Browser,
  url: string,
  overrides: Record<string, string> = {},
): Promise<Record<string, string>> {
  const html = await (await agent.get(url)).text();
  return { ...Object.fromEntries(fieldsOf(html)), ...overrides };
}

/** Post fields as `multipart/form-data`, the way the bundle's `FormData` does. */
async function postFormData(
  cms: Cms,
  agent: Browser,
  url: string,
  fields: Record<string, string>,
): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const session = agent.session();
  return await cms.app.request(url, {
    method: 'POST',
    headers: session === undefined ? {} : { cookie: `${sessionCookieName(cms.config)}=${session}` },
    body: form,
  });
}

async function snapshot(dir: string, skip: (relative: string) => boolean): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .filter((relative) => !skip(relative))
    .sort();
  return Promise.all(
    files.map(
      async (relative) => `${relative}\n${await readFile(path.join(dir, relative), 'utf8')}`,
    ),
  );
}

const notCache = (relative: string): boolean =>
  relative.startsWith('autosave') || relative.startsWith('geekity.db');

describe('POST /admin/autosave', () => {
  it("stores the editor's fields for the signed-in user and touches nothing else", async () => {
    const { cms, ada, contentDir } = await site();
    const fields = await editorFields(ada, '/admin/posts/hello', {
      body: 'Words not saved yet.',
      autosave: POST_FILE,
    });
    const contentBefore = await snapshot(contentDir, () => false);
    const dataBefore = await snapshot(cms.config.dataDir, notCache);

    const response = await postFormData(cms, ada, '/admin/autosave', fields);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    const answer = (await response.json()) as { key: string; savedAt: string };
    assert.equal(answer.key, POST_FILE);
    assert.ok(Math.abs(Date.parse(answer.savedAt) - Date.now()) < 60_000, answer.savedAt);

    const copy = autosaveCopies(cms.config.dataDir).read(userId(cms, 'ada'), POST_FILE);
    assert.ok(copy !== undefined, 'the copy was written');
    assert.equal(copy.type, 'post');
    assert.equal(copy.path, POST_FILE);
    assert.equal(copy.hash, fields['hash']);
    assert.equal(copy.kind, fields['kind']);
    assert.equal(copy.savedAt, answer.savedAt);
    assert.equal(copy.fields['body'], 'Words not saved yet.');
    assert.equal(copy.fields['title'], 'Hello');
    assert.equal(copy.fields['csrf_token'], undefined, 'the token is not kept');

    assert.deepEqual(await snapshot(contentDir, () => false), contentBefore);
    assert.deepEqual(await snapshot(cms.config.dataDir, notCache), dataBefore);
  });

  it('overwrites the copy on the next autosave of the same key', async () => {
    const { cms, ada } = await site();
    const fields = await editorFields(ada, '/admin/posts/hello', { autosave: POST_FILE });

    await postFormData(cms, ada, '/admin/autosave', { ...fields, body: 'First.' });
    await postFormData(cms, ada, '/admin/autosave', { ...fields, body: 'Second.' });

    const copies = autosaveCopies(cms.config.dataDir).list(userId(cms, 'ada'));
    assert.deepEqual(
      copies.map((copy) => [copy.key, copy.fields['body']]),
      [[POST_FILE, 'Second.']],
    );
  });

  it('stores a new document under its minted id, with its type and kind and no path', async () => {
    const { cms, ada } = await site();
    const id = mintAutosaveId();
    const fields = await editorFields(ada, '/admin/posts/new?kind=note', {
      body: 'A note nobody saved.',
      autosave: id,
    });

    const response = await postFormData(cms, ada, '/admin/autosave', fields);

    assert.equal(response.status, 200);
    const copy = autosaveCopies(cms.config.dataDir).read(userId(cms, 'ada'), id);
    assert.equal(copy?.type, 'post');
    assert.equal(copy?.kind, 'note');
    assert.equal(copy?.path, undefined);
    assert.equal(copy?.fields['body'], 'A note nobody saved.');
  });

  it('takes a urlencoded form too', async () => {
    const { cms, ada } = await site();
    const fields = await editorFields(ada, '/admin/pages/about', { autosave: PAGE_FILE });

    const response = await ada.post('/admin/autosave', fields);

    assert.equal(response.status, 200);
    const copy = autosaveCopies(cms.config.dataDir).read(userId(cms, 'ada'), PAGE_FILE);
    assert.equal(copy?.type, 'page');
    assert.equal(copy?.kind, undefined);
  });

  it('refuses a key that does not parse, or a path outside the content directory, with 400', async () => {
    const { cms, ada } = await site();
    const { autosave: _, ...fields } = await editorFields(ada, '/admin/posts/hello');
    for (const key of [
      undefined,
      '',
      'new-nothex',
      '../data/users.json',
      '../outside.md',
      '/etc/x.md',
    ]) {
      const body = { ...fields };
      if (key !== undefined) body['autosave'] = key;
      const response = await postFormData(cms, ada, '/admin/autosave', body);
      assert.equal(response.status, 400, String(key));
      assert.ok(typeof ((await response.json()) as { error: unknown }).error === 'string');
    }
    assert.deepEqual(autosaveCopies(cms.config.dataDir).list(userId(cms, 'ada')), []);
  });

  it('refuses a content path that names no document with 404', async () => {
    const { cms, ada } = await site();
    const fields = await editorFields(ada, '/admin/posts/hello', { autosave: 'posts/gone.md' });

    const response = await postFormData(cms, ada, '/admin/autosave', fields);

    assert.equal(response.status, 404);
    assert.deepEqual(autosaveCopies(cms.config.dataDir).list(userId(cms, 'ada')), []);
  });

  it('is behind the guard: no CSRF token, no copy', async () => {
    const { cms, ada } = await site();
    const { csrf_token: _, ...fields } = await editorFields(ada, '/admin/posts/hello', {
      autosave: POST_FILE,
    });

    const response = await postFormData(cms, ada, '/admin/autosave', fields);

    assert.equal(response.status, 403);
    assert.deepEqual(autosaveCopies(cms.config.dataDir).list(userId(cms, 'ada')), []);
  });
});

describe('POST /admin/autosave/discard', () => {
  it("deletes the user's copy for a key and answers JSON", async () => {
    const { cms, ada } = await site();
    const fields = await editorFields(ada, '/admin/posts/hello', { autosave: POST_FILE });
    await postFormData(cms, ada, '/admin/autosave', fields);

    const response = await postFormData(cms, ada, '/admin/autosave/discard', {
      csrf_token: fields['csrf_token'] ?? '',
      autosave: POST_FILE,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { discarded: true });
    assert.equal(autosaveCopies(cms.config.dataDir).read(userId(cms, 'ada'), POST_FILE), undefined);
  });

  it('goes back to a return path under /admin when the form names one, for a page with no script', async () => {
    const { cms, ada } = await site();
    const fields = await editorFields(ada, '/admin/posts/hello', { autosave: POST_FILE });
    await postFormData(cms, ada, '/admin/autosave', fields);

    const response = await ada.post('/admin/autosave/discard', {
      csrf_token: fields['csrf_token'] ?? '',
      autosave: POST_FILE,
      return: '/admin/posts',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/posts');
    assert.equal(autosaveCopies(cms.config.dataDir).read(userId(cms, 'ada'), POST_FILE), undefined);
  });

  it('refuses a key that does not parse with 400', async () => {
    const { ada } = await site();
    const token = csrfField(await (await ada.get('/admin/posts/hello')).text()) ?? '';
    const response = await ada.post('/admin/autosave/discard', {
      csrf_token: token,
      autosave: '../users.json',
    });
    assert.equal(response.status, 400);
  });
});

describe('a copy belongs to the user who wrote it', () => {
  it('cannot be read, overwritten or discarded by another user', async () => {
    const { cms, ada } = await site();
    await createUser({ dataDir: cms.config.dataDir, ...GRACE });
    const grace = await signIn(cms, GRACE);
    const adaFields = await editorFields(ada, '/admin/posts/hello', {
      autosave: POST_FILE,
      body: "Ada's words.",
    });
    await postFormData(cms, ada, '/admin/autosave', adaFields);

    const graceFields = await editorFields(grace, '/admin/posts/hello', {
      autosave: POST_FILE,
      body: "Grace's words.",
    });
    await postFormData(cms, grace, '/admin/autosave', graceFields);
    const discarded = await postFormData(cms, grace, '/admin/autosave/discard', {
      csrf_token: graceFields['csrf_token'] ?? '',
      autosave: POST_FILE,
    });
    assert.deepEqual(await discarded.json(), { discarded: true }, "grace's own copy went");

    const copies = autosaveCopies(cms.config.dataDir);
    assert.equal(copies.read(userId(cms, 'ada'), POST_FILE)?.fields['body'], "Ada's words.");
    assert.equal(copies.read(userId(cms, 'grace'), POST_FILE), undefined);
  });

  it('goes when the user is deleted', async () => {
    const { cms, ada } = await site();
    await createUser({ dataDir: cms.config.dataDir, ...GRACE });
    const grace = await signIn(cms, GRACE);
    const graceId = userId(cms, 'grace');
    const fields = await editorFields(grace, '/admin/posts/hello', { autosave: POST_FILE });
    await postFormData(cms, grace, '/admin/autosave', fields);
    await postFormData(cms, grace, '/admin/autosave', { ...fields, autosave: mintAutosaveId() });
    await postFormData(cms, ada, '/admin/autosave', {
      ...(await editorFields(ada, '/admin/posts/hello')),
      autosave: POST_FILE,
    });
    assert.equal(autosaveCopies(cms.config.dataDir).list(graceId).length, 2);

    const token = csrfField(await (await ada.get('/admin/users')).text()) ?? '';
    const deleted = await ada.post('/admin/users/delete', {
      csrf_token: token,
      user_id: String(graceId),
    });

    assert.equal(deleted.status, 303);
    assert.deepEqual(autosaveCopies(cms.config.dataDir).list(graceId), []);
    assert.equal(autosaveCopies(cms.config.dataDir).list(userId(cms, 'ada')).length, 1);
  });
});

describe('saving through the editor', () => {
  async function withCopy(
    cms: Cms,
    ada: Browser,
    url: string,
    key: string,
  ): Promise<Record<string, string>> {
    const fields = await editorFields(ada, url, { autosave: key });
    assert.equal((await postFormData(cms, ada, '/admin/autosave', fields)).status, 200);
    return fields;
  }

  const copyOf = (cms: Cms, key: string) =>
    autosaveCopies(cms.config.dataDir).read(userId(cms, 'ada'), key);

  it("deletes the saver's copy when an update succeeds, and keeps other users' copies", async () => {
    const { cms, ada } = await site();
    await createUser({ dataDir: cms.config.dataDir, ...GRACE });
    const grace = await signIn(cms, GRACE);
    await withCopy(cms, grace, '/admin/posts/hello', POST_FILE);
    const fields = await withCopy(cms, ada, '/admin/posts/hello', POST_FILE);

    const saved = await ada.post('/admin/posts/hello', { ...fields, action: 'update' });

    assert.equal(saved.status, 303);
    assert.equal(copyOf(cms, POST_FILE), undefined);
    assert.ok(autosaveCopies(cms.config.dataDir).read(userId(cms, 'grace'), POST_FILE));
  });

  it('deletes the copy of a new document, by its minted id, when it is first saved', async () => {
    const { cms, ada } = await site();
    const id = mintAutosaveId();
    const fields = await withCopy(cms, ada, '/admin/posts/new?kind=note', id);

    const saved = await ada.post('/admin/posts/new', {
      ...fields,
      body: 'A note at last.',
      action: 'publish',
    });

    assert.equal(saved.status, 303);
    assert.equal(copyOf(cms, id), undefined);
  });

  it('deletes the copy when the document is moved to the trash', async () => {
    const { cms, ada } = await site();
    const fields = await withCopy(cms, ada, '/admin/pages/about', PAGE_FILE);

    const trashed = await ada.post('/admin/pages/about', {
      csrf_token: fields['csrf_token'] ?? '',
      action: 'trash',
    });

    assert.equal(trashed.status, 303);
    assert.equal(copyOf(cms, PAGE_FILE), undefined);
  });

  it('keeps the copy when the save conflicts with a newer file', async () => {
    const { cms, ada } = await site();
    const fields = await withCopy(cms, ada, '/admin/posts/hello', POST_FILE);

    const refused = await ada.post('/admin/posts/hello', {
      ...fields,
      hash: 'not-the-hash-on-disk',
      action: 'update',
    });

    assert.equal(refused.status, 409);
    assert.ok(copyOf(cms, POST_FILE));
  });

  it('keeps the copy when the save is refused', async () => {
    const { cms, ada } = await site();
    const fields = await withCopy(cms, ada, '/admin/posts/hello', POST_FILE);

    const refused = await ada.post('/admin/posts/hello', {
      ...fields,
      'in-reply-to': 'their post',
      action: 'update',
    });

    assert.equal(refused.status, 400);
    assert.ok(copyOf(cms, POST_FILE));
  });
});

describe('boot', () => {
  it('prunes copies older than 30 days and keeps newer ones', async () => {
    const contentDir = await box.dir('geekity-autosave-content-');
    const dataDir = await box.dir('geekity-autosave-data-');
    const now = new Date('2026-10-23T12:00:00.000Z');
    const record = (savedAt: string): AutosaveRecord => ({
      type: 'post',
      hash: '',
      fields: { body: savedAt },
      savedAt,
    });
    const copies = autosaveCopies(dataDir);
    copies.save(1, 'new-00000000000000000000000000000001', record('2026-09-20T12:00:00.000Z'));
    copies.save(1, 'new-00000000000000000000000000000002', record('2026-10-01T12:00:00.000Z'));

    await box.open({ contentDir, dataDir, now: () => now });

    assert.deepEqual(
      copies.list(1).map((copy) => copy.key),
      ['new-00000000000000000000000000000002'],
    );
  });
});

describe('the editor page', () => {
  const autosaveOf = (html: string): string | undefined =>
    /<input type="hidden" name="autosave" value="([^"]*)"/.exec(html)?.[1];
  const enhance = (html: string): string =>
    /<div[^>]*id="editor-enhance"[^>]*>/.exec(html)?.[0] ?? '';

  it('carries the content path of a document that exists as its autosave key', async () => {
    const { ada } = await site();
    const html = await (await ada.get('/admin/posts/hello')).text();
    assert.equal(autosaveOf(html), POST_FILE);
  });

  it('mints an id for a new document, a fresh one each time it opens', async () => {
    const { ada } = await site();
    const first = autosaveOf(await (await ada.get('/admin/posts/new?kind=note')).text());
    const second = autosaveOf(await (await ada.get('/admin/pages/new')).text());
    assert.match(first ?? '', /^new-[0-9a-f]{32}$/);
    assert.match(second ?? '', /^new-[0-9a-f]{32}$/);
    assert.notEqual(first, second);
  });

  it('keeps the id a reloaded new editor names in its URL, and mints over one that is not an id', async () => {
    const { ada } = await site();
    const id = mintAutosaveId();
    const kept = await (await ada.get(`/admin/posts/new?kind=note&autosave=${id}`)).text();
    assert.equal(autosaveOf(kept), id);

    const minted = autosaveOf(
      await (await ada.get('/admin/posts/new?kind=note&autosave=posts/x.md')).text(),
    );
    assert.match(minted ?? '', /^new-[0-9a-f]{32}$/);
  });

  it('keeps the posted id when a new document comes back refused', async () => {
    const { ada } = await site();
    const id = mintAutosaveId();
    const fields = await editorFields(ada, '/admin/posts/new?kind=note', {
      autosave: id,
      'in-reply-to': 'their post',
    });
    const refused = await ada.post('/admin/posts/new', { ...fields, action: 'publish' });
    assert.equal(refused.status, 400);
    assert.equal(autosaveOf(await refused.text()), id);
  });

  it('names the autosave endpoint and the signed-in user for the script', async () => {
    const { cms, ada } = await site();
    const tag = enhance(await (await ada.get('/admin/posts/hello')).text());
    assert.match(tag, /data-autosave-url="\/admin\/autosave"/);
    assert.match(tag, new RegExp(`data-autosave-user="${String(userId(cms, 'ada'))}"`));
  });

  it('names the keys a save cleared on the next editor page, once', async () => {
    const { ada } = await site();
    const id = mintAutosaveId();
    const fields = await editorFields(ada, '/admin/posts/new?kind=note', { autosave: id });
    const saved = await ada.post('/admin/posts/new', {
      ...fields,
      body: 'Saved by hand.',
      action: 'publish',
    });
    assert.equal(saved.status, 303);
    const next = saved.headers.get('location') ?? '';

    const after = await (await ada.get(next)).text();
    const cleared = /data-autosave-cleared="([^"]*)"/.exec(enhance(after))?.[1] ?? '';
    const keys = JSON.parse(cleared.replaceAll('&quot;', '"')) as string[];
    assert.ok(keys.includes(id), cleared);
    assert.match(after, /Published/, 'the save message still shows');

    const again = enhance(await (await ada.get(next)).text());
    assert.doesNotMatch(again, /data-autosave-cleared/);
  });

  it('names nothing cleared after a save that was refused', async () => {
    const { ada } = await site();
    const fields = await editorFields(ada, '/admin/posts/hello');
    const refused = await ada.post('/admin/posts/hello', {
      ...fields,
      'in-reply-to': 'their post',
      action: 'update',
    });
    assert.equal(refused.status, 400);
    assert.doesNotMatch(enhance(await refused.text()), /data-autosave-cleared/);
  });
});
