import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { openAdminStore } from '../admin/store.ts';
import type { AdminStore } from '../admin/store.ts';
import { loadActorKeyPairs, SITE_ACTOR_IDENTIFIER } from './keys.ts';

const temporaryDirs: string[] = [];
const openStores: AdminStore[] = [];

after(async () => {
  for (const opened of openStores) opened.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A data directory of its own, removed when the file finishes. */
async function dataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-keys-'));
  temporaryDirs.push(dir);
  return dir;
}

/** An admin store on `dir`, closed when the file finishes. */
function store(dir: string): AdminStore {
  const opened = openAdminStore({ dataDir: dir });
  openStores.push(opened);
  return opened;
}

describe('loadActorKeyPairs', () => {
  it('generates both algorithms on the first call', async () => {
    const admin = store(await dataDir());

    const pairs = await loadActorKeyPairs(admin, SITE_ACTOR_IDENTIFIER);

    assert.equal(pairs.length, 2);
    assert.deepEqual(
      pairs.map((pair) => pair.privateKey.algorithm.name),
      ['RSASSA-PKCS1-v1_5', 'Ed25519'],
    );
    assert.deepEqual(
      pairs.map((pair) => pair.publicKey.type),
      ['public', 'public'],
    );
    assert.deepEqual(
      pairs.map((pair) => pair.privateKey.type),
      ['private', 'private'],
    );
  });

  it('writes what it generated, so a second call reads rather than regenerates', async () => {
    const admin = store(await dataDir());

    await loadActorKeyPairs(admin, SITE_ACTOR_IDENTIFIER);
    const stored = admin.listActorKeys(SITE_ACTOR_IDENTIFIER);

    assert.deepEqual(
      stored.map((key) => key.algorithm),
      ['RSASSA-PKCS1-v1_5', 'Ed25519'],
    );
  });

  it('hands back the same keys across restarts, not new ones', async () => {
    // The whole point of the table: an actor whose key changes on every boot
    // is an actor no follower can verify.
    const dir = await dataDir();

    const first = store(dir);
    await loadActorKeyPairs(first, SITE_ACTOR_IDENTIFIER);
    const before = first.listActorKeys(SITE_ACTOR_IDENTIFIER);
    first.close();

    const second = store(dir);
    const pairs = await loadActorKeyPairs(second, SITE_ACTOR_IDENTIFIER);
    const after_ = second.listActorKeys(SITE_ACTOR_IDENTIFIER);

    assert.equal(pairs.length, 2);
    assert.deepEqual(
      after_.map((key) => key.publicJwk),
      before.map((key) => key.publicJwk),
    );
    assert.deepEqual(
      after_.map((key) => key.privateJwk),
      before.map((key) => key.privateJwk),
    );
  });

  it('regenerates one algorithm when only the other is stored', async () => {
    const admin = store(await dataDir());
    admin.putActorKey({
      identifier: SITE_ACTOR_IDENTIFIER,
      algorithm: 'Ed25519',
      privateJwk: '{"not":"a key"}',
      publicJwk: '{"not":"a key"}',
    });

    // The unusable row is replaced rather than imported, so a half-written or
    // corrupted table heals instead of wedging every boot after it.
    const pairs = await loadActorKeyPairs(admin, SITE_ACTOR_IDENTIFIER);

    assert.equal(pairs.length, 2);
    assert.notEqual(
      admin.listActorKeys(SITE_ACTOR_IDENTIFIER).find((key) => key.algorithm === 'Ed25519')
        ?.publicJwk,
      '{"not":"a key"}',
    );
  });
});
