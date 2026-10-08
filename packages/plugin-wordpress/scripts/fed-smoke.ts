/**
 * Federation smoke test for the WordPress plugin: a real server, the real
 * `@fedify/cli`, and a real peer, over real sockets.
 *
 * The suite drives the plugin inside one process. This boots a site with the
 * plugin installed and enabled on a free port, and then:
 *
 *   1. Brings one person across with the plugin's import, from an RSA pair
 *      exported as PEM, as `geekity import wordpress-actor` does.
 *   2. `fedify lookup` fetches the actor at the plugin's old path, and checks
 *      it is the canonical actor publishing the imported key.
 *   3. A peer built out of Fedify sends a signed `Follow` to the old inbox.
 *      The site has to verify it, store the follower and answer `Accept`,
 *      which the peer verifies against the imported key.
 *   4. The plugin's record says when each path was asked for.
 *   5. Disabling the plugin takes the paths away on the next request.
 *
 * It is `pnpm --filter @geekity/plugin-wordpress fed:smoke`, and part of
 * `pnpm fed:smoke` and the `fed-smoke` CI job. Everything is on loopback, so
 * the site and the peer allow private addresses and `fedify lookup` is given
 * `--allow-private-address`.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import type { webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFederation, generateCryptoKeyPair, MemoryKvStore } from '@fedify/fedify';
import { Accept, Application, Endpoints, Follow } from '@fedify/vocab';
import { createCms, pluginDataFolder, pluginSite } from '@geekity/cms';
import { serve } from '@hono/node-server';

import wordpress from '../src/index.ts';
import { importWordPressActor } from '../src/import.ts';
import { REQUESTS_FILE, wordPressRecords } from '../src/records.ts';
import { writeSite, writeUsers } from '../test/site.ts';

const USERNAME = 'oldblog';
const WORDPRESS_ID = 2;
const STEP_TIMEOUT_MS = 30_000;
const POLL_MS = 100;

async function main(): Promise<void> {
  const cleanups: (() => Promise<void>)[] = [];

  try {
    const port = await freePort();
    const baseUrl = `http://localhost:${String(port)}`;
    const storedActorId = `${baseUrl}/?author=${String(WORDPRESS_ID)}`;
    const wpActor = `${baseUrl}/wp-json/activitypub/1.0/actors/${String(WORDPRESS_ID)}`;

    const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-wp-smoke-data-'));
    const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-wp-smoke-content-'));
    cleanups.push(async () => {
      await rm(dataDir, { recursive: true, force: true });
      await rm(contentDir, { recursive: true, force: true });
    });
    writeSite(contentDir, { baseUrl, author: USERNAME, enabled: true });
    writeUsers(dataDir, [{ username: USERNAME, displayName: 'The Old Blog' }]);

    log(`booting the site on ${baseUrl}`);
    const cms = createCms({
      port,
      dataDir,
      contentDir,
      baseUrl,
      watch: false,
      federation: { queue: null, allowPrivateAddress: true },
      plugins: [wordpress],
    });
    cleanups.push(() => cms.close());
    await cms.serve();
    ok(`the site is listening on ${baseUrl}`);

    // ------------------------------------------------------------ the import
    log(`importing ${USERNAME} as WordPress actor ${String(WORDPRESS_ID)}`);
    const exported = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const records = wordPressRecords(pluginDataFolder(dataDir, wordpress.name));
    const imported = await importWordPressActor({
      site: pluginSite({ admin: cms.admin, config: cms.config }),
      records,
      username: USERNAME,
      actorId: storedActorId,
      wordpressActorId: WORDPRESS_ID,
      privateKeyPem: exported.privateKey,
      publicKeyPem: exported.publicKey,
      followers: false,
    });
    assert.equal(imported.keys[0]?.state, 'imported', 'the RSA pair came from the PEM');
    ok(`imported ${USERNAME}: ${imported.keys.map((key) => key.file).join(', ')}`);

    // ---------------------------------------------------- the old actor path
    log(`fedify lookup ${wpActor}`);
    const actor = await lookup(wpActor);
    assert.equal(actor['id'], storedActorId, 'the identity, not the path it was fetched at');
    assert.equal(actor['inbox'], `${baseUrl}/author/${USERNAME}/inbox/`, 'the canonical inbox');
    const publicKey = actor['publicKey'] as { publicKeyPem?: string } | undefined;
    assert.equal(
      (publicKey?.publicKeyPem ?? '').replace(/\s+/g, ''),
      exported.publicKey.replace(/\s+/g, ''),
      'publishing the imported key',
    );
    ok(`the actor at ${wpActor} is ${storedActorId}`);

    for (const name of ['outbox', 'followers', 'following']) {
      const collection = await lookup(`${wpActor}/${name}`);
      assert.match(String(collection['type']), /Collection/, name);
    }
    ok('the outbox, followers and following collections answer under the old path');

    // --------------------------------------------- a Follow at the old inbox
    log('following from a peer built out of Fedify, at the old inbox');
    const peer = await startPeer(await freePort());
    cleanups.push(() => peer.stop());
    await peer.follow(storedActorId, `${wpActor}/inbox`);

    const follower = await waitFor({
      what: 'the Follow to be accepted and the follower stored',
      poll: () => cms.admin.getFollower(USERNAME, peer.actorId),
    });
    assert.equal(follower.inboxId, peer.inboxId);
    await waitFor({
      what: 'the Accept to arrive at the peer, verified against the imported key',
      poll: () => (peer.accepted() > 0 ? true : undefined),
    });
    ok(`accepted a Follow from ${peer.actorId} delivered to ${wpActor}/inbox`);

    // ----------------------------------------------------------- the record
    const requests = JSON.parse(
      await readFile(
        path.join(pluginDataFolder(dataDir, wordpress.name).path, REQUESTS_FILE),
        'utf8',
      ),
    ) as { users: Record<string, Record<string, string>> };
    for (const route of ['actor', 'inbox', 'outbox', 'followers', 'following']) {
      assert.ok(requests.users[USERNAME]?.[route] !== undefined, `${route} was timed`);
    }
    ok('the plugin recorded when each path was last asked for');

    // ----------------------------------------------------------- disabling
    writeSite(contentDir, { baseUrl, author: USERNAME, enabled: false });
    const gone = await fetch(wpActor, { headers: { accept: 'application/activity+json' } });
    assert.equal(gone.status, 404, 'disabled, the old path is gone on the next request');
    ok('disabling the plugin took the old paths away');

    console.log('\nWordPress plugin federation smoke passed');
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
}

/** A port nothing is listening on right now. */
async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        if (port === 0) reject(new Error('the operating system offered no port'));
        else resolve(port);
      });
    });
  });
}

/** `fedify lookup` on one URL, as the JSON-LD it fetched. */
async function lookup(url: string): Promise<Record<string, unknown>> {
  const result = await new Promise<{ code: number | null; stdout: string; output: string }>(
    (resolve, reject) => {
      const child = spawn('fedify', ['lookup', '--raw', '--allow-private-address', url], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        output += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`fedify lookup ${url} did not finish in time`));
      }, STEP_TIMEOUT_MS);
      timer.unref();
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, output });
      });
    },
  );
  if (result.code !== 0) {
    throw new Error(`fedify lookup ${url} exited ${String(result.code)}:\n${result.output}`);
  }
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

/** A peer that follows through a given inbox and counts the Accepts it gets. */
interface Peer {
  actorId: string;
  inboxId: string;
  follow(actorId: string, inbox: string): Promise<void>;
  accepted(): number;
  stop(): Promise<void>;
}

/**
 * A second ActivityPub server on loopback, built out of Fedify. Its `Follow`
 * goes to the inbox it is told rather than the one the actor document names,
 * because the point is a peer still holding the old URL.
 */
async function startPeer(port: number): Promise<Peer> {
  const origin = `http://localhost:${String(port)}`;
  // Typed through node's WebCrypto types, which the linter resolves.
  const keyPair = (await generateCryptoKeyPair('RSASSA-PKCS1-v1_5')) as webcrypto.CryptoKeyPair;
  let accepts = 0;

  const federation = createFederation<undefined>({
    kv: new MemoryKvStore(),
    origin,
    allowPrivateAddress: true,
  });
  federation
    .setActorDispatcher('/users/{identifier}', async (context, identifier) => {
      if (identifier !== 'peer') return null;
      const keyPairs = await context.getActorKeyPairs(identifier);
      return new Application({
        id: context.getActorUri(identifier),
        preferredUsername: identifier,
        inbox: context.getInboxUri(identifier),
        endpoints: new Endpoints({ sharedInbox: context.getInboxUri() }),
        publicKeys: keyPairs.map((pair) => pair.cryptographicKey),
        assertionMethods: keyPairs.map((pair) => pair.multikey),
      });
    })
    .setKeyPairsDispatcher((_context, identifier) => (identifier === 'peer' ? [keyPair] : []));
  federation.setInboxListeners('/users/{identifier}/inbox', '/inbox').on(Accept, () => {
    accepts += 1;
  });

  const server = serve({
    port,
    hostname: '127.0.0.1',
    fetch: (request: Request) => federation.fetch(request, { contextData: undefined }),
  });

  const context = federation.createContext(new URL(origin), undefined);
  const actorId = context.getActorUri('peer');
  return {
    actorId: actorId.href,
    inboxId: context.getInboxUri('peer').href,
    accepted: () => accepts,
    async follow(target, inbox) {
      await context.sendActivity(
        { identifier: 'peer' },
        { id: new URL(target), inboxId: new URL(inbox) },
        new Follow({ id: new URL('#follow', actorId), actor: actorId, object: new URL(target) }),
      );
    },
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

async function waitFor<T>(wait: { what: string; poll: () => T | undefined }): Promise<T> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  for (;;) {
    const found = wait.poll();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${wait.what}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function log(message: string): void {
  console.log(`\n\u001B[1m==> ${message}\u001B[0m`);
}

function ok(message: string): void {
  console.log(`ok  ${message}`);
}

try {
  await main();
} catch (error) {
  console.error(`\nWordPress plugin federation smoke failed: ${String(error)}`);
  if (error instanceof Error && error.stack !== undefined) console.error(error.stack);
  process.exitCode = 1;
}
