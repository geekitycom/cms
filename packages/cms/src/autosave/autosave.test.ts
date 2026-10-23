import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { CORE_DATA_FILES, classifyFiles } from '../files/data-files.ts';
import {
  AUTOSAVE_KEEP_DAYS,
  autosaveCopies,
  isMintedAutosaveId,
  mintAutosaveId,
  parseAutosaveKey,
} from './index.ts';
import type { AutosaveRecord } from './index.ts';

const dirs: string[] = [];
after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-autosave-'));
  dirs.push(dir);
  return dir;
}

const CONTENT = path.join(tmpdir(), 'geekity-autosave-content');

function record(overrides: Partial<AutosaveRecord> = {}): AutosaveRecord {
  return {
    type: 'post',
    kind: 'article',
    path: 'posts/hello-world.md',
    hash: 'abc123',
    fields: { title: 'Hello', body: 'Draft words.', kind: 'article' },
    savedAt: '2026-10-23T12:00:00.000Z',
    ...overrides,
  };
}

describe('autosave keys', () => {
  it('mints ids that validate, and never the same one twice', () => {
    const first = mintAutosaveId();
    const second = mintAutosaveId();
    assert.match(first, /^new-[0-9a-f]{32}$/);
    assert.notEqual(first, second);
    assert.ok(isMintedAutosaveId(first));
    for (const bad of ['new-', 'new-XYZ', `new-${'a'.repeat(31)}`, 'posts/a.md', 7, undefined]) {
      assert.equal(isMintedAutosaveId(bad), false, String(bad));
    }
  });

  it('parses a minted id as a new document and a content path as an existing one', () => {
    const id = mintAutosaveId();
    assert.deepEqual(parseAutosaveKey(CONTENT, id), { kind: 'new', key: id });
    assert.deepEqual(parseAutosaveKey(CONTENT, 'posts/hello-world.md'), {
      kind: 'existing',
      key: 'posts/hello-world.md',
      path: 'posts/hello-world.md',
    });
    assert.deepEqual(parseAutosaveKey(CONTENT, 'pages/_trash/about.md'), {
      kind: 'existing',
      key: 'pages/_trash/about.md',
      path: 'pages/_trash/about.md',
    });
  });

  it('refuses a key that does not parse or a path outside the content directory', () => {
    for (const bad of [
      '',
      'new-zz',
      '../data/users.json',
      'posts/../../etc/passwd.md',
      '/etc/hosts.md',
      'posts\\hello.md',
      'posts//hello.md',
      'posts/./hello.md',
      'posts/hello.txt',
      'posts/hello.md\0',
      42,
      undefined,
    ]) {
      assert.equal(parseAutosaveKey(CONTENT, bad), undefined, JSON.stringify(bad));
    }
  });
});

describe('the autosave store', () => {
  it('stores a copy for one user and reads it back', async () => {
    const dir = await dataDir();
    const copies = autosaveCopies(dir);
    copies.save(1, 'posts/hello-world.md', record());

    assert.deepEqual(copies.read(1, 'posts/hello-world.md'), {
      key: 'posts/hello-world.md',
      ...record(),
    });
    assert.equal(copies.read(1, 'posts/other.md'), undefined);
  });

  it('overwrites the copy for the same key', async () => {
    const dir = await dataDir();
    const copies = autosaveCopies(dir);
    copies.save(1, 'posts/hello-world.md', record());
    copies.save(
      1,
      'posts/hello-world.md',
      record({ fields: { title: 'Later' }, savedAt: '2026-10-23T12:05:00.000Z' }),
    );

    const read = copies.read(1, 'posts/hello-world.md');
    assert.deepEqual(read?.fields, { title: 'Later' });
    assert.equal(read?.savedAt, '2026-10-23T12:05:00.000Z');
    assert.equal(copies.list(1).length, 1);
  });

  it('keeps each user to their own copies', async () => {
    const dir = await dataDir();
    const copies = autosaveCopies(dir);
    copies.save(1, 'posts/hello-world.md', record({ fields: { title: 'Ada' } }));
    copies.save(2, 'posts/hello-world.md', record({ fields: { title: 'Grace' } }));

    assert.deepEqual(copies.read(1, 'posts/hello-world.md')?.fields, { title: 'Ada' });
    assert.deepEqual(copies.read(2, 'posts/hello-world.md')?.fields, { title: 'Grace' });
    assert.equal(copies.discard(2, 'posts/other.md'), false);
    assert.equal(copies.discard(2, 'posts/hello-world.md'), true);
    assert.equal(copies.read(2, 'posts/hello-world.md'), undefined);
    assert.deepEqual(copies.read(1, 'posts/hello-world.md')?.fields, { title: 'Ada' });
  });

  it('lists a user copies newest first, new documents included', async () => {
    const dir = await dataDir();
    const copies = autosaveCopies(dir);
    const id = mintAutosaveId();
    copies.save(1, 'posts/hello-world.md', record({ savedAt: '2026-10-23T12:00:00.000Z' }));
    const { path: _, ...fresh } = record({ savedAt: '2026-10-23T13:00:00.000Z', kind: 'note' });
    copies.save(1, id, fresh);
    copies.save(2, 'pages/about.md', record({ type: 'page', path: 'pages/about.md' }));

    assert.deepEqual(
      copies.list(1).map((copy) => copy.key),
      [id, 'posts/hello-world.md'],
    );
    assert.deepEqual(copies.list(3), []);
  });

  it('writes every copy under data/autosave/<userId>/, declared pending, mode 0600', async () => {
    const dir = await dataDir();
    autosaveCopies(dir).save(4, 'posts/hello-world.md', record());

    const files = classifyFiles(dir, CORE_DATA_FILES);
    assert.equal(files.length, 1);
    const [file] = files;
    assert.match(file?.relative ?? '', /^autosave\/4\/[0-9a-f]{64}\.json$/);
    assert.equal(file?.declaration?.dataClass.kind, 'pending');
    assert.equal((await stat(file?.absolute ?? '')).mode & 0o777, 0o600);
  });

  it('deletes every copy of a user', async () => {
    const dir = await dataDir();
    const copies = autosaveCopies(dir);
    copies.save(1, 'posts/hello-world.md', record());
    copies.save(1, mintAutosaveId(), record());
    copies.save(2, 'posts/hello-world.md', record());

    copies.discardUser(1);

    assert.deepEqual(copies.list(1), []);
    assert.equal(copies.list(2).length, 1);
    assert.deepEqual(await readdir(path.join(dir, 'autosave')), ['2']);
  });

  it(`prunes copies older than ${String(AUTOSAVE_KEEP_DAYS)} days and keeps the rest`, async () => {
    const dir = await dataDir();
    const copies = autosaveCopies(dir);
    copies.save(1, 'posts/old.md', record({ savedAt: '2026-09-01T00:00:00.000Z' }));
    copies.save(1, 'posts/recent.md', record({ savedAt: '2026-10-20T00:00:00.000Z' }));
    copies.save(2, 'posts/old.md', record({ savedAt: '2026-09-23T11:59:00.000Z' }));

    const pruned = copies.prune(new Date('2026-10-23T12:00:00.000Z'));

    assert.equal(pruned, 2);
    assert.deepEqual(
      copies.list(1).map((copy) => copy.key),
      ['posts/recent.md'],
    );
    assert.deepEqual(copies.list(2), []);
  });

  it('prunes nothing, and throws nothing, when there is no autosave folder', async () => {
    const dir = await dataDir();
    assert.equal(autosaveCopies(dir).prune(new Date()), 0);
    assert.deepEqual(autosaveCopies(dir).list(1), []);
  });
});
