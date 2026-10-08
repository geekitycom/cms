import assert from 'node:assert/strict';
import type { webcrypto } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exportJwk, importJwk, signRequest } from '@fedify/fedify';
import { CryptographicKey, Endpoints, Follow, Person, Undo } from '@fedify/vocab';
import { createCms } from '@geekity/cms';
import type { Cms, Plugin } from '@geekity/cms';

import { seedActorKeys, testKeyPair, writeSite, writeUsers } from './site.ts';

/**
 * The bundle a folder install loads (decision-33), run against the site. It
 * carries its own copy of Fedify, so every object the site hands it, and
 * every activity it hands the site, crosses as plain data. An Undo is the
 * proof: the site's handler checks the undone object's type, which an object
 * from another copy of Fedify would fail.
 */

const BASE_URL = 'https://blog.example';
const USER = 'andrew';
const STORED = `${BASE_URL}/?author=2`;
const WP_ACTOR = `${BASE_URL}/wp-json/activitypub/1.0/actors/2`;
const REMOTE = 'https://remote.example/users/ada';

let bundled: Plugin;
let remoteKeys: webcrypto.CryptoKeyPair;
let remoteDocument: unknown;
let restoreFetch: () => void;
const started: Cms[] = [];
const dirs: string[] = [];

before(async () => {
  const bundle = new URL('../dist/bundle/index.js', import.meta.url).href;
  bundled = ((await import(bundle)) as { default: Plugin }).default;
  remoteKeys = await testKeyPair(1);
  remoteDocument = await new Person({
    id: new URL(REMOTE),
    preferredUsername: 'ada',
    inbox: new URL(`${REMOTE}/inbox`),
    endpoints: new Endpoints({ sharedInbox: new URL('https://remote.example/inbox') }),
    publicKey: new CryptographicKey({
      id: new URL(`${REMOTE}#main-key`),
      owner: new URL(REMOTE),
      publicKey: await importJwk(await exportJwk(remoteKeys.publicKey), 'public'),
    }),
  }).toJsonLd();

  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== 'https://remote.example') {
      return await original(input, init);
    }
    if (request.method === 'POST') return new Response('', { status: 202 });
    return new Response(JSON.stringify(remoteDocument), {
      headers: { 'content-type': 'application/activity+json' },
    });
  }) as typeof fetch;
  restoreFetch = () => {
    globalThis.fetch = original;
  };
});

after(async () => {
  restoreFetch();
  for (const cms of started) await cms.close();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function site(): Promise<Cms> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-wp-bundle-data-'));
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-wp-bundle-content-'));
  dirs.push(dataDir, contentDir);
  writeSite(contentDir, { baseUrl: BASE_URL, author: USER, enabled: true });
  writeUsers(dataDir, [{ username: USER, actorId: STORED }]);
  seedActorKeys(dataDir, USER);
  const folder = path.join(dataDir, 'plugins', '@geekity', 'plugin-wordpress');
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'actors.json'), JSON.stringify({ [USER]: 2 }));

  const cms = createCms({
    dataDir,
    contentDir,
    watch: false,
    baseUrl: BASE_URL,
    federation: { queue: null, allowPrivateAddress: true },
    plugins: [bundled],
  });
  started.push(cms);
  return cms;
}

async function deliver(cms: Cms, activity: { toJsonLd(): Promise<unknown> }): Promise<Response> {
  const request = new Request(`${WP_ACTOR}/inbox`, {
    method: 'POST',
    headers: { 'content-type': 'application/activity+json' },
    body: JSON.stringify(await activity.toJsonLd()),
  });
  return await cms.app.request(
    await signRequest(request, remoteKeys.privateKey, new URL(`${REMOTE}#main-key`)),
  );
}

describe('the bundled plugin', () => {
  it('serves the canonical actor and handles a Follow and its Undo', async () => {
    const cms = await site();

    const actor = await cms.app.request(WP_ACTOR, {
      headers: { accept: 'application/activity+json' },
    });
    assert.equal(((await actor.json()) as Record<string, unknown>)['id'], STORED);

    const follow = new Follow({
      id: new URL('https://remote.example/follows/1'),
      actor: new URL(REMOTE),
      object: new URL(STORED),
    });
    assert.equal((await deliver(cms, follow)).status, 202);
    assert.equal(cms.admin.countFollowers(USER), 1);

    const undo = new Undo({
      id: new URL('https://remote.example/follows/1/undo'),
      actor: new URL(REMOTE),
      object: follow,
    });
    assert.equal((await deliver(cms, undo)).status, 202);
    assert.equal(cms.admin.countFollowers(USER), 0);
  });
});
