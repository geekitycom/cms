/**
 * The remote lookup tool from the outside: an MCP client asking the site to
 * fetch a handle or a URL from the fediverse, with every outbound request
 * answered by a stub that stands in for the remote servers.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { sandbox } from '../../admin/__testing__/harness.ts';
import type { Cms } from '../../index.ts';
import { createUser } from '../../site/users.ts';
import { problemsWith } from '../../util/json-schema.ts';
import type { JsonSchema } from '../../util/json-schema.ts';
import type { HostLookup } from '../../util/public-address.ts';
import { call, fixtureSite, inspectToken, rpc } from './__testing__/fixture.ts';
import { lookupRemote } from './remote.ts';

const box = sandbox();

const ACTIVITY = 'application/activity+json; charset=utf-8';
const WEBFINGER =
  'https://social.example/.well-known/webfinger?resource=acct%3Acarol%40social.example';
const CAROL = 'https://social.example/users/carol';
const NOTE = 'https://social.example/notes/1';
const STATUS = 'https://social.example/statuses/1';
const HUGE = 'https://social.example/huge';
const SLOW = 'https://social.example/slow';
const BOUNCE = 'https://social.example/bounce';

const CAROL_ACTOR = {
  '@context': 'https://www.w3.org/ns/activitystreams',
  id: CAROL,
  type: 'Person',
  preferredUsername: 'carol',
  inbox: `${CAROL}/inbox`,
};

const lookup: HostLookup = (hostname) =>
  Promise.resolve(hostname === 'internal.example' ? ['10.0.0.5'] : ['203.0.113.7']);

const sent: Request[] = [];

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': ACTIVITY, ...init.headers },
  });
}

function answer(request: Request): Promise<Response> {
  const signed = request.headers.has('signature');
  switch (request.url) {
    case WEBFINGER:
      return Promise.resolve(
        new Response(
          JSON.stringify({
            subject: 'acct:carol@social.example',
            links: [
              {
                rel: 'http://webfinger.net/rel/profile-page',
                type: 'text/html',
                href: 'https://social.example/@carol',
              },
              { rel: 'self', type: 'application/activity+json', href: CAROL },
            ],
          }),
          { headers: { 'content-type': 'application/jrd+json' } },
        ),
      );
    case CAROL:
      return Promise.resolve(
        signed
          ? json(CAROL_ACTOR, { headers: { 'cache-control': 'max-age=180', 'x-ignored': 'yes' } })
          : new Response('{"error":"Request not signed"}', {
              status: 401,
              headers: { 'content-type': 'application/json', 'www-authenticate': 'Signature' },
            }),
      );
    case NOTE:
      return Promise.resolve(new Response(null, { status: 302, headers: { location: STATUS } }));
    case STATUS:
      return Promise.resolve(
        signed
          ? json({ id: STATUS, type: 'Note', content: 'Hello' })
          : new Response('unsigned', { status: 401 }),
      );
    case HUGE:
      return Promise.resolve(
        new Response('x'.repeat(300 * 1024), { headers: { 'content-type': 'text/plain' } }),
      );
    case SLOW:
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(request.signal.reason as Error);
        });
      });
    case BOUNCE:
      return Promise.resolve(
        new Response(null, { status: 302, headers: { location: 'http://192.168.1.1/admin' } }),
      );
    default:
      return Promise.resolve(new Response('not here', { status: 404 }));
  }
}

const original = globalThis.fetch;

before(() => {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.startsWith('https://blog.example/')) return original(input, init);
    sent.push(request.clone());
    return answer(request);
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = original;
  await box.cleanup();
});

beforeEach(() => {
  sent.length = 0;
});

type Row = Record<string, unknown>;

/**
 * Check a draft-cavage HTTP Signature against the public key the site's own
 * actor publishes, as a remote server would.
 */
async function signatureHolds(cms: Cms, request: Request): Promise<boolean> {
  const fields = Object.fromEntries(
    [...(request.headers.get('signature') ?? '').matchAll(/(\w+)="([^"]*)"/g)].map(
      ([, name = '', value = '']) => [name, value],
    ),
  );
  const keyId = fields['keyId'] ?? '';
  const actor = (await (
    await cms.app.request(keyId.replace(/#.*$/, ''), {
      headers: { accept: 'application/activity+json' },
    })
  ).json()) as { publicKey: { id: string; publicKeyPem: string } };
  if (actor.publicKey.id !== keyId) return false;

  const url = new URL(request.url);
  const signed = (fields['headers'] ?? '')
    .split(' ')
    .map((name) =>
      name === '(request-target)'
        ? `${name}: ${request.method.toLowerCase()} ${url.pathname}`
        : `${name}: ${request.headers.get(name) ?? ''}`,
    )
    .join('\n');
  const der = Buffer.from(
    actor.publicKey.publicKeyPem.replace(/-----[A-Z ]+-----|\s/g, ''),
    'base64',
  );
  const key = await crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    Buffer.from(fields['signature'] ?? '', 'base64'),
    new TextEncoder().encode(signed),
  );
}

describe('remote_lookup', () => {
  let cms: Cms;
  let token: string;

  before(async () => {
    cms = await fixtureSite(box, { hostLookup: lookup });
    await createUser({
      dataDir: cms.config.dataDir,
      username: 'bea',
      password: 'another horse battery',
    });
    token = await inspectToken(cms);
  });

  it('is listed read-only, open-world, with an output schema, and needs the inspect scope', async () => {
    const { body } = await rpc(cms, token, 'tools/list');
    const tool = (body['result'] as { tools: Row[] }).tools.find(
      (entry) => entry['name'] === 'remote_lookup',
    );
    assert.ok(tool !== undefined, 'remote_lookup is listed');
    const annotations = tool['annotations'] as Row;
    assert.equal(annotations['readOnlyHint'], true);
    assert.equal(annotations['openWorldHint'], true);
    assert.equal(annotations['destructiveHint'], false);

    const profileOnly = await inspectToken(cms, ['profile']);
    const refused = await rpc(cms, profileOnly, 'tools/call', {
      name: 'remote_lookup',
      arguments: { target: '@carol@social.example' },
    });
    assert.equal(refused.status, 403);
    assert.equal(sent.length, 0, 'nothing is fetched without the scope');
  });

  it('resolves a handle through WebFinger and fetches the actor signed as the site author', async () => {
    const answer = await call(cms, token, 'remote_lookup', { target: '@carol@social.example' });
    assert.equal(answer.isError, false, answer.text);
    const { body } = await rpc(cms, token, 'tools/list');
    const tool = (body['result'] as { tools: Row[] }).tools.find(
      (entry) => entry['name'] === 'remote_lookup',
    );
    assert.deepEqual(problemsWith(tool?.['outputSchema'] as JsonSchema, answer.structured), []);

    const webfinger = answer.structured['webfinger'] as Row;
    assert.equal(webfinger['url'], WEBFINGER);
    assert.equal(webfinger['status'], 200);
    assert.equal((webfinger['json'] as Row)['subject'], 'acct:carol@social.example');

    const object = answer.structured['object'] as Row;
    assert.equal(object['requested'], CAROL);
    assert.equal(object['status'], 200);
    assert.deepEqual(object['json'], CAROL_ACTOR);
    assert.deepEqual(object['headers'], [
      { name: 'content-type', value: ACTIVITY },
      { name: 'cache-control', value: 'max-age=180' },
    ]);

    const signedAs = answer.structured['signedAs'] as Row;
    assert.equal(signedAs['username'], 'ada');
    const actorFetch = sent.find((request) => request.url === CAROL);
    assert.ok(actorFetch !== undefined);
    assert.match(actorFetch.headers.get('accept') ?? '', /application\/activity\+json/);
    assert.ok(await signatureHolds(cms, actorFetch), 'the signature verifies with ada’s key');
    assert.match(
      actorFetch.headers.get('signature') ?? '',
      new RegExp(`keyId="${String(signedAs['keyId'])}"`),
    );
    assert.match(answer.text, /200/);
  });

  it('signs as the local user it is asked to', async () => {
    const answer = await call(cms, token, 'remote_lookup', { target: CAROL, actor: 'bea' });
    assert.equal(answer.isError, false, answer.text);
    assert.equal((answer.structured['signedAs'] as Row)['username'], 'bea');
    assert.equal(answer.structured['webfinger'], null, 'a URL needs no WebFinger');
    assert.equal((answer.structured['object'] as Row)['status'], 200);
    const actorFetch = sent.find((request) => request.url === CAROL);
    assert.ok(actorFetch !== undefined);
    assert.match(actorFetch.headers.get('signature') ?? '', /\/author\/bea\//);
    assert.ok(await signatureHolds(cms, actorFetch), 'the signature verifies with bea’s key');

    const unknown = await call(cms, token, 'remote_lookup', { target: CAROL, actor: 'nobody' });
    assert.equal(unknown.isError, true);
    assert.match(unknown.text, /nobody/);
  });

  it('re-signs each redirect hop and reports where the object came from', async () => {
    const answer = await call(cms, token, 'remote_lookup', { target: NOTE });
    assert.equal(answer.isError, false, answer.text);
    const object = answer.structured['object'] as Row;
    assert.equal(object['requested'], NOTE);
    assert.equal(object['url'], STATUS);
    assert.equal((object['json'] as Row)['type'], 'Note');
    const hop = sent.find((request) => request.url === STATUS);
    assert.ok(
      hop !== undefined && (await signatureHolds(cms, hop)),
      'the second hop is signed for its own URL',
    );
  });

  it('answers a refusal from the remote server with its status and body', async () => {
    const answer = await call(cms, token, 'remote_lookup', {
      target: 'https://social.example/missing',
    });
    assert.equal(answer.isError, false, answer.text);
    const object = answer.structured['object'] as Row;
    assert.equal(object['status'], 404);
    assert.equal(object['json'], null);
    assert.equal(object['text'], 'not here');
  });

  for (const target of [
    'http://127.0.0.1/users/x',
    'http://[::1]/users/x',
    'http://169.254.169.254/latest/meta-data',
    'http://10.1.2.3/inbox',
    '@root@localhost',
    'https://internal.example/users/x',
    BOUNCE,
  ]) {
    it(`refuses to reach ${target}`, async () => {
      const answer = await call(cms, token, 'remote_lookup', { target });
      assert.equal(answer.isError, true, answer.text);
      assert.match(answer.text, /not a public address/);
      assert.ok(
        sent.every(
          (request) =>
            !/127\.0\.0\.1|\[::1\]|169\.254|10\.1\.2\.3|localhost|internal\.example|192\.168/.test(
              request.url,
            ),
        ),
        'no request reaches a private address',
      );
    });
  }

  it('refuses a target that is neither a handle nor a web URL', async () => {
    const answer = await call(cms, token, 'remote_lookup', { target: 'ftp://social.example/x' });
    assert.equal(answer.isError, true);
    assert.match(answer.text, /handle|URL/);
  });

  it('reads no more than the size limit of a body, and says it stopped', async () => {
    const answer = await call(cms, token, 'remote_lookup', { target: HUGE });
    assert.equal(answer.isError, false, answer.text);
    const object = answer.structured['object'] as Row;
    assert.equal(object['truncated'], true);
    assert.equal((object['text'] as string).length, 256 * 1024);
  });
});

describe('lookupRemote', () => {
  it('gives up when the remote server does not answer in time', async () => {
    const result = await lookupRemote(
      { kind: 'url', url: new URL(SLOW) },
      {
        lookup,
        signal: new AbortController().signal,
        timeoutMs: 50,
        maxBytes: 1024,
        sign: undefined,
      },
    );
    assert.deepEqual(result, { ok: false, reason: `${SLOW}: no answer within 50 ms` });
  });
});
