/**
 * The federation phase plugins answer in (decision-33, TASK-282): where it
 * sits in the mount, and what a plugin's federation reaches of the site's.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exportJwk, importJwk } from '@fedify/fedify';
import { CryptographicKey, Endpoints, Follow, Person } from '@fedify/vocab';

import { writeUsers } from '../admin/__testing__/users.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import { enterDevMode, readDevModeRecord } from '../dev-mode.ts';
import { seedActorKeys, testKeyPair } from '../federation/__testing__/keys.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { PluginFederationContext, PluginFederationMiddleware } from '../plugin.ts';

const BASE_URL = 'https://blog.example';
const USER = 'ada';
const AUTHOR_URL = `${BASE_URL}/author/${USER}/`;
const STORED_ID = `${BASE_URL}/?author=2`;
const PLUGIN = '@test/plugin-federation';

const REMOTE_ORIGIN = 'https://remote.example';
const REMOTE_ACTOR = `${REMOTE_ORIGIN}/users/grace`;
const REMOTE_INBOX = `${REMOTE_ACTOR}/inbox`;

const started: Cms[] = [];
const dirs: string[] = [];
const deliveries: Record<string, unknown>[] = [];
let remoteActorDocument: unknown;
let restoreFetch: () => void;

before(async () => {
  const keys = await testKeyPair(1);
  remoteActorDocument = await new Person({
    id: new URL(REMOTE_ACTOR),
    preferredUsername: 'grace',
    inbox: new URL(REMOTE_INBOX),
    endpoints: new Endpoints({ sharedInbox: new URL(`${REMOTE_ORIGIN}/inbox`) }),
    publicKey: new CryptographicKey({
      id: new URL(`${REMOTE_ACTOR}#main-key`),
      owner: new URL(REMOTE_ACTOR),
      publicKey: await importJwk(await exportJwk(keys.publicKey), 'public'),
    }),
  }).toJsonLd();

  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== REMOTE_ORIGIN) return await original(input, init);
    if (request.method === 'POST') {
      deliveries.push((await request.json()) as Record<string, unknown>);
      return new Response('', { status: 202 });
    }
    return new Response(JSON.stringify(remoteActorDocument), {
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

async function dir(prefix: string): Promise<string> {
  const made = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(made);
  return made;
}

/** A site whose one plugin runs `middleware` in the federation phase. */
async function site(middleware: PluginFederationMiddleware, enabled = true): Promise<Cms> {
  const dataDir = await dir('geekity-plugin-fed-data-');
  const contentDir = await dir('geekity-plugin-fed-content-');
  seedActorKeys(dataDir, USER);
  writeUsers(dataDir, [{ username: USER, profile: { displayName: 'Ada' }, actorId: STORED_ID }]);
  await writeSiteJson({
    contentDir,
    settings: { ...DEFAULT_SITE_SETTINGS, title: 'Geekity', baseUrl: BASE_URL, author: USER },
  });
  if (enabled) {
    const file = path.join(contentDir, '_data', 'site.json');
    const json = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...json, plugins: { [PLUGIN]: { enabled: true } } }));
  }

  deliveries.length = 0;
  const cms = createCms({
    dataDir,
    contentDir,
    watch: false,
    baseUrl: BASE_URL,
    federation: { queue: null, allowPrivateAddress: true },
    plugins: [
      definePlugin({
        name: PLUGIN,
        version: '1.0.0',
        label: 'Federation',
        description: 'Answers in the federation phase.',
        hostApi: HOST_API_VERSION,
        register: (host) => host.federation(middleware),
      }),
    ],
  });
  started.push(cms);
  return cms;
}

/** Answer `x-plugin: yes` requests, and hand everything else on. */
const claimsMarked: PluginFederationMiddleware = async ({ request }, next) =>
  request.headers.get('x-plugin') === 'yes' ? new Response('plugin') : await next();

const asPeer = { accept: 'application/activity+json' };

describe('the federation phase', () => {
  it('runs after the canonical federation and before stored ids', async () => {
    const cms = await site(claimsMarked);

    const actor = await cms.app.request(AUTHOR_URL, { headers: { ...asPeer, 'x-plugin': 'yes' } });
    assert.equal(((await actor.json()) as Record<string, unknown>)['type'], 'Person');

    const stored = await cms.app.request(STORED_ID, { headers: { ...asPeer, 'x-plugin': 'yes' } });
    assert.equal(await stored.text(), 'plugin', 'a stored id is the plugin’s to claim first');

    const handedOn = await cms.app.request(STORED_ID, { headers: asPeer });
    assert.equal(((await handedOn.json()) as Record<string, unknown>)['id'], STORED_ID);
  });

  it('is skipped while the plugin is disabled', async () => {
    const cms = await site(claimsMarked, false);

    const response = await cms.app.request(`${BASE_URL}/nowhere/`, {
      headers: { 'x-plugin': 'yes' },
    });
    assert.equal(response.status, 404);
  });

  it('hands next() the rest of the site’s answer', async () => {
    let downstream: number | undefined;
    const cms = await site(async (_context, next) => {
      const response = await next();
      downstream = response.status;
      return response;
    });

    assert.equal((await cms.app.request(`${BASE_URL}/nowhere/`)).status, 404);
    assert.equal(downstream, 404);
  });
});

describe('what a plugin’s federation reaches', () => {
  /** Run one request through a middleware that captures its context. */
  async function contextOf(): Promise<{ cms: Cms; context: PluginFederationContext }> {
    let captured: PluginFederationContext | undefined;
    const cms = await site(async (context, next) => {
      captured = context;
      return await next();
    });
    await cms.app.request(`${BASE_URL}/anything/`);
    assert.ok(captured !== undefined);
    return { cms, context: captured };
  }

  it('the canonical actor, as JSON-LD, and nothing for a stranger', async () => {
    const { context } = await contextOf();

    const actor = await context.actor(USER);
    assert.equal(actor?.['id'], STORED_ID);
    assert.equal(actor?.['inbox'], `${AUTHOR_URL}inbox/`);
    assert.equal(await context.actor('nobody'), undefined);
    assert.equal((await context.keyPairs(USER)).length, 2, 'the RSA and the Ed25519 pair');
    assert.deepEqual(await context.keyPairs('nobody'), []);
    assert.equal(context.outbox('nobody'), undefined);
    assert.equal(context.followers('nobody'), undefined);
  });

  it('the shared KV store and the private-address rule', async () => {
    const { context } = await contextOf();

    await context.kv.set(['test'], 'shared');
    assert.equal(await context.kv.get(['test']), 'shared');
    assert.equal(context.allowPrivateAddress, true);
  });

  it('the inbox handlers, run as the canonical inbox runs them', async () => {
    const { cms, context } = await contextOf();
    const follow = await new Follow({
      id: new URL(`${REMOTE_ORIGIN}/follows/1`),
      actor: new URL(REMOTE_ACTOR),
      object: new URL(STORED_ID),
    }).toJsonLd();

    await context.receive(follow as Record<string, unknown>, USER);

    assert.equal(cms.admin.getFollower(USER, REMOTE_ACTOR)?.inboxId, REMOTE_INBOX);
    const accept = deliveries.find((delivery) => delivery['type'] === 'Accept');
    assert.equal(accept?.['actor'], STORED_ID, 'answered from the canonical identity');

    const followers = context.followers(USER);
    assert.equal(followers?.totalItems, 1);
    assert.deepEqual((await followers?.page('0'))?.items, [
      { id: REMOTE_ACTOR, inboxId: REMOTE_INBOX, sharedInboxId: `${REMOTE_ORIGIN}/inbox` },
    ]);
    assert.equal(context.outbox(USER)?.totalItems, 0);
  });

  it('the inbox handlers, held by dev mode with no switch of the plugin’s own (TASK-295)', async () => {
    const { cms, context } = await contextOf();
    enterDevMode(cms.config.dataDir, 'command');
    const follow = await new Follow({
      id: new URL(`${REMOTE_ORIGIN}/follows/2`),
      actor: new URL(REMOTE_ACTOR),
      object: new URL(STORED_ID),
    }).toJsonLd();

    await context.receive(follow as Record<string, unknown>, USER);

    assert.equal(cms.admin.getFollower(USER, REMOTE_ACTOR)?.inboxId, REMOTE_INBOX);
    assert.deepEqual(deliveries, [], 'the Accept did not go out');
    assert.ok(
      readDevModeRecord(cms.config.dataDir).some(
        (entry) => entry.type === 'held' && entry.what.startsWith('Accept '),
      ),
      'it was recorded as held',
    );
  });
});
