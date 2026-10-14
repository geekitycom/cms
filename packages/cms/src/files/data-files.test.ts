import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { databaseFiles, discardDatabase } from '../cache.ts';
import { guardFileFor, lockFileFor, withLockFile } from '../jobs/lock-file.ts';
import { temporaryName } from './atomic.ts';
import {
  ACTOR_KEYS,
  CONTENT_SCRATCH_FILES,
  CORE_DATA_FILES,
  IMAGES,
  JOBS,
  LOCK_FILES,
  TEMPORARY_FILES,
  USERS,
  dataFileFor,
  dataPath,
} from './data-files.ts';
import type { DataClass } from './data-files.ts';

async function dataDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'geekity-data-files-'));
}

function classOf(relative: string): DataClass['kind'] | undefined {
  return dataFileFor(CORE_DATA_FILES, relative)?.dataClass.kind;
}

describe('dataPath', () => {
  it('builds a declared file, a file in a declared folder, and the folder itself', () => {
    assert.equal(dataPath('/site/data', USERS), path.join('/site/data', 'users.json'));
    assert.equal(
      dataPath('/site/data', ACTOR_KEYS, 'ada.ed25519.jwk'),
      path.join('/site/data', 'keys', 'ada.ed25519.jwk'),
    );
    assert.equal(dataPath('/site/data', ACTOR_KEYS), path.join('/site/data', 'keys'));
    assert.equal(
      dataPath('/site/data', IMAGES, '2026', '10', 'cat.jpg'),
      path.join('/site/data', 'images', '2026', '10', 'cat.jpg'),
    );
  });

  it('refuses a path its declaration does not cover, naming the declaration', () => {
    assert.throws(() => dataPath('/d', ACTOR_KEYS, 'ada.pem'), /keys\/\*\.jwk/);
    assert.throws(() => dataPath('/d', USERS, 'extra'), /users\.json/);
    assert.throws(() => dataPath('/d', IMAGES, '..', 'users.json'), /images\/\*\*/);
    assert.throws(() => dataPath('/d', IMAGES, 'a/b'), /images\/\*\*/);
  });
});

describe('the core declarations', () => {
  it('give every file a class and a sentence saying what is lost', () => {
    for (const declaration of [...CORE_DATA_FILES, ...CONTENT_SCRATCH_FILES]) {
      assert.match(declaration.lost, /^[A-Z].*\.$/, declaration.pattern);
    }
    const patterns = CORE_DATA_FILES.map((each) => each.pattern);
    assert.deepEqual(patterns, [...new Set(patterns)], 'each pattern is declared once');
  });

  it('class every core row of decision-55', () => {
    const expected: Record<string, DataClass['kind']> = {
      'keys/ada.RSASSA-PKCS1-v1_5.jwk': 'kept',
      'keys/ada.Ed25519.jwk': 'kept',
      'users.json': 'kept',
      'notification-secret': 'kept',
      'comment-salt': 'kept',
      'comments/hello-world.json': 'kept',
      'contact/20261014T150000Z-0a1b2c3d.json': 'kept',
      'comment-optouts.json': 'kept',
      'indieauth-tokens.json': 'kept',
      'locations.json': 'kept',
      'kept-properties.json': 'kept',
      'plugin-changes.json': 'kept',
      'jobs.json': 'kept',
      'dev-mode.jsonl': 'kept',
      'indieauth-activity.json': 'rebuildable',
      'notification-digests.json': 'rebuildable',
      'micropub-media.json': 'rebuildable',
      'geekity.db': 'rebuildable',
      'geekity.db-wal': 'rebuildable',
      'geekity.db-shm': 'rebuildable',
      'images/2026/10/cat.jpg/cat-640.webp': 'rebuildable',
      'images/2026/10/cat.jpg/image.json': 'rebuildable',
      'avatars/0123abcd.webp': 'rebuildable',
      'avatars/0123abcd.failed': 'rebuildable',
      'queue.sqlite': 'pending',
      'queue.sqlite-wal': 'pending',
      'queue.sqlite-shm': 'pending',
      'users.json.1a2b-3.tmp': 'scratch',
      'comments/hello-world.json.1a2b-3.tmp': 'scratch',
      'jobs.json.lock': 'scratch',
      'jobs.json.lock.takeover': 'scratch',
    };
    const found = Object.fromEntries(Object.keys(expected).map((each) => [each, classOf(each)]));
    assert.deepEqual(found, expected);
  });

  it('leave a file nobody declared without a class', () => {
    assert.equal(classOf('surprise.json'), undefined);
    assert.equal(classOf('keys/ada.pem'), undefined);
  });

  it('declare the content scratch: atomic writes and the watcher probe', () => {
    const scratch = (relative: string) =>
      dataFileFor(CONTENT_SCRATCH_FILES, relative)?.dataClass.kind;
    assert.equal(scratch('posts/hello.md.1a2b-3.tmp'), 'scratch');
    assert.equal(scratch('.geekity-watch-0f3e/probe'), 'scratch');
    assert.equal(scratch('.geekity-watch-0f3e'), 'scratch');
    assert.equal(scratch('posts/hello.md'), undefined);
  });
});

describe('the scratch patterns', () => {
  it('match the temporary name an atomic write uses, under any folder', async () => {
    const dir = await dataDir();
    for (const file of [dataPath(dir, USERS), dataPath(dir, IMAGES, 'a', 'b.webp')]) {
      const relative = path.relative(dir, temporaryName(file)).split(path.sep).join('/');
      assert.equal(dataFileFor(CORE_DATA_FILES, relative), TEMPORARY_FILES, relative);
    }
  });

  it('match the lock file and the takeover guard the job records hold', async () => {
    const dir = await dataDir();
    const lock = lockFileFor(dataPath(dir, JOBS));
    const held = await withLockFile(lock, () => readdir(dir));
    const names = [...held, path.basename(guardFileFor(lock))];
    assert.deepEqual(names, ['jobs.json.lock', 'jobs.json.lock.takeover']);
    for (const name of names) assert.equal(dataFileFor(CORE_DATA_FILES, name), LOCK_FILES, name);
  });
});

describe('discardDatabase', () => {
  it('removes only files declared rebuildable', async () => {
    const dir = await dataDir();
    for (const file of databaseFiles(dir)) await writeFile(file, '');
    for (const kept of ['users.json', 'queue.sqlite', 'queue.sqlite-wal']) {
      await writeFile(path.join(dir, kept), '');
    }
    const before = await readdir(dir);

    discardDatabase(dir);

    const after = new Set(await readdir(dir));
    const removed = before.filter((name) => !after.has(name));
    assert.deepEqual(removed.sort(), ['geekity.db', 'geekity.db-shm', 'geekity.db-wal']);
    for (const name of removed) assert.equal(classOf(name), 'rebuildable', name);
  });
});
