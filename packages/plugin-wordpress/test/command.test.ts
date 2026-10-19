import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { listUsers } from '@geekity/cms';

import { importSummary } from '../src/command.ts';
import type { ImportWordPressActorReport } from '../src/import.ts';
import { runCli, writeConfigWithPlugin } from './site.ts';

const temporaryDirs: string[] = [];

after(async () => {
  await Promise.all(temporaryDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

describe('geekity --help', () => {
  it('lists import wordpress-actor when the plugin is installed', async () => {
    const directory = await temporaryDir('geekity-help-');
    writeConfigWithPlugin(directory);

    const run = await runCli(['--help'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /geekity import wordpress-actor <username> --actor-id <url>/);
    assert.match(run.stdout, /From @geekity\/plugin-wordpress\./);
    assert.match(run.stdout, /--wordpress-id <n>/);
  });

  it('does not list it, and refuses it, on a site without the plugin', async () => {
    const directory = await temporaryDir('geekity-help-bare-');

    assert.doesNotMatch((await runCli(['--help'], directory)).stdout, /wordpress-actor/);
    const run = await runCli(['import', 'wordpress-actor', 'ada'], directory);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /no plugin on this site adds "import wordpress-actor"/);
  });
});

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
   * fetch is covered in process by `import.test.ts`,
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
    writeConfigWithPlugin(directory);
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
    const actors = JSON.parse(
      await fs.readFile(
        path.join(site.dataDir, 'plugins', '@geekity', 'plugin-wordpress', 'actors.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.deepEqual(actors, { ada: 2 }, 'the WordPress number is stored as a number');

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

describe('the wordpress-actor summary', () => {
  /** A run whose followers step skipped the two kinds of follower. */
  const report: ImportWordPressActorReport = {
    username: 'ada',
    actorId: 'https://blog.example/?author=2',
    wordpressActorId: 2,
    identity: 'unchanged',
    keys: [],
    followers: {
      source: 'https://blog.example/wp-json/activitypub/1.0/actors/2/followers',
      added: [],
      unchanged: [],
      refreshed: [],
      failed: [
        {
          actor: 'https://down.example/users/dot',
          reason: 'https://down.example/users/dot answered 503 Service Unavailable',
          refused: false,
        },
        {
          actor: 'https://strict.example/users/sterling',
          reason: 'https://strict.example/users/sterling refused a signed fetch: 401 Unauthorized',
          refused: true,
        },
      ],
    },
    changed: false,
  };

  it('says a refused follower refused a signed fetch, and keeps the rerun advice for the rest', () => {
    const summary = importSummary(report);

    assert.match(
      summary,
      /down\.example\/users\/dot.*\n.*Run this again once their servers answer/s,
    );
    assert.match(summary, /strict\.example\/users\/sterling: .*refused a signed fetch/);
    assert.match(summary, /refused a fetch signed with the imported key/);
  });

  it('does not tell the owner a rerun will fix a follower that refused a signed fetch', () => {
    const summary = importSummary({
      ...report,
      followers: { ...report.followers, failed: report.followers.failed.slice(1) },
    });

    assert.doesNotMatch(summary, /Run this again/);
    assert.match(summary, /running this again will not bring them across/);
  });
});
