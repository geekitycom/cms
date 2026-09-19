import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';

import { cleanupTemporaryDirs, exists, runCli, temporaryDir } from './__testing__/cli.ts';
import { listUsers } from './index.ts';

after(cleanupTemporaryDirs);

describe('geekity import wordpress-actor', () => {
  /** The plugin's actor and the number its paths are built from (decision-14). */
  const STORED_ACTOR_ID = 'https://blog.example/?author=2';
  const WORDPRESS_ACTOR_ID = '2';
  /** The follower the saved collection carries, embedded so nothing is fetched. */
  const FOLLOWER = 'https://mstdn.example/users/weldon';

  /**
   * A site with one account, an exported key pair and a saved followers
   * collection.
   *
   * The collection is a file rather than a URL on purpose: the command's own
   * fetch is covered in process by `src/federation/import-wordpress.test.ts`,
   * and a child process reaching for a socket is the one thing a CLI test
   * must not do.
   */
  async function siteToImportInto(prefix: string): Promise<{
    directory: string;
    dataDir: string;
    privateKey: string;
    publicKey: string;
    followers: string;
  }> {
    const directory = await temporaryDir(prefix);
    const dataDir = path.join(directory, 'data');
    const run = await runCli(['user', 'add', 'ada', '--password', 'hunter22'], directory);
    assert.equal(run.code, 0, run.stderr);

    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const privateKey = path.join(directory, 'ada.private.pem');
    const publicKey = path.join(directory, 'ada.public.pem');
    const followers = path.join(directory, 'followers.json');
    await fs.writeFile(privateKey, pair.privateKey);
    await fs.writeFile(publicKey, pair.publicKey);
    await fs.writeFile(
      followers,
      JSON.stringify({
        type: 'OrderedCollection',
        orderedItems: [
          {
            id: FOLLOWER,
            type: 'Person',
            preferredUsername: 'weldon',
            name: 'Weldon',
            inbox: `${FOLLOWER}/inbox`,
            endpoints: { sharedInbox: 'https://mstdn.example/inbox' },
          },
        ],
      }),
    );

    return { directory, dataDir, privateKey, publicKey, followers };
  }

  /** The command line every test here runs, before its own flags. */
  function importArgs(site: {
    privateKey: string;
    publicKey: string;
    followers: string;
  }): string[] {
    return [
      'import',
      'wordpress-actor',
      'ada',
      '--actor-id',
      STORED_ACTOR_ID,
      '--wordpress-id',
      WORDPRESS_ACTOR_ID,
      '--private-key',
      site.privateKey,
      '--public-key',
      site.publicKey,
      '--followers',
      site.followers,
    ];
  }

  it('writes the key files, both ids and the followers, and says what it did', async () => {
    const site = await siteToImportInto('geekity-import-');

    const run = await runCli(importArgs(site), site.directory);

    assert.equal(run.code, 0, run.stderr);

    const user = listUsers(site.dataDir).find((entry) => entry.username === 'ada');
    assert.equal(user?.actorId, STORED_ACTOR_ID);
    assert.equal(user?.wordpressActorId, 2, 'the WordPress number is stored as a number');

    assert.ok(
      await exists(path.join(site.dataDir, 'keys', 'ada.rsassa-pkcs1-v1_5.jwk')),
      'the imported RSA pair is on disk under the username',
    );
    assert.ok(
      await exists(path.join(site.dataDir, 'keys', 'ada.ed25519.jwk')),
      'and the Ed25519 pair WordPress never had is minted beside it',
    );

    const followers = JSON.parse(
      await fs.readFile(
        path.join(site.directory, 'content', '_data', 'federation', 'ada', 'followers.json'),
        'utf8',
      ),
    ) as { actorId: string; inboxId: string }[];
    assert.deepEqual(
      followers.map((follower) => follower.actorId),
      [FOLLOWER],
    );
    assert.equal(followers[0]?.inboxId, `${FOLLOWER}/inbox`);

    assert.match(run.stdout, /ada/);
    assert.match(run.stdout, /1 added/);
  });

  it('changes nothing the second time, and says so', async () => {
    const site = await siteToImportInto('geekity-import-again-');
    assert.equal((await runCli(importArgs(site), site.directory)).code, 0);

    const run = await runCli(importArgs(site), site.directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /[Nn]othing to change/);
  });

  it('refuses to import over a different key pair unless told to', async () => {
    const site = await siteToImportInto('geekity-import-force-');
    assert.equal((await runCli(importArgs(site), site.directory)).code, 0);

    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    await fs.writeFile(site.privateKey, other.privateKey);
    await fs.writeFile(site.publicKey, other.publicKey);

    const refused = await runCli(importArgs(site), site.directory);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /--force/);

    const forced = await runCli([...importArgs(site), '--force'], site.directory);
    assert.equal(forced.code, 0, forced.stderr);
    assert.match(forced.stdout, /replaced/);
  });

  it('refuses a run that is missing what it cannot invent', async () => {
    const site = await siteToImportInto('geekity-import-missing-');

    const run = await runCli(
      ['import', 'wordpress-actor', 'ada', '--private-key', site.privateKey],
      site.directory,
    );

    assert.equal(run.code, 1);
    assert.match(run.stderr, /--actor-id/);
    assert.equal(listUsers(site.dataDir)[0]?.actorId, undefined, 'and nothing was written');
  });

  it('reads the key pair out of the JSON wp option get prints', async () => {
    const site = await siteToImportInto('geekity-import-keypair-');
    const keypair = path.join(site.directory, 'keypair.json');
    await fs.writeFile(
      keypair,
      JSON.stringify({
        private_key: await fs.readFile(site.privateKey, 'utf8'),
        public_key: await fs.readFile(site.publicKey, 'utf8'),
      }),
    );

    const run = await runCli(
      [
        'import',
        'wordpress-actor',
        'ada',
        '--actor-id',
        STORED_ACTOR_ID,
        '--wordpress-id',
        WORDPRESS_ACTOR_ID,
        '--keypair',
        keypair,
        '--followers',
        'none',
      ],
      site.directory,
    );

    assert.equal(run.code, 0, run.stderr);
    assert.ok(await exists(path.join(site.dataDir, 'keys', 'ada.rsassa-pkcs1-v1_5.jwk')));
  });
});
