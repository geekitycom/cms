import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { browser, FIRST_ADMIN, sandbox, signedIn, signIn } from './__testing__/harness.ts';
import {
  countUsers,
  createUser,
  deleteUser,
  DuplicateUsernameError,
  findUser,
  findUserById,
  findUserByIdentifier,
  listUsers,
  setUserEmail,
  setUserPassword,
  setUserProfile,
  usersFile,
  verifyUserPassword,
} from './accounts.ts';
import { hashPassword } from './passwords.ts';

const temporaryDirs: string[] = [];
const box = sandbox();

after(async () => {
  await box.cleanup();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A data directory that goes away when the file finishes. */
async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-accounts-'));
  temporaryDirs.push(dir);
  return dir;
}

describe('the users file', () => {
  it('starts empty, which is what puts a site into first-run setup', async () => {
    const dataDir = await temporaryDir();

    assert.equal(countUsers(dataDir), 0);
    assert.deepEqual(listUsers(dataDir), []);
  });

  it('creates a user and lists it without its password hash', async () => {
    const dataDir = await temporaryDir();

    const created = await createUser({ dataDir, username: 'ada', password: 'correct horse' });

    assert.equal(created.username, 'ada');
    assert.ok(created.id > 0, 'it was given an id');
    assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(countUsers(dataDir), 1);
    assert.deepEqual(listUsers(dataDir), [created]);
    assert.equal(
      Object.hasOwn(listUsers(dataDir)[0] ?? {}, 'passwordHash'),
      false,
      'the hash is not on a listing',
    );
    assert.equal(findUser(dataDir, 'ada')?.passwordHash.startsWith('$argon2id$'), true);
  });

  it('writes data/users.json, and nothing else can read it (AC #4)', async () => {
    const dataDir = await temporaryDir();

    await createUser({ dataDir, username: 'ada', password: 'correct horse' });

    const file = usersFile(dataDir);
    assert.equal(file, path.join(dataDir, 'users.json'), 'it is directly under the data directory');
    assert.equal((await stat(file)).mode & 0o777, 0o600);

    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(
      (parsed as { users: { username: string }[] }).users.map((user) => user.username),
      ['ada'],
      'the file holds what was created',
    );
  });
});

describe('a name that is taken', () => {
  it('is refused, exactly as the unique index refused it (AC #5)', async () => {
    const dataDir = await temporaryDir();
    await createUser({ dataDir, username: 'ada', password: 'correct horse' });

    await assert.rejects(
      () => createUser({ dataDir, username: 'ada', password: 'another one entirely' }),
      DuplicateUsernameError,
    );

    assert.equal(countUsers(dataDir), 1, 'and nothing was written');
    assert.equal(
      verifyUserPassword(dataDir, 'ada', 'correct horse')?.username,
      'ada',
      'the first password still works',
    );
  });

  it('is refused when two adds race, so only one of them can win (AC #5)', async () => {
    const dataDir = await temporaryDir();

    const outcomes = await Promise.allSettled([
      createUser({ dataDir, username: 'ada', password: 'one password' }),
      createUser({ dataDir, username: 'ada', password: 'another password' }),
      createUser({ dataDir, username: 'grace', password: 'a password of her own' }),
    ]);

    assert.equal(
      outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
      2,
      'ada once and grace once',
    );
    const refused = outcomes.find((outcome) => outcome.status === 'rejected');
    assert.ok(refused?.reason instanceof DuplicateUsernameError);
    assert.deepEqual(
      listUsers(dataDir)
        .map((user) => user.username)
        .sort(),
      ['ada', 'grace'],
    );
  });

  it('is a different name when the case is different, as it always was', async () => {
    const dataDir = await temporaryDir();
    await createUser({ dataDir, username: 'ada', password: 'correct horse' });

    const other = await createUser({ dataDir, username: 'Ada', password: 'a password of her own' });

    assert.equal(other.username, 'Ada');
    assert.equal(countUsers(dataDir), 2);
    assert.equal(verifyUserPassword(dataDir, 'ada', 'a password of her own'), undefined);
  });
});

describe('a user with an email address (AC #1)', () => {
  it('stores it, lists it, and leaves it off a user who has none', async () => {
    const dataDir = await temporaryDir();

    const ada = await createUser({
      dataDir,
      username: 'ada',
      password: 'correct horse',
      email: 'ada@example.com',
    });
    const grace = await createUser({ dataDir, username: 'grace', password: 'a password of hers' });

    assert.equal(ada.email, 'ada@example.com');
    assert.equal(grace.email, undefined);
    assert.equal(findUserById(dataDir, ada.id)?.email, 'ada@example.com');

    const file = JSON.parse(await readFile(usersFile(dataDir), 'utf8')) as {
      users: Record<string, unknown>[];
    };
    assert.equal(file.users[0]?.['email'], 'ada@example.com');
    assert.equal(
      Object.hasOwn(file.users[1] ?? {}, 'email'),
      false,
      'a user with no email has no key for one',
    );
  });

  it('changes and clears it without touching anything else', async () => {
    const dataDir = await temporaryDir();
    const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse' });
    const hash = findUser(dataDir, 'ada')?.passwordHash;

    assert.equal(await setUserEmail({ dataDir, userId: ada.id, email: 'ada@example.com' }), true);
    assert.equal(findUserById(dataDir, ada.id)?.email, 'ada@example.com');

    assert.equal(await setUserEmail({ dataDir, userId: ada.id, email: '' }), true);
    assert.equal(findUserById(dataDir, ada.id)?.email, undefined);
    assert.equal(findUser(dataDir, 'ada')?.passwordHash, hash, 'the password is untouched');

    assert.equal(await setUserEmail({ dataDir, userId: 404, email: 'nobody@example.com' }), false);
  });

  it('is found by username exactly and by email whatever the case', async () => {
    const dataDir = await temporaryDir();
    const ada = await createUser({
      dataDir,
      username: 'ada',
      password: 'correct horse',
      email: 'Ada@Example.com',
    });
    await createUser({ dataDir, username: 'grace', password: 'a password of hers' });

    assert.equal(findUserByIdentifier(dataDir, 'ada')?.id, ada.id);
    assert.equal(findUserByIdentifier(dataDir, 'ADA'), undefined, 'a username is compared exactly');
    assert.equal(findUserByIdentifier(dataDir, 'ada@example.com')?.id, ada.id);
    assert.equal(findUserByIdentifier(dataDir, 'ADA@EXAMPLE.COM')?.id, ada.id);
    assert.equal(findUserByIdentifier(dataDir, 'grace')?.email, undefined);
    assert.equal(findUserByIdentifier(dataDir, 'nobody@example.com'), undefined);
    assert.equal(findUserByIdentifier(dataDir, ''), undefined, 'the empty string matches nobody');
  });
});

describe('a user with a profile (TASK-67 AC #1)', () => {
  it('stores the four fields and leaves the key off a user who has none', async () => {
    const dataDir = await temporaryDir();
    const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse' });
    await createUser({ dataDir, username: 'grace', password: 'a password of hers' });

    assert.equal(
      await setUserProfile({
        dataDir,
        userId: ada.id,
        profile: {
          displayName: 'Ada Lovelace',
          bio: 'Wrote the first program.',
          avatar: '/uploads/2026/09/ada.jpg',
          links: [{ label: 'Home', href: 'https://ada.example' }],
        },
      }),
      true,
    );

    const stored = findUserById(dataDir, ada.id)?.profile;
    assert.equal(stored?.displayName, 'Ada Lovelace');
    assert.equal(stored?.bio, 'Wrote the first program.');
    assert.equal(stored?.avatar, '/uploads/2026/09/ada.jpg');
    assert.deepEqual(stored?.links, [{ label: 'Home', href: 'https://ada.example' }]);

    const file = JSON.parse(await readFile(usersFile(dataDir), 'utf8')) as {
      users: Record<string, unknown>[];
    };
    assert.equal(
      Object.hasOwn(file.users[1] ?? {}, 'profile'),
      false,
      'a user with no profile has no key for one',
    );
  });

  it('drops a field somebody cleared and the whole key when nothing is left', async () => {
    const dataDir = await temporaryDir();
    const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse' });
    const hash = findUser(dataDir, 'ada')?.passwordHash;

    await setUserProfile({
      dataDir,
      userId: ada.id,
      profile: { displayName: 'Ada Lovelace', bio: 'Wrote the first program.' },
    });
    await setUserProfile({ dataDir, userId: ada.id, profile: { displayName: 'Ada Lovelace' } });

    assert.deepEqual(findUserById(dataDir, ada.id)?.profile, { displayName: 'Ada Lovelace' });

    await setUserProfile({ dataDir, userId: ada.id, profile: {} });
    assert.equal(findUserById(dataDir, ada.id)?.profile, undefined);
    assert.equal(findUser(dataDir, 'ada')?.passwordHash, hash, 'the password is untouched');

    assert.equal(await setUserProfile({ dataDir, userId: 404, profile: {} }), false);
  });

  it('reads a hand-written file tolerantly rather than refusing to load', async () => {
    const dataDir = await temporaryDir();
    await writeFile(
      usersFile(dataDir),
      JSON.stringify({
        nextId: 2,
        users: [
          {
            id: 1,
            username: 'ada',
            passwordHash: hashPassword('correct horse'),
            createdAt: '2026-01-01T00:00:00.000Z',
            profile: {
              displayName: 42,
              bio: '  Spaced out.  ',
              links: [{ label: 'Home', href: 'https://ada.example' }, 'nonsense', { href: '' }],
            },
          },
        ],
      }),
      'utf8',
    );

    const stored = findUserById(dataDir, 1)?.profile;
    assert.equal(stored?.displayName, undefined, 'a display name that is not a string is dropped');
    assert.equal(stored?.bio, 'Spaced out.');
    assert.deepEqual(stored?.links, [{ label: 'Home', href: 'https://ada.example' }]);
  });
});

describe('verifying a password (AC #2)', () => {
  it('accepts the password against the hash in the file and refuses everything else', async () => {
    const dataDir = await temporaryDir();
    const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse' });

    assert.deepEqual(verifyUserPassword(dataDir, 'ada', 'correct horse'), ada);
    assert.equal(verifyUserPassword(dataDir, 'ada', 'Correct horse'), undefined);
    assert.equal(verifyUserPassword(dataDir, 'nobody', 'correct horse'), undefined);
  });

  it('hashes the same password differently for two users', async () => {
    const dataDir = await temporaryDir();
    await createUser({ dataDir, username: 'ada', password: 'a shared password' });
    await createUser({ dataDir, username: 'grace', password: 'a shared password' });

    assert.notEqual(
      findUser(dataDir, 'ada')?.passwordHash,
      findUser(dataDir, 'grace')?.passwordHash,
    );
  });
});

describe('changing a password', () => {
  it('replaces the hash and leaves everything else alone', async () => {
    const dataDir = await temporaryDir();
    const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse' });
    await createUser({ dataDir, username: 'grace', password: 'a password of her own' });
    const hers = findUser(dataDir, 'grace')?.passwordHash;

    assert.equal(await setUserPassword({ dataDir, userId: ada.id, password: 'a new one' }), true);

    assert.equal(verifyUserPassword(dataDir, 'ada', 'correct horse'), undefined);
    assert.deepEqual(verifyUserPassword(dataDir, 'ada', 'a new one'), ada);
    assert.equal(findUser(dataDir, 'grace')?.passwordHash, hers, 'nobody else was touched');
  });

  it('says so when there is no such user', async () => {
    const dataDir = await temporaryDir();

    assert.equal(
      await setUserPassword({ dataDir, userId: 404, password: 'a password nobody will use' }),
      false,
    );
  });
});

describe('deleting a user', () => {
  it('takes them out of the file and hands nobody else their id', async () => {
    const dataDir = await temporaryDir();
    const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse' });

    assert.equal(await deleteUser({ dataDir, userId: ada.id }), true);
    assert.equal(countUsers(dataDir), 0);
    assert.equal(findUser(dataDir, 'ada'), undefined);
    assert.equal(findUserById(dataDir, ada.id), undefined);
    assert.equal(await deleteUser({ dataDir, userId: ada.id }), false, 'and only goes once');

    const grace = await createUser({ dataDir, username: 'grace', password: 'a password' });
    assert.notEqual(grace.id, ada.id, 'an id is never handed out twice');
  });
});

describe('a users file that will not parse', () => {
  it('is reported rather than read as a site with no users at all', async () => {
    const dataDir = await temporaryDir();
    await createUser({ dataDir, username: 'ada', password: 'correct horse' });
    await writeFile(usersFile(dataDir), '{"users": [{"id": 1, "usern');

    assert.throws(() => countUsers(dataDir), /could not be read/);
    assert.throws(() => listUsers(dataDir), /Restore the file from a backup/);
    assert.throws(() => verifyUserPassword(dataDir, 'ada', 'correct horse'), /could not be read/);
  });
});

describe('a database whose users are still rows', () => {
  /** A `dataDir` holding a database in the shape TASK-9 left behind. */
  async function legacyDatabase(hash: string): Promise<string> {
    const dataDir = await box.dir('geekity-accounts-legacy-data-');
    const database = new DatabaseSync(path.join(dataDir, 'geekity.db'));

    // Exactly migrations 1 and 2, with the ledger rows that stop them being
    // applied again, so the boot under test meets the schema a shipped site
    // has: a users table, and sessions with a foreign key into it.
    database.exec(`
      CREATE TABLE admin_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO admin_migrations (version, applied_at) VALUES (1, '2026-09-01T00:00:00.000Z');
      INSERT INTO admin_migrations (version, applied_at) VALUES (2, '2026-09-01T00:00:00.000Z');
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
      CREATE UNIQUE INDEX users_username ON users (username);
      CREATE TABLE sessions (
        id         TEXT PRIMARY KEY,
        user_id    INTEGER REFERENCES users (id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        flash      TEXT
      );
      CREATE INDEX sessions_expires_at ON sessions (expires_at);
      CREATE INDEX sessions_user_id ON sessions (user_id);
      INSERT INTO users (id, username, password_hash, created_at)
      VALUES (7, 'ada', '${hash}', '2026-09-01T00:00:00.000Z');
      INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at)
      VALUES ('a-session-from-before', 7, 'a-token-from-before', '2026-09-01T00:00:00.000Z',
              '2099-01-01T00:00:00.000Z');
    `);
    database.close();
    return dataDir;
  }

  /** Whether the database still has a table by that name. */
  function hasTable(dataDir: string, name: string): boolean {
    const database = new DatabaseSync(path.join(dataDir, 'geekity.db'));
    const found = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .all(name);
    database.close();
    return found.length > 0;
  }

  it('writes the rows into users.json on the first boot and drops the table (AC #3)', async () => {
    const dataDir = await legacyDatabase(hashPassword('a password from before'));

    const cms = await box.site({ dataDir });

    assert.deepEqual(listUsers(dataDir), [
      { id: 7, username: 'ada', createdAt: '2026-09-01T00:00:00.000Z' },
    ]);
    assert.equal((await stat(usersFile(dataDir))).mode & 0o777, 0o600, 'and 0600 (AC #4)');
    assert.equal(hasTable(dataDir, 'users'), false, 'the table is gone');

    // The whole point of the migration: the account still works, through the
    // login form, against the hash the table used to hold.
    const agent = await signIn(cms, { username: 'ada', password: 'a password from before' });
    assert.match(await (await agent.get('/admin')).text(), /Signed in as ada/);
  });

  it('keeps the logins the database already held', async () => {
    const dataDir = await legacyDatabase(hashPassword('a password from before'));

    const cms = await box.site({ dataDir });

    const agent = browser(cms);
    agent.setSession('a-session-from-before');
    const dashboard = await agent.get('/admin');
    assert.equal(dashboard.status, 200, 'the session survived the schema change');
    assert.match(await dashboard.text(), /Signed in as ada/);
  });

  it('leaves a users.json that is already there alone, because files win', async () => {
    const dataDir = await legacyDatabase(hashPassword('a password from before'));
    await createUser({ dataDir, username: 'grace', password: 'a password of her own' });

    const cms = await box.site({ dataDir });

    assert.deepEqual(
      listUsers(dataDir).map((user) => user.username),
      ['grace'],
      'the file was not rewritten from the rows',
    );
    assert.equal(hasTable(dataDir, 'users'), false, 'and the table still went');
    const agent = await signIn(cms, { username: 'grace', password: 'a password of her own' });
    assert.equal((await agent.get('/admin')).status, 200);
  });
});

describe('a login and a database that may be deleted (AC #2)', () => {
  it('signs in against the file after the database has been thrown away', async () => {
    const contentDir = await box.dir('geekity-accounts-rebuild-');
    const dataDir = await box.dir('geekity-accounts-rebuild-data-');
    const first = await box.site({ contentDir, dataDir });
    const agent = await signedIn(first);
    assert.equal((await agent.get('/admin')).status, 200);
    await first.close();

    // Exactly what decision-9 says a site may do: the database is a cache.
    for (const name of ['geekity.db', 'geekity.db-shm', 'geekity.db-wal']) {
      await rm(path.join(dataDir, name), { force: true });
    }

    const rebuilt = await box.site({ contentDir, dataDir });
    const held = browser(rebuilt);
    held.setSession(agent.session());
    assert.equal(
      (await held.get('/admin')).status,
      302,
      'the session was in the database, so it went with it',
    );

    // The account was not: it is in the file, and the login form still knows it.
    const again = await signIn(rebuilt, FIRST_ADMIN);
    assert.match(await (await again.get('/admin')).text(), /Signed in as ada/);
  });

  it('refuses a session whose user the file no longer holds', async () => {
    const cms = await box.site();
    await signedIn(cms);
    const grace = await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'a password of her own',
    });
    const hers = await signIn(cms, { username: 'grace', password: 'a password of her own' });
    assert.equal((await hers.get('/admin')).status, 200);

    // Taken out of the file directly, which is the state a database restored
    // from a backup taken before she was deleted leaves behind.
    await deleteUser({ dataDir: cms.config.dataDir, userId: grace.id });

    assert.equal((await hers.get('/admin')).status, 302, 'her session is not a login any more');
    assert.match((await hers.get('/admin')).headers.get('location') ?? '', /login/);
  });
});
