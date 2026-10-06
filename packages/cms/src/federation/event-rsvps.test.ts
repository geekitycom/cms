import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exportJwk, importJwk, signRequest } from '@fedify/fedify';
import { CryptographicKey, Endpoints, Person } from '@fedify/vocab';

import { writeUsers } from '../admin/__testing__/users.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { seedActorKeys, testKeyPair } from './__testing__/keys.ts';

const BASE_URL = 'https://blog.example';
const LOCAL_USER = 'ada';
const SITE_INBOX = `${BASE_URL}/author/${LOCAL_USER}/inbox/`;
const EVENT = `${BASE_URL}/2026/09/camp/`;
const REMOTE_ORIGIN = 'https://mastodon.example';
const PEOPLE = ['bea', 'cy', 'dee'] as const;
const ACTIVITY_STREAMS = 'application/activity+json';

const actorOf = (name: string): string => `${REMOTE_ORIGIN}/users/${name}`;
const keyOf = (name: string): string => `${actorOf(name)}#main-key`;

const started: Cms[] = [];
const temporaryDirs: string[] = [];
const actorDocuments = new Map<string, unknown>();
let remoteKeys: CryptoKeyPair;
const original = globalThis.fetch;

before(async () => {
  remoteKeys = await testKeyPair(1);
  const publicKey = await importJwk(await exportJwk(remoteKeys.publicKey), 'public');
  for (const name of PEOPLE) {
    actorDocuments.set(
      new URL(actorOf(name)).pathname,
      await new Person({
        id: new URL(actorOf(name)),
        preferredUsername: name,
        name: name.toUpperCase(),
        inbox: new URL(`${actorOf(name)}/inbox`),
        endpoints: new Endpoints({ sharedInbox: new URL(`${REMOTE_ORIGIN}/inbox`) }),
        publicKey: new CryptographicKey({
          id: new URL(keyOf(name)),
          owner: new URL(actorOf(name)),
          publicKey,
        }),
      }).toJsonLd(),
    );
  }

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== REMOTE_ORIGIN) return await original(input, init);
    if (request.method === 'POST') return new Response('', { status: 202 });
    const document = actorDocuments.get(url.pathname);
    if (document === undefined) return new Response('Not found.', { status: 404 });
    return new Response(JSON.stringify(document), {
      headers: { 'content-type': ACTIVITY_STREAMS },
    });
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = original;
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

async function site(): Promise<Cms> {
  const dataDir = await temporaryDir('geekity-event-rsvps-data-');
  const contentDir = await temporaryDir('geekity-event-rsvps-content-');
  seedActorKeys(dataDir, LOCAL_USER);
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, 'posts', '2026-09-02-camp.md'),
    [
      '---',
      'title: IndieWeb Camp',
      "date: '2026-09-02T09:00:00Z'",
      'permalink: /2026/09/camp/',
      `author: ${LOCAL_USER}`,
      "start: '2026-10-10T14:00:00Z'",
      '---',
      '',
      'Two days of building.',
      '',
    ].join('\n'),
  );
  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      title: 'Geekity',
      baseUrl: BASE_URL,
      timezone: 'UTC',
      author: LOCAL_USER,
    },
  });
  writeUsers(dataDir, [{ username: LOCAL_USER, profile: { displayName: 'Ada' } }]);

  const instance = createCms({
    dataDir,
    contentDir,
    watch: false,
    baseUrl: BASE_URL,
    federation: { queue: null, allowPrivateAddress: true },
  });
  started.push(instance);
  await instance.sync();
  return instance;
}

async function deliver(
  instance: Cms,
  name: string,
  activity: Record<string, unknown>,
): Promise<void> {
  const request = new Request(SITE_INBOX, {
    method: 'POST',
    headers: { 'content-type': ACTIVITY_STREAMS },
    body: JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      actor: actorOf(name),
      ...activity,
    }),
  });
  const response = await instance.app.request(
    await signRequest(request, remoteKeys.privateKey, new URL(keyOf(name))),
  );
  assert.equal(response.status, 202, await response.clone().text());
}

function groups(page: string): Record<string, number> {
  const found: Record<string, number> = {};
  for (const [, kind, body] of page.matchAll(
    /<div class="reaction-group rsvp-(\w+)">([\s\S]*?)<\/div>\s*<\/div>/g,
  )) {
    found[kind ?? ''] = [...(body ?? '').matchAll(/<a class="u-url"/g)].length;
  }
  return found;
}

describe('fediverse answers to an event (TASK-200 AC #3)', () => {
  it('shows an Accept as going, a TentativeAccept as maybe and a Reject as not going', async () => {
    const instance = await site();
    await deliver(instance, 'bea', { id: `${actorOf('bea')}#a`, type: 'Accept', object: EVENT });
    await deliver(instance, 'cy', {
      id: `${actorOf('cy')}#t`,
      type: 'TentativeAccept',
      object: { id: EVENT, type: 'Event', name: 'IndieWeb Camp' },
    });
    await deliver(instance, 'dee', { id: `${actorOf('dee')}#r`, type: 'Reject', object: EVENT });

    const page = await (await instance.app.request('/2026/09/camp/')).text();

    assert.deepEqual(groups(page), { yes: 1, maybe: 1, no: 1 });
    assert.match(page, /href="https:\/\/mastodon\.example\/users\/bea"/);
    assert.match(page, />Maybe <span class="reaction-count">1<\/span>/);
  });

  it('moves somebody who changes their answer, and drops one they undo', async () => {
    const instance = await site();
    await deliver(instance, 'bea', { id: `${actorOf('bea')}#a`, type: 'Accept', object: EVENT });
    await deliver(instance, 'bea', { id: `${actorOf('bea')}#r`, type: 'Reject', object: EVENT });
    await deliver(instance, 'cy', { id: `${actorOf('cy')}#a`, type: 'Accept', object: EVENT });
    await deliver(instance, 'cy', {
      id: `${actorOf('cy')}#u`,
      type: 'Undo',
      object: { id: `${actorOf('cy')}#a`, type: 'Accept', actor: actorOf('cy'), object: EVENT },
    });

    const page = await (await instance.app.request('/2026/09/camp/')).text();

    assert.deepEqual(groups(page), { no: 1 });
  });

  it('takes no answer to the event as a relay’s answer', async () => {
    const instance = await site();
    instance.admin.putRelay({
      inboxId: `${REMOTE_ORIGIN}/inbox`,
      actorId: null,
      followId: `${BASE_URL}/#follow/relay`,
      state: 'pending',
      reason: null,
    });

    await deliver(instance, 'bea', { id: `${actorOf('bea')}#a`, type: 'Accept', object: EVENT });

    assert.equal(instance.admin.listRelays()[0]?.state, 'pending');
  });
});
