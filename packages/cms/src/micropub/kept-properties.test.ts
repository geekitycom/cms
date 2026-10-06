import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { remoteHostsDoNotExist } from '../__testing__/offline.ts';
import { csrfField, FIRST_ADMIN, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { findUser } from '../admin/accounts.ts';
import { KEPT_PROPERTIES_FILE } from '../content/kept-properties.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';
import { feedPathUnder } from '../web/feed-source.ts';
import { OEMBED_PATH } from '../web/oembed.ts';

remoteHostsDoNotExist();

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const ENDPOINT = '/_geekity/micropub';
const NOW = new Date('2026-09-20T12:00:00.000Z');

interface Site {
  cms: Cms;
  agent: Browser;
  token: string;
}

async function site(): Promise<Site> {
  const cms = await box.open({
    contentDir: await box.dir('geekity-micropub-kept-content-'),
    dataDir: await box.dir('geekity-micropub-kept-data-'),
    baseUrl: BASE,
    now: () => NOW,
  });
  const agent = await signedIn(cms);
  const ada = findUser(cms.config.dataDir, FIRST_ADMIN.username);
  assert.ok(ada !== undefined);
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://micropub.rocks/',
      redirectUri: 'https://micropub.rocks/redirect',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes: ['create', 'update', 'delete'],
    },
    NOW,
  );
  return { cms, agent, token: accessToken };
}

async function postJson(cms: Cms, token: string, body: unknown): Promise<Response> {
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postForm(cms: Cms, token: string, fields: [string, string][]): Promise<Response> {
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields).toString(),
  });
}

async function created(response: Response): Promise<string> {
  assert.equal(response.status, 201, await response.clone().text());
  const location = response.headers.get('location');
  assert.ok(location !== null, 'a 201 names the post');
  return location;
}

async function refusal(response: Response): Promise<string> {
  assert.equal(response.status, 400, await response.clone().text());
  const body = (await response.json()) as Record<string, string>;
  assert.equal(body['error'], 'invalid_request');
  return body['error_description'] ?? '';
}

async function updated(cms: Cms, token: string, body: object): Promise<void> {
  const response = await postJson(cms, token, body);
  assert.equal(response.status, 204, await response.text());
}

async function source(cms: Cms, token: string, url: string): Promise<Record<string, unknown[]>> {
  const response = await cms.app.request(`${ENDPOINT}?q=source&url=${encodeURIComponent(url)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200, await response.clone().text());
  return ((await response.json()) as { properties: Record<string, unknown[]> }).properties;
}

async function keptFile(cms: Cms): Promise<Record<string, Record<string, unknown[]>>> {
  return JSON.parse(
    await readFile(path.join(cms.config.dataDir, KEPT_PROPERTIES_FILE), 'utf8'),
  ) as Record<string, Record<string, unknown[]>>;
}

async function filesUnder(root: string): Promise<[string, string][]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry): Promise<[string, string]> => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(root, file), await readFile(file, 'utf8')];
      }),
  );
}

async function postFiles(cms: Cms): Promise<string[]> {
  return await readdir(path.join(cms.config.contentDir, 'posts')).catch(() => []);
}

async function text(cms: Cms, pathname: string, accept?: string): Promise<string> {
  const response = await cms.app.request(
    pathname,
    accept === undefined ? {} : { headers: { accept } },
  );
  assert.equal(response.status, 200, `${pathname} as ${accept ?? 'html'}`);
  return await response.text();
}

const NESTED = {
  type: ['h-entry'],
  properties: {
    published: ['2017-05-31T12:03:36-07:00'],
    content: ['Lunch meeting'],
    ate: [
      {
        type: ['h-food'],
        properties: {
          name: ['Carnitas tacos'],
          url: ['https://menu.example/carnitas'],
          calories: [41273],
        },
      },
    ],
  },
};

const ATE = NESTED.properties.ate;
const SECRETS = ['h-food', 'Carnitas', 'menu.example', '41273'];

describe('a property the site does not understand (AC #1, #5)', () => {
  it('answers a nested object it does not understand with 201, publishes the rest and keeps the object under dataDir', async () => {
    const { cms, token } = await site();
    const url = await created(await postJson(cms, token, NESTED));
    const permalink = new URL(url).pathname;

    assert.match(await text(cms, permalink), /Lunch meeting/);
    assert.deepEqual(await keptFile(cms), { [permalink]: { ate: ATE } });
    const mode = (await stat(path.join(cms.config.dataDir, KEPT_PROPERTIES_FILE))).mode & 0o777;
    assert.equal(mode, 0o600);
    for (const [file, contents] of await filesUnder(cms.config.contentDir)) {
      for (const needle of SECRETS)
        assert.ok(!contents.includes(needle), `${file} holds ${needle}`);
    }
  });

  it('keeps a form-encoded one as the text it was sent', async () => {
    const { cms, token } = await site();
    const url = await created(
      await postForm(cms, token, [
        ['h', 'entry'],
        ['content', 'Morning.'],
        ['mood', 'sleepy'],
        ['mood', 'hungry'],
      ]),
    );
    assert.deepEqual(await keptFile(cms), {
      [new URL(url).pathname]: { mood: ['sleepy', 'hungry'] },
    });
  });

  it('writes no file for a post that keeps nothing', async () => {
    const { cms, token } = await site();
    await created(
      await postForm(cms, token, [
        ['h', 'entry'],
        ['content', 'Plain.'],
      ]),
    );
    await assert.rejects(stat(path.join(cms.config.dataDir, KEPT_PROPERTIES_FILE)));
  });

  it('refuses more than it keeps for a post, and writes nothing', async () => {
    const { cms, token } = await site();
    const response = await postJson(cms, token, {
      type: ['h-entry'],
      properties: { content: ['Big.'], blob: ['x'.repeat(17 * 1024)] },
    });
    assert.match(await refusal(response), /up to 16 KiB .* blob come to 18 KiB/);
    assert.deepEqual(await postFiles(cms), []);
  });

  it('refuses a file sent as a property it does not understand', async () => {
    const { cms, token } = await site();
    const form = new FormData();
    form.set('h', 'entry');
    form.set('content', 'With a file.');
    form.set('audio', new File(['RIFF'], 'a.wav', { type: 'audio/wav' }));
    const response = await cms.app.request(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    assert.match(await refusal(response), /audio is not understood here and is not a photo/);
    assert.deepEqual(await postFiles(cms), []);
  });
});

describe('a create with nothing to publish (AC #6)', () => {
  it('refuses Quill’s weight post, which is an h-measure and a date, naming weight', async () => {
    const { cms, token } = await site();
    const response = await postJson(cms, token, {
      type: ['h-entry'],
      properties: {
        weight: [{ type: ['h-measure'], properties: { num: ['317'], unit: ['lbs'] } }],
        published: ['2026-09-20T08:00:00-07:00'],
      },
    });
    assert.match(
      await refusal(response),
      /does not understand weight, and the post has nothing else/,
    );
    assert.deepEqual(await postFiles(cms), []);
    await assert.rejects(stat(path.join(cms.config.dataDir, KEPT_PROPERTIES_FILE)));
  });

  it('takes the same property beside a like, which needs no content', async () => {
    const { cms, token } = await site();
    await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: { 'like-of': ['https://peer.example/a-post/'], weight: ['317 lbs'] },
      }),
    );
  });
});

describe('mp-* commands (AC #4)', () => {
  it('still refuses a command the site does not support, by name, on a create and an update', async () => {
    const { cms, token } = await site();
    const response = await postJson(cms, token, {
      type: ['h-entry'],
      properties: { content: ['Hi.'], 'mp-channel': ['notes'] },
    });
    assert.match(await refusal(response), /does not support mp-channel/);
    assert.deepEqual(await postFiles(cms), []);

    const url = await created(await postJson(cms, token, { ...NESTED }));
    const update = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { 'mp-destination': ['elsewhere'] },
    });
    assert.match(await refusal(update), /cannot update mp-destination/);
  });
});

describe('reading and changing what is kept (AC #2)', () => {
  it('answers q=source with the kept properties as they were sent', async () => {
    const { cms, token } = await site();
    const url = await created(await postJson(cms, token, NESTED));
    const properties = await source(cms, token, url);
    assert.deepEqual(properties['ate'], ATE);
    assert.deepEqual(properties['content'], ['Lunch meeting']);
  });

  it('replaces, adds to and deletes a kept property on an update, leaving the post’s file alone', async () => {
    const { cms, token } = await site();
    const url = await created(await postJson(cms, token, NESTED));
    const permalink = new URL(url).pathname;
    const [file] = await postFiles(cms);
    assert.ok(file !== undefined);

    await updated(cms, token, {
      action: 'update',
      url,
      replace: { ate: ['https://a.example/'] },
    });
    assert.deepEqual((await keptFile(cms))[permalink], { ate: ['https://a.example/'] });

    await updated(cms, token, {
      action: 'update',
      url,
      add: { ate: ['https://b.example/'], mood: ['fed'] },
    });
    assert.deepEqual((await keptFile(cms))[permalink], {
      ate: ['https://a.example/', 'https://b.example/'],
      mood: ['fed'],
    });

    await updated(cms, token, {
      action: 'update',
      url,
      delete: { ate: ['https://a.example/'] },
    });
    assert.deepEqual((await keptFile(cms))[permalink], {
      ate: ['https://b.example/'],
      mood: ['fed'],
    });

    await updated(cms, token, { action: 'update', url, replace: { content: ['Dinner.'] } });
    assert.deepEqual(
      (await keptFile(cms))[permalink],
      { ate: ['https://b.example/'], mood: ['fed'] },
      'an update that names none leaves them',
    );

    await updated(cms, token, { action: 'update', url, delete: ['ate', 'mood'] });
    assert.equal(permalink in (await keptFile(cms)), false);
    assert.equal('ate' in (await source(cms, token, url)), false);
    for (const [name, contents] of await filesUnder(cms.config.contentDir)) {
      for (const needle of ['a.example', 'b.example', 'mood']) {
        assert.ok(!contents.includes(needle), `${name} holds ${needle}`);
      }
    }
  });

  it('keeps them through a delete and an undelete', async () => {
    const { cms, token } = await site();
    const url = await created(await postJson(cms, token, NESTED));

    const deleted = await postJson(cms, token, { action: 'delete', url });
    assert.equal(deleted.status, 204);
    assert.deepEqual((await source(cms, token, url))['ate'], ATE);

    const restored = await postJson(cms, token, { action: 'undelete', url });
    assert.equal(restored.status, 204);
    assert.deepEqual((await source(cms, token, url))['ate'], ATE);
  });

  it('moves them with a draft whose re-dating moves it', async () => {
    const { cms, token } = await site();
    const url = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: { content: ['Later.'], 'post-status': ['draft'], ate: ATE },
      }),
    );
    const response = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { published: ['2026-10-05T09:00:00Z'] },
    });
    const moved = await created(response);
    assert.notEqual(moved, url);
    assert.deepEqual(await keptFile(cms), { [new URL(moved).pathname]: { ate: ATE } });
  });

  it('keeps them through an editor save, and moves them with a slug the editor renames', async () => {
    const { cms, agent, token } = await site();
    const url = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: {
          name: ['At lunch'],
          content: ['Lunch.'],
          'mp-slug': ['at-lunch'],
          'post-status': ['draft'],
          ate: ATE,
        },
      }),
    );
    const draft = cms.store.getByPermalink(new URL(url).pathname);
    assert.ok(draft !== undefined);
    const csrf = csrfField(await (await agent.get('/admin/posts/at-lunch')).text());
    assert.ok(csrf !== undefined);

    const saved = await agent.post('/admin/posts/at-lunch', {
      csrf_token: csrf,
      title: 'At lunch',
      slug: 'out-to-lunch',
      body: 'Lunch.',
      draft: '1',
      action: 'save-draft',
      hash: draft.hash,
    });
    assert.equal(saved.status, 303);

    const renamed = cms.store.getBySlug('out-to-lunch');
    assert.ok(renamed !== undefined);
    assert.notEqual(renamed.permalink, draft.permalink);
    assert.deepEqual(await keptFile(cms), { [renamed.permalink]: { ate: ATE } });
  });
});

describe('public surfaces (AC #3)', () => {
  it('no kept property appears on the page, its representations, the feeds, the object, search or llms.txt', async () => {
    const { cms, token } = await site();
    const url = await created(await postJson(cms, token, NESTED));
    const pathname = new URL(url).pathname;

    const surfaces: Record<string, string> = {
      page: await text(cms, pathname),
      markdown: await text(cms, pathname, 'text/markdown'),
      json: await text(cms, pathname, 'application/json'),
      rss: await text(cms, feedPathUnder('/', 'rss')),
      atom: await text(cms, feedPathUnder('/', 'atom')),
      jsonFeed: await text(cms, feedPathUnder('/', 'json')),
      activityStreams: await text(cms, pathname, 'application/activity+json'),
      oembed: await text(cms, `${OEMBED_PATH}?${new URLSearchParams({ url }).toString()}`),
      llms: await text(cms, '/llms.txt'),
      search: await text(cms, '/search/?q=Lunch'),
      searchJson: await text(cms, '/search/index.json?q=Lunch'),
      ...Object.fromEntries(
        (await filesUnder(cms.config.contentDir)).map(([file, contents]) => [
          `content/${file}`,
          contents,
        ]),
      ),
    };
    for (const name of ['page', 'markdown', 'json', 'rss', 'activityStreams', 'search']) {
      assert.match(surfaces[name] ?? '', /Lunch meeting/, `${name} carries the post`);
    }
    for (const [name, contents] of Object.entries(surfaces)) {
      for (const needle of SECRETS)
        assert.ok(!contents.includes(needle), `${name} holds ${needle}`);
    }
  });
});
