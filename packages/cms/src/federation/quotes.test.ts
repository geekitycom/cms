import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
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
import { readQuoteAuthorizations } from './quotes.ts';

const BASE_URL = 'https://blog.example';
const LOCAL_USER = 'ada';
const SITE_ACTOR = `${BASE_URL}/author/${LOCAL_USER}/`;
const SITE_INBOX = `${SITE_ACTOR}inbox/`;
const SHARED_INBOX = `${BASE_URL}/inbox/`;
const WORDPRESS_SHARED_INBOX = `${BASE_URL}/wp-json/activitypub/1.0/inbox`;

const POST = `${BASE_URL}/2026/09/hello/`;
const DRAFT = `${BASE_URL}/2026/09/secret/`;

/** The Mastodon account that quotes, served only by the fetch stub. */
const REMOTE_ORIGIN = 'https://mastodon.example';
const REMOTE_ACTOR = `${REMOTE_ORIGIN}/users/bea`;
const REMOTE_INBOX = `${REMOTE_ACTOR}/inbox`;
const REMOTE_KEY = `${REMOTE_ACTOR}#main-key`;
const QUOTE = `${REMOTE_ACTOR}/statuses/42`;
const REQUEST = `${REMOTE_ACTOR}/quote_requests/42`;

const ACTIVITY_STREAMS = 'application/activity+json';

interface Delivery {
  url: string;
  body: Record<string, unknown>;
}

const started: Cms[] = [];
const temporaryDirs: string[] = [];
const deliveries: Delivery[] = [];

let remoteKeys: CryptoKeyPair;
let remoteActorDocument: unknown;
let restoreFetch: () => void;

before(async () => {
  remoteKeys = await testKeyPair(1);
  remoteActorDocument = await new Person({
    id: new URL(REMOTE_ACTOR),
    preferredUsername: 'bea',
    inbox: new URL(REMOTE_INBOX),
    endpoints: new Endpoints({ sharedInbox: new URL(`${REMOTE_ORIGIN}/inbox`) }),
    publicKey: new CryptographicKey({
      id: new URL(REMOTE_KEY),
      owner: new URL(REMOTE_ACTOR),
      publicKey: await importJwk(await exportJwk(remoteKeys.publicKey), 'public'),
    }),
  }).toJsonLd();

  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== REMOTE_ORIGIN) return await original(input, init);
    if (request.method === 'POST') {
      deliveries.push({
        url: request.url,
        body: (await request.json()) as Record<string, unknown>,
      });
      return new Response('', { status: 202 });
    }
    if (url.pathname === new URL(REMOTE_ACTOR).pathname) {
      return new Response(JSON.stringify(remoteActorDocument), {
        headers: { 'content-type': ACTIVITY_STREAMS },
      });
    }
    return new Response('Not found.', { status: 404 });
  }) as typeof fetch;
  restoreFetch = () => {
    globalThis.fetch = original;
  };
});

after(async () => {
  restoreFetch();
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

function postFile(title: string, permalink: string, draft = false): string {
  return [
    '---',
    `title: ${title}`,
    "date: '2026-09-02T09:00:00Z'",
    `permalink: ${permalink}`,
    `author: ${LOCAL_USER}`,
    ...(draft ? ['draft: true'] : []),
    '---',
    '',
    'Body.',
    '',
  ].join('\n');
}

/** A site with one published post and one draft, handling its inbox inside the request. */
async function site(settings: Partial<typeof DEFAULT_SITE_SETTINGS> = {}): Promise<Cms> {
  const dataDir = await temporaryDir('geekity-quotes-data-');
  const contentDir = await temporaryDir('geekity-quotes-content-');
  seedActorKeys(dataDir, LOCAL_USER);
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, 'posts', '2026-09-02-hello.md'),
    postFile('Hello', '/2026/09/hello/'),
  );
  await writeFile(
    path.join(contentDir, 'posts', '2026-09-01-secret.md'),
    postFile('Secret', '/2026/09/secret/', true),
  );
  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      title: 'Geekity',
      baseUrl: BASE_URL,
      timezone: 'UTC',
      author: LOCAL_USER,
      ...settings,
    },
  });
  writeUsers(dataDir, [
    { username: LOCAL_USER, profile: { displayName: 'Ada' }, wordpressActorId: 2 },
  ]);

  deliveries.length = 0;
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

/** Deliver a JSON-LD activity, signed by the Mastodon account, as Mastodon would. */
async function deliver(
  instance: Cms,
  activity: Record<string, unknown>,
  inbox = SITE_INBOX,
): Promise<Response> {
  const request = new Request(inbox, {
    method: 'POST',
    headers: { 'content-type': ACTIVITY_STREAMS },
    body: JSON.stringify(activity),
  });
  const response = await instance.app.request(
    await signRequest(request, remoteKeys.privateKey, new URL(REMOTE_KEY)),
  );
  assert.equal(response.status, 202, await response.clone().text());
  return response;
}

/** A QuoteRequest shaped the way Mastodon 4.5's QuoteRequestSerializer writes one. */
function quoteRequest(
  options: { object?: string; instrument?: string; id?: string } = {},
): Record<string, unknown> {
  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      { QuoteRequest: 'https://w3id.org/fep/044f#QuoteRequest' },
    ],
    id: options.id ?? REQUEST,
    type: 'QuoteRequest',
    actor: REMOTE_ACTOR,
    object: options.object ?? POST,
    instrument: options.instrument ?? QUOTE,
  };
}

/** The one answer the site sent the Mastodon account. */
function answer(): Record<string, unknown> {
  const sent = deliveries.filter((delivery) => delivery.url === REMOTE_INBOX);
  assert.equal(sent.length, 1, `one answer was sent, not ${String(sent.length)}`);
  return sent[0]!.body;
}

function idOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)['id']
    : value;
}

async function fetchObject(instance: Cms, url: string): Promise<Response> {
  return await instance.app.request(new Request(url, { headers: { accept: ACTIVITY_STREAMS } }));
}

/** Quote the published post and hand back the authorization URL the Accept named. */
async function approvedQuote(instance: Cms, request = REQUEST): Promise<string> {
  await deliver(instance, quoteRequest({ id: request }));
  const authorization = idOf(answer()['result']);
  assert.equal(typeof authorization, 'string');
  deliveries.length = 0;
  return authorization as string;
}

describe('a QuoteRequest for a public post (AC #2)', () => {
  it('is answered with an Accept whose result is a QuoteAuthorization', async () => {
    const instance = await site();

    await deliver(instance, quoteRequest());

    const accept = answer();
    assert.equal(accept['type'], 'Accept');
    assert.equal(accept['actor'], SITE_ACTOR, 'from the post’s author');
    assert.equal(idOf(accept['object']), REQUEST, 'accepting the request Mastodon is waiting on');
    const result = accept['result'] as Record<string, unknown>;
    assert.equal(result['type'], 'QuoteAuthorization');
    assert.equal(result['interactingObject'], QUOTE, 'naming the quote');
    assert.equal(result['interactionTarget'], POST, 'naming the post');
    assert.equal(result['attributedTo'], SITE_ACTOR, 'naming the post’s author');
    assert.equal(
      new URL(String(result['id'])).origin,
      BASE_URL,
      'on this site, since Mastodon checks the stamp’s host against the author’s',
    );
  });

  it('is answered at the shared inbox and at the WordPress-compatible one too', async () => {
    const instance = await site({ wordpressActivityPub: true });

    await deliver(instance, quoteRequest(), SHARED_INBOX);
    assert.equal(answer()['type'], 'Accept');

    deliveries.length = 0;
    await deliver(
      instance,
      quoteRequest({ id: `${REQUEST}-wp`, instrument: `${QUOTE}1` }),
      WORDPRESS_SHARED_INBOX,
    );
    const accept = answer();
    assert.equal(accept['type'], 'Accept');
    assert.equal(accept['actor'], SITE_ACTOR);
  });

  it('answers a second request for the same quote with the same authorization', async () => {
    const instance = await site();

    const first = await approvedQuote(instance);
    // A redelivery of the same activity id never reaches the handler (Fedify's
    // idempotence); a fresh request for the same quote does.
    const second = await approvedQuote(instance, `${REQUEST}-again`);

    assert.equal(second, first);
    assert.equal(readQuoteAuthorizations(instance.config.contentDir, LOCAL_USER).length, 1);
  });
});

describe('a QuoteAuthorization (AC #3)', () => {
  it('is stored in the author’s federation files', async () => {
    const instance = await site();

    const url = await approvedQuote(instance);

    const [stored] = readQuoteAuthorizations(instance.config.contentDir, LOCAL_USER);
    assert.equal(url, `${SITE_ACTOR}quotes/${stored?.id ?? ''}/`);
    assert.equal(stored?.quote, QUOTE);
    assert.equal(stored?.post, POST);
    assert.equal(stored?.request, REQUEST);
    assert.equal(stored?.actor, REMOTE_ACTOR);
  });

  it('is served at its own URL, unsigned, as ActivityStreams JSON', async () => {
    const instance = await site();
    const url = await approvedQuote(instance);

    const response = await fetchObject(instance, url);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/(activity|ld)\+json/);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body['id'], url);
    assert.equal(body['type'], 'QuoteAuthorization');
    assert.equal(body['interactingObject'], QUOTE);
    assert.equal(body['interactionTarget'], POST);
    assert.equal(body['attributedTo'], SITE_ACTOR);
    assert.ok(
      (body['@context'] as unknown[]).includes('https://www.w3.org/ns/activitystreams'),
      'Mastodon refuses a stamp without the ActivityStreams context',
    );
  });

  it('stops being served once the post is no longer public', async () => {
    const instance = await site();
    const url = await approvedQuote(instance);

    const { contentDir } = instance.config;
    await mkdir(path.join(contentDir, '_trash', 'posts'), { recursive: true });
    await rename(
      path.join(contentDir, 'posts', '2026-09-02-hello.md'),
      path.join(contentDir, '_trash', 'posts', '2026-09-02-hello.md'),
    );
    await instance.sync();

    assert.equal((await fetchObject(instance, url)).status, 404);
  });

  it('answers nothing for an id nobody was given', async () => {
    const instance = await site();
    await approvedQuote(instance);

    const response = await fetchObject(
      instance,
      `${SITE_ACTOR}quotes/00000000-0000-4000-8000-000000000000/`,
    );
    assert.equal(response.status, 404);
  });
});

describe('a QuoteRequest the policy refuses (AC #4)', () => {
  for (const [label, options] of [
    ['for a draft', { object: DRAFT }],
    ['for a URL naming no post', { object: `${BASE_URL}/2026/09/never-written/` }],
    ['whose quote lives on another server', { instrument: 'https://elsewhere.example/notes/1' }],
  ] as const) {
    it(`is rejected ${label}, and nothing is stored`, async () => {
      const instance = await site();

      await deliver(instance, quoteRequest(options));

      const reject = answer();
      assert.equal(reject['type'], 'Reject');
      assert.equal(reject['actor'], SITE_ACTOR);
      assert.equal(idOf(reject['object']), REQUEST);
      assert.equal('result' in reject, false);
      assert.deepEqual(readQuoteAuthorizations(instance.config.contentDir, LOCAL_USER), []);
    });
  }
});

describe('a quote taken back (AC #5)', () => {
  it('is no longer authorized once its request is undone', async () => {
    const instance = await site();
    const url = await approvedQuote(instance);

    await deliver(instance, {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        { QuoteRequest: 'https://w3id.org/fep/044f#QuoteRequest' },
      ],
      id: `${REQUEST}#undo`,
      type: 'Undo',
      actor: REMOTE_ACTOR,
      object: quoteRequest(),
    });

    assert.equal((await fetchObject(instance, url)).status, 404);
    assert.deepEqual(readQuoteAuthorizations(instance.config.contentDir, LOCAL_USER), []);
  });

  it('is no longer authorized once the quote itself is deleted', async () => {
    const instance = await site();
    const url = await approvedQuote(instance);

    await deliver(instance, {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${QUOTE}#delete`,
      type: 'Delete',
      actor: REMOTE_ACTOR,
      object: { id: QUOTE, type: 'Tombstone' },
    });

    assert.equal((await fetchObject(instance, url)).status, 404);
    assert.deepEqual(readQuoteAuthorizations(instance.config.contentDir, LOCAL_USER), []);
  });

  it('survives a Delete of something else', async () => {
    const instance = await site();
    const url = await approvedQuote(instance);

    await deliver(instance, {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${REMOTE_ACTOR}/statuses/7#delete`,
      type: 'Delete',
      actor: REMOTE_ACTOR,
      object: { id: `${REMOTE_ACTOR}/statuses/7`, type: 'Tombstone' },
    });

    assert.equal((await fetchObject(instance, url)).status, 200);
  });
});

/**
 * The quoting post, shaped the way me.dm delivered one to shll.me: a `Create`
 * at the shared inbox whose `Note` names the post in `quote` and in the three
 * older spellings beside it, and answers nothing.
 */
function quoteCreate(
  options: { id?: string; content?: string; inReplyTo?: string | null } = {},
): Record<string, unknown> {
  const id = options.id ?? QUOTE;
  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      {
        quote: { '@id': 'https://w3id.org/fep/044f#quote', '@type': '@id' },
        quoteUri: 'http://fedibird.com/ns#quoteUri',
        quoteUrl: 'as:quoteUrl',
        _misskey_quote: 'https://misskey-hub.net/ns#_misskey_quote',
      },
    ],
    id: `${id}/activity`,
    type: 'Create',
    actor: REMOTE_ACTOR,
    published: '2026-09-29T01:59:32Z',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    object: {
      id,
      type: 'Note',
      attributedTo: REMOTE_ACTOR,
      url: `${REMOTE_ORIGIN}/@bea/42`,
      published: '2026-09-29T01:59:32Z',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      inReplyTo: options.inReplyTo ?? null,
      content: options.content ?? '<p>This post is worth reading.</p>',
      quote: POST,
      quoteUri: POST,
      quoteUrl: POST,
      _misskey_quote: POST,
    },
  };
}

async function page(instance: Cms): Promise<string> {
  const response = await instance.app.request('/2026/09/hello/');
  assert.equal(response.status, 200);
  return await response.text();
}

/** The Mentions group of the default theme, or `undefined` when the page has none. */
function mentions(html: string): string | undefined {
  return /<div class="reaction-group p-mention">[\s\S]*?<\/div>\s*<\/div>/.exec(html)?.[0];
}

describe('an approved quote on the quoted post’s page (TASK-171)', () => {
  it('is shown among the mentions, linking to the quote under its author (AC #1)', async () => {
    const instance = await site();
    await approvedQuote(instance);
    await deliver(instance, quoteCreate(), SHARED_INBOX);

    const group = mentions(await page(instance));

    assert.ok(group !== undefined, 'the page has a Mentions group');
    assert.match(group, /Mentions <span class="reaction-count">1<\/span>/);
    assert.ok(group.includes(`href="${REMOTE_ORIGIN}/@bea/42"`), 'linking to the quote');
    assert.ok(group.includes('@bea@mastodon.example'), 'under its author');
  });

  it('carries the quote’s words, sanitised, into the post’s comments feed (AC #1, #6, #7)', async () => {
    const instance = await site();
    await approvedQuote(instance);
    await deliver(
      instance,
      quoteCreate({ content: '<p>Worth it<script>alert(1)</script></p>' }),
      SHARED_INBOX,
    );

    const feed = await (await instance.app.request('/2026/09/hello/feed/')).text();

    assert.ok(feed.includes(`<guid isPermaLink="false">${QUOTE}</guid>`), 'the quote is an item');
    assert.ok(feed.includes('Worth it'), 'with what it says');
    assert.ok(!feed.includes('alert(1)'), 'sanitised');
  });

  it('is not shown when nobody approved it (AC #2)', async () => {
    const instance = await site();
    await deliver(instance, quoteCreate(), SHARED_INBOX);

    assert.equal(mentions(await page(instance)), undefined);
  });

  it('is gone once its request is undone (AC #3)', async () => {
    const instance = await site();
    await approvedQuote(instance);
    await deliver(instance, quoteCreate(), SHARED_INBOX);

    await deliver(instance, {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        { QuoteRequest: 'https://w3id.org/fep/044f#QuoteRequest' },
      ],
      id: `${REQUEST}#undo`,
      type: 'Undo',
      actor: REMOTE_ACTOR,
      object: quoteRequest(),
    });

    assert.equal(mentions(await page(instance)), undefined);
  });

  it('is gone once the quote is deleted (AC #3)', async () => {
    const instance = await site();
    await approvedQuote(instance);
    await deliver(instance, quoteCreate(), SHARED_INBOX);

    await deliver(instance, {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${QUOTE}#delete`,
      type: 'Delete',
      actor: REMOTE_ACTOR,
      object: { id: QUOTE, type: 'Tombstone' },
    });

    assert.equal(mentions(await page(instance)), undefined);
  });

  it('is shown once, as a reply, when it also answers the post (AC #4)', async () => {
    const instance = await site();
    await approvedQuote(instance);
    await deliver(instance, quoteCreate({ inReplyTo: POST }), SHARED_INBOX);

    const html = await page(instance);

    assert.equal(mentions(html), undefined, 'not among the mentions');
    assert.ok(html.includes(`id="comment-${QUOTE}"`), 'but in the thread');
  });

  it('survives the database being thrown away (AC #5)', async () => {
    const first = await site();
    await approvedQuote(first);
    await deliver(first, quoteCreate(), SHARED_INBOX);
    const { contentDir, dataDir } = first.config;
    await first.close();
    started.splice(started.indexOf(first), 1);
    await rm(path.join(dataDir, 'geekity.db'), { force: true });
    await rm(path.join(dataDir, 'geekity.db-wal'), { force: true });
    await rm(path.join(dataDir, 'geekity.db-shm'), { force: true });

    const second = createCms({
      dataDir,
      contentDir,
      watch: false,
      baseUrl: BASE_URL,
      federation: { queue: null, allowPrivateAddress: true },
    });
    started.push(second);
    await second.sync();

    const group = mentions(await page(second));
    assert.ok(group?.includes(`href="${REMOTE_ORIGIN}/@bea/42"`), 'the quote is still shown');
  });
});
