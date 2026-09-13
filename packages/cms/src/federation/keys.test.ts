import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { exportJwk } from '@fedify/fedify';

import { writeUsers } from '../admin/__testing__/users.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { ACTOR_KEY_ALGORITHMS, actorKeyFile, actorKeysDir, loadActorKeyPairs } from './keys.ts';

/**
 * The identifier the keys in this file belong to: a username, which is what
 * decision-14 makes every actor's identifier.
 */
const ADA = 'ada';

/** The origin every request in this file is sent to; Fedify answers by origin. */
const BASE_URL = 'https://blog.example';

const temporaryDirs: string[] = [];
const started: Cms[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A data directory of its own, removed when the file finishes. */
async function dataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-keys-'));
  temporaryDirs.push(dir);
  return dir;
}

/**
 * Key pairs as comparable JSON.
 *
 * `CryptoKey`s are opaque and never equal to one another, so a test that means
 * "the same key" has to say it in the only terms the key can be read in.
 */
async function exported(pairs: readonly CryptoKeyPair[]): Promise<string[]> {
  return await Promise.all(
    pairs.flatMap((pair) => [
      exportJwk(pair.privateKey).then((jwk) => JSON.stringify(jwk)),
      exportJwk(pair.publicKey).then((jwk) => JSON.stringify(jwk)),
    ]),
  );
}

describe('loadActorKeyPairs', () => {
  it('generates both algorithms on the first call', async () => {
    const dir = await dataDir();

    const pairs = await loadActorKeyPairs(dir, ADA);

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

  it('writes one JWK file per algorithm, named after the user (AC #1)', async () => {
    const dir = await dataDir();

    await loadActorKeyPairs(dir, ADA);

    const rsa = JSON.parse(
      await readFile(actorKeyFile(dir, ADA, 'RSASSA-PKCS1-v1_5'), 'utf8'),
    ) as Record<string, unknown>;
    const ed = JSON.parse(await readFile(actorKeyFile(dir, ADA, 'Ed25519'), 'utf8')) as Record<
      string,
      unknown
    >;

    assert.equal(
      actorKeyFile(dir, ADA, 'RSASSA-PKCS1-v1_5'),
      path.join(dir, 'keys', 'ada.rsassa-pkcs1-v1_5.jwk'),
    );
    assert.equal(actorKeyFile(dir, ADA, 'Ed25519'), path.join(dir, 'keys', 'ada.ed25519.jwk'));
    assert.equal(rsa['kty'], 'RSA');
    assert.equal(rsa['alg'], 'RS256');
    assert.ok(typeof rsa['d'] === 'string', 'the file holds the private key');
    assert.equal(ed['kty'], 'OKP');
    assert.equal(ed['crv'], 'Ed25519');
    assert.ok(typeof ed['d'] === 'string', 'the file holds the private key');
  });

  it('keeps the key files and their directory private (AC #1)', async () => {
    const dir = await dataDir();

    await loadActorKeyPairs(dir, ADA);

    assert.equal((await stat(actorKeysDir(dir))).mode & 0o777, 0o700, 'data/keys is the owner’s');
    for (const algorithm of ['RSASSA-PKCS1-v1_5', 'Ed25519'] as const) {
      assert.equal(
        (await stat(actorKeyFile(dir, ADA, algorithm))).mode & 0o777,
        0o600,
        `${algorithm} is readable only by the owner`,
      );
    }
  });

  it('reads the same keys back rather than generating new ones (AC #2)', async () => {
    // The whole point of the files: an actor whose key changes on every boot
    // is an actor no follower can verify.
    const dir = await dataDir();

    const first = await loadActorKeyPairs(dir, ADA);
    const written = await Promise.all(
      ACTOR_KEY_ALGORITHMS.map((algorithm) => readFile(actorKeyFile(dir, ADA, algorithm), 'utf8')),
    );
    const second = await loadActorKeyPairs(dir, ADA);

    assert.deepEqual(await exported(second), await exported(first), 'the same keys');
    assert.deepEqual(
      await Promise.all(
        ACTOR_KEY_ALGORITHMS.map((algorithm) =>
          readFile(actorKeyFile(dir, ADA, algorithm), 'utf8'),
        ),
      ),
      written,
      'and the files were not rewritten',
    );
  });

  it('generates one algorithm without touching the other', async () => {
    const dir = await dataDir();
    const both = await loadActorKeyPairs(dir, ADA);
    await rm(actorKeyFile(dir, ADA, 'Ed25519'));

    const after_ = await loadActorKeyPairs(dir, ADA);

    const before = await exported(both);
    const later = await exported(after_);
    assert.deepEqual(later.slice(0, 2), before.slice(0, 2), 'the RSA file was untouched');
    assert.notDeepEqual(later.slice(2), before.slice(2), 'the deleted Ed25519 key was made again');
  });

  it('keeps one identifier’s keys away from another’s', async () => {
    const dir = await dataDir();

    const ada = await loadActorKeyPairs(dir, ADA);
    const other = await loadActorKeyPairs(dir, 'other');

    assert.notDeepEqual(await exported(other), await exported(ada));
  });

  it('two callers racing on a fresh directory agree on one key (AC #1)', async () => {
    // Nothing else stops a first request and a delivery both finding no file
    // and each minting a pair; the loser would sign with a key the actor
    // document never published.
    const dir = await dataDir();

    const [first, second] = await Promise.all([
      loadActorKeyPairs(dir, ADA),
      loadActorKeyPairs(dir, ADA),
    ]);

    assert.deepEqual(await exported(second), await exported(first));
    assert.deepEqual(
      await exported(await loadActorKeyPairs(dir, ADA)),
      await exported(first),
      'and it is what the files hold',
    );
  });

  it('reports a key file that will not import rather than replacing it (AC #5)', async () => {
    const dir = await dataDir();
    await loadActorKeyPairs(dir, ADA);
    const rsaFile = actorKeyFile(dir, ADA, 'RSASSA-PKCS1-v1_5');
    const rsa = await readFile(rsaFile, 'utf8');
    const file = actorKeyFile(dir, ADA, 'Ed25519');
    await writeFile(file, '{"kty":"OKP","crv":"Ed255', 'utf8');

    await assert.rejects(
      () => loadActorKeyPairs(dir, ADA),
      (error: Error) => {
        assert.ok(error.message.includes(file), 'the message names the file');
        assert.match(error.message, /delete it/i, 'and says how to ask for a new key');
        return true;
      },
    );

    assert.equal(
      await readFile(file, 'utf8'),
      '{"kty":"OKP","crv":"Ed255',
      'nothing was rewritten',
    );
    assert.equal(await readFile(rsaFile, 'utf8'), rsa, 'and the other algorithm is untouched');
  });

  it('reports a key file whose JWK is not a key it can use (AC #5)', async () => {
    const dir = await dataDir();
    await loadActorKeyPairs(dir, ADA);
    const file = actorKeyFile(dir, ADA, 'RSASSA-PKCS1-v1_5');
    await writeFile(file, JSON.stringify({ kty: 'RSA', alg: 'RS256', n: 'nonsense', e: 'AQAB' }));

    await assert.rejects(
      () => loadActorKeyPairs(dir, ADA),
      (error: Error) => error.message.includes(file),
    );
  });
});

describe('the actor’s keys across boots', () => {
  /** A CMS on directories of its own, or on the ones a caller is reusing. */
  async function site(dirs: { contentDir?: string; dataDir?: string } = {}): Promise<Cms> {
    const contentDir = dirs.contentDir ?? (await dataDir());
    const dir = dirs.dataDir ?? (await dataDir());

    await writeSiteJson({
      contentDir,
      settings: { ...DEFAULT_SITE_SETTINGS, baseUrl: BASE_URL },
    });
    // decision-14: the actor is a user, so there has to be one before the
    // site can publish a key at all.
    writeUsers(dir, [{ username: ADA }]);

    const instance = createCms({ contentDir, dataDir: dir, watch: false, baseUrl: BASE_URL });
    started.push(instance);
    return instance;
  }

  /** The actor's published keys: the RSA `publicKey` and the multikeys. */
  async function publishedKeys(instance: Cms): Promise<{ publicKey: unknown; methods: unknown }> {
    const response = await instance.app.request(
      new Request(`${BASE_URL}/author/${ADA}/`, {
        headers: { accept: 'application/activity+json' },
      }),
    );
    assert.equal(response.status, 200);
    const actor = (await response.json()) as Record<string, unknown>;
    return { publicKey: actor['publicKey'], methods: actor['assertionMethod'] };
  }

  /** Whether the database still has a table by that name. */
  function hasTable(dir: string, name: string): boolean {
    const database = new DatabaseSync(path.join(dir, 'geekity.db'));
    const found = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .all(name);
    database.close();
    return found.length > 0;
  }

  it('refuses to boot on a key file that will not import (AC #5)', async () => {
    // Fedify catches whatever the key pairs dispatcher throws and serves an
    // actor with no key at all, so a site whose key file is damaged would go
    // on answering — silently unverifiable to every follower. Boot is
    // therefore where it is caught, and refusing to start is the report.
    const contentDir = await dataDir();
    const dir = await dataDir();
    const first = await site({ contentDir, dataDir: dir });
    await publishedKeys(first);
    await first.close();
    const file = actorKeyFile(dir, ADA, 'Ed25519');
    const whole = await readFile(file, 'utf8');
    await writeFile(file, whole.slice(0, 120), 'utf8');

    assert.throws(
      () => createCms({ contentDir, dataDir: dir, watch: false, baseUrl: BASE_URL }),
      (error: Error) => {
        assert.ok(error.message.includes(file), 'the message names the file');
        assert.match(error.message, /delete it/i, 'and says how to ask for a new key');
        return true;
      },
    );
    assert.equal(await readFile(file, 'utf8'), whole.slice(0, 120), 'and nothing was rewritten');
  });

  it('answers the actor with an error rather than no key at all (AC #5)', async () => {
    const contentDir = await dataDir();
    const dir = await dataDir();
    const instance = await site({ contentDir, dataDir: dir });
    await publishedKeys(instance);

    // Damaged after boot, which the boot check cannot have caught.
    const file = actorKeyFile(dir, ADA, 'Ed25519');
    await writeFile(file, '{"kty":"OKP","crv":"Ed255', 'utf8');

    const response = await instance.app.request(
      new Request(`${BASE_URL}/author/${ADA}/`, {
        headers: { accept: 'application/activity+json' },
      }),
    );

    assert.notEqual(response.status, 200, 'an actor without its keys is not an answer');
  });

  it('publishes the keys it generated on the first boot (AC #1)', async () => {
    const dir = await dataDir();

    const instance = await site({ dataDir: dir });
    const keys = await publishedKeys(instance);

    const rsa = keys.publicKey as { publicKeyPem?: string };
    assert.match(rsa.publicKeyPem ?? '', /^-----BEGIN PUBLIC KEY-----/);
    assert.equal((keys.methods as unknown[]).length, 2, 'both multikeys');
    for (const algorithm of ACTOR_KEY_ALGORITHMS) {
      assert.ok(
        (await readFile(actorKeyFile(dir, ADA, algorithm), 'utf8')).length > 0,
        `${algorithm} was written to data/keys`,
      );
    }
  });

  it('publishes the identical keys after a restart (AC #2)', async () => {
    const contentDir = await dataDir();
    const dir = await dataDir();

    const before = await publishedKeys(await site({ contentDir, dataDir: dir }));
    const after_ = await publishedKeys(await site({ contentDir, dataDir: dir }));

    assert.deepEqual(after_, before);
  });

  it('keeps its keys when the database is deleted (AC #4)', async () => {
    const contentDir = await dataDir();
    const dir = await dataDir();

    const first = await site({ contentDir, dataDir: dir });
    const before = await publishedKeys(first);
    const files = await Promise.all(
      ACTOR_KEY_ALGORITHMS.map((algorithm) => readFile(actorKeyFile(dir, ADA, algorithm), 'utf8')),
    );
    await first.close();

    // What decision-9 says a site may do at any time.
    for (const name of await readdir(dir)) {
      if (name.startsWith('geekity.db')) await rm(path.join(dir, name));
    }
    const after_ = await publishedKeys(await site({ contentDir, dataDir: dir }));

    assert.deepEqual(after_, before, 'the actor is the same actor');
    assert.deepEqual(
      await Promise.all(
        ACTOR_KEY_ALGORITHMS.map((algorithm) =>
          readFile(actorKeyFile(dir, ADA, algorithm), 'utf8'),
        ),
      ),
      files,
      'and the key files were never touched',
    );
  });

  it('writes an older database’s rows out as files and drops the table (AC #3)', async () => {
    const contentDir = await dataDir();
    const dir = await dataDir();

    // A site as this version leaves it, so the keys under test are real ones.
    const first = await site({ contentDir, dataDir: dir });
    const before = await publishedKeys(first);
    await first.close();

    // Now put it back the way the version before this one held it: the pairs
    // in `actor_keys`, and nothing under `data/keys` at all.
    const database = new DatabaseSync(path.join(dir, 'geekity.db'));
    database.exec(`
      CREATE TABLE actor_keys (
        identifier  TEXT NOT NULL,
        algorithm   TEXT NOT NULL,
        private_jwk TEXT NOT NULL,
        public_jwk  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (identifier, algorithm)
      );
    `);
    const insert = database.prepare(`
      INSERT INTO actor_keys (identifier, algorithm, private_jwk, public_jwk, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const algorithm of ACTOR_KEY_ALGORITHMS) {
      const file = actorKeyFile(dir, ADA, algorithm);
      insert.run(
        ADA,
        algorithm,
        await readFile(file, 'utf8'),
        '{"ignored":"the public half is derived"}',
        '2026-09-01T00:00:00.000Z',
      );
      await rm(file);
    }
    database.close();
    await rm(actorKeysDir(dir), { recursive: true, force: true });

    const migrated = await site({ contentDir, dataDir: dir });

    assert.deepEqual(await publishedKeys(migrated), before, 'the same actor, key for key');
    for (const algorithm of ACTOR_KEY_ALGORITHMS) {
      const file = actorKeyFile(dir, ADA, algorithm);
      assert.equal((await stat(file)).mode & 0o777, 0o600, `${algorithm} was written 0600`);
    }
    await migrated.close();
    assert.equal(hasTable(dir, 'actor_keys'), false, 'and the table is gone');
  });

  it('leaves a key file alone when the old table still holds a row for it', async () => {
    const contentDir = await dataDir();
    const dir = await dataDir();

    const first = await site({ contentDir, dataDir: dir });
    const before = await publishedKeys(first);
    await first.close();

    // A row that disagrees with the file: a database restored from a backup
    // taken before the upgrade, next to a `data/keys` that has since moved on.
    // The file is the source of truth, so the row is simply dropped with the
    // table it is in.
    const database = new DatabaseSync(path.join(dir, 'geekity.db'));
    database.exec(`
      CREATE TABLE actor_keys (
        identifier  TEXT NOT NULL,
        algorithm   TEXT NOT NULL,
        private_jwk TEXT NOT NULL,
        public_jwk  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (identifier, algorithm)
      );
      INSERT INTO actor_keys (identifier, algorithm, private_jwk, public_jwk, created_at)
      VALUES ('actor', 'Ed25519', '{"stale":"row"}', '{}', '2026-09-01T00:00:00.000Z');
    `);
    database.close();

    const again = await site({ contentDir, dataDir: dir });

    assert.deepEqual(await publishedKeys(again), before, 'the file won');
    assert.notEqual(await readFile(actorKeyFile(dir, ADA, 'Ed25519'), 'utf8'), '{"stale":"row"}\n');
  });

  it('drops the table on a database this version created, where it was never used', async () => {
    const dir = await dataDir();

    const instance = await site({ dataDir: dir });
    await instance.close();

    assert.equal(hasTable(dir, 'actor_keys'), false);
  });
});
