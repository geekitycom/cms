import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import sharp from 'sharp';

import { sandbox } from '../../admin/__testing__/harness.ts';
import { readAltTexts } from '../../content/alt-text.ts';
import { dataPath, WRITING_LEDGERS } from '../../files/data-files.ts';
import type { Scope } from '../../indieauth/request.ts';
import { issueTokens } from '../../indieauth/tokens.ts';
import type { Cms, GeekityConfig } from '../../index.ts';
import { problemsWith } from '../../util/json-schema.ts';
import type { JsonSchema } from '../../util/json-schema.ts';
import { readActivityLog } from '../../web/indieauth-activity-log.ts';
import { createUser } from '../../site/users.ts';
import { BASE, call, fixtureSite, inspectToken, rpc } from '../inspect/__testing__/fixture.ts';

const box = sandbox();

const NOW = new Date('2026-09-20T12:00:00.000Z');
const CITED = 'https://elsewhere.example/a';
const CITED_ENDPOINT = 'https://elsewhere.example/webmention';
const WRITER: readonly Scope[] = ['create', 'update', 'media'];
const EVERY: readonly Scope[] = [...WRITER, 'publish'];

type Row = Record<string, unknown>;

interface Posted {
  readonly url: string;
  readonly type: unknown;
}

const posted: Posted[] = [];
const original = globalThis.fetch;

before(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.startsWith(`${BASE}/`)) return await original(input, init);
    if (request.method === 'POST') {
      const text = await request.text();
      let type: unknown;
      try {
        type = (JSON.parse(text) as Row)['type'];
      } catch {
        type = 'webmention';
      }
      posted.push({ url: request.url, type });
      return new Response(null, { status: 202 });
    }
    if (request.url === CITED) {
      return new Response(
        `<html><head><link rel="webmention" href="${CITED_ENDPOINT}"></head><body>A page.</body></html>`,
        { headers: { 'content-type': 'text/html' } },
      );
    }
    return new Response('not here', { status: 404 });
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = original;
  await box.cleanup();
});

beforeEach(() => {
  posted.length = 0;
});

async function authoringSite(
  scopes: readonly Scope[] = WRITER,
  config: GeekityConfig = {},
): Promise<{ cms: Cms; token: string }> {
  const cms = await fixtureSite(box, {
    ...config,
    federation: { queue: null, allowPrivateAddress: true },
    now: () => NOW,
  });
  return { cms, token: await inspectToken(cms, [...scopes]) };
}

async function micropubToken(cms: Cms): Promise<string> {
  return (
    await issueTokens(
      cms.config.dataDir,
      {
        clientId: 'https://app.example/',
        redirectUri: 'https://app.example/callback',
        codeChallenge: { method: 'S256', value: 'unused' },
        userId: 1,
        me: `${BASE}/`,
        scopes: ['create', 'update'],
      },
      NOW,
    )
  ).accessToken;
}

async function quiet(cms: Cms): Promise<void> {
  await cms.delivery.settled();
  await cms.webmentions.settled();
  await cms.notifier.settled();
}

function documentAt(cms: Cms, url: string) {
  const document = cms.store.getByPermalink(new URL(url).pathname);
  assert.ok(document !== undefined, `${url} is in the index`);
  return document;
}

async function fileOf(cms: Cms, url: string): Promise<string> {
  return await readFile(
    path.join(cms.config.contentDir, ...documentAt(cms, url).path.split('/')),
    'utf8',
  );
}

async function drafted(cms: Cms, token: string, args: Row): Promise<string> {
  const answer = await call(cms, token, 'create_draft', args);
  assert.equal(answer.isError, false, answer.text);
  return answer.structured['url'] as string;
}

const KINDS: readonly (readonly [string, Row])[] = [
  ['a note', { properties: { content: ['Just a note.'], category: ['one', 'two'] } }],
  ['an article', { properties: { name: ['A title'], content: ['Some **words**.'] } }],
  ['a reply', { properties: { 'in-reply-to': [CITED], content: ['I agree.'] } }],
  ['a bookmark', { properties: { 'bookmark-of': [CITED], name: ['Worth reading'] } }],
  [
    'a review',
    {
      type: 'h-review',
      properties: {
        item: [{ type: ['h-product'], properties: { name: ['A Book'] } }],
        rating: ['4'],
        content: ['Good.'],
      },
    },
  ],
  [
    'an event',
    {
      type: 'h-event',
      properties: { name: ['A meetup'], start: ['2026-10-01T18:00:00Z'], content: ['Come.'] },
    },
  ],
];

describe('the authoring tools', () => {
  it('are listed with their annotations and output that fits their schema', async () => {
    const { cms, token } = await authoringSite(EVERY);
    const { body } = await rpc(cms, token, 'tools/list');
    const listed = (body['result'] as { tools: Row[] }).tools;
    const annotations = (name: string) =>
      listed.find((tool) => tool['name'] === name)?.['annotations'];

    assert.deepEqual(annotations('publish_post'), {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
    assert.deepEqual(annotations('get_post_source'), {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    for (const name of ['create_draft', 'update_post', 'upload_media']) {
      assert.equal((annotations(name) as Row)['readOnlyHint'], false, name);
    }

    const url = await drafted(cms, token, { properties: { content: ['Hi.'] } });
    const source = await call(cms, token, 'get_post_source', { post: url });
    const answers: Record<string, Row> = {
      create_draft: (await call(cms, token, 'create_draft', { properties: { content: ['Yo.'] } }))
        .structured,
      get_post_source: source.structured,
      update_post: (
        await call(cms, token, 'update_post', {
          post: url,
          hash: source.structured['hash'],
          replace: { content: ['Hello.'] },
        })
      ).structured,
      publish_post: (await call(cms, token, 'publish_post', { post: url })).structured,
      upload_media: (
        await call(cms, token, 'upload_media', {
          filename: 'dot.png',
          data: (await png()).toString('base64'),
          alt: 'A dot',
        })
      ).structured,
    };
    for (const [name, structured] of Object.entries(answers)) {
      const tool = listed.find((entry) => entry['name'] === name);
      assert.ok(tool !== undefined, `${name} is listed`);
      assert.deepEqual(problemsWith(tool['outputSchema'] as JsonSchema, structured), [], name);
    }
  });

  it('record every call in the app activity record, refusals for scope included', async () => {
    const { cms, token } = await authoringSite();
    const url = await drafted(cms, token, { properties: { content: ['Hi.'] } });
    await call(cms, token, 'get_post_source', { post: url });
    await call(cms, token, 'upload_media', { filename: 'dot.png', data: 'aGk=', alt: 'x' });
    await rpc(cms, token, 'tools/call', { name: 'publish_post', arguments: { post: url } });

    const entries = (await readActivityLog(cms.config.dataDir)).filter(
      (entry) => entry.endpoint === 'mcp',
    );
    assert.deepEqual(entries.map((entry) => [entry.action, entry.status, entry.error]).sort(), [
      ['create_draft', 200, undefined],
      ['get_post_source', 200, undefined],
      ['publish_post', 403, 'insufficient_scope'],
      ['upload_media', 200, 'tool_error'],
    ]);
  });

  it('add nothing to the writer’s writing ledger', async () => {
    const { cms, token } = await authoringSite(EVERY);
    const url = await drafted(cms, token, { properties: { content: ['Many new words here.'] } });
    const source = await call(cms, token, 'get_post_source', { post: url });
    await call(cms, token, 'update_post', {
      post: url,
      hash: source.structured['hash'],
      replace: { content: ['Many more new words written here today.'] },
    });
    await call(cms, token, 'publish_post', { post: url });

    assert.equal(existsSync(dataPath(cms.config.dataDir, WRITING_LEDGERS, '1.json')), false);
  });
});

describe('create_draft', () => {
  for (const [label, args] of KINDS) {
    it(`writes ${label} as the same file a Micropub draft is`, async () => {
      const { cms, token } = await authoringSite();
      const twin = await authoringSite();

      const url = await drafted(cms, token, args);

      const response = await twin.cms.app.request('/_geekity/micropub', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await micropubToken(twin.cms)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: [args['type'] ?? 'h-entry'],
          properties: { ...(args['properties'] as Row), 'post-status': ['draft'] },
        }),
      });
      assert.equal(response.status, 201, await response.clone().text());
      const location = response.headers.get('location');
      assert.equal(url, location);
      assert.equal(await fileOf(cms, url), await fileOf(twin.cms, url));
      assert.equal(documentAt(cms, url).draft, true);
    });
  }

  it('never publishes, federates or sends webmentions', async () => {
    const { cms, token } = await authoringSite();

    const url = await drafted(cms, token, {
      properties: { content: [`Read ${CITED} soon.`], 'mp-slug': ['soon'] },
    });
    await quiet(cms);

    assert.equal((await cms.app.request(new URL(url).pathname)).status, 404);
    assert.deepEqual(posted, []);
    assert.equal(cms.admin.lastDeliveryToObject(url), undefined);
    assert.deepEqual(cms.admin.listSentWebmentions('soon'), []);
  });

  it('refuses a post-status other than draft, and writes nothing', async () => {
    const { cms, token } = await authoringSite();
    const before = cms.store.getBySlug('now');

    const answer = await call(cms, token, 'create_draft', {
      properties: { content: ['Now.'], 'post-status': ['published'], 'mp-slug': ['now'] },
    });

    assert.equal(answer.isError, true);
    assert.match(answer.text, /publish_post/);
    assert.equal(before, undefined);
    assert.equal(cms.store.getBySlug('now'), undefined);
  });

  it('answers what Micropub would refuse with a tool error naming it', async () => {
    const { cms, token } = await authoringSite();
    const answer = await call(cms, token, 'create_draft', {
      type: 'h-card',
      properties: { name: ['Me'] },
    });
    assert.equal(answer.isError, true);
    assert.match(answer.text, /h-card/);
  });
});

describe('get_post_source', () => {
  it('answers the post’s properties as Micropub q=source does, with the hash to edit by', async () => {
    const { cms, token } = await authoringSite();

    const answer = await call(cms, token, 'get_post_source', { post: 'hello' });

    assert.equal(answer.isError, false, answer.text);
    const response = await cms.app.request(
      `/_geekity/micropub?q=source&url=${encodeURIComponent(`${BASE}/2026/03/hello/`)}`,
      { headers: { authorization: `Bearer ${await micropubToken(cms)}` } },
    );
    const source = (await response.json()) as Row;
    assert.deepEqual(answer.structured['type'], (source['type'] as string[])[0]);
    assert.deepEqual(answer.structured['properties'], source['properties']);
    assert.equal(answer.structured['url'], `${BASE}/2026/03/hello/`);
    assert.equal(answer.structured['hash'], cms.store.getBySlug('hello')?.hash);
  });

  it('refuses another user’s post', async () => {
    const { cms, token } = await authoringSite();
    await createUser({
      dataDir: cms.config.dataDir,
      username: 'bea',
      password: 'another horse battery',
    });
    const url = await drafted(cms, token, {
      properties: { content: ['Mine.'], 'mp-slug': ['mine'] },
    });
    const bea = await issueTokens(
      cms.config.dataDir,
      {
        clientId: 'https://claude.example/client.json',
        redirectUri: 'http://localhost:4567/callback',
        codeChallenge: { method: 'S256', value: 'unused' },
        userId: 2,
        me: `${BASE}/`,
        scopes: [...EVERY],
        resource: `${BASE}/_geekity/mcp`,
      },
      NOW,
    );

    const answer = await call(cms, bea.accessToken, 'get_post_source', { post: url });

    assert.equal(answer.isError, true);
    assert.match(answer.text, /not your post/);
  });
});

describe('update_post', () => {
  it('changes only the properties it names', async () => {
    const { cms, token } = await authoringSite();
    const url = await drafted(cms, token, {
      properties: { name: ['A title'], content: ['Old words.'], category: ['kept'] },
    });
    const source = await call(cms, token, 'get_post_source', { post: url });

    const answer = await call(cms, token, 'update_post', {
      post: url,
      hash: source.structured['hash'],
      replace: { content: ['New words.'] },
    });

    assert.equal(answer.isError, false, answer.text);
    const document = documentAt(cms, url);
    assert.equal(document.body.trim(), 'New words.');
    assert.equal(document.title, 'A title');
    assert.deepEqual(document.tags, ['kept']);
    assert.equal(document.draft, true);
  });

  it('adds and takes away values and whole properties', async () => {
    const { cms, token } = await authoringSite();
    const url = await drafted(cms, token, {
      properties: { content: ['Words.'], summary: ['Gist'], category: ['a', 'b'] },
    });
    const { structured } = await call(cms, token, 'get_post_source', { post: url });

    const answer = await call(cms, token, 'update_post', {
      post: url,
      hash: structured['hash'],
      add: { category: ['c'] },
      deleteValues: { category: ['a'] },
      delete: ['summary'],
    });

    assert.equal(answer.isError, false, answer.text);
    const document = documentAt(cms, url);
    assert.deepEqual(document.tags, ['b', 'c']);
    assert.equal(document.description, undefined);
  });

  it('refuses when the post changed since it was read, and leaves the file as it is', async () => {
    const { cms, token } = await authoringSite();
    const url = await drafted(cms, token, { properties: { content: ['First.'] } });
    const { structured } = await call(cms, token, 'get_post_source', { post: url });
    const file = path.join(cms.config.contentDir, ...documentAt(cms, url).path.split('/'));
    const edited = (await readFile(file, 'utf8')).replace('First.', 'Edited by hand.');
    await writeFile(file, edited);

    const answer = await call(cms, token, 'update_post', {
      post: url,
      hash: structured['hash'],
      replace: { content: ['Overwritten.'] },
    });

    assert.equal(answer.isError, true);
    assert.match(answer.text, /changed/);
    assert.equal(await readFile(file, 'utf8'), edited);
  });

  it('refuses an edit from a stale read after another edit went through', async () => {
    const { cms, token } = await authoringSite();
    const url = await drafted(cms, token, { properties: { content: ['First.'] } });
    const stale = (await call(cms, token, 'get_post_source', { post: url })).structured['hash'];
    const first = await call(cms, token, 'update_post', {
      post: url,
      hash: stale,
      replace: { content: ['Second.'] },
    });
    assert.equal(first.isError, false, first.text);

    const answer = await call(cms, token, 'update_post', {
      post: url,
      hash: stale,
      replace: { content: ['Third.'] },
    });

    assert.equal(answer.isError, true);
    assert.match(answer.text, /get_post_source/);
    assert.equal(documentAt(cms, url).body.trim(), 'Second.');
  });

  it('needs the publish scope as well as update to change a published post', async () => {
    const { cms, token } = await authoringSite();
    const { structured } = await call(cms, token, 'get_post_source', { post: 'hello' });
    const before = await fileOf(cms, `${BASE}/2026/03/hello/`);

    const { status, body } = await rpc(cms, token, 'tools/call', {
      name: 'update_post',
      arguments: { post: 'hello', hash: structured['hash'], replace: { content: ['Changed.'] } },
    });

    assert.equal(status, 403);
    assert.deepEqual((body['error'] as { data: Row }).data, { scope: 'publish' });
    assert.equal(await fileOf(cms, `${BASE}/2026/03/hello/`), before);
    await quiet(cms);
    assert.deepEqual(posted, []);
  });

  it('names the scopes held and the publish scope in the challenge', async () => {
    const { cms, token } = await authoringSite();
    const { structured } = await call(cms, token, 'get_post_source', { post: 'hello' });
    const response = await cms.app.request('/_geekity/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'update_post',
          arguments: { post: 'hello', hash: structured['hash'], replace: { content: ['x'] } },
        },
      }),
    });
    assert.equal(response.status, 403);
    assert.match(
      response.headers.get('www-authenticate') ?? '',
      /insufficient_scope.*scope="create update media publish"/,
    );
  });

  it('needs the publish scope to make a draft public through post-status', async () => {
    const { cms, token } = await authoringSite();
    const url = await drafted(cms, token, { properties: { content: ['Soon.'] } });
    const { structured } = await call(cms, token, 'get_post_source', { post: url });

    const { status } = await rpc(cms, token, 'tools/call', {
      name: 'update_post',
      arguments: { post: url, hash: structured['hash'], replace: { 'post-status': ['published'] } },
    });

    assert.equal(status, 403);
    assert.equal(documentAt(cms, url).draft, true);
  });

  it('with the publish scope, changes a published post and federates an Update', async () => {
    const { cms, token } = await authoringSite(EVERY);
    const { structured } = await call(cms, token, 'get_post_source', { post: 'hello' });

    const answer = await call(cms, token, 'update_post', {
      post: 'hello',
      hash: structured['hash'],
      replace: { content: ['Hello again, fediverse.'] },
    });
    await quiet(cms);

    assert.equal(answer.isError, false, answer.text);
    assert.equal(cms.store.getBySlug('hello')?.body.trim(), 'Hello again, fediverse.');
    assert.equal(cms.admin.lastDeliveryToObject(`${BASE}/2026/03/hello/`)?.activityType, 'Update');
  });
});

describe('publish_post', () => {
  it('publishes a draft, which federates a Create and sends its webmentions', async () => {
    const { cms, token } = await authoringSite(['create', 'publish']);
    const url = await drafted(cms, token, {
      properties: { content: [`Read ${CITED} now.`], 'mp-slug': ['now'] },
    });

    const answer = await call(cms, token, 'publish_post', { post: url });
    await quiet(cms);

    assert.equal(answer.isError, false, answer.text);
    assert.equal(answer.structured['alreadyPublished'], false);
    assert.equal(documentAt(cms, url).draft, false);
    assert.equal((await cms.app.request(new URL(url).pathname)).status, 200);
    assert.equal(cms.admin.lastDeliveryToObject(url)?.activityType, 'Create');
    assert.deepEqual(
      cms.admin.listSentWebmentions('now').map((sent) => sent.target),
      [CITED],
    );
  });

  it('leaves a post that is already published as it is', async () => {
    const { cms, token } = await authoringSite(['publish']);
    const before = await fileOf(cms, `${BASE}/2026/03/hello/`);

    const answer = await call(cms, token, 'publish_post', { post: 'hello' });

    assert.equal(answer.isError, false, answer.text);
    assert.equal(answer.structured['alreadyPublished'], true);
    assert.equal(await fileOf(cms, `${BASE}/2026/03/hello/`), before);
  });

  it('is refused without the publish scope, and the draft stays a draft', async () => {
    const { cms, token } = await authoringSite();
    const url = await drafted(cms, token, { properties: { content: ['Soon.'] } });

    const { status, body } = await rpc(cms, token, 'tools/call', {
      name: 'publish_post',
      arguments: { post: url },
    });

    assert.equal(status, 403);
    assert.deepEqual((body['error'] as { data: Row }).data, { scope: 'publish' });
    assert.equal(documentAt(cms, url).draft, true);
  });
});

describe('upload_media', () => {
  it('stores the file in the media library with its alt text and answers its URL', async () => {
    const { cms, token } = await authoringSite(['media']);

    const answer = await call(cms, token, 'upload_media', {
      filename: 'A Dot.png',
      data: (await png()).toString('base64'),
      alt: 'A single red dot',
    });

    assert.equal(answer.isError, false, answer.text);
    const url = answer.structured['url'] as string;
    assert.match(url, /^https:\/\/blog\.example\/uploads\/2026\/09\/a-dot\.png$/);
    assert.equal(answer.structured['alt'], 'A single red dot');
    assert.deepEqual(readAltTexts(cms.config.contentDir).get('2026/09/a-dot.png'), {
      kind: 'described',
      text: 'A single red dot',
    });
    assert.equal((await cms.app.request(new URL(url).pathname)).status, 200);
  });

  it('stores a file at the largest size the site takes', async () => {
    const limit = 40_000;
    const { cms, token } = await authoringSite(['media'], {
      uploadMaxBytes: limit,
      uploadMediaMaxBytes: limit / 2,
    });

    const answer = await call(cms, token, 'upload_media', {
      filename: 'notes.txt',
      data: Buffer.alloc(limit, 'a').toString('base64'),
      alt: 'x'.repeat(1000),
    });

    assert.equal(answer.isError, false, answer.text);
    const stored = await cms.app.request(new URL(answer.structured['url'] as string).pathname);
    assert.equal((await stored.arrayBuffer()).byteLength, limit);
  });

  it('refuses what the media library refuses, and data larger than the site takes', async () => {
    const { cms, token } = await authoringSite(['media']);
    const wrong = await call(cms, token, 'upload_media', {
      filename: 'dot.png',
      data: Buffer.from('not a png').toString('base64'),
    });
    const notBase64 = await call(cms, token, 'upload_media', { filename: 'dot.png', data: '***' });
    const huge = await call(cms, token, 'upload_media', {
      filename: 'dot.png',
      data: 'A'.repeat(Math.ceil((cms.config.uploadMaxBytes * 4) / 3) + 8),
    });

    assert.equal(wrong.isError, true);
    assert.match(wrong.text, /does not look like a \.png/);
    assert.equal(notBase64.isError, true);
    assert.match(notBase64.text, /base64/);
    assert.equal(huge.isError, true);
    assert.match(huge.text, /too big|larger/i);
  });
});

async function png(): Promise<Buffer> {
  return await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}
