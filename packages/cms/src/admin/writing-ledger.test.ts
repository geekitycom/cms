/**
 * The writing ledger (TASK-499, decision-63): the words a user adds in the
 * editor are credited to them on autosave and on save, each measured from the
 * last text the server saw from that user.
 */
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { siteSettingsIn, writeSiteSettings } from '../__testing__/site-settings.ts';
import { mintAutosaveId } from '../autosave/index.ts';
import { createUser, findUser, setUserWritingGoals } from '../site/users.ts';
import type { Cms } from '../index.ts';
import { readWritingLedger } from '../writing/ledger.ts';
import { fieldsOf } from './__testing__/editor-form.ts';
import { sandbox, signedIn, signIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { deleteUser } from './users.ts';

const box = sandbox();
after(() => box.cleanup());

const POST_FILE = 'posts/2026-01-02-hello.md';
const EDITOR = '/admin/posts/hello';
const NOW = new Date('2026-10-23T15:00:00.000Z');
const TODAY = '2026-10-23';
const GRACE = { username: 'grace', password: 'a password of her own' };

async function site(now: () => Date = () => NOW): Promise<{ cms: Cms; ada: Browser }> {
  const contentDir = await box.dir('geekity-writing-content-');
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, POST_FILE),
    "---\ntitle: Hello\ndate: '2026-01-02T10:00:00.000Z'\npermalink: /2026/01/hello/\n---\n\nSaved words here.\n",
  );
  const cms = await box.site({ contentDir, now });
  return { cms, ada: await signedIn(cms) };
}

function idOf(cms: Cms, username: string): number {
  const user = findUser(cms.config.dataDir, username);
  assert.ok(user !== undefined);
  return user.id;
}

function written(cms: Cms, username = 'ada'): Readonly<Record<string, number>> {
  return readWritingLedger(cms.config.dataDir, idOf(cms, username)).days;
}

async function editorFields(agent: Browser, url: string): Promise<Record<string, string>> {
  return Object.fromEntries(fieldsOf(await (await agent.get(url)).text()));
}

async function autosave(agent: Browser, fields: Record<string, string>): Promise<number> {
  const response = await agent.post('/admin/autosave', fields);
  assert.equal(response.status, 200);
  const answer = (await response.json()) as { wordsToday: number };
  return answer.wordsToday;
}

function words(count: number, word = 'word'): string {
  return Array.from({ length: count }, (_, index) => `${word}${String(index)}`).join(' ');
}

describe('crediting words on autosave', () => {
  it('credits the words added to the saved file when there is no copy yet, and answers the day total', async () => {
    const { cms, ada } = await site();
    const fields = await editorFields(ada, EDITOR);

    const today = await autosave(ada, { ...fields, body: 'Saved words here, and four more now.' });

    assert.equal(today, 4);
    assert.deepEqual(written(cms), { [TODAY]: 4 });
  });

  it("credits only the words added since the user's previous autosave copy", async () => {
    const { cms, ada } = await site();
    const fields = await editorFields(ada, EDITOR);

    await autosave(ada, { ...fields, body: 'Saved words here. One two.' });
    const today = await autosave(ada, { ...fields, body: 'Saved words here. One two three.' });

    assert.equal(today, 3);
    assert.deepEqual(written(cms), { [TODAY]: 3 });
  });

  it('credits the whole body of a new document', async () => {
    const { cms, ada } = await site();
    const id = mintAutosaveId();
    const fields = await editorFields(ada, '/admin/posts/new?kind=note');

    assert.equal(await autosave(ada, { ...fields, autosave: id, body: 'A brand new note.' }), 4);
    assert.deepEqual(written(cms), { [TODAY]: 4 });
  });

  it('answers the day total even when nothing was added, and deleting takes nothing back', async () => {
    const { cms, ada } = await site();
    const fields = await editorFields(ada, EDITOR);

    await autosave(ada, { ...fields, body: 'Saved words here and more.' });
    assert.equal(await autosave(ada, { ...fields, body: 'Saved.' }), 2);
    assert.deepEqual(written(cms), { [TODAY]: 2 });
  });

  it('buckets the credit on the day in the site timezone', async () => {
    const { cms, ada } = await site(() => new Date('2026-10-24T04:59:00.000Z'));
    await writeSiteSettings({
      contentDir: cms.config.contentDir,
      settings: { ...(await siteSettingsIn(cms.config.contentDir)), timezone: 'America/Chicago' },
    });
    const fields = await editorFields(ada, EDITOR);

    await autosave(ada, { ...fields, body: 'Saved words here, late.' });

    assert.deepEqual(written(cms), { [TODAY]: 1 });
  });
});

describe('crediting words on save', () => {
  it('credits the words added to the file on disk when there is no copy, and nothing for a second save with no change', async () => {
    const { cms, ada } = await site();
    const fields = await editorFields(ada, EDITOR);

    const saved = await ada.post(EDITOR, {
      ...fields,
      body: 'Saved words here. Five more words right here.',
      action: 'publish',
    });
    assert.equal(saved.status, 303);
    assert.deepEqual(written(cms), { [TODAY]: 5 });

    const again = await editorFields(ada, EDITOR);
    assert.equal((await ada.post(EDITOR, { ...again, action: 'publish' })).status, 303);
    assert.deepEqual(written(cms), { [TODAY]: 5 });
  });

  it('typing 100 words, autosaving, then saving credits 100 words, not 200', async () => {
    const { cms, ada } = await site();
    const id = mintAutosaveId();
    const fields = await editorFields(ada, '/admin/posts/new?kind=note');
    const body = words(100);

    assert.equal(await autosave(ada, { ...fields, autosave: id, body }), 100);
    const saved = await ada.post('/admin/posts/new', {
      ...fields,
      autosave: id,
      body,
      action: 'publish',
    });

    assert.equal(saved.status, 303);
    assert.ok(cms.store.listAll({ type: 'post' }).some((document) => document.body === body));
    assert.deepEqual(written(cms), { [TODAY]: 100 });
  });

  it('credits the words added after the last autosave when saving', async () => {
    const { cms, ada } = await site();
    const fields = await editorFields(ada, EDITOR);

    await autosave(ada, { ...fields, body: 'Saved words here. One.' });
    await ada.post(EDITOR, {
      ...fields,
      body: 'Saved words here. One two three.',
      action: 'publish',
    });

    assert.deepEqual(written(cms), { [TODAY]: 3 });
  });

  it('credits nothing for a save that is refused', async () => {
    const { cms, ada } = await site();
    const fields = await editorFields(ada, EDITOR);

    const refused = await ada.post(EDITOR, {
      ...fields,
      body: 'Saved words here and more.',
      hash: 'not-the-hash-it-was-read-with',
      action: 'publish',
    });

    assert.notEqual(refused.status, 303);
    assert.deepEqual(written(cms), {});
  });
});

describe('two users on one post', () => {
  it('credits each from their own copy', async () => {
    const { cms, ada } = await site();
    await createUser({ dataDir: cms.config.dataDir, ...GRACE });
    const grace = await signIn(cms, GRACE);
    const adaFields = await editorFields(ada, EDITOR);
    const graceFields = await editorFields(grace, EDITOR);

    await autosave(ada, { ...adaFields, body: 'Saved words here. Ada one two.' });
    await autosave(grace, { ...graceFields, body: 'Saved words here. Grace.' });
    await autosave(ada, { ...adaFields, body: 'Saved words here. Ada one two three.' });

    assert.deepEqual(written(cms, 'ada'), { [TODAY]: 4 });
    assert.deepEqual(written(cms, 'grace'), { [TODAY]: 1 });
  });
});

describe('writes outside the editor and Micropub', () => {
  it('credit no one when a file is written to the content folder, as an import or the CLI does', async () => {
    const { cms } = await site();
    await writeFile(
      path.join(cms.config.contentDir, 'posts', '2026-02-03-imported.md'),
      "---\ntitle: Imported\ndate: '2026-02-03T10:00:00.000Z'\npermalink: /2026/02/imported/\n---\n\nWords that came from somewhere else.\n",
    );
    await cms.sync();

    assert.ok(cms.store.getByPath('posts/2026-02-03-imported.md') !== undefined);
    await assert.rejects(readdir(path.join(cms.config.dataDir, 'writing')), { code: 'ENOENT' });
  });

  it('are the only callers of the credit', async () => {
    const source = path.resolve(import.meta.dirname, '..');
    const callers: string[] = [];
    for (const entry of await readdir(source, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
        continue;
      }
      const file = path.join(entry.parentPath, entry.name);
      if ((await readFile(file, 'utf8')).includes('creditWriting(')) {
        callers.push(path.relative(source, file).split(path.sep).join('/'));
      }
    }
    assert.deepEqual(callers.sort(), [
      'admin/autosave.ts',
      'admin/documents.ts',
      'micropub/endpoint.ts',
      'writing/ledger.ts',
    ]);
  });
});

describe('deleting a user', () => {
  it('deletes their ledger', async () => {
    const { cms } = await site();
    await createUser({ dataDir: cms.config.dataDir, ...GRACE });
    const grace = await signIn(cms, GRACE);
    await autosave(grace, { ...(await editorFields(grace, EDITOR)), body: 'One two three.' });
    const id = idOf(cms, 'grace');
    assert.deepEqual(readWritingLedger(cms.config.dataDir, id).days, { [TODAY]: 3 });

    await deleteUser({ dataDir: cms.config.dataDir, userId: id, now: NOW });

    assert.deepEqual(readWritingLedger(cms.config.dataDir, id).days, {});
  });
});

describe("the editor's word counter", () => {
  async function track(cms: Cms, tracking: boolean): Promise<void> {
    await setUserWritingGoals({
      dataDir: cms.config.dataDir,
      userId: idOf(cms, 'ada'),
      goals: { tracking, words: 500, period: 'day', streak: { dailyWords: 500, missesAllowed: 0 } },
    });
  }

  async function counter(agent: Browser): Promise<string> {
    const response = await agent.get(EDITOR);
    assert.equal(response.status, 200);
    const found = /<p\b[^>]*\bid="editor-words"[^>]*>[^<]*<\/p>/.exec(await response.text());
    assert.ok(found !== null, 'the editor renders a word counter');
    return found[0];
  }

  it("shows the body's word count to a user who does not track writing goals, and no words today", async () => {
    const { cms, ada } = await site();
    await autosave(ada, {
      ...(await editorFields(ada, EDITOR)),
      body: 'Saved words here, and more.',
    });
    await track(cms, false);

    const shown = await counter(ada);

    assert.match(shown, />3 words</);
    assert.doesNotMatch(shown, /today|data-words-today/);
  });

  it("adds today's words from the ledger for a user who tracks writing goals", async () => {
    const { cms, ada } = await site();
    await autosave(ada, {
      ...(await editorFields(ada, EDITOR)),
      body: 'Saved words here, and more.',
    });
    await track(cms, true);

    const shown = await counter(ada);

    assert.match(shown, />3 words · 2 today</);
    assert.match(shown, /data-words-today="2"/);
  });

  it('still opens the editor, counting 0 today, when the ledger cannot be read', async () => {
    const { cms, ada } = await site();
    await track(cms, true);
    const ledger = path.join(cms.config.dataDir, 'writing', `${String(idOf(cms, 'ada'))}.json`);
    await mkdir(path.dirname(ledger), { recursive: true });
    await writeFile(ledger, 'not json');

    assert.match(await counter(ada), />3 words · 0 today</);
  });
});
