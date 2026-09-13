import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { importJwk } from '@fedify/fedify';

import { writeUsers } from '../admin/__testing__/users.ts';
import { listUsers } from '../admin/accounts.ts';
import { openAdminStore } from '../admin/store.ts';
import type { AdminStore } from '../admin/store.ts';
import { importWordPressActor } from './import-wordpress.ts';
import { actorKeyFile } from './keys.ts';
import { followersFile, readFollowers } from './records.ts';

/**
 * `geekity import wordpress-actor` (TASK-71), against a WordPress that only
 * exists in this process.
 *
 * Everything the fake site answers is the shape decision-14 recorded off
 * andrewshell.org on 2026-09-12: an actor id with a query string, a followers
 * `OrderedCollection` that carries nothing but a `first` page, and a page whose
 * `orderedItems` are bare actor URLs rather than embedded actors. The import
 * has to dereference each of those, which is the only reason it touches the
 * network at all — and here the network is a function.
 */

/** The site the owner is leaving, and the person being brought across. */
const WORDPRESS_ORIGIN = 'https://blog.example';
const WORDPRESS_ACTOR_ID = 2;
const STORED_ACTOR_ID = `${WORDPRESS_ORIGIN}/?author=${String(WORDPRESS_ACTOR_ID)}`;
const WP_BASE = `${WORDPRESS_ORIGIN}/wp-json/activitypub/1.0`;
const WP_FOLLOWERS = `${WP_BASE}/actors/${String(WORDPRESS_ACTOR_ID)}/followers`;

const USERNAME = 'andrew';

/** The two followers the fake site has, in the order its page lists them. */
const MARIEN = 'https://tutut.example/users/marien';
const WELDON = 'https://mstdn.example/users/weldon';

/** An actor the collection names and that nobody can fetch. */
const GONE = 'https://gone.example/users/ghost';

const temporaryDirs: string[] = [];
const stores: AdminStore[] = [];

/** The RSA pair standing in for the one `wp option get` would have printed. */
let privateKeyPem: string;
let publicKeyPem: string;
/** A second pair, for the run that must not be allowed to overwrite the first. */
let otherPrivateKeyPem: string;

let restoreFetch: () => void;

before(() => {
  ({ privateKeyPem, publicKeyPem } = rsaPem());
  otherPrivateKeyPem = rsaPem().privateKeyPem;
  restoreFetch = serveFakeWordPress();
});

after(async () => {
  restoreFetch();
  for (const store of stores) store.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A fresh RSA 2048 pair as PEM, which is what the plugin stores. */
function rsaPem(type: 'pkcs8' | 'pkcs1' = 'pkcs8'): {
  privateKeyPem: string;
  publicKeyPem: string;
} {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type, format: 'pem' },
  });
  return { privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey };
}

/** One actor document, as a Mastodon-shaped server would answer it. */
function remoteActor(id: string): Record<string, unknown> {
  const url = new URL(id);
  const username = url.pathname.split('/').pop() ?? '';
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id,
    type: 'Person',
    preferredUsername: username,
    name: `${username} of ${url.host}`,
    url: `${url.origin}/@${username}`,
    inbox: `${id}/inbox`,
    endpoints: { sharedInbox: `${url.origin}/inbox` },
    icon: { type: 'Image', url: `${url.origin}/avatars/${username}.png` },
  };
}

/**
 * The WordPress site and the two followers' servers, answered from memory.
 *
 * Anything else falls through to the real `fetch`, which nothing in this file
 * asks for: a request to an unknown host here is a bug in the test, and it
 * shows up as one.
 */
function serveFakeWordPress(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/activity+json' },
      });

    if (request.url === WP_FOLLOWERS) {
      return json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: WP_FOLLOWERS,
        type: 'OrderedCollection',
        totalItems: 3,
        first: `${WP_FOLLOWERS}?page=1`,
        last: `${WP_FOLLOWERS}?page=1`,
      });
    }
    if (request.url === `${WP_FOLLOWERS}?page=1`) {
      return json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${WP_FOLLOWERS}?page=1`,
        type: 'OrderedCollectionPage',
        totalItems: 3,
        orderedItems: [MARIEN, WELDON, GONE],
        partOf: WP_FOLLOWERS,
      });
    }
    if (request.url === MARIEN || request.url === WELDON) return json(remoteActor(request.url));
    if (url.origin === 'https://gone.example') {
      return new Response('Gone.', { status: 410 });
    }

    return await original(input, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

/** A site with one account, ready to be imported into. */
async function site(): Promise<{ dataDir: string; contentDir: string; admin: AdminStore }> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-import-data-'));
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-import-content-'));
  temporaryDirs.push(dataDir, contentDir);

  writeUsers(dataDir, [{ username: USERNAME }]);
  const admin = openAdminStore({ dataDir });
  stores.push(admin);
  return { dataDir, contentDir, admin };
}

/** Everything the command is given, with the parts every test repeats filled in. */
function importing(
  where: { dataDir: string; contentDir: string; admin: AdminStore },
  overrides: Record<string, unknown> = {},
): Parameters<typeof importWordPressActor>[0] {
  return {
    ...where,
    username: USERNAME,
    actorId: STORED_ACTOR_ID,
    wordpressActorId: WORDPRESS_ACTOR_ID,
    privateKeyPem,
    publicKeyPem,
    followers: false,
    ...overrides,
  } as Parameters<typeof importWordPressActor>[0];
}

describe('importWordPressActor', () => {
  it("writes the plugin's RSA key as the user's JWK file, and mints the Ed25519 pair beside it", async () => {
    const where = await site();

    const report = await importWordPressActor(importing(where));

    const rsaFile = actorKeyFile(where.dataDir, USERNAME, 'RSASSA-PKCS1-v1_5');
    const jwk = JSON.parse(await readFile(rsaFile, 'utf8')) as JsonWebKey;
    assert.equal(jwk.kty, 'RSA', 'the file holds an RSA key');
    assert.equal(jwk.alg, 'RS256', 'spelled the way the key loader insists on');
    assert.ok(typeof jwk.d === 'string' && jwk.d !== '', 'and it is the private half');

    // The proof it is *the plugin's* key and not a new one: the modulus of the
    // exported PEM and the modulus in the file are the same number.
    assert.equal(jwk.n, publicModulus(publicKeyPem), 'the imported key is the one the PEM carried');
    // It has to import, or the site would serve an actor with no usable key.
    await importJwk(jwk, 'private');

    const ed25519 = JSON.parse(
      await readFile(actorKeyFile(where.dataDir, USERNAME, 'Ed25519'), 'utf8'),
    ) as JsonWebKey;
    assert.equal(ed25519.crv, 'Ed25519', 'the Ed25519 pair WordPress never had is minted');

    assert.ok(report.changed, 'the run reports that it changed something');
  });

  it('reads a PKCS#1 PEM as well, which is what an older PHP exports', async () => {
    const where = await site();
    const pkcs1 = rsaPem('pkcs1');

    await importWordPressActor(
      importing(where, {
        privateKeyPem: pkcs1.privateKeyPem,
        publicKeyPem: pkcs1.publicKeyPem,
      }),
    );

    const jwk = JSON.parse(
      await readFile(actorKeyFile(where.dataDir, USERNAME, 'RSASSA-PKCS1-v1_5'), 'utf8'),
    ) as JsonWebKey;
    assert.equal(jwk.n, publicModulus(pkcs1.publicKeyPem));
  });

  it('refuses an export whose two halves are not one pair', async () => {
    const where = await site();

    await assert.rejects(
      importWordPressActor(importing(where, { privateKeyPem: otherPrivateKeyPem })),
      /not two halves of one pair/,
    );
  });

  it('puts the stored actor id and the WordPress number on the user record', async () => {
    const where = await site();

    await importWordPressActor(importing(where));

    const user = listUsers(where.dataDir).find((entry) => entry.username === USERNAME);
    assert.equal(user?.actorId, STORED_ACTOR_ID, 'the id its followers hold, query string and all');
    assert.equal(user?.wordpressActorId, WORDPRESS_ACTOR_ID, 'as a JSON number');
  });

  it('refuses a number another account already carries', async () => {
    const where = await site();
    writeUsers(where.dataDir, [
      { username: USERNAME },
      { username: 'someone-else', id: 9, wordpressActorId: WORDPRESS_ACTOR_ID },
    ]);

    await assert.rejects(importWordPressActor(importing(where)), /someone-else/);
  });

  it('refuses a username nobody on this site has', async () => {
    const where = await site();

    await assert.rejects(importWordPressActor(importing(where, { username: 'nobody' })), /nobody/);
  });

  it('walks the followers collection and writes every reachable follower into the file', async () => {
    const where = await site();

    const report = await importWordPressActor(importing(where, { followers: undefined }));

    assert.equal(
      report.followers.source,
      WP_FOLLOWERS,
      'the collection URL is derived from the actor id and the number',
    );
    const held = readFollowers(where.contentDir, USERNAME);
    assert.deepEqual(
      held.map((follower) => follower.actorId),
      [MARIEN, WELDON],
      'both reachable followers are in the file, in the order the page listed them',
    );

    const marien = held[0];
    assert.equal(marien?.inboxId, `${MARIEN}/inbox`, 'with the inbox to deliver to');
    assert.equal(marien?.sharedInboxId, 'https://tutut.example/inbox', 'and the shared inbox');
    assert.equal(marien?.handle, '@marien@tutut.example', 'and the handle');
    assert.equal(marien?.name, 'marien of tutut.example', 'and the display name');
    assert.equal(marien?.iconUrl, 'https://tutut.example/avatars/marien.png', 'and the avatar');
    assert.equal(marien?.url, 'https://tutut.example/@marien', 'and the profile URL');

    // The index the site pages and delivers by has to say the same thing.
    assert.equal(where.admin.countFollowers(USERNAME), 2);

    assert.deepEqual(
      report.followers.failed.map((failure) => failure.actor),
      [GONE],
      'the one that would not answer is reported rather than fatal',
    );
    assert.match(report.followers.failed[0]?.reason ?? '', /410/);
  });

  it('changes nothing the second time, and says so', async () => {
    const where = await site();

    await importWordPressActor(importing(where, { followers: undefined }));
    const before = await readFile(followersFile(where.contentDir, USERNAME), 'utf8');

    const again = await importWordPressActor(importing(where, { followers: undefined }));

    assert.equal(again.changed, false, 'the second run changed nothing');
    assert.equal(again.identity, 'unchanged');
    assert.deepEqual(
      again.keys.map((key) => key.state),
      ['unchanged', 'unchanged'],
    );
    assert.deepEqual(again.followers.added, [], 'and added no follower');
    assert.deepEqual(again.followers.unchanged, [MARIEN, WELDON]);
    assert.equal(
      await readFile(followersFile(where.contentDir, USERNAME), 'utf8'),
      before,
      'the followers file is byte for byte what it was',
    );
  });

  it('refuses a second, different key pair unless it is told to replace it', async () => {
    const where = await site();
    await importWordPressActor(importing(where));

    const other = rsaPem();
    await assert.rejects(
      importWordPressActor(
        importing(where, {
          privateKeyPem: other.privateKeyPem,
          publicKeyPem: other.publicKeyPem,
        }),
      ),
      /already has a different key pair/,
    );
    assert.equal(
      publicModulus(publicKeyPem),
      (
        JSON.parse(
          await readFile(actorKeyFile(where.dataDir, USERNAME, 'RSASSA-PKCS1-v1_5'), 'utf8'),
        ) as JsonWebKey
      ).n,
      'and the key that is there is untouched',
    );

    const forced = await importWordPressActor(
      importing(where, {
        privateKeyPem: other.privateKeyPem,
        publicKeyPem: other.publicKeyPem,
        force: true,
      }),
    );
    assert.equal(forced.keys[0]?.state, 'replaced');
  });

  it('takes the followers from a file, so a collection can be exported before the DNS moves', async () => {
    const where = await site();
    const saved = path.join(where.dataDir, 'followers.json');
    await writeFile(
      saved,
      JSON.stringify({ type: 'OrderedCollection', orderedItems: [remoteActor(WELDON)] }),
    );

    const report = await importWordPressActor(importing(where, { followers: saved }));

    assert.deepEqual(report.followers.added, [WELDON]);
    assert.deepEqual(
      readFollowers(where.contentDir, USERNAME).map((follower) => follower.inboxId),
      [`${WELDON}/inbox`],
      'an embedded actor needs no dereferencing at all',
    );
  });
});

/**
 * The modulus of a public PEM, read by node:crypto's own parser.
 *
 * An independent reading of the same bytes: the import gets there through
 * WebCrypto and Fedify's `exportJwk`, so a modulus that agrees with this one
 * is a modulus neither side invented.
 */
function publicModulus(pem: string): string {
  return createPublicKey(pem).export({ format: 'jwk' }).n as string;
}
